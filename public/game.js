import { patchClient } from './patch.js';

const OFFICIAL = 'https://astroflux.net/';
const CLIENT = new URL('astroflux.js', OFFICIAL).href;
const query = new URLSearchParams(location.search);
const session = query.get('session');
const modURL = new URL('./mods/afpublic.js', import.meta.url);
let gameSeen = false;
let failed = false;
let watch;
function report(text, status = true) {
  parent.postMessage({ type: 'astroflux-port', session, text, status }, location.origin);
}
function fail(text) {
  failed = true;
  clearInterval(watch);
  report(text);
  const panel = document.querySelector('#failure');
  panel.hidden = false;
  panel.textContent = `${text}\n\nSee the loading diagnostics below the game. Try the official game link to compare.`;
}
async function fetchText(url, label) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.text();
}
function script(url, label = 'Game script') {
  return new Promise((resolve, reject) => {
    const element = document.createElement('script');
    const timer = setTimeout(() => { element.remove(); reject(new Error(`${label}: load timed out`)); }, 30000);
    // Classic scripts default to no-cors, which upstream CORP can block.
    // Ask for CORS permission explicitly; do not send cross-origin credentials.
    if (new URL(url, document.baseURI).protocol === 'https:') element.crossOrigin = 'anonymous';
    element.src = url;
    element.onload = () => { clearTimeout(timer); resolve(); };
    element.onerror = () => {
      clearTimeout(timer);
      element.remove();
      reject(new Error(`${label}: script load failed. Check the Network panel for CORS permission, HTTP status, or connectivity errors.`));
    };
    document.head.append(element);
  });
}
async function waitForSDK() {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (window.PlayerIO && typeof window._pio?.channel === 'function') return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('PlayerIO loader finished, but the SDK did not become ready');
}
window.addEventListener('error', event => {
  // Do not collect URLs, form values, or arbitrary SDK errors that may contain account data.
  if (event instanceof ErrorEvent) {
    report('A runtime error occurred. See this game frame’s browser console for details.', false);
  } else {
    report(`A game resource failed to load (${event.target?.tagName || 'resource'}). Check the browser Network panel.`, false);
  }
}, true);
window.addEventListener('unhandledrejection', () => report('An asynchronous game operation failed. See the browser console.', false));

async function start() {
  const patched = query.get('mode') !== 'original';
  // Relative game resources resolve to the official host; launcher modules stay on Pages.
  const base = document.createElement('base');
  base.href = OFFICIAL;
  document.head.prepend(base);
  report(`Mode: ${patched ? 'AFPUBLIC patches' : 'official code, without patches'}`, false);
  let clientCode;
  if (patched) {
    report('Fetching the current official client…');
    let source;
    try { source = await fetchText(CLIENT, 'Official client'); }
    catch (error) {
      throw new Error(`Official client fetch failed (${error.name}). Cross-origin access, connectivity, or the server may be responsible. Try “Test without mods” to distinguish script loading from readable fetch access.`);
    }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    report(`Upstream SHA-256: ${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`, false);
    const mod = await fetchText(modURL, 'Mod package');
    const result = patchClient(source, mod);
    clientCode = result.code;
    report(result.ok ? 'Both injection anchors matched.' : `Patch compatibility check failed: ${JSON.stringify(result.missing)}. Loading the original code.`, false);
  }
  report('Loading the official PlayerIO loader…');
  await script(new URL('playerio/playerio-loader.js', OFFICIAL).href, 'Official PlayerIO loader');
  await waitForSDK();
  report('PlayerIO SDK ready. Loading game code…');
  if (clientCode !== undefined) {
    const blob = URL.createObjectURL(new Blob([clientCode], { type: 'text/javascript' }));
    try { await script(blob); } finally { URL.revokeObjectURL(blob); }
  } else {
    await script(CLIENT);
  }
  if (typeof window.lime?.embed !== 'function') throw new Error('Official bundle did not expose lime.embed');
  window.lime.embed('astroflux', 'openfl-content', 0, 0, { background: '#000000' });
  if (failed) return;
  report('Game bootstrap started. Waiting for the canvas…');
  const deadline = Date.now() + 45000;
  let canvasSeen = false;
  watch = setInterval(() => {
    if (!canvasSeen && document.querySelector('#openfl-content canvas')) {
      canvasSeen = true;
      report('Game canvas created. Login and asset loading still need verification.');
    }
    if (!gameSeen && window.AF?.game?.gameStartedTime) {
      gameSeen = true;
      report('Game session started with the mod runtime.');
      clearInterval(watch);
    }
    if (!canvasSeen && Date.now() > deadline) fail('The game did not create a canvas within 45 seconds.');
  }, 500);
}
start().catch(error => fail(error.message));
