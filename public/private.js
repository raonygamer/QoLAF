const ROOT = new URL('./private/', import.meta.url);

/** Keys are sent only in a same-origin POST body and never stored in the browser. */
export async function authorizePrivateKey(key, request = fetch) {
  try {
    const response = await request(new URL('session', ROOT), {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }), signal: AbortSignal.timeout(10000),
    });
    return response.ok && (await response.json()).authorized === true;
  } catch { return false; }
}

export async function requestPrivateAccess(query = new URLSearchParams(location.search)) {
  if (query.get('private') !== 'true') return false;
  try {
    const status = await fetch(new URL('status', ROOT), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!status.ok) return false;
    if ((await status.json()).authorized === true) return true;
  } catch { return false; }
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#000c;font:14px Arial;color:#eee';
    const form = document.createElement('form');
    form.style.cssText = 'width:min(380px,80vw);padding:24px;border:1px solid #62645c;background:#101211;box-shadow:0 0 0 3px #090909';
    const title = document.createElement('h2'); title.textContent = 'QoLAF Private'; title.style.color = '#f1da87';
    const label = document.createElement('label'); label.textContent = 'Access key';
    const input = document.createElement('input');
    input.type = 'password'; input.autocomplete = 'off'; input.name = 'private-key'; input.maxLength = 256;
    input.style.cssText = 'display:block;box-sizing:border-box;width:100%;margin:12px 0 20px;padding:10px;background:#050505;color:#fff;border:1px solid #777';
    label.append(input);
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Continue';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Use Public';
    for (const button of [submit, cancel]) button.style.cssText = 'padding:9px 16px;margin-right:10px;border:1px solid #555;background:#292c29;color:#eee;cursor:pointer';
    const finish = allowed => { input.value = ''; backdrop.remove(); resolve(allowed); };
    form.addEventListener('submit', async event => {
      event.preventDefault(); submit.disabled = cancel.disabled = true;
      submit.textContent = 'Checking…';
      const pending = authorizePrivateKey(input.value); input.value = '';
      finish(await pending);
    });
    cancel.addEventListener('click', () => finish(false));
    form.append(title, label, submit, cancel); backdrop.append(form); document.body.append(backdrop); input.focus();
  });
}

/** Private artifacts are self-contained modules; unauthorized requests fall back to Public. */
export async function importPrivateClient(publicURL, request = fetch, importer = url => import(url)) {
  let blobURL;
  try {
    const response = await request(new URL('client.js', ROOT), {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) { console.warn(`[QoLAF Private] Bundle request returned ${response.status}; loading Public.`); return importer(publicURL); }
    blobURL = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
    return await importer(blobURL);
  } catch (error) {
    console.error('[QoLAF Private] Private module failed; loading Public.', error);
    return importer(publicURL);
  } finally {
    if (blobURL) URL.revokeObjectURL(blobURL);
  }
}
