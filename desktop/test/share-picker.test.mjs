import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pickerBots,pickerClick,pickerKey} from '../src/share/picker.mjs';

const bot=id=>({id,name:id});
const recipient=(botId,over={})=>({botId,enabled:true,mode:'compose',prefix:'',sources:{share:true,drop:false},order:0,...over});
const state=(over={})=>({account:{id:'acct'},accountBusy:false,bots:[bot('a'),bot('b'),bot('c')],recipients:[recipient('a'),recipient('b'),recipient('c')],...over});

test('the picker lists only Bots whose general source is on',()=>{
  const rows=pickerBots(state({recipients:[recipient('a'),recipient('b',{sources:{share:false}}),recipient('c',{enabled:false,sources:{share:true}})]}));
  assert.deepEqual(rows.map(row=>row.botId),['a']);
  assert.equal(rows[0].mode,'compose');
  assert.equal(rows[0].name,'a');
});

test('the picker keeps every enabled Bot instead of the macOS 12 slot cap',()=>{
  const bots=Array.from({length:15},(_,index)=>bot(`bot-${index}`));
  const recipients=bots.map((item,index)=>recipient(item.id,{order:index}));
  assert.equal(pickerBots(state({bots,recipients})).length,15);
});

test('the picker follows the configured order and drops unknown Bots',()=>{
  const rows=pickerBots(state({recipients:[recipient('c',{order:2}),recipient('b',{order:0}),recipient('a',{order:1}),recipient('gone',{order:3})]}));
  assert.deepEqual(rows.map(row=>row.botId),['b','a','c']);
});

test('a WhatsApp-only Bot is listed in the share picker',()=>{
  const rows=pickerBots(state({recipients:[recipient('a',{sources:{share:false,whatsapp:true}}),recipient('b',{sources:{share:false}})]}));
  assert.deepEqual(rows.map(row=>row.botId),['a']);
});

test('Windows lists every receiving Bot because it has no per-source choice',()=>{
  const recipients=[recipient('a',{sources:{share:false,drop:false}}),recipient('b',{sources:{share:true}}),recipient('c',{enabled:false,sources:{share:true}})];
  assert.deepEqual(pickerBots(state({recipients})).map(row=>row.botId),['b']);
  assert.deepEqual(pickerBots(state({recipients}),{allSources:true}).map(row=>row.botId),['a','b']);
});

test('the picker is empty without a settled account',()=>{
  assert.deepEqual(pickerBots(state({account:null})),[]);
  assert.deepEqual(pickerBots(state({accountBusy:true})),[]);
});

test('arrow keys move and wrap, Enter sends, Escape cancels',()=>{
  assert.deepEqual(pickerKey({key:'ArrowDown',index:2,count:3}),{action:'move',index:0});
  assert.deepEqual(pickerKey({key:'ArrowUp',index:0,count:3}),{action:'move',index:2});
  assert.deepEqual(pickerKey({key:'Enter',index:1,count:3}),{action:'send',index:1});
  assert.deepEqual(pickerKey({key:'Escape',index:1,count:3}),{action:'cancel',index:1});
  assert.deepEqual(pickerKey({key:'ArrowDown',index:0,count:0}),{action:'none',index:0});
  assert.deepEqual(pickerKey({key:'Enter',index:9,count:3}),{action:'send',index:2});
});

test('a single click selects and only a double click sends',()=>{
  assert.deepEqual(pickerClick({index:1}),{action:'select',index:1});
  assert.deepEqual(pickerClick({index:1,doubleClick:true}),{action:'send',index:1});
  assert.deepEqual(pickerClick({index:-1}),{action:'none',index:0});
});
