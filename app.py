"""
Our Little Booth — Virtual Online Photobooth
Backend Application (Flask)
"""

import os
import re
import uuid
import base64
from io import BytesIO
from datetime import datetime
from flask import Flask, render_template, jsonify, request, send_from_directory, abort
from PIL import Image

app = Flask(__name__)

# Configurations
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'our-little-booth-secret-2026')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max payload limit
INSTANCE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'instance')
SAVED_STRIPS_DIR = os.path.join(INSTANCE_DIR, 'saved_strips')
os.makedirs(SAVED_STRIPS_DIR, exist_ok=True)


@app.route('/')
def index():
    """Renders the landing page."""
    return render_template('index.html')


@app.route('/booth')
def booth():
    """Renders the photobooth camera studio."""
    return render_template('booth.html')


@app.route('/health')
def health():
    """Application health check endpoint."""
    return jsonify({
        "status": "ok",
        "app": "Our Little Booth",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    })


@app.route('/api/save-strip', methods=['POST'])
def save_strip():
    """
    Opt-in endpoint to save a photo strip to the local server.
    Validates base64 image data, verifies safety with Pillow, and saves locally.
    """
    try:
        data = request.get_json(silent=True)
        if not data or 'image' not in data:
            return jsonify({"error": "No image data provided"}), 400

        image_data = data['image']
        title = data.get('title', 'our-little-strip')
        # Sanitize title for filename
        sanitized_title = re.sub(r'[^a-zA-Z0-9_\-]', '', title.replace(' ', '-'))[:30] or 'photo-strip'

        # Match base64 header
        match = re.match(r'^data:image/(png|jpeg|webp);base64,(.+)$', image_data)
        if not match:
            return jsonify({"error": "Invalid image format. Expected base64 PNG or JPEG."}), 400

        img_format = match.group(1).lower()
        if img_format == 'jpeg':
            extension = 'jpg'
        elif img_format == 'webp':
            extension = 'webp'
        else:
            extension = 'png'

        raw_bytes = base64.b64decode(match.group(2))

        # Security check: Validate that the data is an actual valid image using Pillow
        try:
            with Image.open(BytesIO(raw_bytes)) as pil_img:
                pil_img.verify()
        except Exception:
            return jsonify({"error": "Uploaded data is not a valid image"}), 400

        # Generate unique, safe filename
        date_str = datetime.now().strftime('%Y-%m-%d_%H%M%S')
        random_suffix = uuid.uuid4().hex[:6]
        filename = f"{sanitized_title}_{date_str}_{random_suffix}.{extension}"
        file_path = os.path.join(SAVED_STRIPS_DIR, filename)

        # Write to disk
        with open(file_path, 'wb') as f:
            f.write(raw_bytes)

        return jsonify({
            "success": True,
            "filename": filename,
            "url": f"/api/saved/{filename}",
            "message": "Photo strip safely saved to local server gallery!"
        })

    except Exception as e:
        app.logger.error(f"Error saving strip: {e}")
        return jsonify({"error": "Server failed to save photo strip"}), 500


@app.route('/api/saved/<filename>')
def get_saved_strip(filename):
    """Safely serves saved photo strips from the instance directory."""
    # Prevent directory traversal
    if '..' in filename or filename.startswith('/') or filename.startswith('\\'):
        abort(400)
    return send_from_directory(SAVED_STRIPS_DIR, filename)


@app.route('/api/gallery')
def list_saved_gallery():
    """Lists locally saved strips for the session."""
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
    # Default to 127.0.0.1:5000 for secure webcam access on localhost
    debug_mode = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1')
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Our Little Booth on http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=debug_mode)
