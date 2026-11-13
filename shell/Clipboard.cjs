'use strict';

function registerClipboard(ipcMain, clipboard, allowed) {
  ipcMain.handle('qolaf-clipboard:write', (event, value) => {
    if (!allowed(event.senderFrame)) throw new Error('Clipboard bridge is not available to this page');
    if (typeof value !== 'string') throw new TypeError('Clipboard text must be a string');
    clipboard.writeText(value);
  });
  ipcMain.handle('qolaf-clipboard:read', event => {
    if (!allowed(event.senderFrame)) throw new Error('Clipboard bridge is not available to this page');
    return clipboard.readText();
  });
}

module.exports = { registerClipboard };
