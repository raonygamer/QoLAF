import { CONFIG_KEY, PluginHost, readConfig } from './core.js';
import { nativeManager } from './native-manager.js';

export function createPluginManager({storage, safe=false}={}) {
 let config, storageError='', ui;
 try {storage??=localStorage;config=readConfig(storage);}catch(error){storageError='Saved plugins could not be read: '+error.message;config={version:1,plugins:[]};}
 storage??={getItem(){return null;},setItem(){throw Error('Storage unavailable');},removeItem(){}};
 const host=new PluginHost({storage,onChange:()=>ui?.render()});
 const save=next=>{
  // Run the same URL, duplicate and count validation as startup before persisting.
  const validated=readConfig({getItem:()=>JSON.stringify(next)});
  storage.setItem(CONFIG_KEY,JSON.stringify(validated));config=validated;storageError='Saved. Reload to apply changes.';
 };
 ui=nativeManager(host,{config:()=>config,save,reload:()=>location.reload(),safe,error:()=>storageError});
 window.QoLAF=Object.freeze({apiVersion:1,get classes(){return host.classes;},get game(){return host.game;},cls:name=>host.classes?.[name],openPlugins:ui.open});
 window.__QOLAF={classesReady(classes){try{host.classesReady(classes);}catch(error){console.error('[QoLAF bridge]',error);host.dispose();}},created(game){host.created(game);}};
 window.addEventListener('pagehide',()=>host.dispose(),{once:true});
 return {host,async load(){if(!safe)for(const plugin of config.plugins.filter(p=>p.enabled))await host.load(plugin.url);}};
}
