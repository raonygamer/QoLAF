// Cancel navigation defaults without stopping keyboard delivery to Lime/Starling.
const navigationKeys = new Set([
  'Tab', ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Enter',
  'F1', 'F3', 'F6', 'F7', 'F10',
]);

function isEditing(event, page) {
  const nodes = event.composedPath?.() ?? [event.target];
  return [...nodes, page.activeElement].some(node =>
    node?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node?.tagName));
}

export function keepGameKeyboard(getStage, isPlaying, events = window, page = document) {
  let stage = null;
  const nativeKey = event => {
    // OpenFL changes focus after dispatch unless its own event is cancelled.
    // This does not stop propagation to the game's key handlers.
    if (isPlaying() && event.keyCode === 9 && !isEditing(event, page)) event.preventDefault();
  };
  const detachStage = () => {
    stage?.removeEventListener('keyDown', nativeKey, true);
    stage?.removeEventListener('keyDown', nativeKey, false);
  };
  const syncStage = () => {
    const next = getStage() ?? null;
    if (next === stage) return;
    detachStage();
    stage = next;
    stage?.addEventListener('keyDown', nativeKey, true, 10000);
    stage?.addEventListener('keyDown', nativeKey, false, 10000);
  };
  const key = event => {
    // Attach before the DOM event reaches Lime, including after stage replacement.
    syncStage();
    if (!isPlaying() || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!isEditing(event, page) && navigationKeys.has(event.key)) event.preventDefault();
  };
  syncStage();
  events.addEventListener('keydown', key, { capture: true });
  events.addEventListener('keyup', key, { capture: true });
  return () => {
    events.removeEventListener('keydown', key, { capture: true });
    events.removeEventListener('keyup', key, { capture: true });
    detachStage();
    stage = null;
  };
}
