// Compatibility hooks plus early access before Haxe starts the application.
// Apply atomically: a missing or ambiguous anchor returns the original source.
export function patchClient(source) {
  // Production builds may rename every local symbol. Haxe keeps its runtime
  // class names, so resolve identifiers from those registrations first.
  const identifier = '[A-Za-z_$][\\w$]*';
  const boundary = '(?<![\\w$.])';
  const registrations = [...source.matchAll(new RegExp(
    `${boundary}(${identifier})\\["core\\.scene\\.Game"\\]\\s*=\\s*(${identifier})(?=[,;])`, 'g'))];
  const gameRegistration = registrations.length === 1 ? registrations[0] : null;
  const registry = gameRegistration?.[1];
  const game = gameRegistration?.[2];
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const applications = registry ? [...source.matchAll(new RegExp(
    `${boundary}${escape(registry)}(?:\\.ApplicationMain|\\["ApplicationMain"\\])\\s*=\\s*(${identifier})(?=[,;])`, 'g'))] : [];
  const renamed = gameRegistration && registry !== '$hxClasses' && applications.length === 1;
  const application = renamed ? applications[0][1] : 'ApplicationMain';
  const hooks = [
    {
      name: 'class registry',
      pattern: renamed ? new RegExp(boundary + escape(gameRegistration[0]), 'g') : /var \$hxClasses\s*=\s*\{\}\s*([,;])/g,
      replace: (_, separator) => renamed ? `(window.__AF_hx=${registry})["core.scene.Game"]=${game}` : 'var $hxClasses=window.__AF_hx={}' + separator,
    },
    {
      name: 'game created',
      pattern: new RegExp(`${boundary}${escape(renamed ? game : 'core_scene_Game')}\\.instance\\s*=\\s*this\\s*([,;])`, 'g'),
      replace: (_, separator) => `${renamed ? game : 'core_scene_Game'}.instance=this,window.__QOLAF&&window.__QOLAF.created(this)` + separator,
    },
    {
      name: 'classes ready',
      pattern: new RegExp(`${boundary}${escape(application)}\\.main\\(\\)`, 'g'),
      replace: () => `(window.__QOLAF&&window.__QOLAF.classesReady(${renamed ? registry : '$hxClasses'}),${application}.main())`,
    },
  ];
  const missing = hooks.map(hook => ({ name: hook.name, matches: [...source.matchAll(hook.pattern)].length }))
    .filter(hook => hook.matches !== 1);
  if (missing.length) return { ok: false, code: source, missing };
  let code = source;
  for (const hook of hooks) code = code.replace(hook.pattern, hook.replace);
  return { ok: true, code, missing: [] };
}
