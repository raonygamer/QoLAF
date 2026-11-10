import test from 'node:test';
import assert from 'node:assert/strict';
import { Hooks, Scope, PluginHost, pluginURL, readConfig, CONFIG_KEY } from '../public/plugins/core.js';

function storage() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
const log = { info() {}, error() {} };
function Game() {}
Game.prototype.runGameLoop = function () { this.started = true; };
Game.prototype.exit = function () { this.exited = true; };
Game.prototype.tickUpdate = function () {};
Game.prototype.update = function () {};

test('plugin URLs reject executable schemes, credentials and non-local HTTP', () => {
  assert.equal(pluginURL('https://example.com/plugin.js?v=1'), 'https://example.com/plugin.js?v=1');
  assert.equal(pluginURL('http://localhost:8080/plugin.js', 'http://localhost:8080'), 'http://localhost:8080/plugin.js');
  for (const value of ['javascript:alert(1)', 'data:text/javascript,', 'file:///tmp/a.js', 'https://user:pass@example.com/a.js', 'http://example.com/a.js']) {
    assert.throws(() => pluginURL(value, 'https://host.test'));
  }
});
test('saved settings preserve disabled plugins and reject duplicates', () => {
  const s = storage();
  assert.deepEqual(readConfig(s).plugins, []);
  const plugin = { url: 'https://example.com/p.js', enabled: false };
  s.setItem(CONFIG_KEY, JSON.stringify({ version: 1, plugins: [plugin] }));
  assert.deepEqual(readConfig(s).plugins, [plugin]);
  s.setItem(CONFIG_KEY, JSON.stringify({ version: 1, plugins: [plugin, plugin] }));
  assert.throws(() => readConfig(s), /Duplicate/);
});
test('hook layers preserve receiver and result, with independent removal', () => {
  const hooks = new Hooks();
  const calls = [];
  const object = { multiplier: 3, compute(x) { calls.push('original'); return this.multiplier * x; } };
  const original = object.compute;
  const before = hooks.add(object, 'compute', 'before', function (x) { calls.push(['before', this.multiplier, x]); });
  const after = hooks.add(object, 'compute', 'after', function (result) { calls.push(['after', result]); });
  const around = hooks.add(object, 'compute', 'around', function (next, x) { return next(x + 1) + 10; });
  assert.equal(object.compute(2), 19);
  assert.deepEqual(calls, [['before', 3, 2], 'original', ['after', 19]]);
  before(); around();
  assert.equal(object.compute(2), 6);
  after();
  assert.equal(object.compute, original);
});
test('cleanup does not overwrite an unrelated raw replacement', () => {
  const hooks = new Hooks();
  const object = { f() { return 1; } };
  const undo = hooks.add(object, 'f', 'after', () => {});
  const replacement = () => 2;
  object.f = replacement;
  assert.throws(() => hooks.add(object, 'f', 'after', () => {}), /outside/);
  undo();
  assert.equal(object.f, replacement);
});
test('scope cleanup is reverse ordered, idempotent and survives cleanup errors', () => {
  const calls = [];
  const scope = new Scope(() => calls.push('error'));
  scope.defer(() => calls.push(1));
  scope.defer(() => { throw Error(); });
  scope.defer(() => calls.push(3));
  scope.dispose(); scope.dispose();
  assert.deepEqual(calls, [3, 'error', 1]);
});
test('observation errors do not prevent the original; original errors still propagate', () => {
  let errors = 0;
  const hooks = new Hooks(() => errors++);
  const object = { f() { return 7; }, g() { throw Error('upstream'); } };
  hooks.add(object, 'f', 'before', () => { throw Error('plugin'); });
  assert.equal(object.f(), 7);
  assert.equal(errors, 1);
  hooks.add(object, 'g', 'after', () => {});
  assert.throws(() => object.g(), /upstream/);
});
test('plugins receive raw classes and per-game scopes across room changes', async () => {
  let api;
  let sessions = 0;
  let cleaned = 0;
  const plugin = { id: 'test.lifecycle', apiVersion: 1, activate(value) {
    api = value;
    api.onGame((game, session) => {
      assert.equal(game.started, true);
      sessions++;
      session.defer(() => cleaned++);
    });
  } };
  const host = new PluginHost({ storage: storage(), importer: async () => ({ default: plugin }), log });
  await host.load('https://example.com/plugin.js');
  const registry = { 'core.scene.Game': Game };
  host.classesReady(registry);
  assert.equal(api.raw.classes, registry);
  assert.equal(api.cls('core.scene.Game'), Game);
  const first = new Game(); host.created(first); first.runGameLoop(); first.runGameLoop();
  assert.equal(api.raw.game, first);
  assert.equal(sessions, 1);
  first.exit();
  assert.equal(cleaned, 1);
  const second = new Game(); host.created(second); second.runGameLoop();
  assert.equal(sessions, 2);
  host.dispose();
  assert.equal(cleaned, 2);
});
test('activation failure rolls back registered hooks; other plugins still load', async () => {
  const object = { value() { return 5; } };
  const original = object.value;
  let fail = true;
  const host = new PluginHost({ storage: storage(), log, importer: async () => ({ default: {
    id: 'test.failure', apiVersion: 1, activate(api) {
      api.after(object, 'value', () => {});
      if (fail) throw Error('activation failed');
    },
  } }) });
  const bad = await host.load('https://example.com/bad.js');
  assert.equal(bad.state, 'error');
  assert.equal(object.value, original);
  fail = false;
  assert.equal((await host.load('https://example.com/good.js')).state, 'active');
  host.dispose();
  assert.equal(object.value, original);
});
test('API versions and duplicate identities are rejected', async () => {
  let version = 2;
  const host = new PluginHost({ storage: storage(), log, importer: async () => ({ default: { id: 'same.id', apiVersion: version, activate() {} } }) });
  assert.equal((await host.load('https://example.com/unsupported.js')).state, 'error');
  version = 1;
  assert.equal((await host.load('https://example.com/a.js')).state, 'active');
  assert.equal((await host.load('https://example.com/b.js')).state, 'error');
  assert.equal(host.ids.has('same.id'), true);
  host.dispose();
});
test('plugin settings are isolated by stable plugin ID', () => {
  const host = new PluginHost({ storage: storage(), log });
  const a = host.api('a', new Scope()); const b = host.api('b', new Scope());
  a.storage.set('value', { enabled: true });
  assert.deepEqual(a.storage.get('value'), { enabled: true });
  assert.equal(b.storage.get('value', 'missing'), 'missing');
});
