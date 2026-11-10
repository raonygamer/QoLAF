// Host UI uses the game's own display list and controls. No HTML UI is mounted.
export function nativeManager(host, { config, save, reload, safe, error }) {
  let owner, root, window, status, list, input, trust = false, page = 0, blocked, settingsState;
  const C = name => { const cls=host.classes?.[name]; if(!cls)throw Error('Missing game UI class '+name);return cls; };
  const sprite=()=>new (C('starling.display.Sprite'))();
  const place=(child,x,y,parent)=>{child.set_x(x);child.set_y(y);parent?.addChild(child);return child;};
  const text=(value,w=540,h=26,size=13)=>{const t=new (C('starling.text.TextField'))(w,h,value,new (C('starling.text.TextFormat'))('DAIDRR',size,0xffffff,'left','center'));t.set_touchable(false);return t;};
  const button = (label, callback) => {
    const click = () => {
      try { callback(); }
      catch (failure) {
        console.error('[QoLAF plugin UI]', failure);
        status?.set_text(String(failure.message || failure));
      }
    };
    if (!settingsState) return new (C('core.hud.components.LoginButton'))(label, click);
    // Keep login controls on login; use the game's themed menu buttons in play.
    // The external client registers the original Verdana atlas. Vanilla has font13.
    const font = C('starling.text.TextField').getBitmapFont?.('verdana16_bitmap')
      ? 'verdana16_bitmap' : 'font13';
    const control = new (C('core.hud.components.Button'))(click, label, 'normal', 13, font);
    control.autoEnableAfterClick = true;
    control.set_width(120);
    // Native Sprite.set_height scales glyphs. Resize the text and skins instead.
    control.tf.set_height(32);
    control.styleImage.set_height(32);
    control.hoverImage.set_height(32);
    return control;
  };
  const dispose=node=>{if(!node)return;const parent=node.get_parent();if(parent)parent.removeChild(node,true);else node.dispose();};
  const close=()=>{if(!window)return;dispose(window);window=null;trust=false;if(blocked){blocked.game.blockHotkeys=blocked.value;blocked=null;}};
  const layout=()=>{
    if(!owner?.get_stage()||!root)return;
    const stage=owner.get_stage();
    if(settingsState){
      // Original port chrome has a sidebar; upstream has a top tab row.
      root.set_x(settingsState.panel ? 26 : Math.max(20,settingsState.bg.get_width()-132));
      root.set_y(settingsState.panel ? 484 : 32);
    }else{
      root.set_x(stage.get_stageWidth()-132);
      root.set_y(stage.get_stageHeight()-44);
    }
    if(window){
      const fit=Math.max(.1,Math.min(1,(stage.get_stageWidth()-32)/620,(stage.get_stageHeight()-32)/480));
      window.set_scaleX(fit);window.set_scaleY(fit);
      window.set_x((stage.get_stageWidth()-620*fit)/2);
      window.set_y((stage.get_stageHeight()-480*fit)/2);
    }
  };
  function render(){
    if(!window)return;list.removeChildren(0,-1,true);const plugins=config().plugins;page=Math.min(page,Math.max(0,Math.ceil(plugins.length/4)-1));
    for(const [i,p] of plugins.slice(page*4,page*4+4).entries()){
      const record=host.records.find(r=>r.url===p.url);const y=i*62;
      const label=text(record?.name||'External plugin',260,24);place(label,0,y,list);
      const detail=text(p.url,540,22,10);place(detail,0,y+24,list);
      place(button(p.enabled?'Enabled':'Disabled',()=>{save({...config(),plugins:plugins.map(item=>item.url===p.url?{...item,enabled:!item.enabled}:item)});render();}),280,y,list);
      place(button('Remove',()=>{save({...config(),plugins:plugins.filter(item=>item.url!==p.url)});render();}),410,y,list);
      if(record?.error)status.set_text(record.error);
    }
    status.set_text(error()||(safe?'Safe mode: plugins are disabled.':'Changes apply after reload.'));
  }
  function open(){
    if(!owner||window)return;if(host.game){blocked={game:host.game,value:host.game.blockHotkeys};host.game.blockHotkeys=true;}
    window=sprite();window.addEventListener('touch',event=>event.stopPropagation());const bg=new (C('starling.display.Quad'))(620,480,0x080808);bg.set_alpha(.96);window.addChild(bg);
    for(const [x,y,w,h] of [[0,0,620,1],[0,479,620,1],[0,0,1,480],[619,0,1,480]])place(new (C('starling.display.Quad'))(w,h,0x707070),x,y,window);
    place(text('Plugins',410,34,20),24,12,window);place(button('Close',close),476,12,window);
    list=sprite();place(list,24,60,window);
    place(button('<',()=>{page=Math.max(0,page-1);render();}),24,296,window);
    place(button('>',()=>{page=Math.min(Math.ceil(config().plugins.length/4)-1,page+1);render();}),150,296,window);
    place(text('Plugin URL',430,18,11),24,332,window);
    place(new (C('starling.display.Quad'))(432,30,0x707070),23,353,window);
    place(new (C('starling.display.Quad'))(430,28,0x181818),24,354,window);
    input=new (C('core.hud.components.ui.TextEntry'))('plain');input.set_width(430);input.set_height(28);place(input,24,354,window);
    place(button('Add URL',()=>{try{if(!trust)throw Error('Enable trust before adding a plugin.');save({...config(),plugins:[...config().plugins,{url:input.get_text().trim(),enabled:true}]});input.set_text('');trust=false;trustButton.set_text('Trust: no');render();}catch(e){status.set_text(e.message);}}),476,352,window);
    const trustButton=place(button('Trust: no',()=>{trust=!trust;trustButton.set_text(trust?'Trust: yes':'Trust: no');}),24,391,window);
    place(text('Full game/session access, including future updates',430,25,11),154,394,window);
    status=place(text('',420,38,11),24,432,window);status.set_wordWrap(true);
    place(button('Reload',reload),476,432,window);
    (host.game?.overlay||owner).addChild(window);render();layout();
  }
  function unmount(){close();dispose(root);root=null;owner=null;settingsState=null;}
  function mount(target,state=null){unmount();owner=target;settingsState=state;root=button('Plugins',open);if(settingsState?.panel)root.set_width(130);root.set_name('qolaf.pluginsButton');owner.addChild(root);layout();}
  host.on('classesReady',()=>{
    const login=C('Login').prototype;
    host.scope.defer(host.hooks.add(login,'init','after',function(){mount(this);}));
    host.scope.defer(host.hooks.add(login,'resize','after',layout));
    const settings=C('core.states.gameStates.SettingsState').prototype;
    host.scope.defer(host.hooks.add(settings,'enter','after',function(){mount(this.panel||this.container,this);}));
    host.scope.defer(host.hooks.add(settings,'resize','after',layout));
    host.scope.defer(host.hooks.add(settings,'close','before',unmount));
    host.scope.defer(host.hooks.add(settings,'exit','before',unmount));
  });
  host.on('gameReady',unmount);
  host.on('frame',layout);
  host.on('gameExit',unmount);
  host.scope.defer(unmount);
  return {open,render};
}
