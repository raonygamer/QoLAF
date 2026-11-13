import { importPrivateClient } from '../private.js';
import { CONFIG_KEY, DEFAULT_CLIENT_URL, PluginHost, readConfig } from './core.js';
import { nativeManager } from './native-manager.js';

export function createPluginManager({storage, safe=false, privateClient=false}={}) {
 let config, storageError='', ui;
 try {storage??=localStorage;config=readConfig(storage);}catch(error){storageError='Saved plugins could not be read: '+error.message;config={version:1,plugins:[]};}
 storage??={getItem(){return null;},setItem(){throw Error('Storage unavailable');},removeItem(){}};
 try {if(!storageError)storage.setItem(CONFIG_KEY,JSON.stringify(config));}catch(error){storageError='Plugin choices could not be saved: '+error.message;}
 const host=new PluginHost({storage,importer:url=>{
  const target=new URL(url), expected=new URL(DEFAULT_CLIENT_URL);
  return privateClient && target.origin===expected.origin && target.pathname===expected.pathname
   ? importPrivateClient(url) : import(url);
 },onChange:()=>{
  let changed=false;
  config.plugins=config.plugins.map(plugin=>{
   const record=host.records.findLast(record=>record.url===plugin.url&&record.version!==undefined);
   if(!record)return plugin;
   const metadata={name:record.name,version:record.version,description:record.description,safeToHotReload:record.safeToHotReload};
   if(JSON.stringify(plugin.metadata)===JSON.stringify(metadata))return plugin;
   changed=true;return {...plugin,metadata};
  });
  if(changed)try{storage.setItem(CONFIG_KEY,JSON.stringify(config));}catch(error){storageError='Plugin metadata could not be saved: '+error.message;}
  ui?.render();
 }});
 const save=next=>{
  // Run the same URL, duplicate and count validation as startup before persisting.
  const validated=readConfig({getItem:()=>JSON.stringify(next)});
  storage.setItem(CONFIG_KEY,JSON.stringify(validated));config=validated;storageError='Saved. Reload to apply changes.';
 };
 const setUnsafe=async(url,enabled)=>{
  try {
   const recordInfo=host.records.findLast(record=>record.url===url&&record.safeToHotReload!==undefined)??config.plugins.find(plugin=>plugin.url===url)?.metadata;
   if(recordInfo?.safeToHotReload!==true)throw Error('This plugin requires a page reload.');
   if(enabled&&safe)throw Error('Exit safe mode with a page reload before enabling plugins.');
   save({...config,plugins:config.plugins.map(plugin=>plugin.url===url?{...plugin,enabled}:plugin)});
   if(enabled){
    const record=await host.load(url,{fresh:true,hot:true});
    storageError=record.error||(record.state==='active'?'Plugin enabled in the current session.':'Plugin was not activated.');
   }else{
    host.unload(url);
    storageError=host.records.findLast(record=>record.url===url)?.error||'Plugin disabled in the current session. Reload if native state behaves incorrectly.';
   }
  }catch(failure){storageError=String(failure.message||failure);console.error('[QoLAF plugin action]',failure);}
  ui?.render();
 };
 ui=nativeManager(host,{config:()=>config,save,setUnsafe,reload:()=>location.reload(),safe,error:()=>storageError});
 window.QoLAF=Object.freeze({apiVersion:1,get classes(){return host.classes;},get game(){return host.game;},cls:name=>host.classes?.[name],openPlugins:ui.open});
 window.__QOLAF={classesReady(classes){try{host.classesReady(classes);}catch(error){console.error('[QoLAF bridge]',error);host.dispose();}},created(game){host.created(game);}};
 window.addEventListener('pagehide',()=>host.dispose(),{once:true});
 return {host,async load(){if(!safe)for(const plugin of config.plugins.filter(p=>p.enabled))await host.load(plugin.url);}};
}
