#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

FEATURES = [
    {"emoji": "🛗", "label": "Elevator", "enabled": True},
    {"emoji": "🔥", "label": "Chauffage collectif", "enabled": True}
]

class BackendHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers()

    def do_GET(self):
        if self.path == '/features':
            self._set_headers()
            payload = {'features': FEATURES}
            self.wfile.write(json.dumps(payload).encode('utf-8'))
        elif self.path == '/health':
            self._set_headers()
            self.wfile.write(json.dumps({'status': 'ok'}).encode('utf-8'))
        else:
            self.send_error(404, 'Not Found')


def run(server_class=HTTPServer, handler_class=BackendHandler, port=5000):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f'Python backend running on http://127.0.0.1:{port}')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down backend...')
        httpd.server_close()


if __name__ == '__main__':
    run()
