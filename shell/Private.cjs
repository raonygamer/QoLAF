'use strict';
const https = require('node:https');
const ORIGIN = 'https://raony.dev';
const PATH = '/astroflux/private/';
const COOKIE = '__Secure-qolaf_private';

function authenticate(key) {
  return new Promise(resolve => {
    const body = JSON.stringify({ key });
    const request = https.request(ORIGIN + PATH + 'session', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }, response => {
      let content = '', oversized = false;
      response.setEncoding('utf8');
      response.on('data', chunk => {
        if (content.length + chunk.length > 4096) { oversized = true; response.destroy(); resolve(null); }
        else content += chunk;
      });
      response.on('error', () => resolve(null));
      response.on('end', () => {
        try {
          if (oversized || response.statusCode !== 200 || JSON.parse(content).authorized !== true) return resolve(null);
          const header = (response.headers['set-cookie'] || []).find(value => value.startsWith(COOKIE + '='));
          const value = header?.split(';')[0].slice(COOKIE.length + 1);
          resolve(value && /^\d+\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value) ? value : null);
        } catch { resolve(null); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
    request.end(body);
  });
}

async function privateStartURL(address, key, cookies, authorize = authenticate) {
  const url = new URL(address);
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/astroflux/') || !key) return address;
  url.searchParams.delete('private');
  try {
    // A rejected key must not reuse an older authenticated desktop session.
    await cookies.remove(ORIGIN + PATH, COOKIE);
    if (typeof key !== 'string' || key.length > 256) return url.href;
    const value = await authorize(key);
    if (!value) return url.href;
    await cookies.set({ url: ORIGIN + PATH, name: COOKIE, value,
      path: PATH, secure: true, httpOnly: true, sameSite: 'strict' });
    url.searchParams.set('private', 'true');
  } catch { /* Authentication failures leave the public launch intact. */ }
  return url.href;
}
module.exports = { privateStartURL };
