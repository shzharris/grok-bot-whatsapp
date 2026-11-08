import {test} from 'node:test';
import assert from 'node:assert/strict';
const loaded=await import('../src/share/reconciler.mjs').catch(()=>null);
test('recipient changes automatically reconcile the native menu',()=>assert.ok(loaded?.MenuReconciler));
const makeState=id=>({account:{id:'a'},bots:[{id,name:id}],recipients:[{botId:id,enabled:true,order:0,mode:'compose',prefix:'',sources:{share:true}}]});
if(loaded){
 test('publishes account revocation while an older installer is still running',async()=>{
  let release,started;const ready=new Promise(r=>{started=r;}),hold=new Promise(r=>{release=r;});const published=[];
  const queue=new loaded.MenuReconciler({publish:async s=>published.push(s.accountBusy??false),sync:async()=>{},needsUpdate:()=>true,update:async()=>{started();await hold;},delay:1000});
  queue.request(makeState('one'));const work=queue.flush();await ready;queue.request({...makeState('one'),accountBusy:true});await new Promise(r=>setImmediate(r));const during=[...published];release();await work;assert.deepEqual(during,[false,true]);queue.close();
 });
 test('coalesces rapid receiver changes and installs only the latest choice',async()=>{
  const installed=[];const queue=new loaded.MenuReconciler({sync:async()=>{},needsUpdate:()=>true,update:async state=>{installed.push(state.bots[0].id);return {registered:1};},delay:1000});
  queue.request(makeState('first'));queue.request(makeState('second'));await queue.flush();assert.deepEqual(installed,['second']);queue.close();
 });
 test('manual resync forces one install even when the menu looks current',async()=>{
  let calls=0;
  const queue=new loaded.MenuReconciler({sync:async()=>{},needsUpdate:()=>false,update:async()=>{calls++;return {registered:1};},delay:1000});
  queue.request(makeState('one'));await queue.flush({force:true});assert.equal(calls,1);
  await queue.flush();assert.equal(calls,1);queue.close();
 });
 test('a state change during install retries the latest state instead of failing',async()=>{
  const seen=[];let calls=0;
  const queue=new loaded.MenuReconciler({sync:async()=>{},needsUpdate:()=>true,update:async state=>{calls++;seen.push(state.bots[0].id);if(calls===1){queue.request(makeState('second'));throw new Error('MENU_SUPERSEDED');}return {registered:1};},delay:1000});
  queue.request(makeState('first'));await queue.flush();assert.deepEqual(seen,['first','second']);queue.close();
 });
 test('a busy installer is retried without surfacing a failure',async()=>{
  let calls=0;
  const queue=new loaded.MenuReconciler({sync:async()=>{},needsUpdate:()=>true,update:async()=>{calls++;if(calls===1)throw new Error('MENU_UPDATE_BUSY');return {registered:1};},delay:1000});
  queue.request(makeState('one'));const result=await queue.flush();assert.equal(calls,2);assert.deepEqual(result,{registered:1});queue.close();
 });
 test('a change while updating is processed next without parallel installers',async()=>{
  let release,started;const ready=new Promise(r=>{started=r;}),hold=new Promise(r=>{release=r;});const calls=[];let active=0,max=0;
  const queue=new loaded.MenuReconciler({sync:async()=>{},needsUpdate:()=>true,update:async state=>{active++;max=Math.max(max,active);calls.push(state.bots[0].id);if(calls.length===1){started();await hold;}active--;},delay:1000});
  queue.request(makeState('first'));const work=queue.flush();await ready;queue.request(makeState('second'));release();await work;assert.deepEqual(calls,['first','second']);assert.equal(max,1);queue.close();
 });
 test('reply-only state changes do not rebuild or resync the menu',async()=>{
  let syncs=0;const queue=new loaded.MenuReconciler({sync:async()=>{syncs++;},needsUpdate:()=>false,update:async()=>{},delay:1000});
  const state=makeState('one');queue.request(state);await queue.flush();queue.request({...state,inbox:[{text:'reply'}]});await queue.flush();assert.equal(syncs,1);queue.close();
 });
 test('account transition disables configuration without installing old account metadata',async()=>{
  let installs=0;const synced=[];const queue=new loaded.MenuReconciler({sync:async state=>synced.push(state.accountBusy),needsUpdate:()=>true,update:async()=>{installs++;},delay:1000});
  queue.request({...makeState('one'),accountBusy:true});await queue.flush();assert.equal(installs,0);assert.deepEqual(synced,[true]);queue.close();
 });
}
