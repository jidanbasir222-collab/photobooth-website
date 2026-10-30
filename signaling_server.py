"""
LDR Together Booth ❤️ — Standalone Python WebSocket Signaling Server
Provides persistent real-time WebSockets for WebRTC signaling (Offer/Answer/ICE/Sync)
when deployed on persistent hosts like Render, Railway, Fly.io, or run locally.
"""

import os
import json
import asyncio
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("LDR-Signaling")

# In-memory rooms: room_id -> { peer_id: {"ws": websocket, "name": str} }
ROOMS = {}
MAX_PER_ROOM = 2

async def handle_connection(websocket, path=None):
    current_room = None
    current_peer_id = None
    current_name = None

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except Exception:
                continue

            msg_type = data.get("type")
            room_id = data.get("room_id")
            peer_id = data.get("from")

            if msg_type == "JOIN_ROOM":
                current_room = room_id
                current_peer_id = peer_id
                current_name = data.get("nickname", "Partner")

                if current_room not in ROOMS:
                    ROOMS[current_room] = {}

                if len(ROOMS[current_room]) >= MAX_PER_ROOM and current_peer_id not in ROOMS[current_room]:
                    await websocket.send(json.dumps({
                        "type": "ROOM_FULL",
                        "error": "This room already has 2 sweethearts inside! ♡"
                    }))
                    return

                ROOMS[current_room][current_peer_id] = {
                    "ws": websocket,
                    "name": current_name
                }
                logger.info(f"Peer {current_name} ({current_peer_id}) joined room {current_room} ({len(ROOMS[current_room])}/{MAX_PER_ROOM})")

                # Notify self of current room status
                participants = [
                    {"id": pid, "name": p["name"]}
                    for pid, p in ROOMS[current_room].items()
                ]
                await websocket.send(json.dumps({
                    "type": "ROOM_JOINED",
                    "room_id": current_room,
                    "peer_id": current_peer_id,
                    "participants": participants
                }))

                # Notify other partner in the room
                for pid, p in ROOMS[current_room].items():
                    if pid != current_peer_id:
                        try:
                            await p["ws"].send(json.dumps({
                                "type": "USER_JOINED",
                                "from": current_peer_id,
                                "name": current_name,
                                "participants": participants
                            }))
                        except Exception as e:
                            logger.warn(f"Failed to notify partner: {e}")

            elif current_room and current_room in ROOMS:
                # Forward signaling (OFFER, ANSWER, ICE_CANDIDATE, COUNTDOWN, SYNC, etc.) to partner
                target_peer = data.get("to")
                for pid, p in ROOMS[current_room].items():
                    if pid != current_peer_id and (target_peer is None or target_peer == pid):
                        try:
                            await p["ws"].send(json.dumps(data))
                        except Exception as e:
                            logger.warn(f"Error relaying message: {e}")

    except Exception as e:
        logger.info(f"Connection ended for {current_name}: {e}")
    finally:
        # Cleanup on disconnect
        if current_room and current_room in ROOMS:
            if current_peer_id in ROOMS[current_room]:
                del ROOMS[current_room][current_peer_id]
                logger.info(f"Peer {current_name} left room {current_room}")

                # Notify remaining partner
                for pid, p in ROOMS[current_room].items():
                    try:
                        await p["ws"].send(json.dumps({
                            "type": "USER_LEFT",
                            "from": current_peer_id,
                            "name": current_name
                        }))
                    except Exception:
                        pass

            if len(ROOMS[current_room]) == 0:
                del ROOMS[current_room]


async def main():
    port = int(os.environ.get("PORT", 8765))
    try:
        import websockets
        async with websockets.serve(handle_connection, "0.0.0.0", port):
            logger.info(f"LDR WebRTC Signaling WebSocket server started on ws://0.0.0.0:{port}")
            await asyncio.Future()  # run forever
    except ImportError:
        logger.warn("websockets library not installed. Install with `pip install websockets` to run this standalone server.")


if __name__ == "__main__":
    asyncio.run(main())
