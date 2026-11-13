export const API_VERSION = 1;
// Large client bundles can take over a minute on a slow connection.
const IMPORT_TIMEOUT_MS = 180000;
export const DEFAULT_CLIENT_URL = 'https://raonygamer.github.io/QoLAF-Client/qolaf-client.js';
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
  if (!raw) return { version: 1, builtins: 1, plugins: [{url: DEFAULT_CLIENT_URL, enabled: true}] };
  const config = JSON.parse(raw);
  if (config.version !== 1 || !Array.isArray(config.plugins) || config.plugins.length > 12) throw new Error('Invalid saved plugin configuration.');
  const seen = new Set();
  // Remove the retired bundled plugin from existing saved configurations too.
  const plugins = config.plugins.filter(p => {
    const url = new URL(p.url);
    return !/\/afpublic\.js$/i.test(url.pathname) && p.metadata?.name?.toUpperCase() !== 'AFPUBLIC';
  }).map(p => {
    const url = pluginURL(p.url);
    if (seen.has(url)) throw new Error('Duplicate saved plugin URL.');
    seen.add(url);
    const metadata = p.metadata && typeof p.metadata === 'object' ? {
      name: String(p.metadata.name || '').slice(0, 120),
      version: String(p.metadata.version || '').slice(0, 80),
      description: String(p.metadata.description || '').slice(0, 500),
      safeToHotReload: p.metadata.safeToHotReload === true,
    } : undefined;
    return { url, enabled: p.enabled === true, ...(metadata ? {metadata} : {}) };
  });
  return { version: 1, builtins: 1, plugins };
}

export class Scope {
  constructor(onError = console.error) { this.closed = false; this.cleanups = []; this.children = new Set(); this.onError = onError; }
  child() {
    const child = new Scope(this.onError);
    if (this.closed) child.dispose();
    else {
      this.children.add(child);
      child.defer(() => this.children.delete(child));
    }
    return child;
  }
  defer(fn) {
    if (typeof fn !== 'function') throw new TypeError('Cleanup must be a function.');
    if (this.closed) fn(); else this.cleanups.push(fn);
    return fn;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    // Room objects depend on the plugin's class hooks during their disposal.
    // Always retire them first, including hooks installed by readiness replay.
    for (const child of [...this.children]) child.dispose();
    this.children.clear();
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
            try { h.callback.apply(this, values); } catch (error) { onError(error, `${kind} ${String(key)}`); }
          }
        };
        notify('before', args);
        let next = (...values) => entry.original.apply(this, values);
        for (const h of current.filter(h => h.kind === 'around').reverse()) {
          const inner = next;
          next = (...values) => {
            let called = false, result, downstreamError, downstreamFailed = false;
            const proceed = (...forwarded) => {
              called = true;
              try { result = inner(...forwarded); return result; }
              catch (error) { downstreamFailed = true; downstreamError = error; throw error; }
            };
            try { return h.callback.call(this, proceed, ...values); }
            catch (error) {
              if (downstreamFailed && error === downstreamError) {
                onError(error, `around ${String(key)} (downstream method)`);
                throw error;
              }
              onError(error, `around ${String(key)} (hook failed; native fallback)`);
              if (downstreamFailed) throw downstreamError;
              return called ? result : inner(...values);
            }
          };
        }
        // Around hooks intentionally control execution, arguments and return values.
        const result = next(...args);
        notify('after', [result, ...args]);
        return result;
      };
      // Starling dispatches zero, one or two arguments based on listener.length.
      // Haxe $bind preserves this length; a rest-argument wrapper must too.
      Object.defineProperty(entry.wrapper, 'length', { value: entry.original.length });
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
    this.diagnostics = [];
    this.log = Object.fromEntries(['error', 'warn', 'info'].map(level => [level, (...values) => {
      let message;
      try {
        message = values.map(value => value instanceof Error
          ? `${value.name}: ${value.message}\n${value.stack || ''}` : String(value)).join(' ').slice(0, 8192);
      } catch { message = 'Unable to format diagnostic'; }
      const previous = this.diagnostics.at(-1);
      const now = Date.now();
      if (previous && previous.level === level && previous.message.split('\n')[0] === message.split('\n')[0] && now - previous.time < 2000) {
        previous.repeats++;
        previous.time = now;
      } else {
        this.diagnostics.push({ time: now, level, message, repeats: 1 });
        if (this.diagnostics.length > 100) this.diagnostics.shift();
      }
      log[level]?.(...values);
    }]));
    this.classes = null;
    this.game = null;
    this.readyGame = null;
    this.records = [];
    this.pluginScopes = new Map();
    this.importRevision = 0;
    this.ids = new Set();
    this.events = new Map();
    this.hooks = new Hooks((error, context) => this.log.error('[QoLAF hook]', context, error));
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
    const hook = (target, key, kind, callback) => {
      try { return track(host.hooks.add(target, key, kind, callback)); }
      catch (error) {
        host.hooks.onError(error, `install ${kind} ${String(key)}`);
        return () => {};
      }
    };
    return Object.freeze({
      diagnostics: Object.freeze({ snapshot: () => host.diagnostics.map(entry => ({ ...entry })) }),
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
      on(name, callback) {
        const remove = track(host.on(name, callback));
        const value = name === 'classesReady' ? host.classes
          : name === 'gameCreated' ? host.game
          : name === 'gameReady' ? host.readyGame : null;
        if (value) queueMicrotask(() => {
          const current = name === 'classesReady' ? host.classes
            : name === 'gameCreated' ? host.game : host.readyGame;
          if (!scope.closed && current === value && host.events.get(name)?.has(callback)) {
            try { callback(value); } catch (error) { scope.onError(error); }
          }
        });
        return remove;
      },
      onGame(callback) {
        let sessionScope;
        let sessionGame;
        const close = () => { sessionScope?.dispose(); sessionScope = null; sessionGame = null; };
        const enter = game => {
          close();
          sessionGame = game;
          sessionScope = scope.child();
          try {
            const cleanup = callback(game, host.api(id, sessionScope));
            if (cleanup !== undefined) sessionScope.defer(cleanup);
          } catch (error) { close(); throw error; }
        };
        track(host.on('gameReady', enter));
        const ready = host.readyGame;
        if (ready) queueMicrotask(() => {
          if (!scope.closed && host.readyGame === ready && sessionGame !== ready) {
            try { enter(ready); } catch (error) { scope.onError(error); }
          }
        });
        track(host.on('gameExit', game => { if (game === sessionGame) close(); }));
        track(close);
      },
      before: (target, key, callback) => hook(target, key, 'before', callback),
      after: (target, key, callback) => hook(target, key, 'after', callback),
      around: (target, key, callback) => hook(target, key, 'around', callback),
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
  async load(url, { fresh = false, hot = false } = {}) {
    const existing = this.records.find(record => record.url === url && ['active', 'loading'].includes(record.state));
    if (existing) return existing;
    const record = { url, name: url, state: 'loading', error: '' };
    this.records.push(record);
    this.onChange();
    const scope = new Scope(error => {
      record.error = 'Cleanup failed; a page reload is recommended: ' + String(error.message || error);
      this.log.error('[QoLAF plugin cleanup]', error);
    });
    this.pluginScopes.set(record, scope);
    this.scope.defer(() => scope.dispose());
    let timer;
    let cancelImport;
    const cancelledImport = new Promise(resolve => { cancelImport = () => resolve(null); });
    scope.defer(() => cancelImport?.());
    try {
      const address = new URL(pluginURL(url));
      if (fresh) address.searchParams.set('qolafReload', Date.now() + '-' + ++this.importRevision);
      const module = await Promise.race([
        this.importer(address.href),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Plugin import timed out. Check its URL, CORS headers and JavaScript MIME type.')), IMPORT_TIMEOUT_MS); }),
        cancelledImport,
      ]);
      if (scope.closed || this.scope.closed || record.state === 'stopped') { scope.dispose(); return record; }
      const plugin = module.default;
      if (!plugin || plugin.apiVersion !== API_VERSION || typeof plugin.activate !== 'function') throw new Error('Expected default export with apiVersion: 1 and activate(api).');
      if (typeof plugin.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(plugin.id)) throw new Error('Plugin needs a stable lowercase id.');
      if (this.ids.has(plugin.id)) throw new Error('Another plugin already uses this id: ' + plugin.id);
      this.ids.add(plugin.id);
      record.id = plugin.id;
      record.name = typeof plugin.name === 'string' ? plugin.name : plugin.id;
      record.version = String(plugin.version || '');
      record.description = typeof plugin.description === 'string' ? plugin.description : '';
      record.safeToHotReload = plugin.safeToHotReload === true;
      if (hot && !record.safeToHotReload) throw new Error('This plugin version requires a page reload.');
      const cleanup = plugin.activate(this.api(plugin.id, scope));
      if (cleanup?.then) {
        Promise.resolve(cleanup).catch(error => this.log.error('[QoLAF async activation]', error));
        throw new Error('activate must be synchronous. Register lifecycle callbacks instead of waiting for the game.');
      }
      if (cleanup !== undefined) scope.defer(cleanup);
      record.state = scope.closed ? 'stopped' : 'active';
    } catch (error) {
      const cancelled = scope.closed || this.scope.closed;
      scope.dispose();
      this.pluginScopes.delete(record);
      if (record.id) this.ids.delete(record.id);
      record.state = cancelled ? 'stopped' : 'error';
      if (!cancelled) record.error = String(error.message || error);
      this.log.error('[QoLAF plugin]', url, error);
    } finally { cancelImport = null; clearTimeout(timer); this.onChange(); }
    return record;
  }
  unload(url) {
    for (const record of [...this.records].reverse()) {
      if (record.url !== url || !['active', 'loading'].includes(record.state)) continue;
      record.state = 'stopped';
      this.pluginScopes.get(record)?.dispose();
      this.pluginScopes.delete(record);
      if (record.id) this.ids.delete(record.id);
    }
    this.onChange();
  }
  dispose() {
    for (const record of [...this.records].reverse()) this.unload(record.url);
    if (this.readyGame) this.endGame(this.readyGame);
    this.scope.dispose();
    for (const record of this.records) if (record.state === 'active') record.state = 'stopped';
    this.onChange();
  }
}
