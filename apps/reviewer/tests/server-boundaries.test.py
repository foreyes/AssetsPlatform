"""Synthetic filesystem only: both loopback servers must reject escape paths."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request
import urllib.error

SOURCE = Path(__file__).resolve().parent.parent

class Boundaries(unittest.TestCase):
    def test_both_servers(self):
        for server, command in [('serve.py', ['python']), ('server.mjs', ['node'])]:
            with self.subTest(server=server), tempfile.TemporaryDirectory() as tmp:
                base = Path(tmp)
                root = base / 'public'
                root.mkdir()
                shutil.copy(SOURCE / server, root / server)
                (root / 'index.html').write_text('safe')
                (base / 'outside.txt').write_text('synthetic-not-private')
                (root / '.hidden').write_text('synthetic-hidden')
                (root / 'escape.txt').symlink_to(base / 'outside.txt')
                (root / 'alias.txt').symlink_to(root / '.hidden')
                (root / 'listing').mkdir()
                (root / 'index-escape').mkdir()
                (root / 'index-escape' / 'index.html').symlink_to(base / 'outside.txt')
                (root / 'outdir').symlink_to(base, target_is_directory=True)
                with socket.socket() as sock:
                    sock.bind(('127.0.0.1', 0))
                    port = sock.getsockname()[1]
                process = subprocess.Popen(command + [str(root / server)], env={**os.environ, 'PORT': str(port)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    url = f'http://127.0.0.1:{port}'
                    for attempt in range(100):
                        try:
                            with urllib.request.urlopen(url + '/', timeout=1) as response:
                                self.assertEqual(response.read(), b'safe')
                            break
                        except OSError:
                            if process.poll() is not None:
                                self.fail('server exited before ready')
                            time.sleep(.02)
                    else:
                        self.fail('server not ready')
                    for method in ('GET', 'HEAD'):
                        for path in ('/escape.txt', '/alias.txt', '/.hidden', '/%2ehidden', '/listing/', '/index-escape/', '/outdir/outside.txt', '/../outside.txt'):
                            with self.subTest(method=method, path=path):
                                with self.assertRaises(urllib.error.HTTPError) as error:
                                    urllib.request.urlopen(urllib.request.Request(url + path, method=method), timeout=2)
                                self.assertIn(error.exception.code, (400, 404))
                finally:
                    process.terminate()
                    process.wait(timeout=5)

if __name__ == '__main__':
    unittest.main()
