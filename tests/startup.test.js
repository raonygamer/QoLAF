import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = (
  await readFile(new URL("../public/game.js", import.meta.url), "utf8")
)
  .replace(/^import .*;\n/gm, "")
  .replaceAll("import.meta.url", '"https://raony.dev/astroflux/game.js"');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const failure of [false, true])
  test(`startup overlaps downloads and ${failure ? "stops on SDK failure" : "waits for plugins before executing game"}`, async () => {
    const client = deferred(),
      sdk = deferred(),
      font = deferred(),
      plugin = deferred();
    const events = [];
    const panel = { hidden: true, textContent: "" };
    const loading = { hidden: false, classList: { add() {} } };
    const window = {
      addEventListener() {},
      PlayerIO: {},
      _pio: { channel() {} },
      AstrofluxPlayerIO: {
        loadPinnedSDK() {
          events.push("sdk-download");
          return sdk.promise;
        },
      },
      lime: {
        embed() {
          events.push("embed");
        },
      },
    };
    window.parent = window;
    window.postMessage = () => {};
    const document = {
      baseURI: "https://raony.dev/astroflux/upstream/",
      querySelector: (selector) => (selector === "#loading" ? loading : selector === "#failure" ? panel : { textContent: "" }),
      createElement: (tagName) => ({ tagName, remove() {} }),
      head: {
        prepend() {},
        append(element) {
          if (element.tagName !== "script") return;
          events.push(
            element.src.startsWith("blob:")
              ? "execute-game"
              : "loader-download",
          );
          queueMicrotask(() => element.onload());
        },
      },
      fonts: {
        load() {
          events.push("font-download");
          return font.promise;
        },
      },
    };
    vm.runInNewContext(source, {
      window,
      document,
      parent: window,
      location: { search: "", origin: "https://raony.dev" },
      URL,
      URLSearchParams,
      TextEncoder,
      Blob,
      AbortSignal,
      crypto: webcrypto,
      setTimeout: () => 1,
      clearTimeout() {},
      setInterval: () => 1,
      clearInterval() {},
      requestPrivateAccess: async () => false,
      keepAudioActive() {},
      liveUpstream: true,
      patchClient: () => ({ ok: true, code: "// game" }),
      createPluginManager: () => ({
        load() {
          events.push("plugins");
          return plugin.promise;
        },
      }),
      fetch: () => {
        events.push("client-download");
        return client.promise;
      },
    });
    await tick();
    for (const phase of [
      "client-download",
      "loader-download",
      "sdk-download",
      "font-download",
    ])
      assert.ok(
        events.includes(phase),
        `${phase} should start without waiting for another download`,
      );
    assert.equal(events.includes("execute-game"), false);
    if (failure) sdk.reject(new Error("SDK unavailable"));
    else sdk.resolve();
    font.resolve();
    client.resolve({ ok: true, text: async () => "// official source" });
    for (let i = 0; i < 50 && !events.includes("plugins"); i++) await tick();
    if (!failure) assert.ok(events.includes("plugins"));
    assert.equal(events.includes("execute-game"), false);
    plugin.resolve();
    for (let i = 0; i < 10; i++) await tick();
    if (failure) {
      assert.equal(events.includes("embed"), false);
      assert.match(panel.textContent, /SDK unavailable/);
    } else {
      assert.ok(events.indexOf("execute-game") > events.indexOf("plugins"));
      assert.ok(events.indexOf("embed") > events.indexOf("execute-game"));
    }
  });
