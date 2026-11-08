import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const loaded=await Promise.allSettled([import('../src/share/model.mjs'),import('../src/service/share-inbox.mjs')]);
test('share menu and local importer are implemented',()=>assert.ok(loaded.every(r=>r.status==='fulfilled')));
const model=loaded[0].value,ShareInbox=loaded[1].value?.ShareInbox;
const state={account:{id:'a'},bots:Array.from({length:14},(_,i)=>({id:`bot-${i}`,name:`Bot ${i}`,avatarShape:'cloud',avatarColor:'brown'})),recipients:Array.from({length:14},(_,i)=>({botId:`bot-${i}`,enabled:true,order:i,mode:'compose',prefix:'',sources:{wechat:true}}))};
if(model&&ShareInbox){
 test('a same-named single bot is not a second share row for the group',()=>{
  const input=structuredClone(state);
  input.bots[0].kind='GROK_BOT_AGENT_KIND_ROOM';
  input.bots[0].memberAgentIds=['bot-2','bot-3'];
  input.bots[0].name='Same';
  input.bots[1].name='Same';
  const entries=model.menuEntries(input);
  assert.equal(entries.filter(entry=>entry.botName==='Same').length,1);
  assert.equal(entries.find(entry=>entry.botName==='Same').botId,'bot-0');
 });
 test('group menu icons key off member faces and single bots keep the short key',()=>{
  const input=structuredClone(state);
  input.bots[0].kind='GROK_BOT_AGENT_KIND_ROOM';
  input.bots[0].memberAgentIds=['bot-2','bot-3','bot-4','bot-5','bot-6'];
  const entries=model.menuEntries(input);
  const group=JSON.parse(entries.find(entry=>entry.botId==='bot-0').avatarKey);
  const single=JSON.parse(entries.find(entry=>entry.botId==='bot-1').avatarKey);
  assert.equal(group.length,6);
  assert.equal(group[4].length,4);
  assert.equal(group[5],3);
  assert.deepEqual(group[4].map(item=>item[0]),['bot-2','bot-3','bot-4','bot-5']);
  assert.equal(single.length,4);
 });
 test('the main Bot marker never changes the share icon key',()=>{
  const plain=model.menuEntries(state).find(entry=>entry.botId==='bot-1').avatarKey;
  const main=model.menuEntries({...state,runtime:{mainAgentId:'bot-1'}}).find(entry=>entry.botId==='bot-1').avatarKey;
  assert.equal(main,plain);
 });
 test('a WhatsApp-only recipient still gets a share slot',()=>{
  const input=structuredClone(state);
  input.recipients[0].sources={wechat:false,whatsapp:true};
  const slots=model.menuEntries(input);
  assert.equal(slots[0].botId,'bot-0');
 });
 test('only WeChat-enabled recipients get at most twelve slots in configured order',()=>{
  const input=structuredClone(state);input.recipients[0].enabled=false;input.recipients[1].sources.wechat=false;
  const slots=model.menuEntries(input);assert.equal(slots.length,12);assert.equal(slots[0].botId,'bot-2');
  assert.equal(model.menuEntries({...input,accountBusy:true}).length,0);
 });
 test('disabling a row reuses existing bindings without resigning names or avatars',()=>{
  const entries=model.menuEntries(state).slice(0,2);const installed={entries:entries.map((e,index)=>({...e,slot:index+1}))};
  const input=structuredClone(state);input.recipients.forEach((r,i)=>r.enabled=i===1);
  const plan=model.menuPlan(input,installed);assert.equal(plan.rebuild,false);assert.deepEqual(plan.enabledSlots,[2]);
 });
 test('Bot rename changes signed metadata and requires a rebuild',()=>{
  const entries=model.menuEntries(state);const renamed=structuredClone(state);renamed.bots[0].name='New name';
  assert.equal(model.menuPlan(renamed,{entries:entries.map((e,i)=>({...e,slot:i+1}))}).rebuild,true);
 });
 test('a newly enabled Bot keeps the slots already shown to WeChat',()=>{
  const first=model.menuEntries(state).slice(0,1).map(entry=>({...entry,slot:1,generation:1,extensionId:model.extensionIdentifier(1,1)}));
  const input=structuredClone(state);input.recipients.forEach((recipient,index)=>recipient.enabled=index<2);
  const plan=model.menuPlan(input,{layoutVersion:4,entries:first});
  assert.equal(plan.rebuild,true);
  assert.equal(plan.entries.find(entry=>entry.botId==='bot-0').slot,1);
  assert.equal(plan.entries.find(entry=>entry.botId==='bot-0').generation,1);
  assert.equal(plan.entries.find(entry=>entry.botId==='bot-1').slot,2);
  assert.equal(plan.entries.find(entry=>entry.botId==='bot-1').generation,1);
 });
 test('renaming a Bot changes only that extension generation',()=>{
  const entries=model.menuEntries(state).slice(0,2).map((entry,index)=>({...entry,slot:index+1,generation:1}));
  const renamed=structuredClone(state);renamed.bots[0].name='New name';
  const plan=model.menuPlan(renamed,{layoutVersion:4,entries});
  assert.equal(plan.entries.find(entry=>entry.botId==='bot-0').slot,1);
  assert.equal(plan.entries.find(entry=>entry.botId==='bot-0').generation,2);
  assert.equal(plan.entries.find(entry=>entry.botId==='bot-1').generation,1);
  assert.equal(model.extensionIdentifier(1,2),'dev.ronglecat.grokbotanywhere.menu.destination01.g2.share');
 });
 test('changing the relative menu order reassigns slots from the top',()=>{
  const installed={layoutVersion:4,entries:model.menuEntries(state).slice(0,2).map((entry,index)=>({...entry,slot:index+1,generation:1,extensionId:model.extensionIdentifier(index+1,1)}))};
  const input=structuredClone(state);
  input.recipients.forEach((recipient,index)=>{recipient.enabled=index<2;});
  input.recipients[0].order=1;input.recipients[1].order=0;
  const plan=model.menuPlan(input,installed);
  assert.equal(plan.rebuild,true);
  assert.equal(plan.entries[0].botId,'bot-1');
  assert.equal(plan.entries[0].slot,1);
  assert.equal(plan.entries[1].botId,'bot-0');
  assert.equal(plan.entries[1].slot,2);
  assert.equal(plan.entries[0].generation,1);
  assert.equal(plan.entries[1].generation,1);
 });
 async function setup(t){
  const root=await mkdtemp(join(tmpdir(),'gba-share-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const received=[],seen=new Map();const session={account:{id:'a'},transition:false,bots:state.bots,store:{list:()=>[...seen.values()]},receive:async p=>{received.push(p);const row={id:'receipt',accountId:'a',botId:p.botId,mode:p.policy.mode,status:'needs-input',sourceId:p.sourceId};seen.set(p.sourceId,row);return row;}};
  const preparing=[];const inbox=new ShareInbox({root,session,onPreparing:data=>preparing.push(data)});await inbox.initialize();return {root,inbox,received,preparing,session};
 }
 async function batch(root,id='batch-one',patch={}){
  const directory=join(root,'Ready',id);await mkdir(directory,{recursive:true});await writeFile(join(directory,'forward.zip'),Buffer.alloc(5*1024*1024,1));
  const value={version:1,id,accountId:'a',botId:'bot-0',source:'wechat',createdAt:Date.now(),mode:'compose',prefix:'',text:'context',title:'Shared chat',files:[{relativePath:'forward.zip',name:'forward.zip'}],...patch};
  await writeFile(join(directory,'manifest.json'),JSON.stringify(value));return directory;
 }
 test('an account transition preserves the installed menu instead of publishing an empty one',async t=>{
  const {ShareMenu}=await import('../src/main/share-menu.mjs');
  const root=await mkdtemp(join(tmpdir(),'gba-menu-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const menu=Object.create(ShareMenu.prototype);
  Object.assign(menu,{root,status:{available:true,registered:3,enabled:3,needsUpdate:false},installed:{entries:[{slot:1},{slot:2},{slot:3}]},templateHash:'t',applicationPath:'a',configQueue:Promise.resolve(),onChange:()=>{}});
  await menu.sync({accountBusy:true,account:{id:'a'},bots:[],recipients:[]});
  assert.equal(menu.status.registered,3);
  assert.equal(menu.status.enabled,3);
  assert.equal(menu.status.needsUpdate,false);
  assert.equal(existsSync(join(root,'configuration.json')),false);
});
test('a preparing marker opens the composer target before the files are copied',async t=>{
  const {root,inbox,preparing}=await setup(t);
  await writeFile(join(root,'Preparing','batch-two.json'),JSON.stringify({version:1,id:'batch-two',accountId:'a',botId:'bot-0',source:'wechat',createdAt:Date.now(),mode:'compose'}));
  await inbox.drain();await inbox.drain();
  assert.equal(preparing.length,1);
  assert.equal(preparing[0].botId,'bot-0');
  assert.equal(preparing[0].mode,'compose');
 });
 test('a shared _chat.txt is delivered as WhatsApp with the source prefix',async t=>{
  const {root,inbox,received,session}=await setup(t);
  session.sourceDefaults=()=>({wechat:{botId:'',prefix:''},whatsapp:{botId:'bot-0',prefix:'整理要点、痛点和可做的选题'}});
  const directory=join(root,'Ready','wa-batch');
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'_chat.txt'),'[31/12/2024, 23:59:59] Alice: Hello\n[01/01/2025, 09:01:00] Bob: Hi\n');
  await writeFile(join(directory,'manifest.json'),JSON.stringify({version:1,id:'wa-batch',accountId:'a',botId:'bot-0',source:'wechat',createdAt:Date.now(),mode:'compose',prefix:'bot-prefix',text:'',title:'',files:[{relativePath:'_chat.txt',name:'_chat.txt'}]}));
  await inbox.drain();
  assert.equal(received.length,1);
  assert.equal(received[0].source,'whatsapp');
  assert.equal(received[0].sourceTag,'WhatsApp');
  assert.equal(received[0].originSource,'wechat');
  assert.equal(received[0].sourceId,'whatsapp:wa-batch');
  assert.equal(received[0].policy.prefix,'bot-prefix');
  assert.match(received[0].text,/\[WhatsApp\]/);
  assert.match(received[0].text,/整理要点、痛点和可做的选题/);
  assert.match(received[0].text,/参与者：Alice、Bob/);
 });
 test('imports a >4MiB native batch locally once, retaining the delivery snapshot',async t=>{
  const {root,inbox,received}=await setup(t);await batch(root);await inbox.drain();await inbox.drain();
  assert.equal(received.length,1);assert.equal(received[0].expectedAccountId,'a');assert.equal(received[0].policy.mode,'compose');assert.equal((await readFile(join(root,'Imported/batch-one/forward.zip'))).length,5*1024*1024);
 });
 test('a mismatched account keeps the native batch local and never receives it',async t=>{
  const {root,inbox,received}=await setup(t);await batch(root,'batch-one',{accountId:'b'});await inbox.drain();assert.equal(received.length,0);assert.ok(await readFile(join(root,'Ready/batch-one/manifest.json')));
 });
 test('rejects traversing and symbolic file paths before local intake',async t=>{
  const {root,inbox,received}=await setup(t);await writeFile(join(root,'outside'),'private');
  await batch(root,'bad-one',{files:[{relativePath:'../../outside',name:'x'}]});
  const d=await batch(root,'bad-two',{files:[{relativePath:'link',name:'x'}]});await symlink(join(root,'outside'),join(d,'link'));
  await inbox.drain();assert.equal(received.length,0);
 });
 test('a symbolic batch directory is quarantined without writing outside the inbox',async t=>{
  const {root,inbox,received}=await setup(t);const outside=join(root,'Outside');await mkdir(outside);await writeFile(join(outside,'failure.txt'),'untouched');await symlink(outside,join(root,'Ready','bad-link'));
  await inbox.drain();assert.equal(received.length,0);assert.equal(await readFile(join(outside,'failure.txt'),'utf8'),'untouched');
 });
 test('an existing diagnostic symlink cannot overwrite another file',async t=>{
  const {root,inbox}=await setup(t);const outside=join(root,'outside.txt');await writeFile(outside,'untouched');const directory=await batch(root,'invalid',{version:0});await symlink(outside,join(directory,'failure.txt'));await inbox.drain();assert.equal(await readFile(outside,'utf8'),'untouched');
 });
}
