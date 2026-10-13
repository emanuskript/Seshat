import os
import time
import unittest
from pathlib import Path
from unittest.mock import ANY, Mock, patch

import app as seshat_app
from cleanup_runtime import cleanup


class SecurityTests(unittest.TestCase):
    def test_cors_origin_validation_rejects_paths_and_credentials(self):
        self.assertTrue(seshat_app._is_valid_origin("https://seshat.example.org"))
        self.assertFalse(seshat_app._is_valid_origin("https://seshat.example.org/api"))
        self.assertFalse(seshat_app._is_valid_origin("https://user:secret@seshat.example.org"))

    def test_export_proxy_rejects_non_public_destinations(self):
        cases = [
            ("http://localhost/image.jpg", "127.0.0.1"),
            ("http://metadata.internal/image.jpg", "169.254.169.254"),
            ("http://private.example/image.jpg", "10.1.2.3"),
            ("http://v6.example/image.jpg", "::1"),
        ]
        for url, address in cases:
            with self.subTest(url=url):
                answer = [(2, 1, 6, "", (address, 80))]
                with patch.object(seshat_app.socket, "getaddrinfo", return_value=answer):
                    with self.assertRaisesRegex(ValueError, "Private or non-routable"):
                        seshat_app._validate_public_http_url(url)

    def test_export_proxy_accepts_public_destination(self):
        answer = [(2, 1, 6, "", ("93.184.216.34", 443))]
        with patch.object(seshat_app.socket, "getaddrinfo", return_value=answer):
            parsed = seshat_app._validate_public_http_url("https://example.com/image.jpg")
        self.assertEqual(parsed.hostname, "example.com")

    def test_export_proxy_connects_to_the_validated_address(self):
        answer = [(2, 1, 6, "", ("93.184.216.34", 443))]
        response = Mock(status=200)
        connection = Mock()
        connection.getresponse.return_value = response

        with patch.object(seshat_app.socket, "getaddrinfo", return_value=answer), patch.object(
            seshat_app, "_PinnedHTTPSConnection", return_value=connection
        ) as connection_class:
            with seshat_app._open_public_image_url("https://example.com/image.jpg?size=full") as opened:
                self.assertIs(opened, response)

        connection_class.assert_called_once_with("example.com", 443, "93.184.216.34")
        connection.request.assert_called_once_with(
            "GET",
            "/image.jpg?size=full",
            headers=ANY,
        )
        connection.close.assert_called_once()

    def test_job_id_rejects_traversal(self):
        with self.assertRaisesRegex(ValueError, "Invalid job ID"):
            seshat_app.job_paths("../../etc")

    def test_cleanup_removes_only_expired_runtime_files(self):
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            old_job = root / "static" / "jobs" / "old"
            new_job = root / "static" / "jobs" / "new"
            uploads = root / "uploads"
            old_job.mkdir(parents=True)
            new_job.mkdir()
            uploads.mkdir()
            old_upload = uploads / "old.jpg"
            old_upload.write_bytes(b"old")
            timestamp = time.time() - 7200
            os.utime(old_job, (timestamp, timestamp))
            os.utime(old_upload, (timestamp, timestamp))

            self.assertEqual(cleanup(root, 3600), (1, 1))
            self.assertFalse(old_job.exists())
            self.assertFalse(old_upload.exists())
            self.assertTrue(new_job.exists())


if __name__ == "__main__":
    unittest.main()
