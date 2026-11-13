import { requestPrivateAccess } from "./private.js";
import { keepAudioActive } from "./audio.js";
import { liveUpstream } from "./deployment.js";
import { patchClient } from "./patch.js";
import { createPluginManager } from "./plugins/manager.js";

const ASSET_ROOT = new URL("./upstream/", import.meta.url).href;
const CLIENT = new URL("astroflux.js", ASSET_ROOT).href;
const query = new URLSearchParams(location.search);
const session = query.get("session");
const loading = document.querySelector("#loading");
if (window.parent !== window && loading) loading.hidden = true;
let gameSeen = false;
let failed = false;
let watch;
let presentationExpected = false;
let presentationPending = false;
window.addEventListener("qolaf:login-supported", () => {
  presentationExpected = true;
});
let presentationReady = false;
window.addEventListener("qolaf:login-pending", () => {
  presentationPending = true;
});
window.addEventListener("qolaf:login-ready", () => {
  presentationPending = false;
  presentationReady = true;
});
function nativeLoginVisible() {
  const classes = window.__AF_hx;
  const Login = classes?.Login;
  const stage = classes?.["starling.core.Starling"]?.get_current()?.get_stage();
  if (!Login || !stage) return false;
  const visit = (node) => {
    if (!node || node.get_visible?.() === false) return false;
    if (node instanceof Login) return true;
    const count = node.get_numChildren?.() ?? 0;
    for (let index = 0; index < count; index++)
      if (visit(node.getChildAt(index))) return true;
    return false;
  };
  return visit(stage);
}
function report(text, status = true) {
  if (window.parent === window && loading) {
    if (status === "ready") {
      loading.classList.add("finished");
      setTimeout(() => {
        loading.hidden = true;
      }, 500);
    } else if (status === "failed") {
      loading.hidden = true;
    } else if (status === true) {
      document.querySelector("#loading-text").textContent = text;
    }
  }
  parent.postMessage(
    { type: "astroflux-port", session, text, status },
    location.origin,
  );
}
function fail(text) {
  failed = true;
  clearInterval(watch);
  report(text, "failed");
  const panel = document.querySelector("#failure");
  panel.hidden = false;
  panel.textContent = `${text}\n\nSee the browser console for diagnostics. Reload to retry, or open https://astroflux.net/game to compare.`;
}
async function fetchText(url, label) {
  const response = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    cache: "no-cache",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.text();
}
function script(url, label = "Game script") {
  return new Promise((resolve, reject) => {
    const element = document.createElement("script");
    const timer = setTimeout(() => {
      element.remove();
      reject(new Error(`${label}: load timed out`));
    }, 30000);
    // Classic scripts default to no-cors, which upstream CORP can block.
    // Ask for CORS permission explicitly; do not send cross-origin credentials.
    if (new URL(url, document.baseURI).protocol === "https:")
      element.crossOrigin = "anonymous";
    element.src = url;
    element.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    element.onerror = () => {
      clearTimeout(timer);
      element.remove();
      reject(
        new Error(
          `${label}: script load failed. Check the Network panel for CORS permission, HTTP status, or connectivity errors.`,
        ),
      );
    };
    document.head.append(element);
  });
}
async function waitForSDK() {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (window.PlayerIO && typeof window._pio?.channel === "function") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("PlayerIO loader finished, but the SDK did not become ready");
}
window.addEventListener(
  "error",
  (event) => {
    // Do not collect URLs, form values, or arbitrary SDK errors that may contain account data.
    if (event instanceof ErrorEvent) {
      report(
        "A runtime error occurred. See this game frame’s browser console for details.",
        false,
      );
    } else {
      report(
        `A game resource failed to load (${event.target?.tagName || "resource"}). Check the browser Network panel.`,
        false,
      );
    }
  },
  true,
);
window.addEventListener("unhandledrejection", () =>
  report(
    "An asynchronous game operation failed. See the browser console.",
    false,
  ),
);

async function start() {
  const patched = query.get("mode") !== "original";
  const privateClient =
    patched && query.get("safe") !== "1" && (await requestPrivateAccess(query));
  const plugins = patched
    ? createPluginManager({ safe: query.get("safe") === "1", privateClient })
    : null;
  // Keep relative resources inside this deployment's matching upstream snapshot.
  const base = document.createElement("base");
  base.href = ASSET_ROOT;
  document.head.prepend(base);
  report(
    `Mode: ${patched ? "QoLAF plugin host" : "official code, without patches"}`,
    false,
  );
  let clientCode;
  let runtimeInspectable = false;
  // Downloads are independent. Execution still waits for plugins and the SDK;
  // constructing the game before either is ready can miss its startup hooks.
  const prepareClient = async () => {
    const [snapshot, source] = await Promise.all([
      liveUpstream
        ? null
        : fetchText(
            new URL("snapshot.json", ASSET_ROOT),
            "Upstream snapshot",
          ).then(JSON.parse),
      patched ? fetchText(CLIENT, "Official client") : undefined,
    ]);
    if (failed) return;
    report(
      snapshot
        ? `Official files fetched at deployment: ${snapshot.fetchedAt}; assets ${snapshot.assetVersion}`
        : "Official assets are loaded through the server proxy.",
      false,
    );
    if (patched) {
      report("Downloading Astroflux…");
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(source),
      );
      if (failed) return;
      const clientHash = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (snapshot && clientHash !== snapshot.clientSha256)
        throw new Error(
          "Client and deployment manifest differ. Reload after deployment completes.",
        );
      report(`Upstream SHA-256: ${clientHash}`, false);
      const result = patchClient(source);
      clientCode = result.code;
      runtimeInspectable = result.ok;
      report(
        result.ok
          ? "Plugin bridge injection anchors matched."
          : `Patch compatibility check failed: ${JSON.stringify(result.missing)}. Loading the original code.`,
        false,
      );
      if (result.ok) {
        report("Loading enabled plugins…");
        await plugins.load();
      }
    }
  };
  const prepareSDK = async () => {
    report("Connecting game services…");
    await script(
      new URL("playerio/playerio-loader.js", ASSET_ROOT).href,
      "Official PlayerIO loader",
    );
    if (typeof window.AstrofluxPlayerIO?.loadPinnedSDK !== "function")
      throw new Error("Official SDK loader API missing");
    await window.AstrofluxPlayerIO.loadPinnedSDK({
      sdkUrl: new URL("playerio/PlayerIOClient.minified.js", ASSET_ROOT).href,
    });
    await waitForSDK();
  };
  const prepareFonts = async () => {
    const fonts = document.createElement("style");
    fonts.textContent =
      '@font-face{font-family:DAIDRR;src:url("ui/russo_one.ttf")}@font-face{font-family:"Russo One";src:url("ui/russo_one.ttf")}';
    document.head.append(fonts);
    await Promise.race([
      document.fonts.load("12px DAIDRR"),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  };
  await Promise.all([prepareClient(), prepareSDK(), prepareFonts()]);
  report("Starting the game…");
  if (clientCode !== undefined) {
    const blob = URL.createObjectURL(
      new Blob([clientCode], { type: "text/javascript" }),
    );
    try {
      await script(blob);
    } finally {
      URL.revokeObjectURL(blob);
    }
  } else {
    await script(CLIENT);
  }
  keepAudioActive(window.Howler, window, document);
  if (typeof window.lime?.embed !== "function")
    throw new Error("Official bundle did not expose lime.embed");
  window.lime.embed("astroflux", "openfl-content", 0, 0, {
    background: "#000000",
  });
  if (failed) return;
  report("Preparing the game window…");
  const deadline = Date.now() + 45000;
  let canvasSeen = false;
  let revealed = false;
  watch = setInterval(() => {
    if (!canvasSeen && document.querySelector("#openfl-content canvas")) {
      canvasSeen = true;
    }
    const sessionReady = !!window.QoLAF?.game?.gameStartedTime;
    if (
      !revealed &&
      canvasSeen &&
      (sessionReady ||
        presentationReady ||
        (!presentationExpected &&
          !presentationPending &&
          nativeLoginVisible()) ||
        !runtimeInspectable)
    ) {
      revealed = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!failed) report("Game window ready.", "ready");
        }),
      );
    }
    if (!gameSeen && window.QoLAF?.game?.gameStartedTime) {
      gameSeen = true;
      report("Game session started with the mod runtime.");
      clearInterval(watch);
    }
    if (!canvasSeen && Date.now() > deadline)
      fail("The game did not create a canvas within 45 seconds.");
  }, 500);
}
start().catch((error) => fail(error.message));
