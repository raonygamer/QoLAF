import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { patchClient } from '../public/patch.js';

const fixture = 'var $hxClasses={};var core_scene_Game=function(){core_scene_Game.instance=this;};$hxClasses["core.scene.Game"]=core_scene_Game;var ApplicationMain={main:function(){new core_scene_Game();}};ApplicationMain.main();';
test('exposes registry and delivers game instance without replacing the game', () => {
  const result = patchClient(fixture);
  assert.equal(result.ok, true);
  const context = { window: { __QOLAF: { created(g) { context.window.seen = g; }, classesReady() {} } } };
  vm.runInNewContext(result.code, context);
  assert.equal(context.window.__AF_hx['core.scene.Game'], context.core_scene_Game);
  assert.equal(context.window.seen, context.core_scene_Game.instance);
});
test('missing anchor returns pristine source without any injected mod', () => {
  const source = 'var $hxClasses={};';
  const result = patchClient(source, 'throw new Error("must not execute");');
  assert.equal(result.ok, false);
  assert.equal(result.code, source);
});
test('ambiguous anchor returns pristine source', () => {
  const source = fixture + 'var $hxClasses={};';
  assert.equal(patchClient(source, '').code, source);
  assert.equal(patchClient(source, '').ok, false);
});
test('raw registry is delivered before game construction', () => {
  const events = [];
  const context = { window: { __QOLAF: {
    classesReady(registry) { events.push('classes'); assert.ok(registry['core.scene.Game']); },
    created(game) { events.push('game'); assert.ok(game); },
  } } };
  vm.runInNewContext(patchClient(fixture, '').code, context);
  assert.deepEqual(events, ['classes', 'game']);
});
test('supplied official bundle accepts patches and remains syntactically valid', { skip: !process.env.ASTROFLUX_BUNDLE }, () => {
  const source = readFileSync(process.env.ASTROFLUX_BUNDLE, 'utf8');
  const result = patchClient(source);
  assert.equal(result.ok, true, JSON.stringify(result.missing));
  new vm.Script(result.code); // Parse only; never run the game in Node.
});
