#!/usr/bin/env python3
"""Dev-сервер с Cache-Control: no-store — чтобы при отладке браузер всегда
получал свежие файлы. Запуск: python3 tools/devserver.py [порт]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8017
    server = ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    print(f"Serving on http://127.0.0.1:{port} (no-store)", flush=True)
    server.serve_forever()
