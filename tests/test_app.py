"""
Automated Unit Tests for Our Little Booth Flask Application
"""

import os
import unittest
import base64
from io import BytesIO
from PIL import Image
from app import app, SAVED_STRIPS_DIR


class TestOurLittleBooth(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_homepage_loads(self):
        """Verify that the landing page renders with correct content."""
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('A Little Place for', html)
        self.assertIn('Our Memories', html)
        self.assertIn('Two siblings, endless silly poses, and memories worth keeping', html)
        self.assertIn('Start Taking Photos', html)
        self.assertIn('View How It Works', html)
        self.assertIn('Made with love, just for us', html)

    def test_booth_studio_loads(self):
        """Verify that the photobooth studio renders all core UI elements."""
        response = self.client.get('/booth')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('webcam-video', html)
        self.assertIn('review-canvas', html)
        self.assertIn('btn-start-camera', html)
        self.assertIn('btn-capture-photo', html)
        self.assertIn('btn-download-strip', html)
        self.assertIn('camera.js', html)
        self.assertIn('filters.js', html)
        self.assertIn('photo-strip.js', html)
        self.assertIn('photobooth.js', html)

    def test_health_check(self):
        """Verify health check endpoint returns 200 OK and expected JSON."""
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data.get('status'), 'ok')
        self.assertEqual(data.get('app'), 'Our Little Booth')

    def test_save_strip_valid(self):
        """Verify saving a valid base64 PNG photo strip to server."""
        # Create a small valid test PNG using Pillow
        img = Image.new('RGB', (100, 300), color=(255, 248, 239))
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        b64_str = f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}"

        payload = {
            "image": b64_str,
            "title": "Test Strip",
            "layout": "vertical-4"
        }

        response = self.client.post('/api/save-strip', json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data.get('success'))
        self.assertIn('filename', data)
        saved_file = os.path.join(SAVED_STRIPS_DIR, data['filename'])
        self.assertTrue(os.path.exists(saved_file))

        # Clean up created test file
        try:
            os.remove(saved_file)
        except OSError:
            pass

    def test_save_strip_invalid_data(self):
        """Verify rejection of malformed image data."""
        payload = {
            "image": "not-a-valid-data-url",
            "title": "Invalid"
        }
        response = self.client.post('/api/save-strip', json=payload)
        self.assertEqual(response.status_code, 400)

    def test_save_strip_fake_image_bytes(self):
        """Verify rejection of fake corrupted image bytes."""
        fake_b64 = f"data:image/png;base64,{base64.b64encode(b'this is not an image').decode('utf-8')}"
        payload = {"image": fake_b64}
        response = self.client.post('/api/save-strip', json=payload)
        self.assertEqual(response.status_code, 400)

    def test_gallery_endpoint(self):
        """Verify listing of saved strips."""
        response = self.client.get('/api/gallery')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn('strips', data)
        self.assertIsInstance(data['strips'], list)

    def test_directory_traversal_prevention(self):
        """Verify path traversal attack prevention on saved strips route."""
        response = self.client.get('/api/saved/../../etc/passwd')
        self.assertIn(response.status_code, [400, 404])


if __name__ == '__main__':
    unittest.main()
