"""Loopback-only authorization and delivery of the private client bundle."""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import OrderedDict
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

COOKIE = '__Secure-qolaf_private'
PREFIX = '/astroflux/private/'
ORIGIN = 'https://raony.dev'
LIFETIME = 7200


class Authorization:
    def __init__(self, key_hash, secret):
        self.key_hash = key_hash.strip()
        self.secret = secret
        self.attempts = OrderedDict()
        self.lock = threading.Lock()

    def permit_attempt(self, address):
        now = time.monotonic()
        with self.lock:
            recent = [stamp for stamp in self.attempts.pop(address, []) if now - stamp < 60]
            allowed = len(recent) < 10
            if allowed:
                recent.append(now)
            self.attempts[address] = recent
            while len(self.attempts) > 4096:
                self.attempts.popitem(last=False)
            return allowed

    def check_key(self, key):
        return isinstance(key, str) and 0 < len(key) <= 256 and hmac.compare_digest(
            hashlib.sha256(key.encode()).hexdigest(), self.key_hash)

    def issue(self):
        payload = f'{int(time.time()) + LIFETIME}.{secrets.token_hex(16)}'
        signature = hmac.new(self.secret, payload.encode(), hashlib.sha256).hexdigest()
        return payload + '.' + signature

    def valid(self, token):
        try:
            expiry, nonce, signature = token.split('.')
            remaining = int(expiry) - time.time()
            if not 0 < remaining <= LIFETIME or len(nonce) != 32:
                return False
            expected = hmac.new(self.secret, f'{expiry}.{nonce}'.encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(expected, signature)
        except (ValueError, TypeError, AttributeError):
            return False


def handler_for(authorization, bundle):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log credentials, cookies, or request bodies.

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def reply(self, status, payload, content_type='application/json', cookie=None):
            data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store, private')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Vary', 'Cookie')
            self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
            if cookie is not None:
                self.send_header('Set-Cookie', f'{COOKIE}={cookie}; Path={PREFIX}; Max-Age={LIFETIME if cookie else 0}; Secure; HttpOnly; SameSite=Strict')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)

        def authorized(self):
            try:
                cookies = SimpleCookie(self.headers.get('Cookie', ''))
                return authorization.valid(cookies[COOKIE].value) if COOKIE in cookies else False
            except Exception:
                return False

        def do_GET(self):
            path = urlsplit(self.path).path
            if path == PREFIX + 'status':
                return self.reply(200, {'authorized': self.authorized()})
            if path != PREFIX + 'client.js':
                return self.reply(404, {'error': 'Not found'})
            if not self.authorized():
                return self.reply(401, {'error': 'Authorization required'})
            try:
                data = bundle.read_bytes()
            except OSError:
                return self.reply(503, {'error': 'Client unavailable'})
            self.reply(200, data, 'text/javascript; charset=utf-8')

        do_HEAD = do_GET

        def do_POST(self):
            if urlsplit(self.path).path != PREFIX + 'session':
                return self.reply(404, {'error': 'Not found'})
            if self.headers.get('Origin') != ORIGIN:
                return self.reply(403, {'error': 'Invalid origin'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': 'JSON required'})
            # Caddy replaces this header; direct access is loopback-only.
            address = self.headers.get('X-Real-IP', self.client_address[0])
            if not authorization.permit_attempt(address):
                return self.reply(429, {'authorized': False}, cookie='')
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 4096:
                    return self.reply(400, {'authorized': False}, cookie='')
                data = json.loads(self.rfile.read(length))
                valid = isinstance(data, dict) and authorization.check_key(data.get('key'))
            except (ValueError, UnicodeDecodeError):
                valid = False
            if not valid:
                return self.reply(401, {'authorized': False}, cookie='')
            return self.reply(200, {'authorized': True}, cookie=authorization.issue())
    return Handler


if __name__ == '__main__':
    credentials = Path(os.environ['CREDENTIALS_DIRECTORY'])
    auth = Authorization((credentials / 'key.sha256').read_text(), (credentials / 'session.key').read_bytes())
    bundle = Path('/opt/qolaf-private/client.js')
    ThreadingHTTPServer(('127.0.0.1', 8094), handler_for(auth, bundle)).serve_forever()
