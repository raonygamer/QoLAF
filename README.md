# QoLAF

Experimental GitHub Pages launcher for the live Astroflux HTML5 client. Each deployment fetches the official client and its public assets from `https://astroflux.net/`, then serves a matching snapshot on Pages. The browser applies two guarded injection points and starts the AFPUBLIC modifications extracted from the supplied Electron archive.

The official bundle and public assets are downloaded only into the deployment artifact, not committed to Git. Authentication and multiplayer connections still go directly to PlayerIO. No ASAR or credentials are committed. This is a browser loading experiment, not yet a complete port of AstrofluxClient.

## Try locally

Node 22 or newer and Python 3 are sufficient; no npm dependencies are required.

```sh
npm test
npm run build
npm run snapshot
npm run dev
```

Open http://localhost:8080. The game starts automatically and fills the browser window. Add `?mode=original` to test the same deployed official bundle without injection, to distinguish mod failures from startup failures. It still runs under the launcher's origin, so it is not equivalent to opening the official site.

Diagnostics distinguish fetch, compatibility, SDK, and canvas startup. A canvas does not establish successful asset loading or login. Diagnostics appear in the browser console and failures appear inside the game window; the launcher does not collect account values or arbitrary SDK error text.

## GitHub Pages

Create the public repository `raonygamer/QoLAF`, push `main`, and select **GitHub Actions** under Settings → Pages. The included workflow tests and deploys only `dist/`.

Expected address after successful deployment: https://raonygamer.github.io/QoLAF/

## Loading and updates

The upstream site sends `Cross-Origin-Resource-Policy: same-origin` and no CORS allowance for the game bundle, SDK loader, and data. A standalone GitHub Pages page cannot read or embed those resources directly.

`scripts/snapshot.py` downloads the official bundle, five asset manifests, their referenced files, and the PlayerIO loader and SDK into `dist/upstream/`. It checks that the bundle did not change during download and that the SDK matches the official loader's SHA-256 pin. File hashes, asset version, and fetch time are recorded in `snapshot.json`. A failed fetch or consistency check fails the deployment instead of publishing partial files.

`public/game.js` uses this same-origin snapshot and explicitly calls the official loader's `loadPinnedSDK()` API. The SDK's integrity verification remains intact. Relative assets and OpenFL manifests resolve under `upstream/`; no PlayerIO authentication or multiplayer endpoint is proxied.

`public/patch.js` requires exactly one match for each injection anchor. If either is missing or ambiguous it returns pristine source. Individual mod behavior must still be checked against new upstream builds.

Upstream files refresh on each deployment, not each visit. Run **Actions → Test and deploy Pages → Run workflow** to fetch a newer upstream build without changing this repository. GitHub Actions checks the upstream client, SDK, loader, and five manifests every 30 minutes (at minutes 7 and 37 UTC), and deploys only when a checked hash changes. GitHub may delay scheduled runs. Changed assets without a changed bundle/manifest are not detected by this lightweight check; a manual deployment refreshes all assets. A continuously live version would need a separate server-side asset proxy or the Electron interception path.

The snapshot makes assets loadable, but successful login and gameplay from the Pages origin still require a browser test. Loading a canvas alone is not a successful gameplay test.

## Source and next steps

`public/mods/afpublic.js` is preserved from `app.asar/src/afpublic/mod.js` supplied for this project. It includes the existing AFPUBLIC features; they have not been represented as original work or re-licensed. The patch adapter follows that archive's two-anchor approach. Astroflux belongs to its original creators.

The shared patcher and mod file can later be used by an Electron ASAR that keeps loading the official game page. No new Steam ASAR is built in this initial browser experiment.

For a local upstream compatibility check:

```sh
ASTROFLUX_BUNDLE=/path/to/astroflux.js npm test
```
