import { makeBadge } from './session-badge-ui.js';

export default {
  id: 'example.session-badge',
  name: 'Session badge example',
  version: '1.0.0',
  apiVersion: 1,
  activate(api) {
    api.on('classesReady', () => api.log('Raw Game constructor:', api.cls('core.scene.Game')));
    api.onGame((game, session) => {
      const badge = session.mount(makeBadge());
      const update = () => { badge.textContent = `QoLAF plugin · room ${game.roomId || 'joining'}`; };
      update();
      session.interval(update, 1000);
      // The interval and element are removed automatically before this game exits.
    });
  },
};
