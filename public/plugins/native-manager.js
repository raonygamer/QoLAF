import { DEFAULT_CLIENT_URL } from './core.js';
// Host UI uses the game's own display list and controls. No HTML UI is mounted.
export function nativeManager(
  host,
  { config, save, setUnsafe, reload, safe, error },
) {
  let owner,
    root,
    window,
    status,
    list,
    input,
    form,
    pagination,
    previousPage,
    nextPage,
    pageLabel,
    trust = false,
    page = 0,
    blocked,
    settingsState,
    embedded = false;
  const C = (name) => {
    const cls = host.classes?.[name];
    if (!cls) throw Error("Missing game UI class " + name);
    return cls;
  };
  const sprite = () => new (C("starling.display.Sprite"))();
  const place = (child, x, y, parent) => {
    child.set_x(x);
    child.set_y(y);
    parent?.addChild(child);
    return child;
  };
  const text = (value, w = 540, h = 26, size = 13) => {
    const t = new (C("starling.text.TextField"))(
      w,
      h,
      value,
      new (C("starling.text.TextFormat"))(
        settingsState
          ? C("starling.text.TextField").getBitmapFont?.("verdana16_bitmap")
            ? "verdana16_bitmap"
            : "font13"
          : "DAIDRR",
        size,
        0xffffff,
        "left",
        "center",
      ),
    );
    t.set_touchable(false);
    return t;
  };
  const button = (label, callback, width = 120) => {
    const click = () => {
      try {
        callback();
      } catch (failure) {
        console.error("[QoLAF plugin UI]", failure);
        status?.set_text(String(failure.message || failure));
      }
    };
    if (!settingsState) {
      const control = new (C("core.hud.components.LoginButton"))(label, click);
      control.set_width(width);
      return control;
    }
    // Keep login controls on login; use the game's themed menu buttons in play.
    // The external client registers the original Verdana atlas. Vanilla has font13.
    const font = C("starling.text.TextField").getBitmapFont?.(
      "verdana16_bitmap",
    )
      ? "verdana16_bitmap"
      : "font13";
    const control = new (C("core.hud.components.Button"))(
      click,
      label,
      "normal",
      13,
      font,
    );
    control.autoEnableAfterClick = true;
    control.set_width(width);
    // Native Sprite.set_height scales glyphs. Resize the text and skins instead.
    control.tf.set_wordWrap(false);
    control.tf.set_autoScale(false);
    control.tf.set_height(32);
    control.styleImage.set_height(32);
    control.hoverImage.set_height(32);
    return control;
  };
  const dispose = (node) => {
    if (!node) return;
    const parent = node.get_parent();
    if (parent) parent.removeChild(node, true);
    else node.dispose();
  };
  const close = () => {
    if (!window) return;
    if (embedded) {
      settingsState.showCategory("general");
      return;
    }
    dispose(window);
    window = null;
    trust = false;
    if (blocked) {
      blocked.game.blockHotkeys = blocked.value;
      blocked = null;
    }
  };
  const layout = () => {
    if (!owner?.get_stage() || !root) return;
    const stage = owner.get_stage();
    if (settingsState) {
      // The client may replace the open settings panel during hot activation.
      // Wait for its enter hook to remount us before measuring either skin.
      if (!settingsState.panel && !settingsState.bg) return;
      // Original port chrome has a sidebar; upstream has a top tab row.
      root.set_x(
        settingsState.panel
          ? 26
          : Math.max(20, settingsState.bg.get_width() - 132),
      );
      root.set_y(settingsState.panel ? 484 : 32);
    } else {
      const exit = owner.exitButton;
      if (exit?.get_parent() === owner && exit.get_visible()) {
        root.set_x(exit.get_x() + exit.get_width() - root.get_width());
        root.set_y(exit.get_y() - root.get_height() - 8);
      } else {
        root.set_x(stage.get_stageWidth() - 132);
        root.set_y(stage.get_stageHeight() - 44);
      }
    }
    if (window) {
      const fit = Math.max(
        0.1,
        Math.min(
          1,
          (stage.get_stageWidth() - 32) / 620,
          (stage.get_stageHeight() - 32) / 480,
        ),
      );
      window.set_scaleX(fit);
      window.set_scaleY(fit);
      window.set_x((stage.get_stageWidth() - 620 * fit) / 2);
      window.set_y((stage.get_stageHeight() - 480 * fit) / 2);
    }
  };
  function render() {
    if (!window) return;
    list.removeChildren(0, -1, true);
    const plugins = config().plugins;
    page = Math.min(page, Math.max(0, Math.ceil(plugins.length / 2) - 1));
    for (const [i, p] of plugins.slice(page * 2, page * 2 + 2).entries()) {
      const record = host.records.findLast((r) => r.url === p.url);
      const info = record?.version !== undefined ? record : p.metadata;
      const y = i * 80;
      const label = text(info?.name || (p.url === DEFAULT_CLIENT_URL ? "QoLAF Client" : "External plugin"), 224, 24);
      if (info?.version) label.set_text(`${info.name} · ${info.version}`);
      place(label, 0, y, list);
      const description = info?.description || '';
      if (description) place(text(description, 582, 18, 11), 0, y + 36, list);
      const detail = text(p.url, 540, 22, 10);
      place(detail, 0, y + 54, list);
      place(
        button(
          p.enabled ? "Enabled" : "Disabled",
          () => {
            save({
              ...config(),
              plugins: plugins.map((item) =>
                item.url === p.url ? { ...item, enabled: !item.enabled } : item,
              ),
            });
            render();
          },
          88,
        ),
        236,
        y,
        list,
      );
      const active = record?.state === "active" || record?.state === "loading";
      if (info?.safeToHotReload === true) place(
        button(
          active ? "Disable now" : "Enable now",
          () => {
            close();
            queueMicrotask(() => setUnsafe(p.url, !active));
          },
          146,
        ),
        332,
        y,
        list,
      );
      place(
        button(
          "Remove",
          () => {
            save({
              ...config(),
              plugins: plugins.filter((item) => item.url !== p.url),
            });
            render();
          },
          96,
        ),
        486,
        y,
        list,
      );
      if (record?.error) status.set_text(record.error);
    }
    const pages = Math.max(1, Math.ceil(plugins.length / 2));
    const rows = Math.min(2, plugins.length - page * 2);
    const listBottom = 60 + Math.max(0, rows) * 80;
    pagination.set_visible(pages > 1);
    pagination.set_y(listBottom + 8);
    previousPage.set_enabled(page > 0);
    nextPage.set_enabled(page + 1 < pages);
    pageLabel.set_text(`${page + 1} / ${pages}`);
    form.set_y(listBottom + (pages > 1 ? 42 : 12));
    status.set_text(
      error() ||
        (safe
          ? "Safe mode: plugins are disabled."
          : "Changes apply after reload."),
    );
  }
  function open() {
    if (settingsState?.addExternalCategory) {
      settingsState.showCategory("plugins");
      return;
    }
    return buildPanel(false);
  }
  function buildPanel(inSettings) {
    if (!owner || window) return window;
    embedded = inSettings;
    if (host.game && !embedded) {
      blocked = { game: host.game, value: host.game.blockHotkeys };
      host.game.blockHotkeys = true;
    }
    window = sprite();
    window.addEventListener("touch", (event) => event.stopPropagation());
    const panel = window;
    panel.addEventListener("removedFromStage", () => {
      if (window === panel && embedded) {
        window = null;
        embedded = false;
        trust = false;
      }
    });
    if (!embedded) {
      const bg = new (C("starling.display.Quad"))(620, 480, 0x080808);
      bg.set_alpha(0.96);
      window.addChild(bg);
      for (const [x, y, w, h] of [
        [0, 0, 620, 1],
        [0, 479, 620, 1],
        [0, 0, 1, 480],
        [619, 0, 1, 480],
      ])
        place(new (C("starling.display.Quad"))(w, h, 0x707070), x, y, window);
      place(text("Plugins", 410, 34, 20), 24, 12, window);
      place(button("Close", close), 476, 12, window);
    }
    list = sprite();
    place(list, 24, 60, window);
    pagination = place(sprite(), 24, 0, window);
    previousPage = place(button("<", () => {
      page = Math.max(0, page - 1);
      render();
    }, 40), 0, 0, pagination);
    pageLabel = place(text("", 74, 32), 56, 0, pagination);
    nextPage = place(button(">", () => {
      page = Math.max(0, Math.min(Math.ceil(config().plugins.length / 2) - 1, page + 1));
      render();
    }, 40), 138, 0, pagination);
    form = place(sprite(), 0, 0, window);
    place(text("Plugin URL", 430, 18, 11), 24, 0, form);
    place(new (C("starling.display.Quad"))(432, 30, 0x707070), 23, 21, form);
    place(new (C("starling.display.Quad"))(430, 28, 0x181818), 24, 22, form);
    input = new (C("core.hud.components.ui.TextEntry"))("plain");
    input.set_width(430);
    input.set_height(28);
    place(input, 24, 22, form);
    place(
      button("Add URL", () => {
        try {
          if (!trust) throw Error("Enable trust before adding a plugin.");
          save({
            ...config(),
            plugins: [
              ...config().plugins,
              { url: input.get_text().trim(), enabled: true },
            ],
          });
          input.set_text("");
          trust = false;
          trustButton.set_text("Trust: no");
          render();
        } catch (e) {
          status.set_text(e.message);
        }
      }),
      476,
      20,
      form,
    );
    const trustButton = place(
      button("Trust: no", () => {
        trust = !trust;
        trustButton.set_text(trust ? "Trust: yes" : "Trust: no");
      }),
      24,
      59,
      form,
    );
    place(
      text("Full game/session access, including future updates", 430, 25, 11),
      154,
      62,
      form,
    );
    const disclaimer = place(text("Multiple plugins may conflict and cause problems. If this happens, disable one and reload.", 572, 32, 11), 24, 96, form);
    disclaimer.set_wordWrap(true);
    status = place(text("", 420, 38, 11), 24, 132, form);
    status.set_wordWrap(true);
    place(button("Reload", reload), 476, 132, form);
    if (!embedded) (host.game?.overlay || owner).addChild(window);
    render();
    layout();
    return panel;
  }
  function unmount() {
    // Embedded pages belong to SettingsState and are disposed with its active page.
    if (embedded) {
      window = null;
      embedded = false;
      trust = false;
    } else close();
    dispose(root);
    root = null;
    owner = null;
    settingsState = null;
  }
  function mount(target, state = null) {
    unmount();
    owner = target;
    settingsState = state;
    if (state?.addExternalCategory) {
      state.addExternalCategory("plugins", "Plugins", () => buildPanel(true));
      return;
    }
    root = button("Plugins", open);
    if (settingsState?.panel) root.set_width(130);
    root.set_name("qolaf.pluginsButton");
    owner.addChild(root);
    layout();
  }
  host.on("classesReady", () => {
    const login = C("Login").prototype;
    host.scope.defer(
      host.hooks.add(login, "init", "after", function () {
        mount(this);
      }),
    );
    host.scope.defer(host.hooks.add(login, "resize", "after", layout));
    const settings = C("core.states.gameStates.SettingsState").prototype;
    host.scope.defer(
      host.hooks.add(settings, "enter", "after", function () {
        mount(this.panel || this.container, this);
      }),
    );
    host.scope.defer(host.hooks.add(settings, "resize", "after", layout));
    host.scope.defer(host.hooks.add(settings, "close", "before", unmount));
    host.scope.defer(host.hooks.add(settings, "exit", "before", unmount));
  });
  host.on("gameReady", unmount);
  host.on("frame", layout);
  host.on("gameExit", unmount);
  host.scope.defer(unmount);
  return { open, render };
}
