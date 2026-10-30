"""
Automated Unit Tests for Little Memories Flask Application
"""

import os
import unittest
import base64
from io import BytesIO
from PIL import Image
from app import app, SAVED_STRIPS_DIR


class TestLittleMemories(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_homepage_loads(self):
        """Verify that the landing page renders with Little Memories branding and dual modes."""
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('Little Memories', html)
        self.assertIn('Every Moment Deserves a Picture', html)
        self.assertIn('LDR Photobooth', html)
        self.assertIn('Just you and me, wherever we are.', html)
        self.assertIn('Friends Photobooth', html)
        self.assertIn('Make memories together.', html)
        self.assertIn('Your Privacy is Always Protected', html)

    def test_friends_local_studio_loads(self):
        """Verify that the Local Friends Photobooth studio loads with all camera elements."""
        response = self.client.get('/friends/local')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('webcam-video', html)
        self.assertIn('review-canvas', html)
        self.assertIn('btn-start-camera', html)
        self.assertIn('btn-capture-photo', html)
        self.assertIn('btn-download-strip', html)

    def test_booth_route_backwards_compatible(self):
        """Verify that legacy /booth route renders cleanly."""
        response = self.client.get('/booth')
        self.assertEqual(response.status_code, 200)

    def test_health_check(self):
        """Verify health check endpoint returns 200 OK and expected JSON."""
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data.get('status'), 'ok')
        self.assertEqual(data.get('app'), 'Little Memories')

    def test_create_and_join_ldr_room(self):
        """Verify creating an LDR room with limit 2 and rejecting a 3rd participant."""
        # 1. Create LDR room
        res = self.client.post('/api/rooms/create', json={'mode': 'ldr', 'nickname': 'Romeo'})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get('success'))
        room_id = data.get('room_id')
        self.assertTrue(room_id.startswith('ldr-'))
        self.assertEqual(data.get('max_capacity'), 2)

        # 2. Status should be 1/2
        status_res = self.client.get(f'/api/rooms/{room_id}')
        self.assertEqual(status_res.status_code, 200)
        self.assertEqual(status_res.get_json()['count'], 1)

        # 3. Join second user (Juliet) -> 2/2
        join_res = self.client.post(f'/api/rooms/{room_id}/join', json={'nickname': 'Juliet'})
        self.assertEqual(join_res.status_code, 200)
        self.assertTrue(join_res.get_json()['success'])

        # 4. Attempt to join 3rd user -> should fail (403 full)
        fail_res = self.client.post(f'/api/rooms/{room_id}/join', json={'nickname': 'ThirdWheel'})
        self.assertEqual(fail_res.status_code, 403)
        self.assertTrue(fail_res.get_json()['is_full'])

    def test_create_and_join_friends_room(self):
        """Verify creating a Friends room with limit 4."""
        res = self.client.post('/api/rooms/create', json={'mode': 'friends', 'nickname': 'Friend 1'})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        room_id = data.get('room_id')
        self.assertTrue(room_id.startswith('friends-'))
        self.assertEqual(data.get('max_capacity'), 4)

    def test_signaling_flow(self):
        """Verify WebRTC signaling message dispatch and retrieval."""
        res = self.client.post('/api/rooms/create', json={'mode': 'ldr', 'nickname': 'Alice'})
        room_id = res.get_json()['room_id']
        peer_alice = res.get_json()['peer_id']

        join_res = self.client.post(f'/api/rooms/{room_id}/join', json={'nickname': 'Bob'})
        peer_bob = join_res.get_json()['peer_id']

        # Alice sends offer to Bob
        offer_res = self.client.post(f'/api/rooms/{room_id}/signal', json={
            'from': peer_alice,
            'to': peer_bob,
            'type': 'OFFER',
            'data': {'sdp': 'fake-sdp-offer'}
        })
        self.assertEqual(offer_res.status_code, 200)

        # Bob polls signals
        poll_res = self.client.get(f'/api/rooms/{room_id}/signals?peer_id={peer_bob}&last_id=0')
        self.assertEqual(poll_res.status_code, 200)
        signals = poll_res.get_json()['signals']
        self.assertTrue(any(s['type'] == 'OFFER' for s in signals))

    def test_save_strip_valid(self):
        """Verify saving a valid base64 PNG photo strip to server."""
        img = Image.new('RGB', (100, 300), color=(255, 248, 239))
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        b64_str = f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}"

        payload = {
            "image": b64_str,
            "title": "Little Memories Test Strip"
        }

        response = self.client.post('/api/save-strip', json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get('success'))
        self.assertIn('filename', data)
        saved_file = os.path.join(SAVED_STRIPS_DIR, data['filename'])
        self.assertTrue(os.path.exists(saved_file))

        try:
            os.remove(saved_file)
        except OSError:
            pass

    def test_save_strip_invalid_data(self):
        """Verify rejection of malformed image data."""
        payload = {"image": "not-a-valid-data-url"}
        response = self.client.post('/api/save-strip', json=payload)
        self.assertEqual(response.status_code, 400)


    def test_turn_credentials_endpoint(self):
        """Verify WebRTC STUN/TURN configuration endpoint returns valid iceServers."""
        response = self.client.get('/api/turn-credentials')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn('iceServers', data)
        self.assertIsInstance(data['iceServers'], list)
        self.assertGreaterEqual(len(data['iceServers']), 2)


if __name__ == '__main__':
    unittest.main()
