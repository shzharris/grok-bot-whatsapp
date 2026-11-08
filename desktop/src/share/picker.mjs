import {listedBots} from '../renderer/group-avatar.mjs';

// Windows shows one share entry that opens a picker, so it lists every Bot with
// receiving enabled — the per-source switches are a macOS concept there (each
// source maps to a different extension), so Windows ignores them.
// The macOS menu stops at 12 because each row is a signed appex; no such ceiling.
export function pickerBots(state,{allSources=false}={}){
  if(!state.account?.id||state.accountBusy)return [];
  const visible=new Set(listedBots(state.bots).map(bot=>bot.id));
  return state.recipients
    .filter(recipient=>recipient.enabled&&(allSources||recipient.sources?.wechat||recipient.sources?.whatsapp))
    .map((recipient,index)=>({recipient,index,bot:state.bots.find(bot=>bot.id===recipient.botId)}))
    .filter(row=>row.bot&&visible.has(row.bot.id))
    .sort((a,b)=>a.recipient.order-b.recipient.order||a.index-b.index)
    .map(({recipient,bot})=>({botId:bot.id,name:bot.name||'Bot',mode:recipient.mode,prefix:recipient.prefix}));
}

// One row is always selected so 确定 and 双击 both have a target.
export function pickerKey({key,index,count}){
  if(count<=0)return {action:'none',index:0};
  const clamp=value=>Math.min(Math.max(0,value),count-1);
  if(key==='ArrowDown')return {action:'move',index:(clamp(index)+1)%count};
  if(key==='ArrowUp')return {action:'move',index:(clamp(index)-1+count)%count};
  if(key==='Enter')return {action:'send',index:clamp(index)};
  if(key==='Escape')return {action:'cancel',index:clamp(index)};
  return {action:'none',index:clamp(index)};
}

// Single click only selects: the payload is sent on 确定 or on a double click.
export function pickerClick({index,doubleClick=false}){
  if(!Number.isInteger(index)||index<0)return {action:'none',index:0};
  return doubleClick?{action:'send',index}:{action:'select',index};
}
