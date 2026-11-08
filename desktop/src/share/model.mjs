import {groupMembers,listedBots,stackIconVersion} from '../renderer/group-avatar.mjs';
export const menuHostName='Grok Bot Anywhere Menu';
export const MENU_ID='dev.ronglecat.grokbotanywhere.menu';
export const destinationIdentifier=slot=>`${MENU_ID}.destination${String(slot).padStart(2,'0')}`;
export const slotIdentifier=slot=>`${destinationIdentifier(slot)}.share`;
export const extensionIdentifier=(slot,generation=1)=>`${destinationIdentifier(slot)}.g${generation}.share`;
export const legacySlotIdentifier=slot=>`${MENU_ID}.slot${String(slot).padStart(2,'0')}`;
export function pluginIdentifier(installed,slot){
  if((installed?.layoutVersion??0)<2)return legacySlotIdentifier(slot);
  if((installed?.layoutVersion??0)<4)return slotIdentifier(slot);
  const entry=installed?.entries?.find(item=>item.slot===slot);
  return entry?.extensionId??extensionIdentifier(slot,entry?.generation??0);
}
export const destinationPath=(root,slot)=>`${root}/Contents/Helpers/Destination${String(slot).padStart(2,'0')}.app`;
export const slotExtensionPath=(root,slot)=>`${destinationPath(root,slot)}/Contents/PlugIns/GrokBotShare.appex`;
export function menuEntries(state){
  if(!state.account?.id||state.accountBusy)return [];
  const visible=new Set(listedBots(state.bots).map(bot=>bot.id));
  return state.recipients.filter(r=>r.enabled&&(r.sources.wechat||r.sources.whatsapp)).map((r,index)=>({r,index,bot:state.bots.find(b=>b.id===r.botId)})).filter(row=>row.bot&&visible.has(row.bot.id))
    .sort((a,b)=>a.r.order-b.r.order||a.index-b.index).slice(0,12).map(({r,bot})=>({accountId:state.account.id,botId:bot.id,botName:bot.name||'Bot',sessionId:bot.sessionId??'',mode:r.mode,prefix:r.prefix,
      avatarKey:avatarKey(bot,state),bot}));
}
function avatarKey(bot,state){
 const base=[bot.avatarShape,bot.avatarColor,bot.avatar?.picture?.url,bot.avatar?.picture?.version];
 const members=groupMembers(bot,state.bots);
 if(members.length<2)return JSON.stringify(base);
 const shown=members.slice(0,4);
 return JSON.stringify([...base,shown.map(member=>[member.id,member.avatarShape??'',member.avatarColor??'',member.avatar?.kind==='picture'?member.avatar.picture?.url??'':'']),stackIconVersion]);
}
function stickyMenu(desired,previous){
  const used=new Set();
  let changed=false;
  const assigned=desired.map(entry=>{
    const prior=previous.find(item=>item.accountId===entry.accountId&&item.botId===entry.botId&&item.slot);
    if(!prior){changed=true;return {...entry,slot:0,generation:1};}
    const same=prior.botName===entry.botName&&prior.avatarKey===entry.avatarKey;
    if(!same)changed=true;
    used.add(prior.slot);
    return {...entry,slot:prior.slot,generation:same?(prior.generation??1):(prior.generation??1)+1,extensionId:same?prior.extensionId:undefined};
  });
  for(const entry of assigned){
    if(entry.slot)continue;
    let slot=1;while(used.has(slot))slot++;
    if(slot>12){entry.slot=-1;continue;}
    entry.slot=slot;used.add(slot);
  }
  const enabled=assigned.filter(entry=>entry.slot>=1&&entry.slot<=12);
  const stable=!changed&&enabled.every(entry=>{
    const prior=previous.find(item=>item.slot===entry.slot&&item.botId===entry.botId);
    return prior&&prior.botName===entry.botName&&prior.avatarKey===entry.avatarKey&&(prior.generation??1)===entry.generation;
  });
  return {stable,enabled};
}
export function menuPlan(state,installed){
  const desired=menuEntries(state),previous=installed?.entries??[],sticky=stickyMenu(desired,previous);
  const bySlot=[...sticky.enabled].sort((a,b)=>a.slot-b.slot).map(entry=>entry.botId);
  const wanted=desired.map(entry=>entry.botId);
  const ordered=bySlot.length===wanted.length&&bySlot.every((id,index)=>id===wanted[index]);
  if(ordered)return sticky.stable?{rebuild:false,entries:previous,enabledSlots:sticky.enabled.map(entry=>entry.slot)}:{rebuild:true,entries:sticky.enabled,enabledSlots:sticky.enabled.map(entry=>entry.slot)};
  const entries=desired.map((entry,index)=>{
    const prior=previous.find(item=>item.accountId===entry.accountId&&item.botId===entry.botId&&item.slot);
    const same=!!prior&&prior.botName===entry.botName&&prior.avatarKey===entry.avatarKey;
    return {...entry,slot:index+1,generation:prior?(same?(prior.generation??1):(prior.generation??1)+1):1};
  });
  return {rebuild:true,entries,enabledSlots:entries.map(entry=>entry.slot)};
}
export function shareConfiguration(state){return {version:1,accountId:state.accountBusy?null:state.account?.id??null,entries:menuEntries(state).map(({bot,...entry})=>entry)};}
