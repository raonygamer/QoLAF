(function () {
  "use strict";
  var log = function () { console.log.apply(console, ["[AFPUBLIC]"].concat([].slice.call(arguments))); };

  var AF = window.AF = {
    game: null,
    // Any game class by its Haxe name, e.g. AF.cls("core.hud.Hud")
    cls: function (name) { return window.__AF_hx ? window.__AF_hx[name] : undefined; },
    classes: function (filter) {
      return Object.keys(window.__AF_hx || {}).filter(function (n) { return !filter || n.indexOf(filter) !== -1; });
    },
    stage: function () {
      var S = AF.cls("starling.core.Starling"), cur = S && S.get_current();
      return cur && cur.get_stage();
    },
    // Print the Starling display tree: AF.tree() or AF.tree(AF.game.hud.container, 3)
    tree: function (node, maxDepth, _d, _out) {
      node = node || AF.stage(); maxDepth = maxDepth == null ? 4 : maxDepth; _d = _d || 0; _out = _out || [];
      if (!node) { log("stage not ready"); return; }
      var cname = node.__class__ ? node.__class__.__name__ : "?";
      var nm = node.get_name && node.get_name();
      var pos = node.get_x ? " (" + Math.round(node.get_x()) + "," + Math.round(node.get_y()) + ")" : "";
      var hid = node.get_visible && !node.get_visible() ? " [hidden]" : "";
      _out.push(Array(_d + 1).join("  ") + cname + (nm ? " #" + nm : "") + pos + hid);
      if (_d < maxDepth && node.get_numChildren) {
        for (var i = 0; i < node.get_numChildren(); i++) AF.tree(node.getChildAt(i), maxDepth, _d + 1, _out);
      }
      if (_d === 0) console.log(_out.join("\n"));
      return _out;
    },
    // All live display objects of a class: AF.find("core.hud.components.ButtonHud")
    find: function (className, node, _acc) {
      node = node || AF.stage(); _acc = _acc || [];
      if (!node) return _acc;
      if (node.__class__ && node.__class__.__name__ === className) _acc.push(node);
      if (node.get_numChildren) for (var i = 0; i < node.get_numChildren(); i++) AF.find(className, node.getChildAt(i), _acc);
      return _acc;
    }
  };

  function after(className, method, fn) {
    var C = AF.cls(className);
    if (!C || typeof C.prototype[method] !== "function") { console.warn("[AFPUBLIC] missing", className + "." + method); return; }
    var orig = C.prototype[method];
    C.prototype[method] = function () {
      var r = orig.apply(this, arguments);
      try { fn.apply(this, [r].concat([].slice.call(arguments))); } catch (e) { console.error("[AFPUBLIC]", className + "." + method, e); }
      return r;
    };
  }
  AF.after = after;

  var installed = false;
  window.__AFPUBLIC = {
    _onGame: function (game) {
      AF.game = game;
      if (installed) return;
      installed = true;
      log("game created, installing UI edits");
      installEdits();
    }
  };


  function installQuickUpgrade() {
    var TT = "core.hud.components.techTree.TechTree";
    var TechTree = AF.cls(TT), Button = AF.cls("core.hud.components.Button");
    if (!TechTree || !Button) { console.warn("[AFPUBLIC] quick upgrade: classes missing"); return; }
    var STEP_DELAY_MS = 100;

    function isShown(btn) { return btn && btn.get_visible(); }

    function sync(tree) {
      var q = tree.__afQuick;
      if (!q) return;
      var sel = tree.techSelectedForUpgrade;
      var show = !tree.__afQuickRunning && sel != null && sel.level > 0 && isShown(tree.buyWithResourcesButton);
      q.set_visible(show);
      if (show) {
        q.set_enabled(tree.canAfford(sel) && TechTree.hasRequiredLevel(sel.level, tree.me.get_level()));
        q.set_x(tree.buyWithResourcesButton.get_x());
        q.set_y(tree.buyWithResourcesButton.get_y() + 40);
      }
    }

    function finish(tree) {
      tree.__afQuickRunning = false;
      if (tree.techBars == null) return;
      tree.techSelectedForUpgrade = null;
      tree.upgradeInfo.set_visible(false);
      tree.buyWithResourcesButton.set_visible(false);
      tree.buyWithFluxButton.set_visible(false);
      tree.enableTouch();
      tree.resetButton.set_enabled(tree.g.get_me().nrOfUpgrades[0] > 0);
      tree.g.creditManager.refresh();
      sync(tree);
    }

    function step(tree, icon, count) {
      if (tree.techBars == null) { tree.__afQuickRunning = false; return; }
      if (icon == null || icon.level < 1 || icon.level > 6 ||
          !tree.canAfford(icon) || !TechTree.hasRequiredLevel(icon.level, tree.me.get_level())) {
        log("quick upgrade done, levels bought:", count);
        return finish(tree);
      }
      tree.techSelectedForUpgrade = icon;
      var msg = tree.g.createMessage("upgrade");
      msg.add(icon.table); msg.add(icon.tech); msg.add(icon.level);
      tree.g.rpcMessage(msg, function (m) {
        if (!m.getBoolean(0)) {
          if (m.length > 1) tree.g.showErrorDialog(m.getString(1));
          return finish(tree);
        }
        // Only count the upgrade once the server accepts it (costs are based on these counters).
        tree._nrOfUpgrades[0]++;
        tree._nrOfUpgrades[icon.level]++;
        tree.myCargo.reloadCargoFromServer(function () {
          if (tree.techBars == null) { tree.__afQuickRunning = false; return; }
          icon.upgrade();                            // marks it upgraded, unlocks the next icon
          var next = icon.tb.getUpgradeByLevel(icon.level + 1);
          setTimeout(function () { step(tree, next, count + 1); }, STEP_DELAY_MS);
        });
      });
    }

    function start(tree) {
      var sel = tree.techSelectedForUpgrade;
      if (sel == null || tree.__afQuickRunning) return;
      tree.__afQuickRunning = true;
      tree.disableTouch();
      tree.buyWithResourcesButton.set_visible(false);
      tree.buyWithFluxButton.set_visible(false);
      tree.upgradeInfo.set_visible(false);
      sync(tree);
      try { AF.cls("sound.SoundLocator").getService().play("7zeIcPFb-UWzgtR_3nrZ8Q"); } catch (e) {}
      step(tree, sel, 0);
    }

    after(TT, "load", function () {
      if (!this.canUpgrade) return;
      var tree = this;
      tree.__afQuick = new Button(function () { start(tree); }, "Quick Upgrade", "negative");
      tree.__afQuick.set_visible(false);
      tree.addChild(tree.__afQuick);
    });
    ["handleClickTechIcon", "handleClickEliteTechIcon", "updateTechUpgradeInfo",
     "upgraded", "resetTechSkills", "enableTouch"].forEach(function (m) {
      after(TT, m, function () { sync(this); });
    });
    log("quick upgrade installed");
  }


  function installPaintShop() {
    var PS = "core.states.gameStates.LandedPaintShop";
    var Button = AF.cls("core.hud.components.Button"), Text = AF.cls("core.hud.components.Text");
    var CMF = AF.cls("starling.filters.ColorMatrixFilter"), Glow = AF.cls("starling.filters.GlowFilter");
    var ShipFactory = AF.cls("core.ship.ShipFactory"), GameObject = AF.cls("core.GameObject");
    var Sprite = AF.cls("starling.display.Sprite"), Image = AF.cls("starling.display.Image");
    var TexLoc = AF.cls("textures.TextureLocator");
    if (!AF.cls(PS) || !Button || !Text || !CMF || !Glow || !ShipFactory || !GameObject || !Sprite || !Image || !TexLoc) {
      console.warn("[AFPUBLIC] paint shop: classes missing"); return;
    }

    var ROWS = [
      ["sliderShipHue",        160, 280,  0,     1.87079],
      ["sliderShipBrightness", 200, 320, -1,  1],
      ["sliderShipSaturation", 240, 360, -1,     1],
      ["sliderShipContrast",   280, 400, -1, 2],
      ["sliderEngineHue",      340, 440,  0,     Math.PI]
    ];
    var LABEL_X = 230, SLIDER_X = 330, SLIDER_W = 300, STEP = 0.001;
    var PREVIEW_FROM = [380, 100], PREVIEW_TO = [470, 235];

    var pending = null, testDriving = false;

    function makeFilter(h, b, sa, c) {
      var f = new CMF(); f.adjustHue(h); f.adjustBrightness(b); f.adjustSaturation(sa); f.adjustContrast(c); return f;
    }
    function values(ps) { return ROWS.map(function (r) { return ps[r[0]].get_value(); }); }
    function refreshPreview(ps) {
      var v = values(ps);
      ps.preview.get_movieClip().set_filter(makeFilter(v[0], v[1], v[2], v[3]));
      ps.emitters.forEach(function (em) { em.changeHue(v[4]); });
      ps.__afLabels.forEach(function (t, i) { t.set_text(v[i].toFixed(3)); });
    }
    function restoreOwnShip(g) {
      var ship = g.get_me().ship, fo = g.get_me().getActiveFleetObj();
      if (!ship || !fo) return;
      var f = ShipFactory.createPlayerShipColorMatrixFilter(fo);
      ship.get_movieClip().set_filter(f); ship.originalFilter = f;
      if (ship.engine) ship.engine.colorHue = fo.engineHue || 0;
    }
    function applyToOwnShip(g, v) {
      var ship = g.get_me().ship;
      if (!ship) return false;
      var f = makeFilter(v[0], v[1], v[2], v[3]);
      ship.get_movieClip().set_filter(f); ship.originalFilter = f;
      if (ship.engine) ship.engine.colorHue = v[4];
      return true;
    }
    function text(ps, x, y, opts) {
      var t = new Text();
      t.set_size(opts.size || 12);
      if (opts.width) t.set_width(opts.width);
      if (opts.wrap) t.set_wordWrap(true);
      if (opts.color != null) t.set_color(opts.color);
      if (opts.html != null) t.set_htmlText(opts.html); else t.set_text(opts.text || "");
      t.set_x(x); t.set_y(y); ps.addChild(t);
      return t;
    }
    function findChild(ps, Cls, x, y) {
      var c = ps.container;
      for (var k = 0; c && k < c.get_numChildren(); k++) {
        var ch = c.getChildAt(k);
        if (ch instanceof Cls && Math.round(ch.get_x()) === x && Math.round(ch.get_y()) === y) return ch;
      }
      return null;
    }

    function addKaffe(ps, tm) {
      var bg = new Image(tm.getTextureGUIByTextureName("pod_rails.jpg"));
      bg.set_width(520); bg.set_height(120); bg.set_x(170); bg.set_y(50); ps.addChild(bg);
      var kaffe = new Image(tm.getTextureGUIByTextureName("male7.jpg"));
      kaffe.set_width(80); kaffe.set_scaleY(kaffe.get_scaleX()); kaffe.set_x(75); kaffe.set_y(65); ps.addChild(kaffe);
      text(ps, 65, 155, { width: 220, html: "Kaffe the Painter" });
      text(ps, 185, 70, { width: 490, wrap: true, color: 13421772, html:
        "Welcome to the shop, pilot! Use the sliders to get your ship looking sharp." +
        "<br>Want to see it in the void? Hit the <FONT COLOR='#66FF66'>Free Test Drive</FONT> button." +
        "<br>When you're happy, just <FONT COLOR='#66FF66'>Buy</FONT> the new look. Any <FONT COLOR='#ADFF2F'>free paint jobs</FONT> you've earned will be used first!" });
    }

    function addCurrentShip(ps) {
      var skin = ps.dataManager.loadKey("Skins", ps.g.get_me().activeSkin);
      var shipObj = ps.g.dataManager.loadKey("Ships", skin.ship);
      var go = new GameObject();
      go.switchTexturesByObj(shipObj);
      go.get_movieClip().set_filter(ShipFactory.createPlayerShipColorMatrixFilter(ps.fleetObj));
      var holder = new Sprite();
      go.canvas = holder; go.addToCanvas();
      holder.set_x(130); holder.set_y(500);
      ps.addChild(holder);
      text(ps, 75, 440, { width: 220, html: "Your current ship" });
    }

    function movePreview(ps) {
      var r = ps.preview.canvas;
      if (!r) return;
      var dx = PREVIEW_TO[0] - PREVIEW_FROM[0], dy = PREVIEW_TO[1] - PREVIEW_FROM[1];
      r.set_x(PREVIEW_TO[0]); r.set_y(PREVIEW_TO[1]);
      ps.emitters.forEach(function (em) { em.posX += dx; em.posY += dy; });
    }

    function pulseGlow(ps, glow) {
      var t0 = performance.now();
      (function frame(now) {
        if (!ps.__afAlive) return;
        var t = ((now - t0) / 1000) % 2.5, a;
        if (t < 0.25) a = t / 0.25; else if (t < 1.25) a = 1; else if (t < 1.5) a = 1 - (t - 1.25) / 0.25; else a = 0;
        glow.set_alpha(a);
        requestAnimationFrame(frame);
      })(t0);
    }

    AF.after(PS, "enter", function () {
      var ps = this, fo = ps.fleetObj;
      var tm = ps.textureManager || TexLoc.getService();
      ps.__afAlive = true;
      ps.__afLabels = [];

      movePreview(ps);
      addCurrentShip(ps);
      addKaffe(ps, tm);

      var saved = [fo.shipHue, fo.shipBrightness, fo.shipSaturation, fo.shipContrast, fo.engineHue];
      ROWS.forEach(function (r, i) {
        var label = findChild(ps, Text, 250, r[1]);
        if (label) { label.set_x(LABEL_X); label.set_y(r[2]); }
        var sl = ps[r[0]];
        sl.minimum = r[3]; sl.maximum = r[4]; sl.step = STEP;
        sl.set_x(SLIDER_X); sl.set_y(r[2]); sl.set_width(SLIDER_W);
        sl.set_value(pending ? pending[i] : (saved[i] || 0));   // original set_value clamped to the old range
        ps.__afLabels.push(text(ps, SLIDER_X + SLIDER_W + 15, r[2], {}));
        sl.addEventListener("change", function () { refreshPreview(ps); });
      });
      pending = null;
      refreshPreview(ps);

      var buy = findChild(ps, Button, 270, 440);
      if (buy) { buy.set_x(230); buy.set_y(480); }
      var freeTxt = findChild(ps, Text, 395, 445);
      if (freeTxt) { freeTxt.set_x(360); freeTxt.set_y(485); }

      var drive = new Button(function () {
        pending = values(ps);
        testDriving = true;
        ps.leave();
        var v = pending, tries = 0;
        (function wait() {
          tries++;
          var me = ps.g.get_me();
          if (me && me.ship && !me.isTakingOff && applyToOwnShip(ps.g, v)) {
            setTimeout(function () { applyToOwnShip(ps.g, v); }, 1500);
            log("test drive look applied (local only)");
          } else if (tries < 50) setTimeout(wait, 200);
          else applyToOwnShip(ps.g, v);
        })();
      }, "Free Test Drive", "positive");
      drive.set_x(540); drive.set_y(480);
      var glow = new Glow(16777215, 0, 10);
      drive.tf.set_filter(glow);
      ps.addChild(drive);
      pulseGlow(ps, glow);
    });

    AF.after(PS, "exit", function () {
      this.__afAlive = false;                    // stops the glow loop
      if (testDriving) { testDriving = false; return; }
      var g = this.g;
      setTimeout(function () { restoreOwnShip(g); }, 0);
    });

    log("paint shop installed");
  }

  function installFitness() {
    var Artifact = AF.cls("core.artifact.Artifact"), ArtifactStat = AF.cls("core.artifact.ArtifactStat");
    var CB = "core.artifact.ArtifactCargoBox", Button = AF.cls("core.hud.components.Button");
    if (!Artifact || !ArtifactStat || !AF.cls(CB) || !Button) { console.warn("[AFPUBLIC] fitness: classes missing"); return; }

    var W = {   // weight per stat type (Add/Add2/Add3 share a weight)
      healthAdd: 0.002264, healthMulti: 0.5832, armorAdd: 0.15375, armorMulti: 0.333,
      corrosiveAdd: 0.3388, corrosiveMulti: 0.83325, energyAdd: 0.324, energyMulti: 0.83325,
      kineticAdd: 0.3132, kineticMulti: 0.79992, shieldAdd: 0.001925, shieldMulti: 0.54675,
      shieldRegen: 0.48, corrosiveResist: 0.425, energyResist: 0.425, kineticResist: 0.425,
      allResist: 1.1, allAdd: 0.23904, allMulti: 2.36925, dotDamage: 5, dotDuration: 2.5,
      directDamage: 0.5, speed: 0.88, refire: 0.529584, powerReg: 0.24, powerMax: 0.3333,
      cooldown: 0.6666, increaseRecyleRate: 1.1, damageReduction: 1.5,
      damageReductionWithLowHealth: 1.4, damageReductionWithLowShield: 1.4, healthRegenAdd: 0.1,
      shieldVamp: 1, healthVamp: 1, kineticChanceToPenetrateShield: 0.05,
      energyChanceToShieldOverload: 0.5, corrosiveChanceToIgnite: 0.5,
      beamAndMissileDoesBonusDamage: 0.5, recycleCatalyst: 1, lucaniteCore: 1.1, mantisCore: 0.8,
      thermofangCore: 1, reduceKineticResistance: 1, reduceCorrosiveResistance: 1,
      reduceEnergyResistance: 1, crownOfXhersix: 10, fistOfZharix: 10, dotDamageUnique: 1.1,
      directDamageUnique: 0.5
    };
    var FLAT = {   // fixed fitness regardless of value
      velocityCore: 50, slowDown: 80, damageReductionUnique: 50, damageReductionWithLowHealthUnique: 35,
      damageReductionWithLowShieldUnique: 35, overmind: 30, upgrade: 20, veilOfYhgvis: 50,
      bloodlineSurge: 50, reflectDamageUnique: 40
    };
    function statFitness(type, val) {
      if (type === "convHp" || type === "convShield") return val >= 1000 ? 43 : 0.0425 * val;
      if (FLAT[type] != null) return FLAT[type];
      var base = type.replace(/[23]$/, "");          // healthAdd2 -> healthAdd, speed3 -> speed
      return W[base] != null ? W[base] * val : 0;     // unknown types score 0, like your default
    }
    function fitness(a) {
      var t = 0;
      for (var i = 0; i < a.stats.length; i++) t += statFitness(a.stats[i].type, a.stats[i].value);
      return t;
    }
    AF.statFitness = statFitness;
    AF.artifactFitness = fitness;   // purify uses this
    if (!Object.getOwnPropertyDescriptor(Artifact.prototype, "fitness")) {
      Object.defineProperty(Artifact.prototype, "fitness", { get: function () { return fitness(this); }, configurable: true });
    }

    AF.after(CB, "addToolTip", function () {
      var a = this.a, tt = this.toolTip;
      if (!a || !a.revealed || !tt || typeof tt.s !== "string") return;
      var line = "fitness: " + (fitness(a) | 0) + "<br>";
      var at = -1;
      if (a.stats.length) {
        var s0 = a.stats[0];
        at = tt.s.indexOf(ArtifactStat.parseTextFromStatType(s0.type, s0.value, s0.get_isUnique()));
      }
      tt.set_text(at === -1 ? tt.s + line : tt.s.slice(0, at) + line + tt.s.slice(at));
    });

    var nativeSorts = typeof Artifact.orderRelics === "function";   // newer builds have their own Relics/Upgrades
    Artifact.orderLevelLow = function (x, y) {           // "Fitness": highest first
      if (!x.revealed || !y.revealed) return Artifact.orderRevealed(x, y);
      var fx = fitness(x), fy = fitness(y);
      return fx < fy ? 1 : fx > fy ? -1 : 0;
    };
    if (!nativeSorts) Artifact.orderStatCountAsc = function (x, y) {       // "Relic": uniques first, higher strength first
      if (!x.revealed || !y.revealed) return Artifact.orderRevealed(x, y);
      var ux = x.get_isUnique(), uy = y.get_isUnique();
      if (ux !== uy) return ux ? -1 : 1;
      if (ux && uy) return x.level < y.level ? 1 : x.level > y.level ? -1 : 0;
      return 0;
    };
    if (!nativeSorts) Artifact.orderStatCountDesc = function (x, y) {      // "Upgrades": most upgraded first
      if (!x.revealed || !y.revealed) return Artifact.orderRevealed(x, y);
      return x.upgraded < y.upgraded ? 1 : x.upgraded > y.upgraded ? -1 : 0;
    };
    var RELABEL = nativeSorts ? { "Strength low": "Fitness" }
                              : { "Strength low": "Fitness", "Modifiers high": "Relic", "Modifiers low": "Upgrades" };
    AF.after("core.artifact.ArtifactOverview", "chooseSorting", function () {
      var panel = this.getChildAt(this.get_numChildren() - 1);   // chooseSorting adds it last
      if (!panel || !panel.__class__ || panel.__class__.__name__ !== "core.artifact.ArtifactSorting") return;
      for (var i = 0; i < panel.get_numChildren(); i++) {
        var c = panel.getChildAt(i);
        if (c instanceof Button && RELABEL[c.get_text()]) c.set_text(RELABEL[c.get_text()]);
      }
      var ROWS = ["health", "convShield", null,
                  "armor", "damageReductionWithLowHealth", "damageReductionWithLowShield", null,
                  "shield", "convHp", null,
                  "power", "all", "increaseRecyleRate", null,
                  "kineticAdd", "kineticMulti", "kineticResist", null,
                  "energy", null,
                  "corrosiveAdd", "corrosiveMulti", "corrosiveResist", null,
                  "speed", "refire", "cooldown", null];
      if (!nativeSorts && panel.mainBody && typeof panel.drawOfSubset === "function") {
        panel.mainBody.removeChildren(0, -1, true);
        panel.nextX = 20; panel.nextY = 0;
        ROWS.forEach(function (r) { if (r === null) panel.newRow(); else panel.drawOfSubset(r); });
      }
    });

    log("fitness installed");
  }

  function installPurify() {
    var AO = "core.artifact.ArtifactOverview";
    var Button = AF.cls("core.hud.components.Button"), InputText = AF.cls("core.hud.components.InputText");
    var TextBitmap = AF.cls("core.hud.components.TextBitmap");
    var Confirm = AF.cls("core.hud.components.dialogs.PopupConfirmMessage");
    if (!AF.cls(AO) || !Button || !InputText || !TextBitmap || !Confirm) { console.warn("[AFPUBLIC] purify: classes missing"); return; }

    var KEY = "AFPUBLIC.purifyStats", MAX = 40;
    var PROTECT_UNIQUE = true;

    function loadStats() {
      var o = {};
      try { o = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem("afmod.purifyStats") || "{}") || {}; } catch (e) {}
      return { lines: o.lines != null ? o.lines : 0, fitness: o.fitness != null ? o.fitness : 110, level: o.level != null ? o.level : 90 };
    }
    function saveStats(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

    function fitnessOf(a) {
      if (typeof AF.artifactFitness === "function") return AF.artifactFitness(a);
      return a.fitness != null ? a.fitness : null;
    }
	
    function isProtected(box) {
      var a = box.a;
      return a.revealed || a.name === "Recycle Generator" || !a.stats || a.stats.length === 0 || box.isUsedInSetup() ||
             a.upgrading || a.upgraded > 0 || (PROTECT_UNIQUE && a.get_isUnique());
    }
    function isBelow(a, t) {
      if (a.stats.length < t.lines) return true;
      var f = fitnessOf(a);
      if (f != null && f < t.fitness) return true;
      return a.level < t.level;
    }
    function readInputs(ao) {
      var n = function (inp) { var v = parseInt(inp.get_text(), 10); return isNaN(v) ? 0 : v; };
      return { lines: n(ao.__afLines), fitness: n(ao.__afFitness), level: n(ao.__afLevel) };
    }

    function purify(ao) {
      var btn = ao.__afPurify, g = ao.g, t = readInputs(ao);
      saveStats(t);
      var picked = [];
      for (var i = 0; i < ao.cargoBoxes.length && picked.length < MAX; i++) {
        var box = ao.cargoBoxes[i];
        if (box.a != null && !isProtected(box) && isBelow(box.a, t)) picked.push(box);
      }
      if (!picked.length) { g.showMessageDialog("No artifacts below your thresholds."); btn.set_enabled(true); return; }
      if (g.myCargo.get_isFull()) { g.showErrorDialog("Your cargo compressor is overloaded!"); btn.set_enabled(true); return; }

      picked.forEach(function (b) { b.setSelectedForRecycle(); });
      var cancel = function () { picked.forEach(function (b) { if (b.a) b.setNotSelected(); }); btn.set_enabled(true); };

      var dlg = new Confirm("Purify", "Cancel", "negative");
      dlg.set_text("Purify <FONT COLOR='#ffaa44'>" + picked.length + "</FONT> artifacts?\n\n" +
        "Lines below " + t.lines + ", fitness below " + t.fitness +
        (typeof AF.artifactFitness === "function" ? "" : " <FONT COLOR='#888888'>(fitness not set up, skipped)</FONT>") +
        ", or level below " + t.level + ".\n\nThis can't be undone.");
      g.addChildToOverlay(dlg, true);
      dlg.addEventListener("close", function () { dlg.removeEventListeners(); g.removeChildFromOverlay(dlg, true); cancel(); });
      dlg.addEventListener("accept", function () {
        dlg.removeEventListeners(); g.removeChildFromOverlay(dlg, true);
        var arts = picked.map(function (b) { return b.a; });
        var msg = g.createMessage("bulkRecycle");
        arts.forEach(function (a) { msg.add(a.id); });
        g.showModalLoadingScreen("Purifying, please wait...");
        g.rpcMessage(msg, function (m) {
          g.hideModalLoadingScreen();
          btn.set_enabled(true);
          if (!m.getBoolean(0)) { cancel(); g.showErrorDialog("Purify failed, " + m.getString(1)); return; }
          var p = ao.p;
          arts.forEach(function (a) {
            p.artifactCount -= 1;
            if (ao.cargoBoxes) for (var k = 0; k < ao.cargoBoxes.length; k++) if (ao.cargoBoxes[k].a === a) { ao.cargoBoxes[k].setEmpty(); break; }
            var j = p.artifacts.indexOf(a); if (j !== -1) p.artifacts.splice(j, 1);
            var r = ao.markedForRecycle ? ao.markedForRecycle.indexOf(a) : -1; if (r !== -1) ao.markedForRecycle.splice(r, 1);
          });
          if (p.artifactCount < p.get_artifactLimit()) g.hud.hideArtifactLimitText();
          for (var q = 1; q < m.length; q += 2) g.myCargo.addItem("Commodities", m.getString(q), m.getInt(q + 1));
          log("purified", arts.length, "artifacts");
        });
      });
    }

    AF.after(AO, "drawComponents", function () {
      var ao = this, st = loadStats();
      var btn = ao.__afPurify = new Button(function () { purify(ao); }, "Purify!", "positive");
      btn.set_x(390); btn.set_y(0);
      var save = new Button(function () { saveStats(readInputs(ao)); save.set_enabled(true); log("purify stats saved"); }, "Save!", "positive");
      save.set_x(390); save.set_y(btn.get_y() + btn.get_height() + 10);
      ao.addChild(save); ao.addChild(btn);

      var ix = 390 + btn.get_width() + 20;
      function input(y, val) {
        var inp = new InputText(ix, y, 40, 25);
        inp.set_restrict("0-9"); inp.set_maxChars(3); inp.set_text(String(val)); inp.set_isEnabled(true);
        ao.addChild(inp); return inp;
      }
      ao.__afLines = input(0, st.lines);
      ao.__afFitness = input(27, st.fitness);
      ao.__afLevel = input(54, st.level);
      ao.addChild(new TextBitmap(ix + 50, 5, "Lines", 12));
      ao.addChild(new TextBitmap(ix + 50, 32, "Fitness", 12));
      ao.addChild(new TextBitmap(ix + 50, 59, "Level", 12));
    });

    log("purify installed");
  }
  
  function installBackgroundBrightness() {
    var PM = "core.parallax.ParallaxManager", SG = "core.states.gameStates.SettingsGeneral";
    var Slider = AF.cls("core.hud.components.ui.Slider");
    if (!AF.cls(PM) || !AF.cls(SG) || !Slider) { console.warn("[AFPUBLIC] background brightness: classes missing"); return; }
    var KEY = "AFPUBLIC.nebulaAlpha", DEFAULT = 0.7;
    var clamp = function (v) { return Math.min(1, Math.max(0, v)); };
    var alpha = DEFAULT;
    try { var saved = parseFloat(localStorage.getItem(KEY)); if (!isNaN(saved)) alpha = clamp(saved); } catch (e) {}

    function apply(pm) {
      if (!pm || pm.isIntro || !pm.nebulas) return;
      pm.nebulas.forEach(function (n) { n.set_alpha(alpha); });
    }
    AF.setNebulaAlpha = function (v) {
      alpha = clamp(v);
      try { localStorage.setItem(KEY, String(alpha)); } catch (e) {}
      if (AF.game) apply(AF.game.parallaxManager);
    };

    AF.after(PM, "refresh", function () { apply(this); });
    AF.after(SG, "addCheckbox", function (r, check) {
      if (check !== this.showBackground || this.__afNebula) return;
      var slider = this.__afNebula = new Slider();
      this.addSlider(slider, alpha, "Background Brightness");
      slider.addEventListener("change", function () { AF.setNebulaAlpha(slider.get_value()); });
    });
    log("background brightness installed");
  }

  function installScreenShake() {
    var Cam = AF.cls("camerafocus.StarlingCameraFocus"), SG = "core.states.gameStates.SettingsGeneral";
    var CheckBox = AF.cls("core.hud.components.ui.CheckBox");
    if (!Cam || !AF.cls(SG) || !CheckBox || typeof Cam.prototype.shake !== "function") { console.warn("[AFPUBLIC] screen shake: classes missing"); return; }
    var KEY = "AFPUBLIC.screenShake", enabled = true;
    try { enabled = localStorage.getItem(KEY) !== "0"; } catch (e) {}

    var orig = Cam.prototype.shake;
    Cam.prototype.shake = function () { if (enabled) return orig.apply(this, arguments); };
    AF.setScreenShake = function (on) {
      enabled = !!on;
      try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (e) {}
      var cam = AF.game && AF.game.camera;
      if (!enabled && cam) { cam._shakeTimer = 0; cam.isShaking = false; }
    };

    AF.after(SG, "addCheckbox", function (r, check) {
      if (check !== this.showBackground || this.__afShake) return;
      var box = this.__afShake = new CheckBox();
      box.set_selected(enabled);
      box.addEventListener("change", function () { AF.setScreenShake(box.get_selected()); });
      this.addCheckbox(box, "Screen Shake");
    });
    log("screen shake toggle installed");
  }

  function installCargoPercent() {
    var C = "core.hud.components.cargo.Cargo", TextBitmap = AF.cls("core.hud.components.TextBitmap");
    if (!AF.cls(C) || !TextBitmap) { console.warn("[AFPUBLIC] cargo percent: classes missing"); return; }
    var RED = 0xff4444;
    AF.after(C, "draw", function () {
      var me = this.g && this.g.get_me(), cap = me && this.compressorCapacities && this.compressorCapacities[me.compressorLevel];
      if (!cap) return;
      var pct = 100 * this.spaceJunkCount / cap | 0;
      if (pct <= 100) return;
      for (var i = 0; i < this.get_numChildren(); i++) {
        var c = this.getChildAt(i);
        if (!(c instanceof TextBitmap) || !/^\d+%$/.test(c.get_text())) continue;
        var mid = c.get_x() + c.get_width() / 2;
        c.set_color(RED);
        c.set_text(pct + "%");
        c.set_x(mid - c.get_width() / 2);
        return;
      }
    });
    log("cargo percent installed");
  }

  function installCloakReveal() {
    var Enemy = AF.cls("core.ship.EnemyShip"), Tween = AF.cls("com.greensock.TweenMax"), SG = "core.states.gameStates.SettingsGeneral";
    var CheckBox = AF.cls("core.hud.components.ui.CheckBox");
    if (!Enemy || !Tween || !AF.cls(SG) || !CheckBox || typeof Enemy.prototype.cloakStart !== "function") { console.warn("[AFPUBLIC] cloak reveal: classes missing"); return; }
    var KEY = "AFPUBLIC.showCloaked", ALPHA = 0.4, enabled = false;
    try { enabled = localStorage.getItem(KEY) === "1"; } catch (e) {}

    var orig = Enemy.prototype.cloakStart;
    Enemy.prototype.cloakStart = function () {
      if (!enabled) return orig.apply(this, arguments);
      Tween.to(this._mc, 1, { alpha: ALPHA });
    };
    AF.setShowCloaked = function (on) {
      enabled = !!on;
      try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (e) {}
    };

    AF.after(SG, "addCheckbox", function (r, check) {
      if (check !== this.showBackground || this.__afCloak) return;
      var box = this.__afCloak = new CheckBox();
      box.set_selected(enabled);
      box.addEventListener("change", function () { AF.setShowCloaked(box.get_selected()); });
      this.addCheckbox(box, "Show Cloaked Enemies");
    });
    log("cloak reveal installed");
  }

  function installLowHpWarning() {
    var HS = AF.cls("core.hud.components.HealthAndShield"), Tween = AF.cls("com.greensock.TweenMax"), SG = "core.states.gameStates.SettingsGeneral";
    var Slider = AF.cls("core.hud.components.ui.Slider");
    if (!HS || !Tween || !AF.cls(SG) || !Slider || typeof HS.prototype.startLowHpWarningEffect !== "function") { console.warn("[AFPUBLIC] low hp warning: classes missing"); return; }
    var KEY = "AFPUBLIC.lowHpStrength", DEFAULT = 0.5;
    var clamp = function (v) { return Math.min(1, Math.max(0, v)); };
    var k = DEFAULT;
    try { var saved = parseFloat(localStorage.getItem(KEY)); if (!isNaN(saved)) k = clamp(saved); } catch (e) {}

    HS.prototype.startLowHpWarningEffect = function () {
      if (this.inLowHp) return;
      var self = this, o = this.warningOverlay;
      this.inLowHp = true;
      if (this.lowHpTween) { this.lowHpTween.kill(); this.lowHpTween = null; }
      this.g.addChildToOverlay(o);
      this.lowHpTween = Tween.fromTo(o, 1, { alpha: o.get_alpha() }, { alpha: 0.2 * k, onComplete: function () {
        self.lowHpTween = Tween.fromTo(o, 1, { alpha: 0.2 * k }, { alpha: 0.3 * k, yoyo: true, repeat: -1 });
      } });
    };
    AF.setLowHpStrength = function (v) {
      k = clamp(v);
      try { localStorage.setItem(KEY, String(k)); } catch (e) {}
      var hs = AF.game && AF.game.hud && AF.game.hud.healthAndShield;
      if (hs && hs.inLowHp) { hs.inLowHp = false; hs.startLowHpWarningEffect(); }
    };

    AF.after(SG, "addCheckbox", function (r, check) {
      if (check !== this.showBackground || this.__afLowHp) return;
      var slider = this.__afLowHp = new Slider();
      this.addSlider(slider, k, "Low Health Warning");
      slider.addEventListener("change", function () { AF.setLowHpStrength(slider.get_value()); });
    });
    log("low hp warning installed");
  }

  function installKongregateLogin() {
    var Login = AF.cls("Login"), QC = AF.cls("playerio.QuickConnect"), Client = AF.cls("playerio.Client");
    var PErr = AF.cls("playerio.PlayerIOError"), Sdk = AF.cls("playerio.sdk.PlayerIOSdk"), Util = AF.cls("generics.Util");
    if (!Login || !QC || !Client || !PErr || !Sdk || !Util || typeof Login.prototype.onConnectSimple !== "function") {
      console.warn("[AFPUBLIC] kongregate login: classes missing"); return;
    }
    var orig = Login.prototype.onConnectSimple;
    Login.prototype.onConnectSimple = function () {
      var id = Util.trimUsername(this.emailInput.get_text()), token = Util.trimUsername(this.passwordInput.get_text());
      if (!/^\d{3,}$/.test(id) || !/^[0-9a-f]{64}$/i.test(token)) return orig.apply(this, arguments);

      var self = this;
      this.emailInput.set_error(""); this.passwordInput.set_error("");
      this.hideLogin();
      this.updateStatus("Connecting to Kongregate account");
      this.mySharedObject.data.email = id; this.mySharedObject.flush();
      var n = ++this.connectAttempt;
      this.startConnectTimer(n);
      if (!Sdk.isLoaded() || typeof _pio === "undefined") {
        this.onSimpleConnectFailed(PErr.local("SdkNotLoaded", "PlayerIO SDK is not loaded, reload the page."), n); return;
      }
      var ch = new _pio.channel();
      ch.kongregateConnect(Login.gameId, id, token, [], "javascript", {},
        function (c) { self.onSimpleConnected(Client.wrap(c), n); },
        function (err) { self.onSimpleConnectFailed(PErr.wrap(err), n); },
        QC.convertFor(ch, Login.gameId));
    };
    log("kongregate login installed");
  }

  (function installEarly(tries) {
    if (AF.cls("Login") && AF.cls("playerio.QuickConnect")) { installKongregateLogin(); return; }
    if (tries < 1200) setTimeout(function () { installEarly(tries + 1); }, 50);
  })(0);

  function installEdits() {
    installQuickUpgrade();
    installPaintShop();
    installFitness();
    installPurify();
    installBackgroundBrightness();
    installScreenShake();
    installCargoPercent();
    installCloakReveal();
    installLowHpWarning();
  }
})();
