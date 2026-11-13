const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DiscordPresence } = require('../shell/Discord.cjs');

test('helper bridge validates payloads, parses split status, owns child and stops old sessions', () => {
  const calls = [], writes = [];
  const create = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
    child.stdin = new EventEmitter(); child.stdin.writableLength = 0;
    child.stdin.write = value => writes.push(JSON.parse(value));
    child.stdin.end = value => { writes.push(JSON.parse(value)); queueMicrotask(() => child.emit('exit')); };
    child.kill = () => {};
    return child;
  };
  const bridge = new DiscordPresence({ platform: 'win32', launch: (...args) => {
    const child = create(); calls.push({ args, child }); return child;
  } });
  bridge.extract = name => '/fixed/' + name;
  assert.throws(() => bridge.start('not an ID'), /Invalid/);
  assert.deepEqual(bridge.start('1551018956079235112'), { state: 'starting' });
  assert.deepEqual(calls[0].args.slice(0, 2), ['/fixed/qolaf-presence.exe', ['1551018956079235112', '/fixed/qolaf-presence-linux']]);
  bridge.start('1551018956079235112'); assert.equal(calls.length, 1);
  calls[0].child.stdout.emit('data', '{"status":"con');
  calls[0].child.stdout.emit('data', 'nected"}\n');
  assert.equal(bridge.status().state, 'connected');
  bridge.setActivity({ details: 'Exploring', state: 'System', timestamps: { start: 123 }, secret: 'excluded' });
  assert.deepEqual(writes[0], { op: 'set', activity: { details: 'Exploring', state: 'System', timestamps: { start: 123 } } });
  assert.throws(() => bridge.setActivity({ details: 'a'.repeat(129), state: '', timestamps: { start: 123 } }), /Invalid/);
  bridge.start('1551018956079235113');
  calls[0].child.stdout.emit('data', '{"status":"active"}\n');
  calls[0].child.emit('exit');
  assert.equal(bridge.status().state, 'starting', 'old child cannot overwrite new state');
  calls[1].child.stdin.writableLength = 65537;
  bridge.setActivity({ details: 'Exploring', state: 'System', timestamps: { start: 123 } });
  assert.equal(bridge.status().state, 'helper_unresponsive');
  assert.equal(bridge.child, null);
  bridge.stop();
});
