// Compatibility hooks plus early access before Haxe starts the application.
// Apply atomically: a missing or ambiguous anchor returns the original source.
export function patchClient(source) {
  const hooks = [
    {
      name: 'class registry',
      pattern: /var \$hxClasses\s*=\s*\{\}\s*([,;])/g,
      replace: (_, separator) => 'var $hxClasses=window.__AF_hx={}' + separator,
    },
    {
      name: 'game created',
      pattern: /core_scene_Game\.instance\s*=\s*this\s*([,;])/g,
      replace: (_, separator) => 'core_scene_Game.instance=this,window.__QOLAF&&window.__QOLAF.created(this)' + separator,
    },
    {
      name: 'classes ready',
      pattern: /ApplicationMain\.main\(\)/g,
      replace: () => '(window.__QOLAF&&window.__QOLAF.classesReady($hxClasses),ApplicationMain.main())',
    },
  ];
  const missing = hooks.map(hook => ({ name: hook.name, matches: [...source.matchAll(hook.pattern)].length }))
    .filter(hook => hook.matches !== 1);
  if (missing.length) return { ok: false, code: source, missing };
  let code = source;
  for (const hook of hooks) code = code.replace(hook.pattern, hook.replace);
  return { ok: true, code, missing: [] };
}
