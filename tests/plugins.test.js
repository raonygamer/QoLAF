import test from 'node:test';
import assert from 'node:assert/strict';
import { Hooks, Scope, PluginHost, pluginURL, readConfig, CONFIG_KEY, DEFAULT_CLIENT_URL } from '../public/plugins/core.js';

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
  assert.deepEqual(readConfig(s).plugins, [{url: DEFAULT_CLIENT_URL, enabled: true}]);
  const plugin = { url: 'https://example.com/p.js', enabled: false };
  s.setItem(CONFIG_KEY, JSON.stringify({ version: 1, builtins: 1, plugins: [plugin] }));
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

test('hooked frame callbacks retain arity through real Starling dispatch', async () => {
  const {default: invoke} = await import('./fixtures/starling-invoke.js');
  const vector = values => ({get_length: () => values.length, get: i => values[i], set: (i,v) => { values[i]=v; }, pop: () => values.pop()});
  const hooks = new Hooks();
  const event = {type:'enterFrame',data:{marker:1},setCurrentTarget(){},get_passedTime:()=>1/60};
  for (const method of [function () {return 0;}, function (e) { assert.equal(e,event); this.frames++; }, function (e,data) {assert.equal(e,event);assert.equal(data,event.data);}]) {
    const target = {frames:0,update:method};
    const off=hooks.add(target,'update','after',()=>{});
    assert.equal(target.update.length,method.length);
    const dispatcher = {__eventListeners:{h:{enterFrame:vector([target.update.bind(target)])}},__eventStack:vector([])};
    invoke.call(dispatcher,event);
    if (method.length===1) assert.equal(target.frames,1);
    off(); assert.equal(target.update,method);
  }
});


test('live unload removes plugin and session hooks while preserving the running host', async () => {
  const target = { value() { return 1; } };
  const host = new PluginHost({ storage: storage(), log, importer: async () => ({ default: {
    id: 'live', apiVersion: 1, activate(api) {
      api.around(target, 'value', next => next() + 1);
      api.onGame((_game, session) => session.around(target, 'value', next => next() + 10));
    },
  } }) });
  await host.load('https://example.com/live.js');
  host.classesReady({ 'core.scene.Game': Game });
  const game = new Game();
  host.created(game); game.runGameLoop();
  assert.equal(target.value(), 12);
  host.unload('https://example.com/live.js');
  assert.equal(target.value(), 1);
  assert.equal(host.game, game);
  assert.equal(host.readyGame, game);
  assert.equal(host.scope.closed, false);
  assert.equal(host.records[0].state, 'stopped');
  let frames = 0;
  host.on('frame', () => frames++); game.update();
  assert.equal(frames, 1);
  host.dispose();
});

test('unsafe enable imports a fresh module and replays readiness only to that plugin', async () => {
  const imports = [], events = [];
  const host = new PluginHost({ storage: storage(), log, importer: async url => {
    imports.push(url);
    return { default: { id: 'late', apiVersion: 1, activate(api) {
      api.on('classesReady', () => events.push('classes'));
      api.onGame((_game, session) => { events.push('game'); session.defer(() => events.push('cleanup')); });
    } } };
  } });
  let existingReady = 0;
  host.on('classesReady', () => existingReady++);
  host.classesReady({ 'core.scene.Game': Game });
  const game = new Game(); host.created(game); game.runGameLoop();
  await host.load('https://example.com/late.js?v=1', { fresh: true });
  await Promise.resolve();
  assert.deepEqual(events, ['classes', 'game']);
  host.unload('https://example.com/late.js?v=1');
  await host.load('https://example.com/late.js?v=1', { fresh: true });
  await Promise.resolve();
  assert.deepEqual(events, ['classes', 'game', 'cleanup', 'classes', 'game']);
  assert.equal(existingReady, 1);
  assert.notEqual(imports[0], imports[1]);
  assert.equal(new URL(imports[0]).searchParams.get('v'), '1');
  host.dispose();
});

test('disabling a pending import prevents later activation', async () => {
  let deliver, activated = false;
  const host = new PluginHost({ storage: storage(), log, importer: () => new Promise(resolve => deliver = resolve) });
  const loading = host.load('https://example.com/pending.js');
  host.unload('https://example.com/pending.js');
  deliver({ default: { id: 'pending', apiVersion: 1, activate() { activated = true; } } });
  assert.equal((await loading).state, 'stopped');
  assert.equal(activated, false);
  assert.equal(host.ids.size, 0);
  host.dispose();
});

test('diagnostics retain hook context, coalesce repeats and preserve around failures', () => {
  const host = new PluginHost({ storage: storage(), log: { error() {}, info() {}, warn() {} } });
  const scope = new Scope();
  const api = host.api('test', scope);
  const target = { draw() { return 42; } };
  api.before(target, 'draw', () => { throw new Error('missing texture'); });
  assert.equal(target.draw(), 42);
  assert.equal(target.draw(), 42);
  let entries = api.diagnostics.snapshot();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].repeats, 2);
  assert.match(entries[0].message, /before draw.*Error: missing texture/s);
  entries[0].message = 'changed externally';
  assert.notEqual(api.diagnostics.snapshot()[0].message, 'changed externally');
  const failure = new Error('around failed');
  api.around(target, 'draw', () => { throw failure; });
  assert.throws(() => target.draw(), error => error === failure);
  assert.match(api.diagnostics.snapshot().at(-1).message, /around draw/);
  for (let i = 0; i < 130; i++) api.log('entry ' + i);
  assert.equal(api.diagnostics.snapshot().length, 100);
  scope.dispose();
  assert.equal(target.draw(), 42);
});

test('retired bundled plugin is removed without changing saved QoLAF choices', () => {
  for (const enabled of [true, false]) {
    const s = storage();
    const client = { url: DEFAULT_CLIENT_URL, enabled: false };
    const retired = { url: 'https://raony.dev/astroflux/plugins/afpublic.js?old=1', enabled };
    s.setItem(CONFIG_KEY, JSON.stringify({ version: 1, builtins: 1, plugins: [client, retired] }));
    assert.deepEqual(readConfig(s).plugins, [client]);
  }
});

test('hot enabling checks the current plugin declaration before activation', async () => {
  let activated = 0;
  const host = new PluginHost({ storage: storage(), log: {error() {}, info() {}}, importer: async () => ({default: {
    id: 'metadata', name: 'Metadata', description: 'Example', version: '1', apiVersion: 1,
    activate() { activated++; },
  }}) });
  const record = await host.load('https://example.com/metadata.js', {hot: true});
  assert.equal(record.safeToHotReload, false);
  assert.equal(record.description, 'Example');
  assert.equal(record.state, 'error');
  assert.equal(activated, 0);
  host.dispose();
});

test('room refresh replaces session hooks without reimporting or deactivating plugins', async () => {
  let imports = 0, activations = 0;
  const chat = { send() { return 'native'; } };
  const host = new PluginHost({storage: storage(), log, importer: async () => {
    imports++;
    return {default: {id: 'refresh', apiVersion: 1, activate(api) {
      activations++;
      api.around(chat, 'send', next => next() + ':global');
      api.onGame((_game, session) => session.around(chat, 'send', next => next() + ':session'));
    }}};
  }});
  await host.load('https://example.com/plugin.js');
  host.classesReady({'core.scene.Game': Game});
  for (let i = 0; i < 4; i++) {
    const game = new Game(); host.created(game); game.runGameLoop();
    assert.equal(chat.send(), 'native:session:global');
    game.exit();
    assert.equal(chat.send(), 'native:global');
    assert.equal(host.records[0].state, 'active');
  }
  assert.equal(imports, 1); assert.equal(activations, 1);
  host.dispose(); assert.equal(chat.send(), 'native');
});

test('hot unload closes room UI before restoring global class hooks', async () => {
  const calls = [];
  const screen = { resize() { calls.push('native resize'); } };
  const host = new PluginHost({ storage: storage(), log, importer: async () => ({ default: {
    id: 'ordered', apiVersion: 1, activate(api) {
      api.on('classesReady', () => {
        // A late classesReady replay installs global hooks after onGame registered.
        api.defer(() => screen.resize());
        api.around(screen, 'resize', () => calls.push('client resize'));
      });
      api.onGame((_game, session) => {
        session.defer(() => screen.resize());
      });
    },
  } }) });
  host.classesReady({ 'core.scene.Game': Game });
  const game = new Game(); host.created(game); game.runGameLoop();
  await host.load('https://example.com/ordered.js', { fresh: true });
  await Promise.resolve();
  host.unload('https://example.com/ordered.js');
  assert.deepEqual(calls, ['client resize', 'native resize']);
  host.dispose();
});

test('room scope disposal releases ownership and survives a failing cleanup', () => {
  const calls = [];
  const parent = new Scope(error => calls.push(error.message));
  const oldRoom = parent.child();
  oldRoom.defer(() => calls.push('old room'));
  oldRoom.dispose();
  assert.equal(parent.children.size, 0);
  const newRoom = parent.child();
  newRoom.defer(() => calls.push('new room'));
  newRoom.defer(() => { throw new Error('room cleanup error'); });
  parent.defer(() => calls.push('plugin'));
  parent.dispose(); parent.dispose(); newRoom.dispose();
  assert.deepEqual(calls, ['old room', 'room cleanup error', 'new room', 'plugin']);
  assert.equal(parent.children.size, 0);
  assert.equal(parent.child().closed, true);
});

test('slow imports may finish after ten seconds without a false failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deliver;
  let activations = 0;
  const host = new PluginHost({ storage: storage(), log, importer: () => new Promise(resolve => { deliver = resolve; }) });
  const loading = host.load('https://example.com/slow.js');
  t.mock.timers.tick(120000);
  await Promise.resolve();
  assert.equal(host.records[0].state, 'loading');
  deliver({ default: { id: 'slow', apiVersion: 1, activate() { activations++; } } });
  assert.equal((await loading).state, 'active');
  assert.equal(activations, 1);
  host.dispose();
});

test('import deadline remains bounded and a late module never activates', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deliver;
  let activations = 0;
  const host = new PluginHost({ storage: storage(), log, importer: () => new Promise(resolve => { deliver = resolve; }) });
  const loading = host.load('https://example.com/late.js');
  t.mock.timers.tick(180000);
  const record = await loading;
  assert.equal(record.state, 'error');
  assert.match(record.error, /import timed out/);
  deliver({ default: { id: 'late', apiVersion: 1, activate() { activations++; } } });
  await Promise.resolve();
  assert.equal(activations, 0);
  assert.equal(host.ids.size, 0);
  host.dispose();
});

test('unloading settles a pending load immediately without waiting for the network', async () => {
  let deliver;
  let activations = 0;
  const host = new PluginHost({ storage: storage(), log, importer: () => new Promise(resolve => { deliver = resolve; }) });
  const loading = host.load('https://example.com/cancel.js');
  host.unload('https://example.com/cancel.js');
  assert.equal((await loading).state, 'stopped');
  deliver({ default: { id: 'cancel', apiVersion: 1, activate() { activations++; } } });
  await Promise.resolve();
  assert.equal(activations, 0);
  assert.equal(host.ids.size, 0);
  host.dispose();
});
