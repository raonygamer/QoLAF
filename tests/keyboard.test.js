import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepGameKeyboard } from '../public/keyboard.js';

function fixture() {
  const events = new EventTarget();
  const page = { activeElement: null };
  let playing = false;
  const makeStage = () => ({
    listeners: new Map(),
    addEventListener(type, fn, capture) { this.listeners.set(capture, fn); },
    removeEventListener(type, fn, capture) { if (this.listeners.get(capture) === fn) this.listeners.delete(capture); },
  });
  let stage = makeStage();
  const cleanup = keepGameKeyboard(() => stage, () => playing, events, page);
  const press = (key, options = {}, type = 'keydown') => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { key, ...options });
    events.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { events, page, cleanup, press, makeStage,
    play: () => { playing = true; },
    stage: () => stage, replace: next => { stage = next; } };
}

test('game keys reach listeners while browser navigation is cancelled only in gameplay', () => {
  const f = fixture();
  assert.equal(f.press('Tab'), false);
  f.play();
  let delivered = 0;
  f.events.addEventListener('keydown', () => delivered++);
  for (const key of ['Tab', ' ', 'ArrowUp', 'Home', 'PageDown', 'Backspace', 'F1', 'F3', 'F6', 'F7', 'F10'])
    assert.equal(f.press(key), true, key);
  assert.equal(delivered, 11);
  assert.equal(f.press('Tab', { shiftKey: true }), true);
  assert.equal(f.press('Tab', {}, 'keyup'), true);
  for (const key of ['F5', 'F11', 'Escape', 'a']) assert.equal(f.press(key), false);
  assert.equal(f.press('Tab', { ctrlKey: true }), false);
  assert.equal(f.press('F1', { altKey: true }), false);
  assert.equal(f.press(' ', { isComposing: true }), false);
  f.page.activeElement = { tagName: 'INPUT' };
  assert.equal(f.press('Tab'), false);
  assert.equal(f.press('Backspace'), false);
  f.page.activeElement = { isContentEditable: true };
  assert.equal(f.press('ArrowUp'), false);
  f.cleanup();
});

test('OpenFL tab traversal is cancelled without stopping its event; replacement and cleanup detach listeners', () => {
  const f = fixture();
  let cancelled = 0;
  const event = { keyCode: 9, preventDefault() { cancelled++; } };
  f.stage().listeners.get(false)(event);
  assert.equal(cancelled, 0);
  f.play();
  f.stage().listeners.get(false)(event);
  assert.equal(cancelled, 1);
  f.stage().listeners.get(false)({ keyCode: 65, preventDefault() { throw Error('ordinary key'); } });
  const old = f.stage();
  f.replace(f.makeStage());
  f.press('Tab');
  assert.equal(old.listeners.size, 0);
  assert.equal(f.stage().listeners.size, 2);
  f.cleanup();
  assert.equal(f.stage().listeners.size, 0);
  assert.equal(f.press('Tab'), false);
});
