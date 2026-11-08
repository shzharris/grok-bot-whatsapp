import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename,rm,cp,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,createHash} from 'node:crypto';
import {menuHostName,menuEntries,menuPlan,shareConfiguration,slotIdentifier,legacySlotIdentifier,destinationPath,slotExtensionPath,extensionIdentifier,pluginIdentifier} from '../share/model.mjs';
import {plist,extensionInfo,destinationInfo} from '../share/plist.mjs';
import {registerSlots} from '../share/registration.mjs';
import {iconResourceName} from '../share/icon-resource.mjs';
import {shareSlotTitle} from '../shell/locale.mjs';

const execute=promisify(execFile);
const LS='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const run=(file,args)=>execute(file,args,{timeout:30000,maxBuffer:2*1024*1024});
const layoutOptions=installed=>installed?.layoutVersion>=2?{}:{identifier:legacySlotIdentifier,extension:(root,slot)=>join(root,`Contents/PlugIns/GrokBotShare${slot}.appex`),destination:null};
async function atomicJSON(path,value){const temporary=`${path}-${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temporary,path);}

export class ShareMenu {
 constructor({root,template,applicationsRoot,applicationPath,locale='en',onChange=()=>{}}){
  Object.assign(this,{root,template,applicationsRoot,applicationPath,locale,onChange});
  this.host=join(applicationsRoot,menuHostName);
  this.busy=false;this.status={available:process.platform==='darwin',registered:0,enabled:0,needsUpdate:true};this.configQueue=Promise.resolve();
 }
 async initialize(){
  await mkdir(this.root,{recursive:true,mode:0o700});
  const digest=createHash('sha256').update('transparent-share-icons-v7');
  for(const file of ['Contents/MacOS/GrokBotMenuHost','Contents/PlugIns/GrokBotShare1.appex/Contents/MacOS/GrokBotShare','Contents/Resources/share.entitlements'])digest.update(await readFile(join(this.template,file)));
  this.templateHash=digest.digest('hex');
  try{this.installed=JSON.parse(await readFile(join(this.root,'menu-state.json'),'utf8'));await access(this.installed.hostPath??join(this.applicationsRoot,'Grok Bot Anywhere Menu.app'));this.electedSlots=await this.readElections(this.installed);this.status.registered=this.electedSlots.length;this.status.enabled=this.installed.entries?.length??0;this.status.needsUpdate=this.status.registered!==this.status.enabled;}
  catch{this.installed=null;this.electedSlots=[];}
 }
 async elect(){
  if(!this.installed)return this.status;
  const host=this.installed.hostPath??this.host;
  for(const entry of this.installed.entries??[]){
   const extension=slotExtensionPath(host,entry.slot);
   const identifier=entry.extensionId??extensionIdentifier(entry.slot,entry.generation??1);
   await run('/usr/bin/pluginkit',['-a',extension]).catch(()=>{});
   await run('/usr/bin/pluginkit',['-e','use','-i',identifier]).catch(()=>{});
  }
  this.electedSlots=await this.readElections(this.installed);
  this.status.registered=this.electedSlots.length;
  this.status.enabled=this.installed.entries?.length??this.status.enabled??0;
  this.status.needsUpdate=this.status.registered!==this.status.enabled;
  this.onChange();
  return this.status;
 }
 async readElections(installed){
  if((installed?.layoutVersion??0)>=4){
   const {stdout}=await run('/usr/bin/pluginkit',['-m','-p','com.apple.share-services']);
   const enabled=new Set(stdout.split('\n').filter(line=>line.startsWith('+')).map(line=>line.trim().split(/\s+/)[1]?.split('(')[0]).filter(Boolean));
   return (installed.entries??[]).filter(entry=>enabled.has(entry.extensionId??extensionIdentifier(entry.slot,entry.generation??1))).map(entry=>entry.slot);
  }
  const identifier=installed?.layoutVersion>=2?slotIdentifier:legacySlotIdentifier,slots=[];
  for(let slot=1;slot<=12;slot++){
   const {stdout}=await run('/usr/bin/pluginkit',['-m','-i',identifier(slot)]);
   if(stdout.split('\n').some(line=>line.startsWith('+')&&line.includes(identifier(slot))))slots.push(slot);
  }
  return slots;
 }
 allowedSlots(state,installed){const desired=menuEntries(state);return (installed?.entries??[]).filter(e=>desired.some(d=>d.accountId===e.accountId&&d.botId===e.botId)).map(e=>e.slot);}
 async sync(state){
  this.state=state;
  // During startup/login the account is transitioning and menuEntries is
  // intentionally empty. Do not publish that transient as a real menu state:
  // it rewrites configuration.json and lets a manual sync clear the menu.
  if(state.accountBusy){this.status={...this.status,busy:this.busy};this.onChange();return;}
  const configuration=shareConfiguration(state);
  this.configQueue=this.configQueue.catch(()=>{}).then(async()=>{
   await atomicJSON(join(this.root,'configuration.json'),configuration);
   if(this.installed&&!this.busy){
    const slots=this.allowedSlots(state,this.installed),identifier=slot=>pluginIdentifier(this.installed,slot);
    if(JSON.stringify(slots)!==JSON.stringify(this.electedSlots)){
     for(let slot=1;slot<=12;slot++)await run('/usr/bin/pluginkit',['-e',slots.includes(slot)?'use':'ignore','-i',identifier(slot)]);
     this.electedSlots=await this.readElections(this.installed);this.status.registered=this.electedSlots.length;
    }
   }
  });
  await this.configQueue;
  const current=this.state,entries=menuEntries(current),plan=menuPlan(current,this.installed);
  this.status={...this.status,enabled:entries.length,needsUpdate:!this.installed||this.installed.layoutVersion!==4||plan.rebuild||this.installed.templateHash!==this.templateHash||this.installed.applicationPath!==this.applicationPath||this.status.registered!==entries.length,busy:this.busy};
  this.onChange();
 }
 async retire(installed,host){
  const ids=new Set();
  for(let slot=1;slot<=12;slot++){
   ids.add(legacySlotIdentifier(slot));ids.add(slotIdentifier(slot));ids.add(pluginIdentifier(installed,slot));
   await run('/usr/bin/pluginkit',['-r',slotExtensionPath(host,slot)]).catch(()=>{});
   if((installed?.layoutVersion??0)>=2)await run(LS,['-u',destinationPath(host,slot)]).catch(()=>{});
  }
  for(const entry of installed?.entries??[])if(entry.extensionId)ids.add(entry.extensionId);
  for(const id of ids)await run('/usr/bin/pluginkit',['-e','ignore','-i',id]).catch(()=>{});
  await run(LS,['-u',host]).catch(()=>{});
 }
 async unregister(installed,host=this.host){
  const options=layoutOptions(installed),identifier=options.identifier??slotIdentifier,extension=options.extension??slotExtensionPath;
  for(let slot=1;slot<=12;slot++){
   await run('/usr/bin/pluginkit',['-e','ignore','-i',identifier(slot)]).catch(()=>{});
   await run('/usr/bin/pluginkit',['-r',extension(host,slot)]).catch(()=>{});
   if(installed?.layoutVersion>=2)await run(LS,['-u',destinationPath(host,slot)]).catch(()=>{});
  }
  await run(LS,['-u',host]).catch(()=>{});
 }
 async update(state,icons,{isCurrent=()=>true,force=false}={}){
  if(process.platform!=='darwin')throw new Error('MAC_ONLY');if(this.busy)throw new Error('MENU_UPDATE_BUSY');
  const check=()=>{if(!isCurrent())throw new Error('MENU_SUPERSEDED');};check();
  if(state.accountBusy)throw new Error('ACCOUNT_BUSY');
  this.busy=true;this.status.busy=true;this.onChange();
  const workRoot=join(dirname(this.root),'MenuUpdates'),work=join(workRoot,randomUUID()),staged=join(work,'Grok Bot Anywhere Menu.app'),backup=join(work,'Previous.app');
  const previous=this.installed;let previousHost=previous?.hostPath??join(this.applicationsRoot,'Grok Bot Anywhere Menu.app');let swapped=false,backedUp=false,registrationTouched=false,preserveWork=false,completed=false;
  try{
   await this.sync(state);check();
   const plan=menuPlan(state,this.installed);let exists=true;try{await access(this.host);}catch{exists=false;}
   if(exists)previousHost=this.host;
   let previousBuild=this.installed?.build??2;
   if(exists){try{const {stdout}=await run('/usr/bin/plutil',['-extract','CFBundleVersion','raw','-o','-',join(this.host,'Contents/Info.plist')]);previousBuild=Math.max(previousBuild,Number(stdout.trim())||0);}catch{}}
   const menuLocale=String(this.locale??'').toLowerCase().startsWith('zh')?'zh':'en';
   const recordedLocale=this.installed?.locale==='zh'||this.installed?.locale==='en'?this.installed.locale:'';
   const rebuild=force||plan.rebuild||!exists||this.installed?.layoutVersion!==4||this.installed?.templateHash!==this.templateHash||this.installed?.applicationPath!==this.applicationPath||(recordedLocale!==''&&recordedLocale!==menuLocale);
   const build=rebuild?previousBuild+1:previousBuild;
   if(rebuild){
    const entries=plan.entries.filter(entry=>plan.enabledSlots.includes(entry.slot)).map(entry=>({...entry,generation:entry.generation??1,extensionId:extensionIdentifier(entry.slot,entry.generation??1)}));
    await mkdir(work,{recursive:true,mode:0o700});await cp(this.template,staged,{recursive:true});
    const contents=join(staged,'Contents'),entitlements=join(contents,'Resources/share.entitlements');
    await rm(join(contents,'PlugIns'),{recursive:true,force:true});await mkdir(join(contents,'Helpers'),{recursive:true});
    await writeFile(join(contents,'Info.plist'),plist({CFBundleInfoDictionaryVersion:'6.0',CFBundleName:'Grok Bot Anywhere Menu',CFBundleIdentifier:'dev.ronglecat.grokbotanywhere.menu',CFBundleExecutable:'GrokBotMenuHost',CFBundlePackageType:'APPL',CFBundleShortVersionString:'0.2.0',CFBundleVersion:String(build),LSUIElement:true,LSMinimumSystemVersion:'14.0',GBAApplicationPath:this.applicationPath}));
    for(let slot=1;slot<=12;slot++){
     check();
     const entry=entries.find(e=>e.slot===slot),destination=destinationPath(staged,slot),inside=join(destination,'Contents'),extension=slotExtensionPath(staged,slot),resources=join(extension,'Contents/Resources');
     await mkdir(join(inside,'MacOS'),{recursive:true});await mkdir(join(inside,'Resources'),{recursive:true});
     await cp(join(this.template,'Contents/MacOS/GrokBotMenuHost'),join(inside,'MacOS/GrokBotMenuHost'));
     await cp(join(this.template,'Contents/PlugIns/GrokBotShare1.appex'),extension,{recursive:true});
     const executable=`GrokBotShare${slot}`;
     await rename(join(extension,'Contents/MacOS/GrokBotShare'),join(extension,'Contents/MacOS',executable));
     const name=shareSlotTitle(entry?.botName,this.locale);
     let iconFile='AppIcon.icns';
     await writeFile(join(resources,'binding.json'),JSON.stringify(entry?{version:1,slot,accountId:entry.accountId,botId:entry.botId}:{version:1,slot}));
     for(const language of ['zh-Hans','en']){await mkdir(join(resources,`${language}.lproj`),{recursive:true});await writeFile(join(resources,`${language}.lproj/InfoPlist.strings`),`"CFBundleDisplayName" = ${JSON.stringify(name)};\n`);}
     if(entry){
      const data=icons.find(icon=>icon.botId===entry.botId)?.png;
      if(typeof data!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)||data.length>2*1024*1024)throw new Error('MENU_AVATAR_MISSING');
      const pixels=Buffer.from(data.split(',')[1],'base64');iconFile=iconResourceName(pixels);
      const input=join(resources,'avatar.png');await writeFile(input,pixels);
      const iconset=join(work,`slot${slot}.iconset`);await mkdir(iconset,{recursive:true});
      for(const size of [16,32,128,256,512])for(const scale of [1,2])await run('/usr/bin/sips',['-z',String(size*scale),String(size*scale),input,'--out',join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)]);
      await run('/usr/bin/iconutil',['--convert','icns','--output',join(resources,iconFile),iconset]);
      await cp(join(resources,iconFile),join(inside,'Resources',iconFile));
     }
     await writeFile(join(inside,'Info.plist'),plist(destinationInfo(slot,name,this.applicationPath,iconFile,build)));
     await writeFile(join(extension,'Contents/Info.plist'),plist({...extensionInfo(slot,name,iconFile),CFBundleExecutable:executable,CFBundleIdentifier:entry?.extensionId??extensionIdentifier(slot,0),CFBundleVersion:String(build)}));
     await run('/usr/bin/codesign',['--force','--sign','-','--entitlements',entitlements,extension]);
     await run('/usr/bin/codesign',['--force','--sign','-',destination]);
    }
    await rm(join(contents,'Info.plist'));await rm(join(contents,'MacOS'),{recursive:true,force:true});await rm(join(staged,'Contents/_CodeSignature'),{recursive:true,force:true});
    for(let slot=1;slot<=12;slot++)await run('/usr/bin/codesign',['--verify','--deep','--strict',destinationPath(staged,slot)]);check();
    await mkdir(this.applicationsRoot,{recursive:true});
    let previousExists=false;try{await access(previousHost);previousExists=true;}catch{}
    if(previousExists){registrationTouched=true;await this.retire(previous,previousHost);check();await rename(previousHost,backup);backedUp=true;}
    check();await rename(staged,this.host);swapped=true;check();
    plan.entries=entries;plan.enabledSlots=entries.map(e=>e.slot);
   }
   check();registrationTouched=true;check();
   const registered=await registerSlots(this.host,plan.enabledSlots,run,undefined,{isCurrent,identifier:slot=>pluginIdentifier({layoutVersion:rebuild?4:this.installed?.layoutVersion,entries:plan.entries},slot)});check();
   this.installed={layoutVersion:rebuild?4:(previous?.layoutVersion??4),hostPath:this.host,entries:plan.entries.map(({bot,...entry})=>entry),enabledSlots:plan.enabledSlots,templateHash:this.templateHash,applicationPath:this.applicationPath,build,locale:rebuild?menuLocale:this.installed?.locale};
   this.electedSlots=await this.readElections(this.installed);check();
   await atomicJSON(join(this.root,'menu-state.json'),this.installed);
   this.status={available:true,registered,enabled:plan.enabledSlots.length,needsUpdate:registered!==plan.enabledSlots.length,busy:false};this.onChange();
   completed=true;return this.status;
  }catch(error){
   if(swapped){await this.unregister({layoutVersion:2});await rm(this.host,{recursive:true,force:true});}
   if(backedUp){try{await rename(backup,previousHost);}catch(rollbackError){preserveWork=true;throw new Error('MENU_ROLLBACK_FAILED',{cause:rollbackError});}}
   this.installed=previous;
   if(registrationTouched&&previous){
    const allowed=this.allowedSlots(this.state??state,previous);

    await registerSlots(previousHost,allowed,run,undefined,{...layoutOptions(previous),identifier:slot=>pluginIdentifier(previous,slot)}).catch(()=>{});
    this.electedSlots=await this.readElections(previous).catch(()=>[]);
   }
   if(error.message==='MENU_SUPERSEDED')return;
   await writeFile(join(this.root,`update-failure-${randomUUID()}.txt`),String(error.stderr??error.message),{mode:0o600,flag:'wx'}).catch(()=>{});
   this.status={...this.status,needsUpdate:true,error:'MENU_UPDATE_FAILED'};
   throw new Error('MENU_UPDATE_FAILED',{cause:error});
  }finally{
   this.busy=false;this.status.busy=false;this.onChange();
   if(this.state)await this.sync(this.state);
   if(!preserveWork)await rm(work,{recursive:true,force:true});
   // Removing the old app inode can asynchronously evict the replacement from
   // PlugInKit. Reassert the final paths after backup cleanup has settled.
   if(completed&&!this.busy){
    await delay(2000);
    const allowed=this.allowedSlots(this.state??state,this.installed);
    for(let attempt=0;attempt<3;attempt++){
     await registerSlots(this.host,allowed,run,undefined,{identifier:slot=>pluginIdentifier(this.installed,slot)});await delay(2000);
     this.electedSlots=await this.readElections(this.installed);
     if(allowed.every(slot=>this.electedSlots.includes(slot)))break;
    }
    this.status.registered=this.electedSlots.filter(slot=>allowed.includes(slot)).length;
    this.status.needsUpdate=this.status.registered!==menuEntries(this.state??state).length;
    this.onChange();
   }
  }
 }
}
