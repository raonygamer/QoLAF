# QoLAF plugin API

Players open the small **Plugins** button in the game, paste an HTTPS JavaScript module URL, acknowledge that they trust the code, and click **Add plugin**. Enable, disable, removal take effect on **Reload game**. The next load imports enabled modules before the Haxe application starts. Settings live in the browser; nothing is sent to a plugin directory service.

External plugins run in the game frame with its full privileges. They can access account/session data and modify objects, prototypes, DOM, storage, and network behavior. The API is a convenience layer, not a security boundary. Only install trusted URLs. Trust also extends to future code served at that URL; use immutable versioned release paths when you want a pinned version. URL fragments and embedded credentials are rejected. Browsers require CORS permission and a JavaScript MIME type for cross-origin modules.

## Module contract

```js
export default {
  id: 'yourname.yourplugin', // Stable lowercase ID; unique among enabled plugins.
  name: 'Your plugin',
  version: '1.0.0',
  apiVersion: 1,
  activate(api) {
    // Synchronous setup. Register callbacks; do not await game startup here.
    api.on('classesReady', classes => {
      const Ship = api.cls('core.ship.PlayerShip');
      // Ship is the actual compiled Haxe constructor.
    });
    api.onGame((game, session) => {
      // Player, managers and HUD exist; called again for each new game session.
      session.interval(() => api.log(game.roomId), 1000);
      // Managed resources are released before this game exits.
      return () => { /* Undo any additional session-specific mutations. */ };
    });
    return () => { /* Optional plugin-wide cleanup. */ };
  },
};
```

`activate` must return either nothing or a cleanup function, not a Promise. This avoids waiting for a game that has not started yet. Module import errors, unsupported API versions, duplicate IDs, and activation failures are shown in the manager. The import timeout is ten seconds. An import cannot be cancelled by JavaScript: timed-out module top-level code can still finish executing, although the loader will not activate it. Keep top-level work minimal.

## Raw Haxe access

| API | Returns |
| --- | --- |
| `api.raw.classes` | Actual `$hxClasses` registry after `classesReady` |
| `api.cls('core.scene.Game')` | Actual Haxe constructor |
| `api.game` / `api.raw.game` | Current live Game object, or null |
| `api.raw.starling` | Current Starling instance |
| `window.QoLAF.classes` / `.game` / `.cls(name)` | Equivalent access for console inspection in the game frame |

Instances, managers, and prototype objects are mutable. Haxe property syntax often compiles to getters and setters: for example, `game.get_me()` and `player.get_level()`. Inspect the class and source instead of assuming AS3 property names map directly to JavaScript fields. Haxe dictionaries and maps may use `.h` internally.

Raw edits are permitted, but not automatically tracked. Save originals and use `api.defer()` or session cleanup to restore them. The host cannot guarantee recovery from arbitrary direct modifications; disabling a plugin reloads the frame.

## Method hooks

Use ordinary functions when the hook needs the original method's `this`.

```js
api.on('classesReady', () => {
  const Game = api.cls('core.scene.Game');

  api.before(Game.prototype, 'tickUpdate', function () {
    // Observe the live game before its update.
  });

  api.after(Game.prototype, 'tickUpdate', function (result, ...args) {
    // Observe the result and original arguments after a successful update.
  });

  // Advanced interception: can replace arguments, return values, or execution.
  // Replace target/method with the specific game method you intend to alter.
  // api.around(target, 'method', function (next, ...args) {
  //   const result = next(...args);
  //   return result;
  // });
});
```

`before`, `after`, and `around` return an idempotent removal function and register it with their scope. Multiple plugins share a dispatcher so removal of one hook does not erase the others. Before/after callback exceptions are logged while preserving original behavior. Around hooks deliberately control execution; exceptions propagate, and calling `next` twice calls the underlying method twice. The host does not retry an around hook after an exception because that could repeat game/network side effects.

Install prototype hooks during `classesReady`, before the application constructs objects and caches callbacks through Haxe's `$bind`. Late replacement cannot redirect callbacks that are already bound. A later unmanaged prototype replacement may bypass managed hooks; reload to recover. Cleanup will not overwrite a replacement made by other code.

## Lifecycle and managed resources

| API | Behavior |
| --- | --- |
| `api.on('classesReady', fn)` | Class definitions and static initialization are complete, before `ApplicationMain.main()` |
| `api.on('gameCreated', fn)` | Game instance captured inside its constructor; initialization is not complete |
| `api.onGame((game, session) => cleanup)` | After `Game.runGameLoop`; session resources are disposed on exit or replacement |
| `api.on('gameReady', fn)` | Raw readiness event without an automatic per-game scope |
| `api.on('gameExit', fn)` | Before the original `Game.exit` disposes its objects |
| `api.on('tick', fn)` | After `Game.tickUpdate`, receiving the game |
| `api.on('frame', fn)` | After `Game.update`, receiving `{ game, event }` |
| `api.defer(cleanup)` | Register synchronous cleanup, run in reverse registration order |
| `api.listen(target, event, fn, options)` | Add/remove a DOM or compatible dispatcher event listener |
| `api.interval(fn, milliseconds)` | Managed recurring timer |
| `api.mount(element, parent)` | Append a DOM element and remove it on cleanup; default parent is the frame body |
| `api.storage.get(key, fallback)` | Read JSON from a namespace based on the plugin's stable ID |
| `api.storage.set(key, value)` / `.remove(key)` | Write/remove a setting in that namespace |

The session API passed to `onGame` has the same methods with a shorter lifetime. Use it for references to HUD objects, room-specific listeners, overlays, and timers. Plugin-wide hooks belong to the outer API. Cleanup is best-effort on page exit; do not depend on it to commit important data. Callbacks should be synchronous and lightweight; manage asynchronous work and cancellation explicitly.

Storage namespacing prevents accidental collisions, not deliberate access by another plugin. A plain JavaScript plugin can always access the browser's storage directly.

## Split source across files or publish one bundle

The entry URL is a native ES module. Relative imports resolve against the entry module's URL, not the game's asset base. A separate plugin repository can contain:

```text
src/
  plugin.js
  targeting/index.js
  chat/index.js
  settings/index.js
```

Publish these modules together on HTTPS hosting with CORS, or use a bundler to emit an ES module entry such as `dist/qolaf-client.js`. Keep the source split by feature; a single distribution file need not become a single source file. The bundle must retain the default export above. GitHub Pages module URLs work; GitHub `/blob/` pages are HTML and will not.

Authoring examples live in the repository’s `examples/` directory. They are not shipped on the game website.

## Recovery and compatibility

Open `https://raonygamer.github.io/QoLAF/?safe=1` to skip external plugins for that visit, then disable/remove a broken plugin and reload the normal URL. `?mode=original` skips the plugin bridge entirely. Normal reloads use browser module caching; deploy versioned URLs or correct cache headers when releasing updates.

The bridge requires exactly one match for each of three anchors (class registry, game creation, and Haxe entry point). An incompatible bundle is left unmodified. Deployments test these anchors against the newly downloaded upstream client.
