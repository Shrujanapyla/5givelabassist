import base64
import unittest
from io import BytesIO
from PIL import Image
from main import decode_image
from fastapi import HTTPException

class DecodeImageTests(unittest.TestCase):
    def test_decodes_valid_png_data_url(self):
        buffer = BytesIO()
        Image.new('RGB', (32, 24), color='white').save(buffer, format='PNG')
        payload = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
        image = decode_image(payload)
        self.assertEqual(image.size, (32, 24))

    def test_rejects_invalid_payload(self):
        with self.assertRaises(HTTPException):
            decode_image('not-an-image')

    def test_rejects_oversized_dimensions(self):
        buffer = BytesIO()
        Image.new('RGB', (4100, 3100), color='white').save(buffer, format='PNG', optimize=True)
        payload = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
        with self.assertRaises(HTTPException) as error:
            decode_image(payload)
        self.assertEqual(error.exception.status_code, 413)

if __name__ == '__main__':
    unittest.main()
