import { patchClient } from './patch.js';
import { createPluginManager } from './plugins/manager.js';

const ASSET_ROOT = new URL('./upstream/', import.meta.url).href;
const CLIENT = new URL('astroflux.js', ASSET_ROOT).href;
const query = new URLSearchParams(location.search);
const session = query.get('session');
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
  panel.textContent = `${text}\n\nSee the browser console for diagnostics. Reload to retry, or open https://astroflux.net/game to compare.`;
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
  const plugins = patched ? createPluginManager({ safe: query.get('safe') === '1' }) : null;
  // Keep relative resources inside this deployment's matching upstream snapshot.
  const base = document.createElement('base');
  base.href = ASSET_ROOT;
  document.head.prepend(base);
  report(`Mode: ${patched ? 'QoLAF plugin host' : 'official code, without patches'}`, false);
  const snapshot = JSON.parse(await fetchText(new URL('snapshot.json', ASSET_ROOT), 'Upstream snapshot'));
  report(`Official files fetched at deployment: ${snapshot.fetchedAt}; assets ${snapshot.assetVersion}`, false);
  let clientCode;
  if (patched) {
    report('Loading the official client from this deployment…');
    let source;
    try { source = await fetchText(CLIENT, 'Official client'); }
    catch (error) {
      throw new Error(`Deployed client could not be loaded (${error.name}). Check the Pages deployment and Network panel.`);
    }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    const clientHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    if (clientHash !== snapshot.clientSha256) throw new Error('Client and deployment manifest differ. Reload after deployment completes.');
    report(`Upstream SHA-256: ${clientHash}`, false);
    const result = patchClient(source);
    clientCode = result.code;
    report(result.ok ? 'Plugin bridge injection anchors matched.' : `Patch compatibility check failed: ${JSON.stringify(result.missing)}. Loading the original code.`, false);
    if (result.ok) {
      report('Loading enabled plugins…');
      await plugins.load();
    }
  }
  report('Loading the official PlayerIO loader…');
  await script(new URL('playerio/playerio-loader.js', ASSET_ROOT).href, 'Official PlayerIO loader');
  if (typeof window.AstrofluxPlayerIO?.loadPinnedSDK !== 'function') throw new Error('Official SDK loader API missing');
  await window.AstrofluxPlayerIO.loadPinnedSDK({ sdkUrl: new URL('playerio/PlayerIOClient.minified.js', ASSET_ROOT).href });
  await waitForSDK();
  report('PlayerIO SDK ready. Loading game code…');
  if (clientCode !== undefined) {
    const blob = URL.createObjectURL(new Blob([clientCode], { type: 'text/javascript' }));
    try { await script(blob); } finally { URL.revokeObjectURL(blob); }
  } else {
    await script(CLIENT);
  }
  if (typeof window.lime?.embed !== 'function') throw new Error('Official bundle did not expose lime.embed');
  const fonts = document.createElement('style');
  fonts.textContent = '@font-face{font-family:DAIDRR;src:url("ui/russo_one.ttf")}@font-face{font-family:"Russo One";src:url("ui/russo_one.ttf")}';
  document.head.append(fonts);
  await Promise.race([document.fonts.load('12px DAIDRR'), new Promise(resolve => setTimeout(resolve, 5000))]);
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
    if (!gameSeen && window.QoLAF?.game?.gameStartedTime) {
      gameSeen = true;
      report('Game session started with the mod runtime.');
      clearInterval(watch);
    }
    if (!canvasSeen && Date.now() > deadline) fail('The game did not create a canvas within 45 seconds.');
  }, 500);
}
start().catch(error => fail(error.message));
