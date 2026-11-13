import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeManager } from '../public/plugins/native-manager.js';
import { Hooks, Scope } from '../public/plugins/core.js';

function fixture(bitmapFont = true, plugins = []) {
  const stage = { get_stageWidth: () => 1920, get_stageHeight: () => 1080 };
  class Node {
    children = []; parent = null; disposed = false; listeners = new Map();
    addChild(child) { this.children.push(child); child.parent = this; return child; }
    get_parent() { return this.parent; }
    get_stage() { return stage; }
    removeChild(child, dispose) {
      this.children = this.children.filter(item => item !== child);
      child.parent = null;
      for (const callback of child.listeners.get('removedFromStage') ?? []) callback();
      if (dispose) child.dispose();
    }
    removeChildren() { for (const child of [...this.children]) this.removeChild(child, true); }
    dispose() { this.disposed = true; this.removeChildren(); }
    addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
    get_width() { return this.width; }
    get_height() { return this.height; }
    get_x() { return this.x; }
    get_y() { return this.y; }
    get_visible() { return this.visible !== false; }
  }
  for (const key of ['x', 'y', 'width', 'height', 'text', 'name', 'alpha', 'scaleX', 'scaleY', 'touchable', 'wordWrap', 'autoScale', 'visible', 'enabled'])
    Node.prototype['set_' + key] = function(value) { this[key] = value; };
  class Text extends Node {
    static getBitmapFont() { return bitmapFont ? {} : null; }
    constructor(width, height, text, format) { super(); Object.assign(this, { width, height, text, format }); }
  }
  class LoginButton extends Node {
    constructor(label, callback) { super(); Object.assign(this, { label, callback, width: 120, height: 41 }); }
  }
  class Button extends Node {
    tf = new Node(); styleImage = new Node(); hoverImage = new Node();
    constructor(callback, label, style, size, font) {
      super(); Object.assign(this, { callback, label, style, size, font });
    }
  }
  class Login extends Node { init() {} resize() {} }
  class Settings { panel = new Node(); enter() {} resize() {} close() {} exit() {} }
  const events = new Map();
  const host = { classes: {
    Login, 'core.states.gameStates.SettingsState': Settings,
    'starling.display.Sprite': Node, 'starling.display.Quad': Node,
    'starling.text.TextField': Text, 'starling.text.TextFormat': class {},
    'core.hud.components.LoginButton': LoginButton, 'core.hud.components.Button': Button,
    'core.hud.components.ui.TextEntry': Node,
  }, hooks: new Hooks(), scope: new Scope(), records: [],
    on: (name, callback) => events.set(name, callback) };
  const ui = nativeManager(host, { config: () => ({ plugins }), save() {}, reload() {}, error: () => '' });
  events.get('classesReady')();
  return { host, ui, events, Login, Settings, LoginButton, Button, Node };
}

test('Plugins follows login/game/settings lifecycle and matches native sidebar dimensions', () => {
  const f = fixture();
  const login = new f.Login();
  login.init();
  assert.ok(login.children[0] instanceof f.LoginButton);
  f.events.get('gameReady')();
  assert.equal(login.children.length, 0);
  f.host.game = { overlay: new f.Node(), blockHotkeys: false };
  const settings = new f.Settings();
  settings.enter();
  const root = settings.panel.children[0];
  assert.ok(root instanceof f.Button);
  assert.equal(root.label, 'Plugins');
  assert.equal(root.font, 'verdana16_bitmap');
  assert.equal(root.size, 13);
  assert.equal(root.style, 'normal');
  assert.equal(root.width, 130);
  assert.equal(root.x, 26);
  assert.equal(root.y, 484);
  for (const part of [root.tf, root.styleImage, root.hoverImage]) assert.equal(part.height, 32);
  assert.equal(root.autoEnableAfterClick, true);
  root.callback();
  assert.equal(f.host.game.blockHotkeys, true);
  const popup = f.host.game.overlay.children[0];
  assert.ok(popup.children.find(child => child.label === 'Close') instanceof f.Button);
  settings.exit();
  assert.equal(root.disposed, true);
  assert.equal(popup.disposed, true);
  assert.equal(f.host.game.blockHotkeys, false);
  f.host.scope.dispose();
});

test('vanilla settings retains the native menu font when the external bitmap atlas is absent', () => {
  const f = fixture(false);
  const settings = new f.Settings();
  settings.enter();
  assert.equal(settings.panel.children[0].font, 'font13');
  f.host.scope.dispose();
});


test('ported settings embeds Plugins as a category without a second window or duplicate title', () => {
  const f = fixture();
  const settings = new f.Settings();
  const pages = new Map();
  settings.addExternalCategory = (id, label, factory) => pages.set(id, { label, factory });
  settings.showCategory = id => {
    if (settings.activePage) settings.panel.removeChild(settings.activePage, true);
    settings.activePage = pages.get(id)?.factory() ?? null;
    if (settings.activePage) settings.panel.addChild(settings.activePage);
  };
  f.host.game = { overlay: new f.Node(), blockHotkeys: false };
  settings.enter();
  assert.equal(pages.get('plugins').label, 'Plugins');
  assert.equal(settings.panel.children.length, 0, 'no floating sidebar button');
  f.ui.open();
  const panel = settings.activePage;
  assert.ok(panel);
  assert.equal(f.host.game.overlay.children.length, 0);
  assert.equal(f.host.game.blockHotkeys, false, 'settings retains input ownership');
  assert.equal(panel.children.some(child => child.label === 'Close' || child.text === 'Plugins'), false);
  settings.showCategory('general');
  assert.equal(panel.disposed, true);
  f.ui.open();
  assert.notEqual(settings.activePage, panel);
  settings.showCategory('general');
  settings.exit();
  f.host.scope.dispose();
});


test('desktop login places Plugins above Exit and follows its native resized bounds', () => {
  const f = fixture();
  const login = new f.Login();
  login.init();
  const plugins = login.children[0];
  assert.equal(plugins.x, 1920 - 132);
  assert.equal(plugins.y, 1080 - 44);
  // Native desktop startup may create Exit after the Plugins mount.
  const exit = new f.LoginButton('exit', () => {});
  login.exitButton = exit;
  login.addChild(exit);
  exit.set_x(1780);
  exit.set_y(1019);
  f.events.get('frame')();
  assert.equal(plugins.x + plugins.width, exit.x + exit.width);
  assert.equal(plugins.y + plugins.height + 8, exit.y);
  exit.set_x(500);
  exit.set_y(300);
  login.resize();
  assert.equal(plugins.x, 500);
  assert.equal(plugins.y + plugins.height + 8, 300);
  exit.visible = false;
  f.events.get('frame')();
  assert.equal(plugins.y, 1080 - 44);
  f.host.scope.dispose();
});


test('plugin form follows row count and pagination only appears for multiple pages', () => {
  for (const count of [1, 4, 5]) {
    const plugins = Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${i}.js`, enabled: true }));
    const f = fixture(true, plugins);
    const settings = new f.Settings();
    settings.enter();
    f.ui.open();
    const panel = settings.panel.children.find(child => child.children.some(node => node.children.some(item => item.label === '<')));
    // Standalone settings modal is owned by the settings panel when no Game exists.
    const pager = panel.children.find(node => node.children.some(item => item.label === '<'));
    const form = panel.children.find(node => node.children.some(item => item.text === 'Plugin URL'));
    assert.equal(pager.visible, count > 3);
    assert.equal(pager.children.find(item => item.label === '<').enabled, false);
    assert.equal(form.y, 60 + Math.min(count, 2) * 80 + (count > 2 ? 42 : 12));
    assert.ok(form.y + 170 <= 480);
    settings.exit();
    f.host.scope.dispose();
  }
});


test('live actions require explicit hot-reload metadata and show plugin details', () => {
  for (const safeToHotReload of [undefined, false, true]) {
    const url = 'https://example.com/plugin.js';
    const f = fixture(true, [{url, enabled: true}]);
    f.host.records.push({url, name: 'Example', version: '2.3', description: 'Example improvements', state: 'active', safeToHotReload});
    const settings = new f.Settings();
    settings.enter(); f.ui.open();
    const nodes = [];
    const visit = node => { nodes.push(node); for (const child of node.children) visit(child); };
    visit(settings.panel);
    assert.equal(nodes.some(node => node.label === 'Disable now'), safeToHotReload === true);
    assert.ok(nodes.some(node => node.text === 'Example · 2.3'));
    assert.ok(nodes.some(node => node.text === 'Example improvements'));
    assert.ok(nodes.some(node => node.text?.startsWith('Multiple plugins may conflict')));
    settings.exit(); f.host.scope.dispose();
  }
});
