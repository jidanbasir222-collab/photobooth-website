"""
Little Memories — Dual-Mode Photobooth
Backend Application (Flask)
Compatible with Localhost and Vercel Serverless Environments
"""

import os
import re
import uuid
import secrets
import base64
import tempfile
import threading
from io import BytesIO
from datetime import datetime, timezone, timedelta
from flask import Flask, render_template, jsonify, request, send_from_directory, abort, redirect, url_for
from PIL import Image

# Absolute paths for templates and static assets
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, 'templates')
STATIC_DIR = os.path.join(BASE_DIR, 'static')

app = Flask(
    __name__,
    template_folder=TEMPLATES_DIR,
    static_folder=STATIC_DIR,
    static_url_path='/static'
)

# Configurations
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'little-memories-secret-2026')
app.config['MAX_CONTENT_LENGTH'] = 24 * 1024 * 1024  # 24 MB max payload limit

# Storage handling (with read-only filesystem fallback to /tmp for Vercel Serverless)
INSTANCE_DIR = os.path.join(BASE_DIR, 'instance')
LOCAL_SAVED_DIR = os.path.join(INSTANCE_DIR, 'saved_strips')

try:
    os.makedirs(LOCAL_SAVED_DIR, exist_ok=True)
    test_path = os.path.join(LOCAL_SAVED_DIR, '.write_test')
    with open(test_path, 'w') as f:
        f.write('ok')
    os.remove(test_path)
    SAVED_STRIPS_DIR = LOCAL_SAVED_DIR
except (OSError, PermissionError):
    SAVED_STRIPS_DIR = os.path.join(tempfile.gettempdir(), 'saved_strips')
    try:
        os.makedirs(SAVED_STRIPS_DIR, exist_ok=True)
    except Exception:
        SAVED_STRIPS_DIR = tempfile.gettempdir()


# --------------------------------------------------------------------------
# In-Memory Thread-Safe Private Room & Signaling Store
# --------------------------------------------------------------------------
rooms_lock = threading.Lock()
# rooms structure:
# room_id -> {
#    "id": room_id,
#    "mode": "ldr" or "friends",
#    "max_capacity": int (2 for ldr, 4 for friends),
#    "created_at": datetime,
#    "last_activity": datetime,
#    "participants": { peer_id: {"name": str, "joined_at": datetime, "is_ready": bool} },
#    "signals": [ {"from": peer_id, "to": target_peer_id or None, "data": dict, "id": int, "timestamp": float} ],
#    "signal_counter": int
# }
ROOMS = {}
ROOM_EXPIRY_HOURS = 4


def cleanup_expired_rooms():
    """Remove rooms inactive for more than ROOM_EXPIRY_HOURS."""
    now = datetime.now(timezone.utc)
    expired_ids = []
    with rooms_lock:
        for r_id, r in ROOMS.items():
            if now - r['last_activity'] > timedelta(hours=ROOM_EXPIRY_HOURS):
                expired_ids.append(r_id)
        for r_id in expired_ids:
            del ROOMS[r_id]


# --------------------------------------------------------------------------
# Public Pages & Navigation
# --------------------------------------------------------------------------
@app.route('/')
def index():
    """Renders the main Little Memories landing page with dual-mode selector."""
    return render_template('index.html')


@app.route('/booth')
def booth():
    """Renders the Local Friends Mode photobooth (single device in one place)."""
    return render_template('booth.html', mode='local')


@app.route('/friends/local')
def friends_local():
    """Explicit route for Local Friends Mode."""
    return render_template('booth.html', mode='local')


@app.route('/ldr')
def ldr_booth():
    """Renders LDR Couple Photobooth studio / lobby."""
    room_id = request.args.get('room', '').strip()
    return render_template('ldr.html', mode='ldr', initial_room_id=room_id)


@app.route('/ldr/<room_id>')
def ldr_room(room_id):
    """Direct route for joining an LDR Couple room via invitation link."""
    return render_template('ldr.html', mode='ldr', initial_room_id=room_id)


@app.route('/friends/remote')
def friends_remote():
    """Renders Remote Friends Photobooth studio / lobby."""
    room_id = request.args.get('room', '').strip()
    return render_template('friends_remote.html', mode='remote_friends', initial_room_id=room_id)


@app.route('/friends/remote/<room_id>')
def friends_remote_room(room_id):
    """Direct route for joining a Remote Friends room via invitation link."""
    return render_template('friends_remote.html', mode='remote_friends', initial_room_id=room_id)


@app.route('/room/<room_id>')
def universal_room_redirect(room_id):
    """
    Universal room redirector:
    Checks if room is an LDR or Friends room and directs user to correct studio.
    """
    cleanup_expired_rooms()
    with rooms_lock:
        room = ROOMS.get(room_id)
        if room and room.get('mode') == 'friends':
            return redirect(url_for('friends_remote_room', room_id=room_id))
    # Default to ldr
    return redirect(url_for('ldr_room', room_id=room_id))


@app.route('/health')
def health():
    """Application health check endpoint."""
    return jsonify({
        "status": "ok",
        "app": "Little Memories",
        "version": "2.1.0",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })


@app.route('/favicon.ico')
@app.route('/favicon.png')
def favicon():
    """Serve a camera heart favicon for browser requests."""
    svg_favicon = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#74564A"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3" fill="#F5D9DC"/></svg>"""
    return svg_favicon, 200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400"
    }


# --------------------------------------------------------------------------
# Private Room & WebRTC Signaling REST API
# Compatible with Vercel Serverless Functions and Localhost
# --------------------------------------------------------------------------
@app.route('/api/rooms/create', methods=['POST'])
def create_room():
    """
    Create a new private room for either LDR (2 people) or Remote Friends (up to 4).
    Generates a secure random room ID.
    """
    cleanup_expired_rooms()
    data = request.get_json(silent=True) or {}
    mode = (data.get('mode') or 'ldr').strip().lower()
    if mode not in ('ldr', 'friends'):
        mode = 'ldr'

    default_name = 'Partner 1' if mode == 'ldr' else 'Friend 1'
    host_name = (data.get('nickname') or default_name).strip()[:30]

    random_token = secrets.token_hex(4)
    room_prefix = 'ldr' if mode == 'ldr' else 'friends'
    room_id = f"{room_prefix}-{random_token}"
    peer_id = secrets.token_hex(6)
    now = datetime.now(timezone.utc)
    max_capacity = 2 if mode == 'ldr' else 4

    with rooms_lock:
        ROOMS[room_id] = {
            "id": room_id,
            "mode": mode,
            "max_capacity": max_capacity,
            "created_at": now,
            "last_activity": now,
            "participants": {
                peer_id: {
                    "id": peer_id,
                    "name": host_name,
                    "joined_at": now.isoformat(),
                    "is_ready": False
                }
            },
            "signals": [],
            "signal_counter": 0
        }

    return jsonify({
        "success": True,
        "room_id": room_id,
        "mode": mode,
        "peer_id": peer_id,
        "nickname": host_name,
        "max_capacity": max_capacity,
        "message": "Room created successfully! Share the invite link with your favorites. ♡"
    })


@app.route('/api/rooms/<room_id>', methods=['GET'])
def get_room_status(room_id):
    """Check room status, mode, participant count, and capacity."""
    cleanup_expired_rooms()
    with rooms_lock:
        room = ROOMS.get(room_id)
        if not room:
            return jsonify({
                "exists": False,
                "error": "Room not found or has expired. Please create a new room! ♡"
            }), 404

        max_cap = room.get("max_capacity", 2)
        participant_list = [
            {"id": p_id, "name": p["name"], "is_ready": p.get("is_ready", False)}
            for p_id, p in room["participants"].items()
        ]

        return jsonify({
            "exists": True,
            "room_id": room_id,
            "mode": room.get("mode", "ldr"),
            "count": len(room["participants"]),
            "max": max_cap,
            "is_full": len(room["participants"]) >= max_cap,
            "participants": participant_list
        })


@app.route('/api/rooms/<room_id>/join', methods=['POST'])
def join_room(room_id):
    """
    Join an existing private room.
    Validates participant limit (2 for LDR, 4 for Friends).
    """
    cleanup_expired_rooms()
    data = request.get_json(silent=True) or {}
    nickname = (data.get('nickname') or 'Guest').strip()[:30]

    with rooms_lock:
        room = ROOMS.get(room_id)
        if not room:
            return jsonify({"error": "Room does not exist or has expired."}), 404

        max_cap = room.get("max_capacity", 2)
        if len(room["participants"]) >= max_cap:
            msg = "This private couple room already has 2 sweethearts inside! ♡" if room.get("mode") == "ldr" else f"This friends room has reached its limit of {max_cap} participants! ♡"
            return jsonify({
                "error": msg,
                "is_full": True
            }), 403

        peer_id = secrets.token_hex(6)
        now = datetime.now(timezone.utc)
        room["last_activity"] = now
        room["participants"][peer_id] = {
            "id": peer_id,
            "name": nickname,
            "joined_at": now.isoformat(),
            "is_ready": False
        }

        # Broadcast user joined signal to other participants
        room["signal_counter"] += 1
        room["signals"].append({
            "id": room["signal_counter"],
            "from": peer_id,
            "to": None,
            "type": "USER_JOINED",
            "data": {
                "peer_id": peer_id,
                "name": nickname
            },
            "timestamp": now.timestamp()
        })

        participant_list = [
            {"id": p_id, "name": p["name"], "is_ready": p.get("is_ready", False)}
            for p_id, p in room["participants"].items()
        ]

    return jsonify({
        "success": True,
        "room_id": room_id,
        "mode": room.get("mode", "ldr"),
        "peer_id": peer_id,
        "nickname": nickname,
        "participants": participant_list,
        "message": "Welcome to the room! ❤️"
    })


@app.route('/api/rooms/<room_id>/signal', methods=['POST'])
def send_signal(room_id):
    """
    Relay WebRTC signaling messages (Offer, Answer, ICE Candidates, Ready states,
    Countdown triggers, Still-image photo transfers).
    """
    data = request.get_json(silent=True)
    if not data or 'from' not in data or 'type' not in data:
        return jsonify({"error": "Invalid signaling payload"}), 400

    from_peer = data['from']
    target_peer = data.get('to')
    signal_type = data['type']
    payload = data.get('data', {})

    now = datetime.now(timezone.utc)

    with rooms_lock:
        room = ROOMS.get(room_id)
        if not room:
            return jsonify({"error": "Room not found"}), 404

        if from_peer not in room["participants"]:
            return jsonify({"error": "Unauthorized peer"}), 403

        room["last_activity"] = now
        room["signal_counter"] += 1

        if signal_type == 'SET_READY':
            is_ready = bool(payload.get('is_ready', False))
            room["participants"][from_peer]["is_ready"] = is_ready

        signal_entry = {
            "id": room["signal_counter"],
            "from": from_peer,
            "to": target_peer,
            "type": signal_type,
            "data": payload,
            "timestamp": now.timestamp()
        }
        room["signals"].append(signal_entry)

        # Keep queue bounded
        if len(room["signals"]) > 100:
            room["signals"] = room["signals"][-60:]

    return jsonify({"success": True, "signal_id": signal_entry["id"]})


@app.route('/api/rooms/<room_id>/signals', methods=['GET'])
def poll_signals(room_id):
    """
    Poll for pending signaling messages directed to a peer (or broadcast).
    Guarantees WebRTC negotiation works seamlessly even on serverless hosts.
    """
    peer_id = request.args.get('peer_id')
    last_id = int(request.args.get('last_id', 0))

    if not peer_id:
        return jsonify({"error": "Missing peer_id parameter"}), 400

    with rooms_lock:
        room = ROOMS.get(room_id)
        if not room:
            return jsonify({"error": "Room not found"}), 404

        if peer_id not in room["participants"]:
            return jsonify({"error": "Peer no longer in room"}), 403

        now = datetime.now(timezone.utc)
        room["last_activity"] = now

        new_signals = []
        for s in room["signals"]:
            if s["id"] > last_id and s["from"] != peer_id:
                if s["to"] is None or s["to"] == peer_id:
                    new_signals.append(s)

        participants_status = [
            {"id": p_id, "name": p["name"], "is_ready": p.get("is_ready", False)}
            for p_id, p in room["participants"].items()
        ]

        return jsonify({
            "signals": new_signals,
            "participants": participants_status,
            "last_id": room["signal_counter"]
        })


@app.route('/api/rooms/<room_id>/leave', methods=['POST'])
def leave_room(room_id):
    """Gracefully remove a participant and notify room."""
    data = request.get_json(silent=True) or {}
    peer_id = data.get('peer_id')

    with rooms_lock:
        room = ROOMS.get(room_id)
        if room and peer_id in room["participants"]:
            p_name = room["participants"][peer_id]["name"]
            del room["participants"][peer_id]

            room["signal_counter"] += 1
            now = datetime.now(timezone.utc)
            room["signals"].append({
                "id": room["signal_counter"],
                "from": peer_id,
                "to": None,
                "type": "USER_LEFT",
                "data": {"peer_id": peer_id, "name": p_name},
                "timestamp": now.timestamp()
            })

            if len(room["participants"]) == 0:
                del ROOMS[room_id]

    return jsonify({"success": True})


# --------------------------------------------------------------------------
# Opt-in Photo Strip Storage & Gallery
# --------------------------------------------------------------------------
@app.route('/api/save-strip', methods=['POST'])
def save_strip():
    """
    Opt-in endpoint to save a final photo strip.
    Validates base64 image data and saves safely into serverless /tmp or local storage.
    """
    try:
        data = request.get_json(silent=True)
        if not data or 'image' not in data:
            return jsonify({"error": "No image data provided"}), 400

        image_data = data['image']
        title = data.get('title', 'little-memories-strip')
        sanitized_title = re.sub(r'[^a-zA-Z0-9_\-]', '', title.replace(' ', '-'))[:30] or 'photo-strip'

        match = re.match(r'^data:image/(png|jpeg|webp);base64,(.+)$', image_data)
        if not match:
            return jsonify({"error": "Invalid image format. Expected base64 PNG or JPEG."}), 400

        img_format = match.group(1).lower()
        extension = 'jpg' if img_format == 'jpeg' else ('webp' if img_format == 'webp' else 'png')
        raw_bytes = base64.b64decode(match.group(2))

        try:
            with Image.open(BytesIO(raw_bytes)) as pil_img:
                pil_img.verify()
        except Exception:
            return jsonify({"error": "Uploaded data is not a valid image"}), 400

        date_str = datetime.now().strftime('%Y-%m-%d_%H%M%S')
        random_suffix = uuid.uuid4().hex[:6]
        filename = f"{sanitized_title}_{date_str}_{random_suffix}.{extension}"
        file_path = os.path.join(SAVED_STRIPS_DIR, filename)

        with open(file_path, 'wb') as f:
            f.write(raw_bytes)

        return jsonify({
            "success": True,
            "filename": filename,
            "url": f"/api/saved/{filename}",
            "message": "Photo strip safely saved to gallery! ♡"
        })

    except Exception as e:
        app.logger.error(f"Error saving strip: {e}")
        return jsonify({"error": "Server failed to save photo strip"}), 500


@app.route('/api/saved/<path:filename>')
def get_saved_strip(filename):
    """Safely serves saved photo strips."""
    if '..' in filename or filename.startswith('/') or filename.startswith('\\') or ':' in filename:
        abort(400)
    if not os.path.exists(SAVED_STRIPS_DIR):
        abort(404)
    return send_from_directory(SAVED_STRIPS_DIR, filename)


@app.route('/api/gallery')
def list_saved_gallery():
    """Lists saved photo strips."""
    try:
        files = []
        if os.path.exists(SAVED_STRIPS_DIR):
            for entry in sorted(os.listdir(SAVED_STRIPS_DIR), reverse=True):
                if entry.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    files.append({
                        "filename": entry,
                        "url": f"/api/saved/{entry}"
                    })
        return jsonify({"strips": files})
    except Exception as e:
        app.logger.error(f"Error listing gallery: {e}")
        return jsonify({"strips": []}), 500


@app.errorhandler(404)
def not_found_error(error):
    return render_template('index.html', error="Page not found"), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    debug_mode = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1')
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Little Memories on http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=debug_mode)
