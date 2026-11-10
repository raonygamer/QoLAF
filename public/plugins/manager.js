import { CONFIG_KEY, PluginHost, pluginURL, readConfig } from './core.js';

export function createPluginManager({ storage, safe = false } = {}) {
  let config;
  let storageError = '';
  try { storage ??= localStorage; config = readConfig(storage); }
  catch (error) {
    storageError = 'Saved plugins could not be read: ' + error.message;
    config = { version: 1, legacyEnabled: false, plugins: [] };
  }
  storage ??= { getItem() { return null; }, setItem() { throw new Error('Browser storage is unavailable.'); }, removeItem() {} };
  const host = new PluginHost({ storage, onChange: () => render() });
  let pending = false;
  const root = document.createElement('div');
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{font:14px system-ui;color:#e5edff}button,input{font:inherit}button{cursor:pointer;border:1px solid #49617b;border-radius:5px;padding:7px 11px;color:#e5edff;background:#21334a}button:hover{background:#304c6c}button:focus-visible,input:focus-visible{outline:2px solid #72e4c9;outline-offset:2px}#open{position:fixed;right:8px;top:8px;z-index:2147483646;opacity:.5;font-size:11px}#open:hover,#open:focus{opacity:1}dialog{width:min(650px,90vw);max-height:85vh;overflow:auto;box-sizing:border-box;border:1px solid #405773;border-radius:10px;background:#101a29;color:#e5edff;padding:22px}dialog::backdrop{background:#0009}header{display:flex;align-items:center;justify-content:space-between}h2{margin:0}p{color:#acbdd4;line-height:1.5}.row{padding:12px 0;border-bottom:1px solid #304056;display:flex;gap:12px;align-items:center}.description{flex:1;min-width:0}.url{font:11px monospace;overflow-wrap:anywhere;margin-top:5px}.state{font-size:12px;color:#80e5ce;margin-top:4px}.error{color:#ffb3b3;overflow-wrap:anywhere}form{margin-top:20px}input[type=url]{width:100%;box-sizing:border-box;padding:10px;background:#07111d;border:1px solid #435a75;border-radius:5px;color:#fff}label.trust{display:flex;gap:8px;align-items:start;margin:12px 0;line-height:1.4;color:#bccce0}label.trust input{margin-top:3px}footer{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.note{font-size:12px}#message{min-height:18px}a{color:#80e5ce}
    </style>
    <button id="open" title="Manage plugins">Plugins</button>
    <dialog aria-labelledby="heading"><header><h2 id="heading">QoLAF plugins</h2><button id="close" aria-label="Close plugin manager">Close</button></header>
    <p>Install JavaScript modules by URL. Changes take effect when you reload the game.</p>
    <div id="list"></div>
    <form><label for="url">Plugin entry URL</label><input id="url" type="url" required placeholder="https://example.github.io/my-plugin/plugin.js" autocomplete="off">
    <label class="trust"><input id="trust" type="checkbox" required><span>I trust this plugin and its future updates. It runs with full access to this game, including account and session data.</span></label>
    <button type="submit">Add plugin</button></form>
    <p id="message" class="error" role="status"></p>
    <p class="note">Use a JavaScript module URL, not a GitHub file-view page. The host must support CORS. For recovery, open this page with <code>?safe=1</code>.</p>
    <footer><button id="reload">Reload game</button><button id="disable">Disable all additions</button></footer></dialog>`;
  document.body.append(root);
  const dialog = shadow.querySelector('dialog');
  const list = shadow.querySelector('#list');
  const message = shadow.querySelector('#message');
  let blockedGame;
  let previousBlock;
  const unblock = () => {
    if (blockedGame && host.game === blockedGame) blockedGame.blockHotkeys = previousBlock;
    blockedGame = null;
  };
  function open() {
    if (dialog.open) return;
    blockedGame = host.game;
    if (blockedGame) { previousBlock = blockedGame.blockHotkeys; blockedGame.blockHotkeys = true; }
    const input = host.classes?.['io.InputLocator']?.getService();
    if (input) {
      for (const map of [input.downKeys, input.pressedKeys, input.releasedKeys]) {
        if (map?.h) for (const key of Object.keys(map.h)) map.h[key] = false;
      }
      input._isMousePressed = input._isRightMousePressed = false;
      input._mouseJustPressed = input._rightMouseJustPressed = false;
    }
    dialog.showModal();
    render();
  }
  shadow.querySelector('#open').onclick = open;
  shadow.querySelector('#close').onclick = () => dialog.close();
  dialog.addEventListener('close', unblock);
  for (const name of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) root.addEventListener(name, e => e.stopPropagation());
  function save(next) {
    try { storage.setItem(CONFIG_KEY, JSON.stringify(next)); }
    catch (error) { message.textContent = 'Could not save settings: ' + error.message; return false; }
    config = next;
    pending = true;
    storageError = '';
    render();
    return true;
  }
  function row(name, detail, enabled, state, toggle, remove) {
    const item = document.createElement('div'); item.className = 'row';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = enabled; check.setAttribute('aria-label', 'Enable ' + name);
    check.onchange = () => { if (!toggle(check.checked)) check.checked = enabled; };
    const content = document.createElement('div'); content.className = 'description';
    const title = document.createElement('strong'); title.textContent = name;
    const url = document.createElement('div'); url.className = 'url'; url.textContent = detail;
    const status = document.createElement('div'); status.className = 'state'; status.textContent = state;
    content.append(title, url, status); item.append(check, content);
    if (remove) { const button = document.createElement('button'); button.textContent = 'Remove'; button.onclick = remove; item.append(button); }
    list.append(item);
  }
  function render() {
    if (!list) return;
    list.replaceChildren();
    row('AFPUBLIC compatibility mod', 'Existing bundled features. Separate from external plugins.', config.legacyEnabled,
      safe ? 'Disabled by safe mode' : pending ? 'Reload to apply changes' : 'Bundled',
      enabled => save({ ...config, legacyEnabled: enabled }));
    for (const plugin of config.plugins) {
      const running = host.records.find(r => r.url === plugin.url);
      row(running?.name || 'External plugin', plugin.url, plugin.enabled,
        pending ? 'Reload to apply changes' : safe ? 'Disabled by safe mode' : running?.error || running?.state || (plugin.enabled ? 'Waiting for startup' : 'Disabled'),
        enabled => save({ ...config, plugins: config.plugins.map(p => p.url === plugin.url ? { ...p, enabled } : p) }),
        () => save({ ...config, plugins: config.plugins.filter(p => p.url !== plugin.url) }));
    }
    message.textContent = storageError || (pending ? 'Saved. Reload to apply changes; this disconnects the current game session.' : safe ? 'Safe mode: external plugins and AFPUBLIC are disabled for this visit.' : '');
  }
  shadow.querySelector('form').onsubmit = e => {
    e.preventDefault();
    try {
      if (config.plugins.length >= 12) throw new Error('Maximum 12 plugins.');
      const url = pluginURL(shadow.querySelector('#url').value.trim());
      if (config.plugins.some(p => p.url === url)) throw new Error('This plugin URL is already installed.');
      if (save({ ...config, plugins: [...config.plugins, { url, enabled: true }] })) e.target.reset();
    } catch (error) { message.textContent = error.message; }
  };
  shadow.querySelector('#disable').onclick = () => save({ ...config, legacyEnabled: false, plugins: config.plugins.map(p => ({ ...p, enabled: false })) });
  shadow.querySelector('#reload').onclick = () => location.reload();
  // Read-only accessors expose actual mutable game objects to plugin authors.
  window.QoLAF = Object.freeze({ apiVersion: 1, get classes() { return host.classes; }, get game() { return host.game; }, cls: name => host.classes?.[name], openPlugins: open });
  window.__QOLAF = {
    classesReady(classes) { try { host.classesReady(classes); } catch (error) { console.error('[QoLAF bridge]', error); host.dispose(); } },
    created(game) { host.created(game); },
  };
  window.addEventListener('pagehide', () => { unblock(); host.dispose(); }, { once: true });
  render();
  return {
    host,
    get legacyEnabled() { return !safe && config.legacyEnabled; },
    async load() {
      if (safe) return;
      for (const plugin of config.plugins.filter(p => p.enabled)) await host.load(plugin.url);
    },
  };
}
