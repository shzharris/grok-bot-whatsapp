import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const modules = await Promise.allSettled([import('../src/service/store.mjs'), import('../src/service/delivery.mjs')]);
test('delivery modules are available', () => assert.ok(modules.every(r => r.status === 'fulfilled')));
const Store = modules[0].value?.InboxStore;
const Delivery = modules[1].value?.Delivery;
const bot = {id:'bot-one', name:'Research', sessionId:'session-one'};
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'gba-test-'));
  const store = new Store(root);
  t.after(async () => { store.close(); await rm(root, {recursive:true, force:true}); });
  const sent = [];
  const delivery = new Delivery({store, client:{sendMessage:async value => {sent.push(value); return {messageId:value.messageId};}}, upload:async f=>({path:`server/${f.name}`, name:f.name}), now:()=>1000});
  return {root, store, delivery, sent};
}
if (Store && Delivery) {
  test('composer edits retain chosen files and accept newly attached files', async t => {
    const {root,store,delivery,sent}=await setup(t);
    const first=join(root,'first.txt'),second=join(root,'second.txt');await writeFile(first,'one');await writeFile(second,'two');
    const item=await delivery.receive({accountId:'a',bot,source:'drop',text:'draft',files:[first],manual:true});
    await delivery.process(item.id,'a',{text:'question',files:[item.files[0].path,second]});
    assert.deepEqual(sent[0].attachmentNames,['first.txt','second.txt']);
    assert.equal(store.get(item.id,'a').files.length,2);
  });
  test('recipients default to disabled and compose-first; configuration is account-scoped', async t => {
    const {store} = await setup(t);
    assert.equal(store.recipient('a', bot.id).enabled, false);
    assert.equal(store.recipient('a', bot.id).mode, 'compose');
    assert.equal(store.recipient('a', bot.id).composerAfterSend, 'inherit');
    assert.throws(()=>store.saveRecipient('a',bot.id,{composerAfterSend:'nope'}),/RECIPIENT_INVALID/);
    store.saveRecipient('a',bot.id,{composerAfterSend:'open'});
    assert.equal(store.recipient('a',bot.id).composerAfterSend,'open');
    store.saveRecipient('a', bot.id, {enabled:true, sources:{wechat:true}});
    assert.equal(store.recipient('b', bot.id).enabled, false);
    assert.equal(store.recipient('a', bot.id).sources.drop, false);
  });
  test('local ingestion copies a ZIP above 4MiB and does not access the network', async t => {
    const {root,store,delivery,sent} = await setup(t);
    const path = join(root,'forward.zip'); const bytes = Buffer.alloc(5*1024*1024, 7); await writeFile(path, bytes);
    store.saveRecipient('a',bot.id,{enabled:true,sources:{drop:true}});
    const item = await delivery.receive({accountId:'a',bot,source:'drop',text:'context',files:[path]});
    await rm(path);
    assert.equal(item.status,'needs-input'); assert.equal(sent.length,0);
    assert.deepEqual(await readFile(item.files[0].path), bytes);
    assert.equal(store.list('a')[0].botId,bot.id); assert.equal(store.list('b').length,0);
  });
  test('disabled sources reject submissions before accepting a receipt', async t => {
    const {store,delivery} = await setup(t);
    store.saveRecipient('a',bot.id,{enabled:true,sources:{drop:true}});
    await assert.rejects(delivery.receive({accountId:'a',bot,source:'wechat',text:'no'}),/SOURCE_DISABLED/);
    assert.equal(store.list('a').length,0);
  });
  test('direct delivery snapshots prefix and stable message identity', async t => {
    const {store,delivery,sent} = await setup(t);
    store.saveRecipient('a',bot.id,{enabled:true,mode:'direct',prefix:'Summarize',sources:{drop:true}});
    const item = await delivery.receive({accountId:'a',bot,source:'drop',text:'body'});
    store.saveRecipient('a',bot.id,{prefix:'changed'});
    await delivery.process(item.id,'a');
    assert.equal(sent[0].text,'Summarize\n\nbody'); assert.equal(sent[0].messageId,item.messageId);
    assert.equal(store.get(item.id,'a').status,'sent');
    await assert.rejects(delivery.process(item.id,'a'),/RECEIPT_NOT_SENDABLE/);
  });
  test('uncertain sends are held and cannot be retried', async t => {
    const {store} = await setup(t); let calls = 0;
    const delivery = new Delivery({store,now:()=>1000,client:{sendMessage:async()=>{calls++; throw Object.assign(new Error('SEND_UNCONFIRMED'),{code:'SEND_UNCONFIRMED'});}}});
    store.saveRecipient('a',bot.id,{enabled:true,mode:'direct',sources:{drop:true}});
    const item = await delivery.receive({accountId:'a',bot,source:'drop',text:'body'});
    await delivery.process(item.id,'a');
    assert.equal(store.get(item.id,'a').status,'unconfirmed');
    await assert.rejects(delivery.process(item.id,'a'),/RECEIPT_NOT_SENDABLE/); assert.equal(calls,1);
  });
  test('expired direct receipts never call send', async t => {
    const {store,delivery,sent} = await setup(t);
    store.saveRecipient('a',bot.id,{enabled:true,mode:'direct',sources:{drop:true}});
    const item = await delivery.receive({accountId:'a',bot,source:'drop',text:'body'});
    delivery.now = ()=>91001;
    await delivery.process(item.id,'a');
    assert.equal(store.get(item.id,'a').status,'expired'); assert.equal(sent.length,0);
  });
  test('a direct share with 100 attachments can finish after the 90s creation window', async t => {
    const {root,store,delivery,sent} = await setup(t);
    let now=1000;delivery.now=()=>now;
    delivery.upload=async file=>{now+=1000;return {path:`server/${file.name}`,name:file.name};};
    store.saveRecipient('a',bot.id,{enabled:true,mode:'direct',sources:{share:true}});
    const files=[];
    for(let index=0;index<100;index++){const path=join(root,`image-${index}.png`);await writeFile(path,'x');files.push(path);}
    const item=await delivery.receive({accountId:'a',bot,source:'share',files,manual:false,policy:{mode:'direct',prefix:'',createdAt:1000}});
    await delivery.process(item.id,'a');
    assert.equal(store.get(item.id,'a').status,'sent');
    assert.equal(sent.length,1);
    assert.equal(sent[0].attachmentPaths.length,100);
  });
  test('delivery publishes upload, send, and done progress for the bar', async t => {
    const {root,store,delivery} = await setup(t);
    store.saveRecipient('a',bot.id,{enabled:true,mode:'direct',sources:{drop:true}});
    const path=join(root,'large.bin');await writeFile(path,Buffer.alloc(8,1));
    const item=await delivery.receive({accountId:'a',bot,source:'drop',files:[path],manual:false,policy:{mode:'direct',prefix:'',createdAt:1000}});
    const stages=[];
    delivery.onChange=()=>{const row=store.get(item.id,'a');if(row?.progress)stages.push(row.progress.stage);};
    delivery.upload=async(file,context)=>{context.onProgress?.({bytes:2,totalBytes:file.bytes});context.onProgress?.({bytes:file.bytes,totalBytes:file.bytes});return {path:'server/large',name:file.name};};
    await delivery.process(item.id,'a');
    assert.equal(store.get(item.id,'a').status,'sent');
    assert.deepEqual([...new Set(stages)],['upload','send','done']);
  });
  test('restart marks a persisted send attempt unconfirmed without resending', async t => {
    const {root,store,delivery} = await setup(t);
    store.saveRecipient('a',bot.id,{enabled:true,mode:'direct',sources:{drop:true}});
    const item = await delivery.receive({accountId:'a',bot,source:'drop',text:'body'});
    store.update(item.id,'a',{phase:'sending'}); store.close();
    // Closed before the test ends: Windows refuses to unlink the open SQLite
    // file, and the teardown hook that removes the directory runs first.
    const reopened = new Store(root);
    try { assert.equal(reopened.get(item.id,'a').status,'unconfirmed'); } finally { reopened.close(); }
  });
  test('a WhatsApp export shared from an enabled menu source is accepted and tagged', async t => {
    const {delivery,store}=await setup(t);
    store.saveRecipient('a',bot.id,{enabled:true,sources:{wechat:true}});
    assert.equal(store.recipient('a',bot.id).sources.share,true);
    assert.equal(store.recipient('a',bot.id).sources.wechat,false);
    const item=await delivery.receive({accountId:'a',bot,source:'whatsapp',originSource:'share',sourceTag:'WhatsApp',text:'[WhatsApp]\n整理一下'});
    assert.equal(item.source,'whatsapp');
    assert.equal(item.sourceTag,'WhatsApp');
    await assert.rejects(delivery.receive({accountId:'a',bot,source:'whatsapp',text:'untagged'}),/SOURCE_DISABLED/);
    await assert.rejects(delivery.receive({accountId:'a',bot,source:'whatsapp',sourceTag:'WeChat',text:'nope'}),/RECEIPT_INVALID/);
  });
  test('a receipt cannot be sent under a different account', async t => {
    const {store,delivery,sent} = await setup(t);
    store.saveRecipient('a',bot.id,{enabled:true,sources:{drop:true}});
    const item=await delivery.receive({accountId:'a',bot,source:'drop',text:'body'});
    await assert.rejects(delivery.process(item.id,'b',{text:'edited'}),/RECEIPT_NOT_FOUND/); assert.equal(sent.length,0);
  });
}
