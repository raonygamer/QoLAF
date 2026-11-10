export function makeBadge() {
  const badge = document.createElement('div');
  Object.assign(badge.style, { position: 'fixed', bottom: '8px', right: '8px', pointerEvents: 'none', zIndex: '1000', color: '#86ead0', background: '#102332dd', padding: '5px 9px', borderRadius: '5px', font: '12px system-ui' });
  return badge;
}
