import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import * as sdk from 'grok-bot-sdk';
import {COLORS,SHAPES} from 'grok-bot-avatar-engine';
import {Delivery} from './delivery.mjs';
import {emptySourceDefaults,normalizeSourceDefaults,SOURCE_DEFAULT_FLAGS,SOURCE_DEFAULT_KEYS} from './source-defaults.mjs';
import {inspectWhatsAppIntake,prependInstruction} from './whatsapp-export.mjs';
import {WhatsAppFolderWatch} from './whatsapp-watch.mjs';
import {readSidebarSettings} from './runtime-settings.mjs';
import {normalizeAccelerator,normalizeShortcutMap} from '../shortcuts.mjs';

const AVATAR_SHAPES=new Set(SHAPES);
const AVATAR_COLORS=new Set(COLORS.map(({id})=>id));

function emptyRuntime(){return {mainAgentId:null,statuses:[],pinnedAgentIds:[],sections:[]};}
async function readRuntime(client,bots,previous=emptyRuntime(),credentials){
  const runtime={...emptyRuntime(),...previous,statuses:Array.isArray(previous?.statuses)?previous.statuses:[]};
  if(typeof client.getRuntimeSettings==='function'){
    const settings=await client.getRuntimeSettings();
    runtime.mainAgentId=settings?.mainAgentId??null;
    runtime.pinnedAgentIds=Array.isArray(settings?.pinnedAgentIds)?settings.pinnedAgentIds:[];
    runtime.sections=Array.isArray(settings?.sections)?settings.sections:[];
  }else if(credentials?.accessToken&&client?.constructor?.name==='GrokBotClient'){
    const settings=await readSidebarSettings(credentials);
    runtime.mainAgentId=settings.mainAgentId;
    runtime.pinnedAgentIds=settings.pinnedAgentIds;
    runtime.sections=settings.sections;
  }
  const ids=bots.map(bot=>bot.id);
  if(typeof client.listStatuses==='function'){
    const listed=await client.listStatuses(ids);
    runtime.statuses=Array.isArray(listed?.statuses)?listed.statuses:[];
  }else if(typeof client.listAgentStatuses==='function'){
    const listed=await client.listAgentStatuses(ids);
    runtime.statuses=(Array.isArray(listed?.statuses)?listed.statuses:[]).flatMap(row=>typeof row?.agentId==='string'&&row.agentId?[{agentId:row.agentId,isRunning:row.isRunning===true}]:[]);
  }
  return runtime;
}

export class AccountSession {
  constructor({store,sdk:implementation=sdk,upload,onEvent=()=>{},now=Date.now,downloadsDir=''}) {
    Object.assign(this,{store,sdk:implementation,upload,onEvent,now,downloadsDir});
    this.whatsappWatch=new WhatsAppFolderWatch({session:this,downloadsDir});
    const cached=store.preference('lastAccount');
    this.account=cached?.account??null;this.bots=cached?.bots??[];
    this.client=null;this.credentials=null;this.generation=0;this.pending=0;this.transition=false;
    this.watches=new Map();this.sendQueues=new Map();this.watchErrors={};this.runtime=emptyRuntime();
  }
  requireAccount(){if(!this.account)throw new Error('LOGIN_REQUIRED');return this.account.id;}
  requireClient(){if(this.transition)throw new Error('ACCOUNT_BUSY');if(!this.client)throw new Error('LOGIN_REQUIRED');return this.client;}
  assertIdle(){if(this.pending||this.delivery?.active.size||this.delivery?.inflight.size)throw new Error('DELIVERY_IN_PROGRESS');if(this.transition)throw new Error('ACCOUNT_BUSY');}
  snapshot(){
    const accountId=this.account?.id;
    return {account:this.account,connected:!!this.client,accountBusy:this.transition,bots:this.bots,recipients:accountId?this.bots.map(bot=>this.store.recipient(accountId,bot.id)):[],
      inbox:accountId?this.store.list(accountId).map(({files,...item})=>({...item,files:files.map(({name,bytes})=>({name,bytes}))})):[],
      theme:this.store.preference('theme')??'system',shortcuts:this.shortcutMap(),sourceDefaults:this.sourceDefaults(),whatsappWatch:this.whatsappWatch.view(),runtime:this.runtime,watchErrors:this.watchErrors,backgroundSending:!!this.delivery?.inflight.size,
      capabilities:{runtime:typeof this.client?.getRuntimeSettings==='function',statuses:typeof this.client?.listStatuses==='function'||typeof this.client?.listAgentStatuses==='function'}};
  }
  emit(){if(!this.closed)this.onEvent({event:'state',data:this.snapshot()});}
  async login() {
    this.assertIdle();const generation=++this.generation;
    this.transition=true;this.emit();
    try{
    const flow=this.sdk.createLogin();this.onEvent({event:'login.url',data:{url:flow.loginUrl}});
    const result=await this.sdk.pollLogin(flow);
    if(generation!==this.generation)throw new Error('LOGIN_CANCELLED');
    const credentials={accessToken:result.accessToken,...Number.isInteger(result.selectedTeamId)?{teamId:result.selectedTeamId}:{}};
    return await this.connect(credentials,generation);
    }finally{if(generation===this.generation){this.transition=false;this.emit();}}
  }
  async desktopLogin(){
    this.assertIdle();const generation=++this.generation;
    this.transition=true;this.emit();
    try{
    if(process.platform!=='darwin')throw new Error('MAC_ONLY');
    const {desktopCredentials}=await import('grok-bot-sdk/desktop');
    const credentials=await desktopCredentials();
    if(generation!==this.generation)throw new Error('LOGIN_CANCELLED');
    return await this.connect(credentials,generation);
    }finally{if(generation===this.generation){this.transition=false;this.emit();}}
  }
  async connect(credentials,expectedGeneration) {
    if(expectedGeneration===undefined)this.assertIdle();
    const generation=expectedGeneration??++this.generation;
    this.transition=true;this.emit();
    try{
    const client=new this.sdk.GrokBotClient(credentials);
    const me=await client.getMe();const roster=await client.listBots();
    const runtime=await readRuntime(client,roster.bots,emptyRuntime(),credentials);
    if(generation!==this.generation)throw new Error('LOGIN_CANCELLED');
    this.stopWatches();
    this.account={id:String(me.authId??me.userId),name:me.name??me.email??'Grok Bot'};
    this.bots=roster.bots;this.runtime=runtime;this.client=client;this.credentials=credentials;this.watchErrors={};
    this.delivery=new Delivery({store:this.store,client,now:this.now,upload:(file,context)=>{
      if(!this.upload)throw new Error('UPLOAD_UNAVAILABLE');
      return this.upload(file,{...context,credentials});
    },onChange:()=>this.emit()});
    this.store.preference('lastAccount',{account:this.account,bots:this.bots});
    this.emit();
    this.transition=false;this.emit();return {credentials,state:this.snapshot()};
    }finally{if(generation===this.generation){this.transition=false;this.emit();}}
  }
  async refresh(){
    const client=this.requireClient(),generation=this.generation;
    try{
      const roster=await client.listBots();
      if(generation!==this.generation)throw new Error('LOGIN_CANCELLED');
      const runtime=await readRuntime(client,roster.bots,this.runtime,this.credentials);
      if(generation!==this.generation)throw new Error('LOGIN_CANCELLED');
      this.bots=roster.bots;this.runtime=runtime;
      this.store.preference('lastAccount',{account:this.account,bots:this.bots});this.emit();return this.snapshot();
    }catch(error){if(generation===this.generation)this.authFailure(error);throw error;}
  }
  configure(botId,patch){const accountId=this.requireAccount();if(!this.bots.some(b=>b.id===botId))throw new Error('BOT_NOT_FOUND');const result=this.store.saveRecipient(accountId,botId,patch);this.emit();return result;}
  sourceDefaults(){
    const accountId=this.account?.id;
    if(!accountId)return emptySourceDefaults();
    return normalizeSourceDefaults(this.store.preference(`sourceDefaults:${accountId}`));
  }
  setSourceDefaults(patch){
    const accountId=this.requireAccount();
    const next=normalizeSourceDefaults(patch,this.sourceDefaults(),new Set(this.bots.map(bot=>bot.id)));
    this.store.preference(`sourceDefaults:${accountId}`,next);
    for(const source of SOURCE_DEFAULT_KEYS){
      const botId=next[source].botId;
      if(!botId)continue;
      const flags=SOURCE_DEFAULT_FLAGS[source];
      const recipient=this.store.recipient(accountId,botId);
      if(!recipient.enabled||flags.some(flag=>recipient.sources[flag]!==true))this.store.saveRecipient(accountId,botId,{enabled:true,sources:Object.fromEntries(flags.map(flag=>[flag,true]))});
    }
    this.emit();
    return this.snapshot();
  }
  disableAllReceive(){
    const accountId=this.requireAccount();
    const closed=this.store.disableEnabled(accountId,this.bots.map(bot=>bot.id));
    this.emit();
    return {closed};
  }
  async updateBotAvatar(botId,{shape,color}={}){
    const client=this.requireClient();
    const bot=this.bots.find(item=>item.id===botId);
    if(!bot)throw new Error('BOT_NOT_FOUND');
    if(bot.kind==='GROK_BOT_AGENT_KIND_ROOM'||(Array.isArray(bot.memberAgentIds)&&bot.memberAgentIds.length>0))throw new Error('BOT_NOT_EDITABLE');
    if(bot.avatar?.kind==='picture'||bot.viewerCanManage===false)throw new Error('BOT_NOT_EDITABLE');
    if(typeof bot.serverId!=='string'||!bot.serverId)throw new Error('BOT_NOT_EDITABLE');
    if(!AVATAR_SHAPES.has(shape)||!AVATAR_COLORS.has(color))throw new Error('AVATAR_INVALID');
    if(typeof client.updateBot!=='function')throw new Error('AVATAR_UPDATE_UNAVAILABLE');
    const result=await client.updateBot({id:bot.serverId,avatarShape:shape,avatarColor:color});
    if(result?.bot?.id===botId){
      const index=this.bots.findIndex(item=>item.id===botId);
      this.bots[index]={...this.bots[index],...result.bot,id:botId,serverId:this.bots[index].serverId};
      this.store.preference('lastAccount',{account:this.account,bots:this.bots});
      this.emit();
      return {bot:this.bots[index],state:this.snapshot()};
    }
    await this.refresh();
    return {bot:this.bots.find(item=>item.id===botId)??null,state:this.snapshot()};
  }

  async duplicateBot(botId){
    const client=this.requireClient();
    const bot=this.bots.find(item=>item.id===botId);
    if(!bot)throw new Error('BOT_NOT_FOUND');
    if(bot.kind==='GROK_BOT_AGENT_KIND_ROOM'||(Array.isArray(bot.memberAgentIds)&&bot.memberAgentIds.length>0))throw new Error('BOT_NOT_COPYABLE');
    if(typeof client.duplicateBot!=='function')throw new Error('DUPLICATE_UNAVAILABLE');
    const result=await client.duplicateBot({botId});
    try{await this.refresh();}catch{/* The Bot already exists. The window refreshes again. */}
    return {bot:result.bot};
  }
  async receive({botId,expectedAccountId,...input}){
    if(this.transition)throw new Error('ACCOUNT_BUSY');
    const accountId=this.requireAccount(),bot=this.bots.find(b=>b.id===botId);if(!bot)throw new Error('BOT_NOT_FOUND');
    if(expectedAccountId!==undefined&&expectedAccountId!==accountId)throw new Error('RECEIPT_SCOPE_MISMATCH');
    // Local intake stays available when credentials expire.
    const delivery=this.delivery??new Delivery({store:this.store,now:this.now,onChange:()=>this.emit()});
    this.pending++;
    let extractDir='';
    try{
      const prepared=await this.prepareIntake(input);
      extractDir=prepared.extractDir??'';
      const item=await delivery.receive({...prepared.input,accountId,bot});
      if(item.mode==='direct'&&this.client&&!this.transition&&this.account?.id===accountId)await this.process(item.id);
      return this.store.get(item.id,accountId);
    }finally{this.pending--;if(extractDir)await rm(extractDir,{recursive:true,force:true});}
  }
  async prepareIntake(input){
    if(input.sourceTag==='WhatsApp')return {input};
    const defaults=this.sourceDefaults();
    const extractDir=await mkdtemp(join(this.store.root,'wa-'));
    try{
      const inspected=await inspectWhatsAppIntake({files:input.files??[],fileNames:input.fileNames,text:input.text??'',title:input.title??'',prefix:defaults.whatsapp?.prefix??'',extractDir});
      const source=input.source==='wechat'?'share':input.source;
      if(!inspected){
        await rm(extractDir,{recursive:true,force:true});
        const text=source==='share'?prependInstruction(input.text??'',defaults.share?.prefix??''):input.text;
        return {input:{...input,source,text}};
      }
      return {extractDir,input:{...input,source:'whatsapp',originSource:input.originSource??source,sourceTag:'WhatsApp',text:inspected.text,title:inspected.chatName||input.title||'',files:inspected.files,fileNames:inspected.fileNames}};
    }catch(error){
      await rm(extractDir,{recursive:true,force:true});
      throw error;
    }
  }
  async process(id,edit){
    this.requireClient();const accountId=this.requireAccount();
    const item=this.store.get(id,accountId);if(!item)throw new Error('RECEIPT_NOT_FOUND');
    this.pending++;
    const previous=this.sendQueues.get(item.botId)??Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      this.requireClient();
      this.watch(item.botId,item.sessionId);
      return this.delivery.process(id,accountId,edit);
    });
    this.sendQueues.set(item.botId,task);
    try{
      return await task;
    }catch(error){this.authFailure(error);throw error;}finally{this.pending--;if(this.sendQueues.get(item.botId)===task)this.sendQueues.delete(item.botId);}
  }
  submit(id,text,files){return this.process(id,{text,...files!==undefined?{files}:{}});}
  submitAsync(id,text,files){
    const accountId=this.requireAccount();
    if(!this.store.get(id,accountId))throw new Error('RECEIPT_NOT_FOUND');
    void this.submit(id,text,files).catch(error=>{
      const code=typeof error?.message==='string'&&/^[A-Z][A-Z0-9_]{1,70}$/.test(error.message)?error.message:'SEND_FAILED';
      this.onEvent({event:'send.error',data:{id,error:code}});
    });
    return {id,status:'sending'};
  }
  async retry(id){const item=this.store.get(id,this.requireAccount());if(!item||item.status!=='failed')throw new Error('RECEIPT_NOT_SENDABLE');return this.process(id,item.mode==='compose'?{text:item.text}:undefined);}
  resolve(id){
    this.assertIdle();const accountId=this.requireAccount(),item=this.store.get(id,accountId);
    if(!item||item.status!=='unconfirmed')throw new Error('RECEIPT_NOT_UNCONFIRMED');
    const result=this.store.update(id,accountId,{holdResolved:true,resolvedAt:this.now()});this.emit();return result;
  }
  async dismissComposer(id){
    const accountId=this.requireAccount(),item=this.store.get(id,accountId);
    if(!item)throw new Error('RECEIPT_NOT_FOUND');
    if(!['needs-input','failed'].includes(item.status))return item;
    const updated=this.store.update(id,accountId,{files:[],composerDismissed:true});
    for(const file of item.files??[])if(typeof file?.path==='string')try{await rm(file.path,{force:true});}catch{}
    this.emit();
    return updated;
  }
  composer(id){const item=this.store.get(id,this.requireAccount());if(!item||!['needs-input','failed'].includes(item.status))throw new Error('RECEIPT_NOT_SENDABLE');return item;}
  async resume(){
    if(!this.client)return;
    for(const item of this.store.list(this.requireAccount()).reverse()){
      if(!this.client)break;
      if(item.mode==='direct'&&item.status==='needs-input'&&item.phase==='ready')await this.process(item.id);
    }
  }
  watch(botId,sessionId=''){
    const client=this.requireClient();if(typeof client.watchBot!=='function')return;
    const accountId=this.requireAccount(),key=`${botId}|${sessionId}`;
    if(this.watches.has(key))return;
    const control=new AbortController();this.watches.set(key,control);
    const cursorKey=`cursor:${accountId}:${key}`,resumeFrom=this.store.preference(cursorKey);
    void(async()=>{
      try{
        for await(const event of client.watchBot({botId,sessionId,signal:control.signal,...resumeFrom?{resumeFrom}:{}})){
          if(control.signal.aborted)return;
          if(event.type==='message'&&!event.data.replay){
            // The SDK exposes Bot/session events, not a request→reply relation.
            // Attach new live events only to the latest active/sent attempt.
            const item=this.store.list(accountId).find(row=>row.botId===botId&&row.sessionId===sessionId&&(row.phase==='sending'||['sent','unconfirmed'].includes(row.status)));
            if(item&&event.data.entryId!==item.messageId){
              const known=item.replies.some(r=>r.id===event.data.entryId);
              const replies=item.replies.filter(r=>r.id!==event.data.entryId);replies.push({id:event.data.entryId,text:event.data.text});
              this.store.update(item.id,accountId,{replies:replies.slice(-100),replyScope:'bot-session'});
              if(!known)this.onEvent({event:'reply',data:{botId,name:this.bots.find(b=>b.id===botId)?.name??'',text:event.data.text}});
              this.emit();
            }
          }
          if(event.type==='message.deleted'){
            for(const item of this.store.list(accountId).filter(row=>row.botId===botId&&row.sessionId===sessionId))this.store.update(item.id,accountId,{replies:item.replies.filter(r=>r.id!==event.data.entryId)});
            this.emit();
          }
          if(event.id)this.store.preference(cursorKey,event.id);
        }
      }catch(error){if(!control.signal.aborted){this.watchErrors[botId]='REPLY_DISCONNECTED';this.authFailure(error);this.emit();}}
      finally{if(this.watches.get(key)===control)this.watches.delete(key);}
    })();
  }
  authFailure(error){
    if(error?.httpStatus===401||error?.httpStatus===403){this.client=null;this.credentials=null;this.stopWatches();this.onEvent({event:'auth.expired',data:{}});this.emit();}
  }
  setTheme(theme){if(!['system','light','dark'].includes(theme))throw new Error('THEME_INVALID');this.store.preference('theme',theme);this.emit();return this.snapshot();}
  shortcutMap(){return normalizeShortcutMap(this.store.preference('shortcuts'));}
  setShortcut(slot,accelerator){
    const current=this.shortcutMap();
    const next=normalizeAccelerator(accelerator);
    const grok=typeof slot==='string'&&slot.startsWith('grok:')?slot.slice(5):'';
    const owned=[['compose',current.compose],['open',current.open],...Object.entries(current.bots),...Object.entries(current.opens).map(([id,value])=>[`grok:${id}`,value])];
    const taken=(candidate,except)=>!!candidate&&owned.some(([id,value])=>id!==except&&value===candidate);
    if(slot==='compose'||slot==='open'){
      if(taken(next,slot))throw new Error('SHORTCUT_UNAVAILABLE');
      current[slot]=next;
    }else if(grok){
      if(!/^[\w-]{1,80}$/.test(grok))throw new Error('SHORTCUT_INVALID');
      if(!this.bots.some(bot=>bot.id===grok))throw new Error('BOT_NOT_FOUND');
      if(taken(next,slot))throw new Error('SHORTCUT_UNAVAILABLE');
      if(next)current.opens[grok]=next;else delete current.opens[grok];
    }else{
      if(!/^[\w-]{1,80}$/.test(String(slot??'')))throw new Error('SHORTCUT_INVALID');
      if(!this.bots.some(bot=>bot.id===slot))throw new Error('BOT_NOT_FOUND');
      if(taken(next,slot))throw new Error('SHORTCUT_UNAVAILABLE');
      if(next)current.bots[slot]=next;else delete current.bots[slot];
    }
    this.store.preference('shortcuts',{compose:current.compose,open:current.open,bots:current.bots,opens:current.opens});
    this.emit();return this.snapshot();
  }
  async logout(){if(this.pending||this.delivery?.active.size||this.delivery?.inflight.size)throw new Error('DELIVERY_IN_PROGRESS');++this.generation;this.transition=false;this.stopWatches();this.client=null;this.credentials=null;this.account=null;this.bots=[];this.runtime=emptyRuntime();this.store.preference('lastAccount',null);this.emit();return this.snapshot();}
  stopWatches(){for(const control of this.watches.values())control.abort();this.watches.clear();}
  close(){this.closed=true;++this.generation;this.stopWatches();}
}
