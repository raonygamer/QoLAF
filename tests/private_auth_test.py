import hashlib
import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('PrivateClient', Path(__file__).parents[1] / 'server/PrivateClient.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PrivateAuthorizationTest(unittest.TestCase):
    def setUp(self):
        self.auth = module.Authorization(hashlib.sha256(b'test-key').hexdigest(), b'server-only-secret')
        self.directory = tempfile.TemporaryDirectory()
        bundle = Path(self.directory.name) / 'client.js'
        bundle.write_text('export default "private fixture";')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), module.handler_for(self.auth, bundle))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}' + module.PREFIX

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.directory.cleanup()

    def request(self, path, key=None, cookie=None, origin=module.ORIGIN):
        headers = {'Origin': origin, 'Content-Type': 'application/json'}
        if cookie: headers['Cookie'] = cookie
        request = urllib.request.Request(self.base + path, data=None if key is None else json.dumps({'key': key}).encode(), headers=headers)
        try: return urllib.request.urlopen(request)
        except urllib.error.HTTPError as error: return error

    def test_private_bundle_requires_valid_cookie(self):
        self.assertEqual(self.request('client.js').status, 401)
        response = self.request('session', 'test-key')
        self.assertEqual(response.status, 200)
        cookie = response.headers['Set-Cookie']
        for attribute in ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/astroflux/private/']:
            self.assertIn(attribute, cookie)
        response = self.request('client.js', cookie=cookie.split(';')[0])
        self.assertEqual(response.status, 200)
        self.assertIn('no-store', response.headers['Cache-Control'])
        self.assertIn(b'private fixture', response.read())
        self.assertEqual(self.request('client.js', cookie=module.COOKIE+'=forged').status, 401)

    def test_wrong_key_clears_session_and_foreign_origin_is_rejected(self):
        response = self.request('session', 'wrong')
        self.assertEqual(response.status, 401)
        self.assertIn('Max-Age=0', response.headers['Set-Cookie'])
        self.assertEqual(self.request('session', 'test-key', origin='https://example.org').status, 403)

    def test_invalid_expired_and_modified_tokens(self):
        token = self.auth.issue()
        self.assertTrue(self.auth.valid(token))
        self.assertFalse(self.auth.valid('1.' + token.split('.', 1)[1]))
        self.assertFalse(self.auth.valid(token[:-1] + ('a' if token[-1] != 'a' else 'b')))
        self.assertFalse(self.auth.valid(''))
        self.assertFalse(self.auth.valid(None))

    def test_attempt_limit(self):
        for _ in range(10): self.assertTrue(self.auth.permit_attempt('one-address'))
        self.assertFalse(self.auth.permit_attempt('one-address'))
        self.assertTrue(self.auth.permit_attempt('different-address'))

if __name__ == '__main__': unittest.main()
