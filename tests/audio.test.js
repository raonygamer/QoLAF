import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepAudioActive } from '../public/audio.js';

test('background audio resumes an unlocked context without changing mixer volume', async () => {
  const events = new EventTarget();
  const page = new EventTarget();
  const context = new EventTarget();
  context.state = 'running';
  let resumed = 0;
  context.resume = async () => { resumed++; context.state = 'running'; };
  const audio = { ctx: context, autoSuspend: true, _volume: 0.3, _muted: true };
  const cleanup = keepAudioActive(audio, events, page);
  assert.equal(audio.autoSuspend, false);
  context.state = 'suspended';
  events.dispatchEvent(new Event('blur'));
  await Promise.resolve();
  assert.equal(resumed, 1);
  assert.equal(audio._volume, 0.3);
  assert.equal(audio._muted, true);
  cleanup();
  assert.equal(audio.autoSuspend, true);
  context.state = 'suspended';
  events.dispatchEvent(new Event('blur'));
  assert.equal(resumed, 1);
});

test('audio attempts playback immediately and tolerates browser autoplay rejection', async () => {
  const events = new EventTarget();
  const page = new EventTarget();
  const context = new EventTarget();
  context.state = 'suspended';
  let attempts = 0;
  context.resume = async () => { attempts++; throw new Error('autoplay denied'); };
  const cleanup = keepAudioActive({ ctx: context, autoSuspend: true }, events, page);
  assert.equal(attempts, 1, 'no first-focus gate');
  await new Promise(resolve => setImmediate(resolve));
  events.dispatchEvent(new Event('focus'));
  assert.equal(attempts, 2);
  await new Promise(resolve => setImmediate(resolve));
  cleanup();
});
