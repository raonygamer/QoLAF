import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeManager } from '../public/plugins/native-manager.js';
import { Hooks, Scope } from '../public/plugins/core.js';

function fixture(bitmapFont = true) {
  const stage = { get_stageWidth: () => 1920, get_stageHeight: () => 1080 };
  class Node {
    children = []; parent = null; disposed = false;
    addChild(child) { this.children.push(child); child.parent = this; return child; }
    get_parent() { return this.parent; }
    get_stage() { return stage; }
    removeChild(child, dispose) {
      this.children = this.children.filter(item => item !== child);
      child.parent = null;
      if (dispose) child.dispose();
    }
    removeChildren() { for (const child of [...this.children]) this.removeChild(child, true); }
    dispose() { this.disposed = true; this.removeChildren(); }
    addEventListener() {}
    get_width() { return this.width; }
  }
  for (const key of ['x', 'y', 'width', 'height', 'text', 'name', 'alpha', 'scaleX', 'scaleY', 'touchable', 'wordWrap'])
    Node.prototype['set_' + key] = function(value) { this[key] = value; };
  class Text extends Node {
    static getBitmapFont() { return bitmapFont ? {} : null; }
    constructor(width, height, text, format) { super(); Object.assign(this, { width, height, text, format }); }
  }
  class LoginButton extends Node {
    constructor(label, callback) { super(); Object.assign(this, { label, callback }); }
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
  const ui = nativeManager(host, { config: () => ({ plugins: [] }), save() {}, reload() {}, error: () => '' });
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
