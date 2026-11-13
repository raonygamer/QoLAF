import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const { registerClipboard } = createRequire(import.meta.url)('../shell/Clipboard.cjs');

test('native clipboard bridge gates both directions and validates text', () => {
  const handlers = new Map();
  let text = 'original';
  registerClipboard({ handle: (name, fn) => handlers.set(name, fn) }, {
    writeText: value => { text = value; }, readText: () => text,
  }, frame => frame?.url === 'https://raony.dev/astroflux/game.html' && frame.parent === null);
  const trusted = { senderFrame: { url: 'https://raony.dev/astroflux/game.html', parent: null } };
  const write = handlers.get('qolaf-clipboard:write');
  const read = handlers.get('qolaf-clipboard:read');
  write(trusted, 'copy 😀');
  assert.equal(read(trusted), 'copy 😀');
  for (const event of [{}, { senderFrame: { url: 'https://example.com', parent: null } }, { senderFrame: { ...trusted.senderFrame, parent: {} } }]) {
    assert.throws(() => write(event, 'bad'), /not available/);
    assert.throws(() => read(event), /not available/);
  }
  assert.throws(() => write(trusted, {}), /must be a string/);
  assert.equal(text, 'copy 😀');
});
