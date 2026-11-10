const frame = document.querySelector('#game');
const session = crypto.randomUUID();
const mode = new URLSearchParams(location.search).get('mode') === 'original' ? 'original' : 'patched';
const safe = new URLSearchParams(location.search).get('safe') === '1' ? '1' : '0';
// No launcher chrome: keep diagnostics in the console, errors inside the game frame.
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type !== 'astroflux-port' || data.session !== session || typeof data.text !== 'string') return;
  console.info('[QoLAF]', data.text.slice(0, 2000));
});
frame.src = `./game.html?mode=${mode}&safe=${safe}&session=${session}`;
