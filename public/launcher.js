const frame = document.querySelector('#game');
const status = document.querySelector('#status');
const log = document.querySelector('#log');
let session = '';
function launch(mode) {
  session = crypto.randomUUID();
  log.textContent = '';
  status.textContent = 'Starting…';
  document.querySelector('#placeholder').hidden = true;
  frame.hidden = false;
  frame.src = `./game.html?mode=${mode}&session=${session}`;
}
document.querySelector('#play').addEventListener('click', () => launch('patched'));
document.querySelector('#original').addEventListener('click', () => launch('original'));
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type !== 'astroflux-port' || data.session !== session || typeof data.text !== 'string') return;
  const text = data.text.slice(0, 2000);
  log.textContent += `${new Date().toLocaleTimeString()}  ${text}\n`;
  log.scrollTop = log.scrollHeight;
  if (data.status) status.textContent = text;
});
document.querySelector('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(log.textContent); status.textContent = 'Diagnostics copied'; }
  catch { status.textContent = 'Clipboard unavailable. Select and copy the diagnostics below.'; }
});
