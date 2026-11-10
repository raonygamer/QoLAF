export const API_VERSION = 1;
export const CONFIG_KEY = 'qolaf.plugins.v1';

export function pluginURL(value, origin = globalThis.location?.origin) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new Error('Use a URL without credentials or a fragment.');
  const local = url.origin === origin && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Plugins must use HTTPS (or the same local development server).');
  return url.href;
}

export function readConfig(storage) {
  const raw = storage.getItem(CONFIG_KEY);
  if (!raw) return { version: 1, legacyEnabled: true, plugins: [] };
  const config = JSON.parse(raw);
  if (config.version !== 1 || !Array.isArray(config.plugins) || config.plugins.length > 12) throw new Error('Invalid saved plugin configuration.');
  const seen = new Set();
  const plugins = config.plugins.map(p => {
    const url = pluginURL(p.url);
    if (seen.has(url)) throw new Error('Duplicate saved plugin URL.');
    seen.add(url);
    return { url, enabled: p.enabled === true };
  });
  return { version: 1, legacyEnabled: config.legacyEnabled !== false, plugins };
}

export class Scope {
  constructor(onError = console.error) { this.closed = false; this.cleanups = []; this.onError = onError; }
  defer(fn) {
    if (typeof fn !== 'function') throw new TypeError('Cleanup must be a function.');
    if (this.closed) fn(); else this.cleanups.push(fn);
    return fn;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.cleanups.reverse()) { try { fn(); } catch (error) { this.onError(error); } }
    this.cleanups = [];
  }
}

// A single dispatcher per method keeps independently removable plugins composable.
export class Hooks {
  constructor(onError = console.error) { this.targets = new WeakMap(); this.onError = onError; }
  add(target, key, kind, callback) {
    if (!target || typeof target[key] !== 'function') throw new Error(`Method not found: ${String(key)}`);
    if (!['before', 'after', 'around'].includes(kind) || typeof callback !== 'function') throw new TypeError('Invalid hook.');
    let methods = this.targets.get(target);
    if (!methods) this.targets.set(target, methods = new Map());
    let entry = methods.get(key);
    if (!entry) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      entry = { original: target[key], descriptor, hooks: [] };
      const onError = this.onError;
      entry.wrapper = function (...args) {
        const current = entry.hooks.slice();
        const notify = (kind, values) => {
          for (const h of current.filter(h => h.kind === kind)) {
            try { h.callback.apply(this, values); } catch (error) { onError(error); }
          }
        };
        notify('before', args);
        let next = (...values) => entry.original.apply(this, values);
        for (const h of current.filter(h => h.kind === 'around').reverse()) {
          const inner = next;
          next = (...values) => h.callback.call(this, inner, ...values);
        }
        // Around hooks intentionally control execution, arguments and return values.
        const result = next(...args);
        notify('after', [result, ...args]);
        return result;
      };
      target[key] = entry.wrapper;
      methods.set(key, entry);
    } else if (target[key] !== entry.wrapper) {
      throw new Error(`Method ${String(key)} was replaced outside the hook manager; reload before hooking it.`);
    }
    const hook = { kind, callback };
    entry.hooks.push(hook);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      entry.hooks = entry.hooks.filter(h => h !== hook);
      if (!entry.hooks.length) {
        if (target[key] === entry.wrapper) {
          if (entry.descriptor) Object.defineProperty(target, key, entry.descriptor);
          else delete target[key];
        }
        methods.delete(key);
      }
    };
  }
}

export class PluginHost {
  constructor({ storage, importer = url => import(url), onChange = () => {}, log = console } = {}) {
    this.storage = storage;
    this.importer = importer;
    this.onChange = onChange;
    this.log = log;
    this.classes = null;
    this.game = null;
    this.readyGame = null;
    this.records = [];
    this.ids = new Set();
    this.events = new Map();
    this.hooks = new Hooks(error => this.log.error('[QoLAF hook]', error));
    this.scope = new Scope(error => this.log.error('[QoLAF cleanup]', error));
  }
  emit(name, value) {
    for (const callback of [...(this.events.get(name) || [])]) {
      try { callback(value); } catch (error) { this.log.error(`[QoLAF ${name}]`, error); }
    }
  }
  on(name, callback) {
    if (!['classesReady', 'gameCreated', 'gameReady', 'gameExit', 'tick', 'frame'].includes(name)) throw new Error('Unknown lifecycle event: ' + name);
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(callback);
    return () => this.events.get(name)?.delete(callback);
  }
  classesReady(classes) {
    if (this.classes) return;
    this.classes = classes;
    const game = classes['core.scene.Game']?.prototype;
    if (!game || !['runGameLoop', 'exit', 'tickUpdate', 'update'].every(key => typeof game[key] === 'function')) {
      this.log.error('[QoLAF] Game lifecycle changed; plugins disabled.');
      this.dispose();
      return;
    }
    const host = this;
    this.scope.defer(this.hooks.add(game, 'runGameLoop', 'after', function () {
      if (host.readyGame === this) return;
      if (host.readyGame) host.endGame(host.readyGame);
      host.game = host.readyGame = this;
      host.emit('gameReady', this);
    }));
    this.scope.defer(this.hooks.add(game, 'exit', 'before', function () { host.endGame(this); }));
    this.scope.defer(this.hooks.add(game, 'tickUpdate', 'after', function () { host.emit('tick', this); }));
    this.scope.defer(this.hooks.add(game, 'update', 'after', function (_result, event) { host.emit('frame', { game: this, event }); }));
    this.emit('classesReady', classes);
  }
  created(game) { this.game = game; this.emit('gameCreated', game); }
  endGame(game) {
    this.emit('gameExit', game);
    if (this.readyGame === game) this.readyGame = null;
    if (this.game === game) this.game = null;
  }
  api(id, scope) {
    const host = this;
    const keyPrefix = `qolaf.plugin.${id}.`;
    const track = dispose => { scope.defer(dispose); return dispose; };
    return Object.freeze({
      version: API_VERSION,
      id,
      get game() { return host.game; },
      // These are actual Haxe objects, not projections or sandbox proxies.
      raw: Object.freeze({
        get classes() { return host.classes; },
        get game() { return host.game; },
        get starling() { return host.classes?.['starling.core.Starling']?.get_current(); },
      }),
      cls: name => host.classes?.[name],
      on: (name, callback) => track(host.on(name, callback)),
      onGame(callback) {
        let sessionScope;
        let sessionGame;
        const close = () => { sessionScope?.dispose(); sessionScope = null; sessionGame = null; };
        track(host.on('gameReady', game => {
          close();
          sessionGame = game;
          sessionScope = new Scope(scope.onError);
          try {
            const cleanup = callback(game, host.api(id, sessionScope));
            if (cleanup !== undefined) sessionScope.defer(cleanup);
          } catch (error) { close(); throw error; }
        }));
        track(host.on('gameExit', game => { if (game === sessionGame) close(); }));
        track(close);
      },
      before: (target, key, callback) => track(host.hooks.add(target, key, 'before', callback)),
      after: (target, key, callback) => track(host.hooks.add(target, key, 'after', callback)),
      around: (target, key, callback) => track(host.hooks.add(target, key, 'around', callback)),
      defer: fn => scope.defer(fn),
      listen(target, name, callback, options) {
        target.addEventListener(name, callback, options);
        return track(() => target.removeEventListener(name, callback, options));
      },
      interval(callback, ms) {
        const timer = setInterval(() => { try { callback(); } catch (error) { scope.onError(error); } }, ms);
        return track(() => clearInterval(timer));
      },
      mount(element, parent = document.body) { parent.append(element); track(() => element.remove()); return element; },
      storage: Object.freeze({
        get(key, fallback = null) { const value = host.storage.getItem(keyPrefix + key); return value === null ? fallback : JSON.parse(value); },
        set(key, value) { host.storage.setItem(keyPrefix + key, JSON.stringify(value)); },
        remove(key) { host.storage.removeItem(keyPrefix + key); },
      }),
      log: (...values) => host.log.info(`[QoLAF:${id}]`, ...values),
    });
  }
  async load(url) {
    const record = { url, name: url, state: 'loading', error: '' };
    this.records.push(record);
    this.onChange();
    const scope = new Scope(error => this.log.error('[QoLAF plugin cleanup]', error));
    let timer;
    try {
      const module = await Promise.race([
        this.importer(pluginURL(url)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Plugin import timed out. Check its URL, CORS headers and JavaScript MIME type.')), 10000); }),
      ]);
      const plugin = module.default;
      if (!plugin || plugin.apiVersion !== API_VERSION || typeof plugin.activate !== 'function') throw new Error('Expected default export with apiVersion: 1 and activate(api).');
      if (typeof plugin.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(plugin.id)) throw new Error('Plugin needs a stable lowercase id.');
      if (this.ids.has(plugin.id)) throw new Error('Another plugin already uses this id: ' + plugin.id);
      this.ids.add(plugin.id);
      record.id = plugin.id;
      record.name = typeof plugin.name === 'string' ? plugin.name : plugin.id;
      record.version = String(plugin.version || '');
      const cleanup = plugin.activate(this.api(plugin.id, scope));
      if (cleanup?.then) {
        Promise.resolve(cleanup).catch(error => this.log.error('[QoLAF async activation]', error));
        throw new Error('activate must be synchronous. Register lifecycle callbacks instead of waiting for the game.');
      }
      if (cleanup !== undefined) scope.defer(cleanup);
      this.scope.defer(() => scope.dispose());
      record.state = 'active';
    } catch (error) {
      scope.dispose();
      if (record.id) this.ids.delete(record.id);
      record.state = 'error';
      record.error = String(error.message || error);
      this.log.error('[QoLAF plugin]', url, error);
    } finally { clearTimeout(timer); this.onChange(); }
    return record;
  }
  dispose() {
    if (this.readyGame) this.endGame(this.readyGame);
    this.scope.dispose();
    for (const record of this.records) if (record.state === 'active') record.state = 'stopped';
    this.onChange();
  }
}
