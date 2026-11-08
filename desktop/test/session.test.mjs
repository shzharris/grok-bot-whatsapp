import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InboxStore} from '../src/service/store.mjs';
const loaded=await import('../src/service/session.mjs').catch(()=>null);
test('account session is implemented',()=>assert.ok(loaded?.AccountSession));
const bot={id:'bot-one',name:'Research',sessionId:'s'};
if(loaded) {
 test('externally staged intake cannot be accepted under another account',async t=>{
  const {session,store}=await setup(t);
  await assert.rejects(session.receive({botId:bot.id,expectedAccountId:'other',source:'drop',manual:true,text:'private context'}),/RECEIPT_SCOPE_MISMATCH/);
  assert.equal(store.list('account-a').length,0);
 });
 test('a stale refresh authentication error cannot disconnect a newer account',async t=>{
  const {session,client}=await setup(t);let fail;
  client.listBots=()=>new Promise((_,reject)=>{fail=reject;});const stale=assert.rejects(session.refresh());
  session.sdk.GrokBotClient=class{async getMe(){return {authId:'account-b'};}async listBots(){return {bots:[bot]};}};
  await session.connect({accessToken:'B'});fail(Object.assign(new Error('RPC_FAILED'),{httpStatus:401}));await stale;
  assert.equal(session.snapshot().account.id,'account-b');assert.equal(session.snapshot().connected,true);
 });
 test('intake during an account transition is rejected before copying old account content',async t=>{
  const {session}=await setup(t);let release;const waiting=new Promise(r=>{release=r;});
  session.sdk.GrokBotClient=class{async getMe(){await waiting;return {authId:'account-b'};}async listBots(){return {bots:[bot]};}};
  const connecting=session.connect({accessToken:'B'});
  const rejected=assert.rejects(session.receive({botId:bot.id,source:'drop',manual:true,text:'A private context'}),/ACCOUNT_BUSY/);
  release();await connecting;await rejected;
 });
 test('a timed-out send cannot be unlocked or logged out while its SDK request is still live',async t=>{
  let release;const waiting=new Promise(r=>{release=r;});const {session}=await setup(t,{sendMessage:()=>waiting});
  session.configure(bot.id,{enabled:true,mode:'direct',sources:{drop:true}});session.delivery.now=()=>0;
  const item=await session.delivery.receive({accountId:'account-a',bot,source:'drop',text:'one'});session.delivery.now=()=>89999;
  await session.process(item.id);
  assert.equal(session.store.get(item.id,'account-a').status,'unconfirmed');
  assert.throws(()=>session.resolve(item.id),/DELIVERY_IN_PROGRESS/);await assert.rejects(session.logout(),/DELIVERY_IN_PROGRESS/);
  release({});await new Promise(r=>setImmediate(r));session.resolve(item.id);
 });
 test('fast live reply is persisted on the latest attempt and replay does not notify',async t=>{
  let startSend,finished;const sending=new Promise(r=>{startSend=r;}),received=new Promise(r=>{finished=r;});
  const {session}=await setup(t,{
   async *watchBot(){yield {type:'message',id:'old-cursor',data:{entryId:'old',text:'old history',replay:true}};await sending;yield {type:'message',id:'new-cursor',data:{entryId:'reply',text:'new reply',replay:false}};finished();},
   async sendMessage(){startSend();await received;return {};}
  });
  const events=[];session.onEvent=event=>events.push(event);
  const old=await session.receive({botId:bot.id,source:'drop',manual:true,text:'old request'});session.store.update(old.id,'account-a',{status:'sent',phase:'done'});
  const item=await session.receive({botId:bot.id,source:'drop',manual:true,text:'current'});await session.submit(item.id,'question');
  assert.deepEqual(session.store.get(item.id,'account-a').replies,[{id:'reply',text:'new reply'}]);
  assert.deepEqual(session.store.get(old.id,'account-a').replies,[]);
  assert.equal(events.filter(e=>e.event==='reply').length,1);
 });
 test('starting an account transition prevents new sends until it commits',async t=>{
  const {session}=await setup(t);let release;
  const waiting=new Promise(r=>{release=r;});
  const item=await session.receive({botId:bot.id,source:'drop',manual:true,text:'A draft'});
  session.sdk.GrokBotClient=class{async getMe(){await waiting;return {authId:'account-b'};}async listBots(){return {bots:[bot]};}};
  const connecting=session.connect({accessToken:'B'});
  const rejected=assert.rejects(session.submit(item.id,'A private question'),/ACCOUNT_BUSY/);
  release();await connecting;await rejected;
 });
 test('acknowledging an unconfirmed receipt releases the Bot without resending it',async t=>{
  let calls=0;const {session}=await setup(t,{sendMessage:async()=>{calls++;throw new Error('SEND_UNCONFIRMED');}});
  const item=await session.receive({botId:bot.id,source:'drop',manual:true,text:'one'});await session.submit(item.id,'one');
  session.resolve(item.id);
  assert.equal(session.store.get(item.id,'account-a').status,'unconfirmed');assert.equal(session.store.get(item.id,'account-a').holdResolved,true);assert.equal(calls,1);
 });
 test('a later send for the same Bot waits and then stops if the first send is unconfirmed',async t=>{
  let release,calls=0;const pending=new Promise(r=>{release=r;});
  const {session}=await setup(t,{sendMessage:async()=>{calls++;await pending;throw new Error('SEND_UNCONFIRMED');}});
  const first=await session.receive({botId:bot.id,source:'drop',manual:true,text:'one'});
  const second=await session.receive({botId:bot.id,source:'drop',manual:true,text:'two'});
  const sending=session.submit(first.id,'one');const queued=session.submit(second.id,'two');
  await new Promise(r=>setImmediate(r));const concurrentCalls=calls;
  const rejected=assert.rejects(queued,/BOT_SEND_HELD/);release();await sending;await rejected;assert.equal(concurrentCalls,1);assert.equal(calls,1);
 });
 test('a bot shortcut is stored beside the general shortcut and cannot reuse it',async t=>{
  const {session}=await setup(t);
  session.bots=[bot];
  assert.equal(session.shortcutMap().compose,'Ctrl+Alt+Space');
  session.setShortcut(bot.id,'Alt+A');
  assert.equal(session.snapshot().shortcuts.compose,'Ctrl+Alt+Space');
  assert.equal(session.snapshot().shortcuts.bots[bot.id],'Alt+A');
  assert.throws(()=>session.setShortcut(bot.id,'Ctrl+Alt+Space'),/SHORTCUT_UNAVAILABLE/);
  assert.throws(()=>session.setShortcut('compose','Alt+A'),/SHORTCUT_UNAVAILABLE/);
  assert.throws(()=>session.setShortcut('missing-bot','Ctrl+Alt+K'),/BOT_NOT_FOUND/);
  session.setShortcut(bot.id,'');
  assert.equal(session.snapshot().shortcuts.bots[bot.id],undefined);
  session.setShortcut('compose','');
  assert.equal(session.snapshot().shortcuts.compose,null);
  session.setShortcut(bot.id,'Alt+A');
  session.setShortcut('open','Ctrl+Shift+G');
  assert.equal(session.snapshot().shortcuts.open,'Ctrl+Shift+G');
  assert.throws(()=>session.setShortcut('open','Alt+A'),/SHORTCUT_UNAVAILABLE/);
  assert.throws(()=>session.setShortcut(bot.id,'Ctrl+Shift+G'),/SHORTCUT_UNAVAILABLE/);
  session.setShortcut('open','');
  assert.equal(session.snapshot().shortcuts.open,null);
  session.setShortcut(`grok:${bot.id}`,'Alt+O');
  assert.equal(session.snapshot().shortcuts.opens[bot.id],'Alt+O');
  assert.throws(()=>session.setShortcut(`grok:${bot.id}`,'Alt+A'),/SHORTCUT_UNAVAILABLE/);
  assert.throws(()=>session.setShortcut(bot.id,'Alt+O'),/SHORTCUT_UNAVAILABLE/);
  session.setShortcut(`grok:${bot.id}`,'');
  assert.equal(session.snapshot().shortcuts.opens[bot.id],undefined);
 });
 async function setup(t,overrides={}) {
  const root=await mkdtemp(join(tmpdir(),'gba-session-'));const store=new InboxStore(root);
  const client={getMe:async()=>({authId:'account-a',email:'person@example.test',secret:'hidden'}),listBots:async()=>({bots:[bot],truncated:false}),sendMessage:async()=>({delivery:'accepted-box'}),...overrides};
  const session=new loaded.AccountSession({store,sdk:{GrokBotClient:class {constructor(){return client;}}}});
  t.after(async()=>{session.close();store.close();await rm(root,{recursive:true,force:true});});
  await session.connect({accessToken:'test-secret'});
  return {session,store,client,root};
 }
 test('state exposes only account summary and never credentials or raw account fields',async t=>{
  const {session}=await setup(t); const state=session.snapshot();
  assert.equal(state.account.id,'account-a');assert.equal(state.connected,true);
  assert.ok(!JSON.stringify(state).includes('test-secret'));assert.ok(!JSON.stringify(state).includes('hidden'));
  assert.equal(state.capabilities.runtime,false);
 });
 test('a compose-first external receipt never sends before user submission',async t=>{
  let sent=0;const {session}=await setup(t,{sendMessage:async()=>{sent++;return {};}});
  session.configure(bot.id,{enabled:true,sources:{drop:true}});
  const item=await session.receive({botId:bot.id,source:'drop',text:'context'});
  assert.equal(sent,0);assert.equal(item.status,'needs-input');
  await session.submit(item.id,'context + question');assert.equal(sent,1);
 });
 test('submitAsync returns immediately and reports a held Bot as send.error',async t=>{
  const {session,store}=await setup(t);
  session.configure(bot.id,{enabled:true,sources:{drop:true}});
  const item=await session.receive({botId:bot.id,source:'drop',text:'draft',manual:true});
  const held=await session.receive({botId:bot.id,source:'drop',text:'held',manual:true});
  store.update(held.id,'account-a',{status:'unconfirmed',phase:'held',holdResolved:false});
  const events=[];session.onEvent=event=>events.push(event);
  const result=session.submitAsync(item.id,'send');
  assert.equal(result.status,'sending');
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(events.some(event=>event.event==='send.error'&&event.data.id===item.id&&event.data.error==='BOT_SEND_HELD'));
 });
 test('dismissing a composer clears its files and prevents automatic presentation',async t=>{
  const {session,store,root}=await setup(t);
  const fixture=join(root,'attachment.txt');await writeFile(fixture,'payload');
  const item=await session.receive({botId:bot.id,source:'drop',manual:true,text:'',files:[fixture]});
  assert.equal(item.files.length,1);
  const cleared=await session.dismissComposer(item.id);
  assert.deepEqual(cleared.files,[]);
  assert.equal(cleared.composerDismissed,true);
  assert.deepEqual(store.get(item.id,'account-a').files,[]);
 });
 test('authentication failure disconnects delivery and retains local intake',async t=>{
  const {session,client}=await setup(t);
  client.listBots=async()=>{throw Object.assign(new Error('RPC_FAILED'),{httpStatus:401});};
  await assert.rejects(session.refresh());assert.equal(session.snapshot().connected,false);
  session.configure(bot.id,{enabled:true,sources:{drop:true}});
  const item=await session.receive({botId:bot.id,source:'drop',text:'offline'});
  assert.equal(item.status,'needs-input');await assert.rejects(session.submit(item.id,'later'),/LOGIN_REQUIRED/);
 });
 test('account changes are rejected while a send is in progress',async t=>{
  let release;const pending=new Promise(r=>{release=r;});
  const {session}=await setup(t,{sendMessage:async()=>{await pending;return {};}});
  const item=await session.receive({botId:bot.id,source:'drop',text:'manual',manual:true});
  const send=session.submit(item.id,'question');
  await assert.rejects(session.logout(),/DELIVERY_IN_PROGRESS/);release();await send;
 });
 test('login cancelled by logout cannot reconnect later',async t=>{
  const {session}=await setup(t);let release;
  session.sdk.createLogin=()=>({loginUrl:'https://cursor.com/loginDeepControl'});
  session.sdk.pollLogin=()=>new Promise(r=>{release=r;});
  const login=session.login();await session.logout();release({accessToken:'late'});
  await assert.rejects(login,/LOGIN_CANCELLED/);assert.equal(session.snapshot().connected,false);
 });
 test('connect loads pins and sections without dropping a later status list',async t=>{
  const {session,client}=await setup(t,{getRuntimeSettings:async()=>({mainAgentId:'bot-one',pinnedAgentIds:['bot-one'],sections:[{id:'sec-1',name:'工作',agentIds:[],collapsed:true}]})});
  const runtime=session.snapshot().runtime;
  assert.equal(runtime.mainAgentId,'bot-one');
  assert.deepEqual(runtime.pinnedAgentIds,['bot-one']);
  assert.equal(runtime.sections[0].name,'工作');
  assert.equal(session.snapshot().capabilities.runtime,true);
  session.runtime.statuses=[{agentId:'bot-one',isRunning:true}];
  client.getRuntimeSettings=async()=>({mainAgentId:null,pinnedAgentIds:[],sections:[]});
  const refreshed=await session.refresh();
  assert.equal(refreshed.runtime.statuses[0].isRunning,true);
  assert.deepEqual(refreshed.runtime.pinnedAgentIds,[]);
 });
 test('agent statuses from the sdk keep only the running flag',async t=>{
  const {session}=await setup(t,{listAgentStatuses:async()=>({statuses:[{agentId:'bot-one',isRunning:true,live:{secret:1}}]})});
  const state=await session.refresh();
  assert.deepEqual(state.runtime.statuses,[{agentId:'bot-one',isRunning:true}]);
  assert.equal(state.capabilities.statuses,true);
  assert.ok(!JSON.stringify(state.runtime).includes('secret'));
 });
 test('duplicate copies one bot and refuses a room',async t=>{
  const room={id:'room-1',name:'Room',kind:'GROK_BOT_AGENT_KIND_ROOM',memberAgentIds:['bot-one'],sessionId:''};
  const copy={id:'copied-bot',name:'Copy',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[],sessionId:''};
  let listed=0;
  const {session}=await setup(t,{
   listBots:async()=>({bots:++listed>1?[bot,room,copy]:[bot,room],truncated:false}),
   duplicateBot:async options=>{assert.deepEqual(options,{botId:'bot-one'});return {bot:copy};}
  });
  await assert.rejects(session.duplicateBot('room-1'),/BOT_NOT_COPYABLE/);
  await assert.rejects(session.duplicateBot('missing'),/BOT_NOT_FOUND/);
  const result=await session.duplicateBot('bot-one');
  assert.equal(result.bot.id,'copied-bot');
  assert.ok(session.snapshot().bots.some(item=>item.id==='copied-bot'));
  assert.equal(session.snapshot().recipients.find(item=>item.botId==='copied-bot').sources.wechat,false);
 });
 test('duplicate still returns the new bot when refresh fails',async t=>{
  const copy={id:'copied-late',name:'Late',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[],sessionId:''};
  const {session,client}=await setup(t,{duplicateBot:async()=>({bot:copy})});
  client.listBots=async()=>{throw new Error('RPC_FAILED');};
  const result=await session.duplicateBot(bot.id);
  assert.equal(result.bot.id,'copied-late');
  assert.equal(session.snapshot().bots.some(item=>item.id==='copied-late'),false);
 });
 test('disable all receive closes every enabled bot once and rolls back together',async t=>{
  const hidden={id:'bot-hidden',name:'Same',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]};
  const room={id:'room-1',name:'Same',kind:'GROK_BOT_AGENT_KIND_ROOM',memberAgentIds:['bot-one']};
  const {session,store}=await setup(t);
  session.bots=[bot,hidden,room];
  const sources={wechat:true,share:true,shortcuts:true,drop:false};
  session.configure(bot.id,{enabled:true,mode:'direct',prefix:'keep',sources});
  session.configure(hidden.id,{enabled:true,mode:'compose',prefix:'hide',sources});
  session.configure(room.id,{enabled:false,mode:'compose',prefix:'room',sources});
  let events=0;
  session.onEvent=()=>{events+=1;};
  const result=session.disableAllReceive();
  assert.equal(result.closed,2);
  assert.equal(events,1);
  const kept=store.recipient('account-a',bot.id);
  assert.equal(kept.enabled,false);
  assert.equal(kept.mode,'direct');
  assert.equal(kept.prefix,'keep');
  assert.equal(kept.sources.wechat,true);
  assert.equal(kept.sources.share,true);
  assert.equal(kept.sources.shortcuts,true);
  assert.equal(kept.sources.drop,false);
  assert.equal(store.recipient('account-a',hidden.id).enabled,false);
  assert.equal(store.recipient('account-a',hidden.id).prefix,'hide');
  assert.equal(store.recipient('account-a',room.id).enabled,false);
  assert.equal(store.recipient('account-a',room.id).prefix,'room');
  session.configure(bot.id,{enabled:true});
  session.configure(hidden.id,{enabled:true});
  const original=store.saveRecipient.bind(store);
  let calls=0;
  store.saveRecipient=(accountId,botId,patch)=>{calls+=1;if(calls===2)throw new Error('RECIPIENT_INVALID');return original(accountId,botId,patch);};
  assert.throws(()=>session.disableAllReceive(),/RECIPIENT_INVALID/);
  assert.equal(store.recipient('account-a',bot.id).enabled,true);
  assert.equal(store.recipient('account-a',hidden.id).enabled,true);
 });
 test('each source keeps its own default Bot and prefix',async t=>{
  const {session,store}=await setup(t);
  assert.deepEqual(session.sourceDefaults(),{wechat:{botId:'',prefix:''},whatsapp:{botId:'',prefix:''}});
  session.setSourceDefaults({whatsapp:{botId:bot.id,prefix:'整理要点、痛点和可做的选题'}});
  assert.equal(session.sourceDefaults().whatsapp.prefix,'整理要点、痛点和可做的选题');
  assert.equal(session.sourceDefaults().wechat.botId,'');
  const recipient=store.recipient('account-a',bot.id);
  assert.equal(recipient.enabled,true);
  assert.equal(recipient.sources.whatsapp,true);
  assert.equal(recipient.sources.wechat,false);
  assert.throws(()=>session.setSourceDefaults({wechat:{botId:'missing'}}),/BOT_NOT_FOUND/);
  assert.throws(()=>session.setSourceDefaults({wechat:{prefix:1}}),/SOURCE_DEFAULTS_INVALID/);
 });
 test('a dropped WhatsApp export is tagged and carries the source prefix',async t=>{
  const {session,root}=await setup(t);
  session.setSourceDefaults({whatsapp:{botId:bot.id,prefix:'整理要点、痛点和可做的选题'}});
  const file=join(root,'WhatsApp Chat - 家庭群.txt');
  await writeFile(file,'[2024年1月15日 下午3:45:12] 小明: 大家好\n[2024年1月15日 下午4:01:02] 小红: 收到\n');
  const item=await session.receive({botId:bot.id,source:'drop',files:[file]});
  assert.equal(item.source,'whatsapp');
  assert.equal(item.sourceTag,'WhatsApp');
  assert.equal(item.title,'家庭群');
  assert.match(item.text,/\[WhatsApp\]/);
  assert.match(item.text,/整理要点、痛点和可做的选题/);
  assert.match(item.text,/参与者：小明、小红/);
  assert.match(item.text,/2024-01-15 15:45/);
  assert.equal(item.files.length,1);
 });
 test('duplicate is unavailable until the sdk provides it',async t=>{
  const {session}=await setup(t);
  await assert.rejects(session.duplicateBot(bot.id),/DUPLICATE_UNAVAILABLE/);
 });
}
