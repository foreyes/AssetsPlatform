"""Loopback development server only; not an authentication boundary."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def translate_path(self, path):
        candidate = Path(super().translate_path(path))
        try:
            relative = candidate.relative_to(ROOT)
            if any(part.startswith('.') for part in relative.parts):
                return os.devnull
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(ROOT)
            if any(part.startswith('.') for part in resolved.relative_to(ROOT).parts):
                return os.devnull
            return str(resolved)
        except (ValueError, OSError, RuntimeError):
            return os.devnull

    def list_directory(self, path):
        self.send_error(404)
        return None

    def send_head(self):
        if self.translate_path(self.path) == os.devnull:
            self.send_error(404)
            return None
        # Prevent the base handler following a symlinked directory index unchecked.
        target = Path(self.translate_path(self.path))
        if target.is_dir():
            for index in ('index.html', 'index.htm'):
                child = target / index
                if child.exists():
                    try:
                        relative = child.resolve(strict=True).relative_to(ROOT)
                        if any(part.startswith('.') for part in relative.parts):
                            raise ValueError('hidden')
                    except (ValueError, OSError, RuntimeError):
                        self.send_error(404)
                        return None
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        return super().send_head()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8768'))
    print(f'Asset Review: http://127.0.0.1:{port}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
