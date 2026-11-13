import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { authorizePrivateKey, importPrivateClient, requestPrivateAccess } from '../public/private.js';
const require = createRequire(import.meta.url);
const { privateStartURL } = require('../shell/Private.cjs');

test('key is sent only in JSON POST and rejected keys return false', async () => {
  const allowed = await authorizePrivateKey('test-secret', async (url, options) => {
    assert.ok(!url.href.includes('test-secret'));
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(JSON.parse(options.body).key, 'test-secret');
    return {ok:false};
  });
  assert.equal(allowed, false);
  assert.equal(await requestPrivateAccess(new URLSearchParams()), false);
});

test('unauthorized bundle fetch falls back to public without importing private text', async () => {
  const imports = [];
  const result = await importPrivateClient('https://example.com/public.js', async () => ({ok:false}), async url => { imports.push(url); return 'public'; });
  assert.equal(result, 'public');
  assert.deepEqual(imports, ['https://example.com/public.js']);
});

test('authorized bundle imports from a transient blob', async () => {
  await importPrivateClient('https://example.com/public.js', async () => ({ok:true,text:async()=> 'export default 1;'}), async url => {
    assert.ok(url.startsWith('blob:'));
  });
});

test('Steam and itch launch privately only after server authorization', async () => {
  const saved = [], removed = [];
  const cookies = {set:async cookie=>saved.push(cookie),remove:async(...args)=>removed.push(args)};
  for (const address of ['https://raony.dev/astroflux/game.html?shell=steam', 'https://raony.dev/astroflux/game.html']) {
    const result = await privateStartURL(address, 'secret', cookies, async ()=>'signed-cookie');
    assert.equal(new URL(result).searchParams.get('private'), 'true');
    assert.ok(!result.includes('secret'));
  }
  assert.equal(saved.length, 2);
  assert.equal(saved[0].httpOnly, true);
  assert.equal(saved[0].secure, true);
  const rejected = await privateStartURL('https://raony.dev/astroflux/game.html?private=true', 'wrong', cookies, async()=>null);
  assert.equal(new URL(rejected).searchParams.has('private'), false);
  let called = false;
  await privateStartURL('https://astroflux.net/game', 'secret', cookies, async()=>{called=true;});
  assert.equal(called, false);
});
