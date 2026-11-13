'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

/** Fixed bundled helper protocol; renderer input never supplies executables or arguments. */
class DiscordPresence {
  constructor({ directory, helpers, platform = process.platform, launch = spawn }) {
    this.directory = directory;
    this.helpers = helpers;
    this.platform = platform;
    this.launch = launch;
    this.child = null;
    this.application = '';
    this.state = 'disabled';
    this.output = '';
    this.started = 0;
  }

  extract(name) {
    const data = fs.readFileSync(path.join(this.helpers, name));
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    const directory = path.join(this.directory, digest);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, name);
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(data)) {
      fs.writeFileSync(target + '.new', data, { mode: 0o700 });
      fs.renameSync(target + '.new', target);
    }
    if (this.platform !== 'win32') fs.chmodSync(target, 0o700);
    return target;
  }

  start(application) {
    if (typeof application !== 'string' || !/^[0-9]{17,20}$/.test(application))
      throw new TypeError('Invalid Discord application ID');
    if (this.child && this.application === application) return this.status();
    this.stop();
    if (!['linux', 'win32'].includes(this.platform)) {
      this.state = 'unsupported_host';
      return this.status();
    }
    this.state = 'starting';
    this.application = application;
    this.started = Date.now();
    try {
      const linux = this.extract('qolaf-presence-linux');
      const executable = this.platform === 'win32' ? this.extract('qolaf-presence.exe') : linux;
      const args = this.platform === 'win32' ? [application, linux] : [application];
      const child = this.launch(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      this.child = child;
      const failed = () => {
        if (this.child !== child) return;
        this.stop();
        this.state = 'helper_failed';
      };
      child.on('error', failed);
      child.on('exit', failed);
      child.stdin.on('error', failed);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (this.child !== child) return;
        this.output += chunk;
        if (this.output.length > 65536) return failed();
        let newline;
        while ((newline = this.output.indexOf('\n')) >= 0) {
          const line = this.output.slice(0, newline);
          this.output = this.output.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (typeof message.status === 'string' && /^[a-z_]{1,64}$/.test(message.status))
              this.state = message.status;
          } catch { /* Ignore non-protocol output. */ }
        }
      });
    } catch {
      this.stop();
      this.state = 'helper_failed';
    }
    return this.status();
  }

  setActivity(activity) {
    if (!activity || typeof activity.details !== 'string' || typeof activity.state !== 'string' ||
      Buffer.byteLength(activity.details) > 128 || Buffer.byteLength(activity.state) > 128 ||
      /[\x00-\x1f\x7f]/.test(activity.details + activity.state) ||
      !Number.isSafeInteger(activity.timestamps?.start) || activity.timestamps.start < 0)
      throw new TypeError('Invalid Discord activity');
    if (!this.child) return this.status();
    if (this.child.stdin.writableLength > 65536) {
      this.stop();
      this.state = 'helper_unresponsive';
      return this.status();
    }
    // Select protocol fields explicitly; never forward arbitrary renderer payloads.
    this.child.stdin.write(JSON.stringify({ op: 'set', activity: {
      details: activity.details, state: activity.state, timestamps: { start: activity.timestamps.start },
    } }) + '\n');
    return this.status();
  }

  status() { return { state: this.state }; }

  stop() {
    const child = this.child;
    this.child = null;
    this.application = '';
    this.output = '';
    this.state = 'disabled';
    if (child) {
      child.stdin.end(JSON.stringify({ op: 'quit' }) + '\n');
      const timer = setTimeout(() => child.kill(), 1500);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    }
    return this.status();
  }
}
module.exports = { DiscordPresence };
