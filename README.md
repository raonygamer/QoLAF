# AstrofluxClient Port

Experimental GitHub Pages launcher for the live Astroflux HTML5 client. It fetches `https://astroflux.net/astroflux.js`, applies two guarded injection points, and starts the game with the AFPUBLIC modifications extracted from the supplied Electron archive.

The official client, PlayerIO SDK, game definitions, textures, and accounts remain upstream. No official bundle, assets, ASAR, or credentials are committed. This is a browser loading experiment, not yet a complete port of AstrofluxClient.

## Try locally

Node 22 or newer and Python 3 are sufficient; no npm dependencies are required.

```sh
npm test
npm run dev
```

Open http://localhost:8080 and choose **Play with mods**. **Test without mods** loads the official JavaScript through a script tag to help distinguish readable-fetch/CORS failures from other failures. It still runs under the launcher's origin, so it is not equivalent to opening the official site.

Diagnostics distinguish fetch, compatibility, SDK, and canvas startup. A canvas does not establish successful asset loading or login. Copy diagnostics to report failures; the launcher does not collect account values or arbitrary SDK error text.

## GitHub Pages

Create the public repository `raonygamer/AstrofluxClient-Port`, push `main`, and select **GitHub Actions** under Settings → Pages. The included workflow tests and deploys only `dist/`.

Expected address after successful deployment: https://raonygamer.github.io/AstrofluxClient-Port/

## Loading and updates

`public/game.js` requests the current official bundle with cache revalidation and records its SHA-256. `public/patch.js` requires exactly one match for each injection anchor; if either is missing or ambiguous, it returns the pristine source. Individual mod behavior must still be checked against new upstream builds.

The frame sets its base URL to `https://astroflux.net/` so relative game assets continue resolving to the official host. This does not change the frame's security origin. Readable bundle fetches require upstream CORS permission; textures, data requests, SDK behavior, and authentication must also be tested from the deployed origin. No public proxy or authentication forwarding is used.

The initial bootstrap uses the observed official PlayerIO loader and the bundle's `lime.embed` entry point. The live game HTML was unavailable during implementation, so page-specific setup may require adjustment after the first browser test.

## Source and next steps

`public/mods/afpublic.js` is preserved from `app.asar/src/afpublic/mod.js` supplied for this project. It includes the existing AFPUBLIC features; they have not been represented as original work or re-licensed. The patch adapter follows that archive's two-anchor approach. Astroflux belongs to its original creators.

The shared patcher and mod file can later be used by an Electron ASAR that keeps loading the official game page. No new Steam ASAR is built in this initial browser experiment.

For a local upstream compatibility check:

```sh
ASTROFLUX_BUNDLE=/path/to/astroflux.js npm test
```
