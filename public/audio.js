// Keep the game's existing mixer and volumes; only change suspension policy.
export function keepAudioActive(audio, events, page) {
  if (!audio) return () => {};
  const previousAutoSuspend = audio.autoSuspend;
  audio.autoSuspend = false;
  if (audio._suspendTimer) {
    clearTimeout(audio._suspendTimer);
    audio._suspendTimer = null;
  }
  let context;
  let resuming = false;
  const resume = () => {
    if (context !== audio.ctx) {
      context?.removeEventListener('statechange', onState);
      context = audio.ctx;
      context?.addEventListener('statechange', onState);
    }
    if (resuming || !context || context.state !== 'suspended') return;
    resuming = true;
    Promise.resolve(context.resume()).catch(() => {}).finally(() => { resuming = false; });
  };
  const onState = () => resume();
  const onGesture = (event) => {
    if (!event.isTrusted) return;
    resume();
  };
  events.addEventListener('blur', resume);
  events.addEventListener('focus', resume);
  events.addEventListener('pointerdown', onGesture);
  events.addEventListener('keydown', onGesture);
  page.addEventListener('visibilitychange', resume);
  resume();
  // Howler creates its context lazily when the first sound is loaded.
  const contextWatch = !audio.ctx ? setInterval(() => {
    resume();
    if (audio.ctx) clearInterval(contextWatch);
  }, 250) : undefined;
  return () => {
    clearInterval(contextWatch);
    audio.autoSuspend = previousAutoSuspend;
    context?.removeEventListener('statechange', onState);
    events.removeEventListener('blur', resume);
    events.removeEventListener('focus', resume);
    events.removeEventListener('pointerdown', onGesture);
    events.removeEventListener('keydown', onGesture);
    page.removeEventListener('visibilitychange', resume);
  };
}
