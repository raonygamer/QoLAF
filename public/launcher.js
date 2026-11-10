const frame = document.querySelector('#game');
const session = crypto.randomUUID();
const mode = new URLSearchParams(location.search).get('mode') === 'original' ? 'original' : 'patched';
// No launcher chrome: keep diagnostics in the console, errors inside the game frame.
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type !== 'astroflux-port' || data.session !== session || typeof data.text !== 'string') return;
  console.info('[AstrofluxClient-Port]', data.text.slice(0, 2000));
});
frame.src = `./game.html?mode=${mode}&session=${session}`;
