import { requestPrivateAccess } from './private.js';
const frame = document.querySelector('#game');
const session = crypto.randomUUID();
const mode = new URLSearchParams(location.search).get('mode') === 'original' ? 'original' : 'patched';
const safe = new URLSearchParams(location.search).get('safe') === '1' ? '1' : '0';
const loading = document.querySelector('#loading');
const loadingText = document.querySelector('#loading-text');
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type !== 'astroflux-port' || data.session !== session || typeof data.text !== 'string') return;
  console.info('[QoLAF]', data.text.slice(0, 2000));
  if (data.status === 'failed') loading.hidden = true;
  else if (data.status === 'ready' && !loading.classList.contains('finished')) {
    loading.classList.add('finished');
    // A timer also handles reduced motion and browsers skipping transitionend.
    setTimeout(() => { loading.hidden = true; }, 500);
  }
  else if (data.status === true) loadingText.textContent = data.text.slice(0, 200);
});
const privateClient = mode !== 'original' && safe !== '1' && await requestPrivateAccess();
frame.src = `./game.html?mode=${mode}&safe=${safe}&session=${session}&private=${privateClient}`;
