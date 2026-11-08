import {createAvatar} from './avatar-adapter.mjs';
import {cutoutStack,groupMembers,listedBots,placeStack,stackPlan} from './group-avatar.mjs';
import {acceptLateFiles,composerAfterSend} from '../shell/actions.mjs';
const api=window.anywhere;
const part=new URLSearchParams(location.search).get('part')||'card';
const columns=10;
let state,picking=false,pickIndex=0,sending=false,focus=false,lastHit=null,toastTimer,avatarKey='',placed='',pickerStamp='',cardStamp='',fileToken,queuedFiles=null,largeConfirm=null,background=null,barTimer=null,barError='',barKey='',earlySendError=null;
const LARGE_FILE_BYTES=50*1024*1024;
const handles=[],pickerHandles=[],barHandles=[];
const field=document.createElement('textarea');field.className='composer-input';field.rows=1;field.addEventListener('input',()=>{draft.text=field.value;fileToken=null;queuedFiles=null;largeConfirm=null;grow(field);const send=document.querySelector('.send');if(send)send.disabled=sending||!canSend();reportSize();});field.addEventListener('keydown',onKey);
const draft={botId:'',text:'',paths:[],names:[],receiptId:null,remote:[],preparing:null};
let preparingTimer;
const $=id=>document.getElementById(id);
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const chinese=()=>{const ui=state?.host?.uiLocale;if(ui==='zh'||ui==='en')return ui==='zh';return String(state?.host?.locale??navigator.language??'').toLowerCase().startsWith('zh');};
const t=(cn,en)=>chinese()?cn:en;
const prefs=()=>state?.composerPrefs??{afterSend:'hide',dismissOnOutside:true};
const ordered=()=>{
 if(!state)return [];
 const visible=new Set(listedBots(state.bots).map(bot=>bot.id));
 return state.bots.map((bot,index)=>({bot,index,order:state.recipients.find(item=>item.botId===bot.id)?.order??0})).filter(item=>visible.has(item.bot.id)).sort((a,b)=>a.order-b.order||a.index-b.index).map(item=>item.bot);
};
const errors={
 PREVIEW_ONLY:['当前是预览，不能发送。','Messages cannot be sent in preview.'],
 RECEIPT_EMPTY:['先写一点内容，或加上文件。','Write something or add a file.'],
 LOGIN_REQUIRED:['请登录后发送。','Sign in to send.'],
 SEND_UNCONFIRMED:['发送结果未确认，请到发送记录里核对。','Delivery was not confirmed. Check Send history.'],
 SEND_EXPIRED:['直接发送超时，没有发出去。内容还在发送记录里。','Direct send expired before it was sent. It is still in Send history.'],
 SEND_FAILED:['没有发出去，请到发送记录里重试。','Delivery failed. Retry it from Send history.'],
 BOT_SEND_HELD:['这个 Bot 有一条未确认的发送，请先到发送记录里核对。','This Bot has an unconfirmed send. Check Send history first.'],
 DELIVERY_IN_PROGRESS:['上一条还在发送，请稍等。','Delivery is still running.'],
 RECEIPT_NOT_SENDABLE:['这条内容现在不能发送。','This item cannot be sent right now.'],
 INPUT_REQUIRED:['先补一点正文。','Add a message first.'],
 UPLOAD_EXPIRED:['上传时间太久，没有发出去。文件还在发送记录里。','Upload timed out. Files are still in Send history.'],
 UPLOAD_FAILED:['附件没有上传成功，请到发送记录重试。','The attachment did not upload. Retry from Send history.'],
 GATEWAY_ATTACHMENT_TOO_LARGE:['附件太大，当前上传方式不支持。','This attachment is too large for the current upload mode.']
};
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function playEnter(){
 for(const node of [$('card'),$('avatar')]){
  if(!node)continue;
  node.classList.remove('entering');void node.offsetWidth;node.classList.add('entering');
 }
}
function lucide(paths){const node=document.createElementNS('http://www.w3.org/2000/svg','svg');node.setAttribute('viewBox','0 0 24 24');node.setAttribute('width','16');node.setAttribute('height','16');node.setAttribute('fill','none');node.setAttribute('stroke','currentColor');node.setAttribute('stroke-width','2');node.setAttribute('stroke-linecap','round');node.setAttribute('stroke-linejoin','round');node.setAttribute('aria-hidden','true');for(const d of paths){const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',d);node.append(shape);}return node;}
function pictureUrl(bot){
 const value=bot.avatar?.kind==='picture'?bot.avatar.picture?.url:'';
 if(typeof value!=='string'||!value)return '';
 try{const url=new URL(value);return ['https:','data:','blob:'].includes(url.protocol)?url.href:'';}catch{return '';}
}
function paintCharacter(target,bot,size,reducedMotion,bucket){
 target.classList.remove('picture');
 requestAnimationFrame(()=>{if(!target.isConnected)return;const handle=createAvatar(target,{agentId:bot.id,shape:bot.avatarShape,color:bot.avatarColor,size,main:!reducedMotion&&state.runtime?.mainAgentId===bot.id,state:reducedMotion?'idle':state.runtime?.statuses?.some(row=>row.agentId===bot.id&&row.isRunning)?'working':'idle',theme:state.theme==='system'?'auto':state.theme,reducedMotion:reducedMotion||matchMedia('(prefers-reduced-motion:reduce)').matches});bucket.push(handle);});
}
function paintOne(bot,size,reducedMotion,bucket=handles){
 const target=el('div','avatar');target.style.width=target.style.height=`${size}px`;
 const url=pictureUrl(bot);
 if(url){
  const image=el('img');image.alt='';image.decoding='async';
  image.addEventListener('error',()=>{if(!target.isConnected)return;image.remove();paintCharacter(target,bot,size,reducedMotion,bucket);},{once:true});
  image.src=url;target.classList.add('picture');target.append(image);return target;
 }
 paintCharacter(target,bot,size,reducedMotion,bucket);
 return target;
}
function paintFace(bot,size,reducedMotion=false,bucket=handles){
 const members=groupMembers(bot,state?.bots??[]);
 if(members.length<2)return paintOne(members[0]??bot,size,reducedMotion,bucket);
 const plan=stackPlan(members),root=el('div','avatar-stack');
 root.style.width=root.style.height=`${size}px`;root.dataset.count=String(plan.count);
 const faceSize=Math.round(size*plan.ratio);
 const add=node=>{const face=el('div','stack-face');face.append(node);root.append(face);return face;};
 if(plan.extra){const badge=add(el('span','stack-more',`+${plan.extra}`));badge.style.fontSize=`${(faceSize*0.34).toFixed(1)}px`;}
 for(const member of plan.shown)add(paintOne(member,faceSize,true,bucket));
 placeStack(root);root.__cutout=cutoutStack(root);
 return root;
}
function paintAvatar(bot){
 const key=`${bot.id}:${state.theme}:${state.runtime?.mainAgentId===bot.id}:${(bot.memberAgentIds??[]).join('|')}`;
 const host=$('avatar');
 if(avatarKey===key&&host.childElementCount)return;
 avatarKey=key;host.querySelector('.avatar-stack')?.__cutout?.();host.replaceChildren();
 for(const handle of handles)handle.destroy();handles.length=0;
 host.append(paintFace(bot,88));
}
function movePick(dx,dy){
 const bots=ordered(),count=bots.length;if(!count)return;
 if(dx){const next=pickIndex+dx;if(next>=0&&next<count)pickIndex=next;return;}
 const column=pickIndex%columns,next=pickIndex+dy*columns;
 if(next>=0&&next<count)pickIndex=next;
 else if(dy>0&&Math.floor(pickIndex/columns)<Math.floor((count-1)/columns))pickIndex=Math.min(count-1,Math.floor((count-1)/columns)*columns+column);
}
function confirmPick(){
 const bots=ordered();
 if(!picking||!bots[pickIndex]){picking=false;render();return;}
 const bot=bots[pickIndex];
 picking=false;focus=true;
 if(bot.id!==draft.botId){draft.botId=bot.id;draft.receiptId=null;draft.remote=[];fileToken=null;queuedFiles=null;}
 void api.noteBot(bot.id).catch(()=>{});
 render();
 void api.focusComposer().catch(()=>{});
}
function mergePaths(paths){
 let skipped=0;
 for(const path of paths??[]){
  if(typeof path!=='string'||!path||draft.paths.includes(path))continue;
  if(draft.paths.length+draft.remote.length>=100){skipped++;continue;}
  draft.paths.push(path);draft.names.push(path.split(/[\\/]/).pop());
 }
 if(skipped)toast(t(`最多一次 100 个文件，已忽略 ${skipped} 个。`,`Up to 100 files at once; ${skipped} ignored.`));
}
function updatePreparing(value){
 clearTimeout(preparingTimer);preparingTimer=null;draft.preparing=value;
 if(!value)return;
 preparingTimer=setTimeout(()=>{
  if(draft.preparing?.id!==value.id)return;
  draft.preparing={...draft.preparing,timedOut:true};
  toast(t('附件还没有准备好。可以先发文字，或稍后再试。','The attachments are not ready yet. You can send text now or try again.'));
  if(state)render();
 },120000);
}
function applyPayload(data){
 if(!data?.botId)return;
 if(data.preparing){
  const sameBot=data.botId===draft.botId;
  if(!sameBot){draft.paths=[];draft.names=[];draft.remote=[];draft.text='';}
  draft.botId=data.botId;draft.receiptId=null;draft.remote=[];
  fileToken=null;queuedFiles=null;
  updatePreparing(data.preparing);
  picking=false;focus=true;return;
 }
 if(data.id){
  const sameBot=data.botId===draft.botId;
  const wasPreparing=!!draft.preparing;
  const keepLocal=sameBot&&(wasPreparing||draft.paths.length>0);
  const typed=draft.text;
  draft.botId=data.botId;draft.receiptId=data.id;draft.remote=(data.files??[]).map((file,index)=>({...file,index:file.index??index}));
  if(!sameBot){draft.paths=[];draft.names=[];draft.text=data.text??'';}
  else if(typed.trim()){
    const forwarded=typeof data.text==='string'?data.text.trim():'';
    draft.text=wasPreparing&&forwarded&&!typed.includes(forwarded)?`${forwarded}\n\n${typed}`:typed;
    if(!keepLocal){draft.paths=[];draft.names=[];}
  }else{draft.text=data.text??'';if(!keepLocal){draft.paths=[];draft.names=[];}}
  updatePreparing(null);
 }
 else{
  if(data.botId!==draft.botId){draft.botId=data.botId;draft.receiptId=null;draft.remote=[];}
  if(typeof data.text==='string'){draft.botId=data.botId;draft.text=data.text;draft.receiptId=null;draft.remote=[];draft.paths=[];draft.names=[];updatePreparing(null);}
  mergePaths(data.localPaths);
 }
 fileToken=data.attachToken??null;
 const waiting=queuedFiles;queuedFiles=null;
 if(waiting)acceptComposerFiles(waiting,false);
 picking=false;focus=true;
}
function acceptComposerFiles(data,paint){
 if(fileToken===undefined){queuedFiles=data;return;}
 const paths=acceptLateFiles({token:data?.token,current:fileToken,botId:data?.botId,currentBotId:draft.botId,paths:data?.localPaths});
 if(!paths.length)return;
 mergePaths(paths);
 if(paint)render();
}
function grow(field){field.style.height='auto';field.style.height=`${Math.min(160,Math.max(22,field.scrollHeight))}px`;}
function focusField(){field.focus();try{field.setSelectionRange(field.value.length,field.value.length);}catch{}}
function box(node){
 if(!node||node.hidden)return null;
 const rect=node.getBoundingClientRect();
 if(rect.width<8||rect.height<8)return null;
 return {x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)};
}
function reportSize(){
 if(part==='picker'){
  const node=$('picker');if(!node||node.hidden)return;
  const height=Math.ceil(node.getBoundingClientRect().height);
  const key=`picker:${height}`;
  if(key===placed||height<8)return;placed=key;
  void api.placeComposer(760,height,{part:'picker'}).catch(()=>{});
  return;
 }
 if(document.documentElement.dataset.part==='bar'){
  const bar=$('bar');if(!bar||bar.hidden)return;
  const rect=bar.getBoundingClientRect(),width=Math.ceil(rect.width),height=Math.ceil(rect.height);
  if(height<8)return;
  const key=`bar:${width}x${height}`;if(key===placed)return;placed=key;
  void api.composerReady({part:'bar',width,height}).catch(()=>{});
  void api.placeComposer(width,height,{part:'bar'}).catch(()=>{});
  return;
 }
 if(part!=='card')return;
 const card=$('card');if(!card)return;
 const rect=card.getBoundingClientRect();
 const width=Math.ceil(rect.width),height=Math.ceil(rect.height);
 if(height<8)return;
 void api.composerReady({part:'card',width,height}).catch(()=>{});
 const key=`card:${width}x${height}:${picking}:${pickIndex}`;
 if(key===placed)return;placed=key;
 void api.placeComposer(width,height).catch(()=>{});
 void api.syncPicker({open:picking,index:pickIndex}).catch(()=>{});
}
function canSend(){if(draft.preparing&&!draft.preparing.timedOut)return false;return !!(draft.text.trim()||draft.paths.length||draft.remote.length);}
function fileSizeLabel(bytes){
 if(!Number.isFinite(bytes)||bytes<=0)return '0 MB';
 if(bytes>=1024*1024*1024)return `${(bytes/1024/1024/1024).toFixed(1)} GB`;
 return `${Math.max(1,Math.round(bytes/1024/1024))} MB`;
}
async function largeAttachmentWarning(){
 const local=draft.paths.length?await api.fileSizes(draft.paths).catch(()=>[]):[];
 const files=[
  ...draft.remote.map(file=>({name:file.name,bytes:Number(file.bytes)||0})),
  ...(Array.isArray(local)?local:[]).map(file=>({name:String(file.path??'').split(/[\\/]/).pop()||t('附件','Attachment'),bytes:Number(file.bytes)||0}))
 ];
 const total=files.reduce((sum,file)=>sum+file.bytes,0);
 const largest=files.slice().sort((a,b)=>b.bytes-a.bytes)[0];
 if(total<=LARGE_FILE_BYTES&&!(largest?.bytes>LARGE_FILE_BYTES))return null;
 return {total,largest};
}
function syncPickerSelection(bots){
 const picker=$('picker');const grid=picker.querySelector('.picker-grid');if(!grid)return;
 const activeRow=Math.floor(pickIndex/columns);
 [...grid.children].forEach((cell,index)=>{
  const selected=index===pickIndex;
  cell.classList.toggle('selected',selected);cell.setAttribute('aria-selected',String(selected));
  const ordinal=cell.querySelector('.pick-index');
  if(ordinal){ordinal.hidden=Math.floor(index/columns)!==activeRow;ordinal.textContent=index%columns===9?'0':String(index%columns+1);}
 });
 const selected=grid.children[pickIndex];if(selected)selected.scrollIntoView({block:'nearest'});
}
function renderPicker(bots){
 const picker=$('picker');
 const stamp=`${picking}:${state.theme}:${bots.map(bot=>`${bot.id}:${bot.name??''}:${(bot.memberAgentIds??[]).join(',')}`).join('|')}`;
 if(stamp===pickerStamp){if(picking)syncPickerSelection(bots);return;}
 pickerStamp=stamp;
 for(const handle of pickerHandles)handle.destroy();pickerHandles.length=0;
 picker.querySelectorAll('.avatar-stack').forEach(stack=>stack.__cutout?.());
 picker.replaceChildren();
 if(!picking)return;
 if(pickIndex>=bots.length)pickIndex=Math.max(0,bots.length-1);
 const grid=el('div','picker-grid');grid.setAttribute('role','listbox');
 const activeRow=Math.floor(pickIndex/columns);
 bots.forEach((item,index)=>{
  const cell=el('button',`pick${index===pickIndex?' selected':''}`);cell.type='button';cell.setAttribute('role','option');cell.setAttribute('aria-selected',String(index===pickIndex));
  const ordinal=el('span','pick-index',index%columns===9?'0':String(index%columns+1));ordinal.hidden=Math.floor(index/columns)!==activeRow;cell.append(ordinal);
  const face=paintFace(item,36,true,pickerHandles);
  cell.append(face,el('span','pick-name',item.name||t('未命名 Bot','Unnamed Bot')));
  cell.addEventListener('click',()=>{if(part==='picker'){void api.pickBot(item.id);return;}pickIndex=index;confirmPick();});
  grid.append(cell);
 });
 picker.append(grid,el('p','hint',t('1–0 选择当前行    − + 换行    回车或 Tab 确认    Esc 取消','1–0 picks this row, − + changes row, Enter or Tab confirms, Esc cancels')));
 const selected=grid.children[pickIndex];
 if(selected)selected.scrollIntoView({block:'nearest'});
}
function renderAvatar(){
 if(!state)return;
 document.documentElement.dataset.part='avatar';
 document.documentElement.dataset.theme=state.theme;
 const bot=ordered().find(item=>item.id===(draft.botId||state.activeBotId))||ordered()[0];
 if(!bot)return;
 draft.botId=bot.id;paintAvatar(bot);
 document.documentElement.dataset.ready='true';
 requestAnimationFrame(()=>requestAnimationFrame(()=>{if(part==='avatar')void api.composerReady({part:'avatar'}).catch(()=>{});}));
}
function renderPickerOnly(){
 if(!state)return;
 document.documentElement.dataset.part='picker';
 document.documentElement.dataset.theme=state.theme;
 $('picker').hidden=!picking;
 renderPicker(ordered());
 document.documentElement.dataset.ready='true';
 if(picking)requestAnimationFrame(reportSize);
}
function clearBarHandles(){
 $('bar')?.querySelectorAll('.avatar-stack').forEach(stack=>stack.__cutout?.());
 for(const handle of barHandles.splice(0))handle?.destroy?.();
}
function closeBar(){
 clearTimeout(barTimer);barTimer=null;background=null;barError='';barKey='';clearBarHandles();
 void api.keepComposerOpen(false).catch(()=>{});
 void api.hideComposer(false).catch(()=>{});
}
function barInfo(receipt){
 const bot=ordered().find(item=>item.id===background?.botId);
 const name=bot?.name||t('这个 Bot','this Bot');
 if(barError){
  const pair=errors[barError];
  return {title:t('没有发出去','Not sent'),status:pair?t(...pair):t('发送没有完成。','The send did not finish.'),percent:100,indeterminate:false,error:true};
 }
 const status=receipt?.status??'';
 if(status==='sent')return {title:t(`已发送给 ${name}`,`Sent to ${name}`),status:t('完成','Done'),percent:100,indeterminate:false};
 if(status==='unconfirmed')return {title:t('发送结果未确认','Delivery not confirmed'),status:t('请到发送记录核对。这条不会自动重发。','Check Send history. It will not be resent.'),percent:100,indeterminate:false,error:true};
 if(status==='expired')return {title:t('发送已过期','Send expired'),status:t('内容还在发送记录里。','It is still in Send history.'),percent:100,indeterminate:false,error:true};
 if(status==='failed'){
  const pair=errors[receipt?.error];
  return {title:t('没有发出去','Not sent'),status:pair?t(...pair):t('附件还在发送记录里，可以重试。','Files are still in Send history; you can retry.'),percent:100,indeterminate:false,error:true};
 }
 const progress=receipt?.progress??{};
 if(progress.stage==='upload'){
  const total=Number(progress.totalBytes)||0,bytes=Math.max(0,Number(progress.bytes)||0);
  const files=Math.max(1,Number(progress.total)||1),index=Math.max(0,Number(progress.index)||0);
  const percent=total>0?Math.min(99,Math.round(((index+Math.max(0,Math.min(1,bytes/total)))/files)*100)):0;
  const detail=total>0?t(`${progress.name??''} · ${fileSizeLabel(bytes)} / ${fileSizeLabel(total)}`,`${progress.name??''} · ${fileSizeLabel(bytes)} / ${fileSizeLabel(total)}`):t('正在读取附件…','Reading attachments…');
  return {title:t('正在上传附件…','Uploading attachments…'),status:detail,percent,indeterminate:!(total>0)};
 }
 if(progress.stage==='send'||receipt?.phase==='sending')return {title:t('正在发送…','Sending…'),status:t(`发给 ${name}`,`To ${name}`),percent:0,indeterminate:true};
 return {title:t('正在准备发送…','Preparing to send…'),status:t(`发给 ${name}`,`To ${name}`),percent:0,indeterminate:true};
}
function renderBar(){
 if(!state)return;
 document.documentElement.lang=chinese()?'zh-CN':'en';
 document.documentElement.dataset.part='bar';
 document.documentElement.dataset.theme=state.theme;
 const bar=$('bar');if(!bar)return;
 const bot=ordered().find(item=>item.id===background?.botId);
 const receipt=(state.inbox??[]).find(item=>item.id===background?.id);
 const info=barInfo(receipt);
 const key=`${background?.id??''}:${bot?.id??''}:${state.theme}`;
 if(key!==barKey||!bar.childElementCount){
  barKey=key;clearBarHandles();bar.replaceChildren();
  const avatar=el('div','bar-avatar');if(bot)avatar.append(paintFace(bot,28,true,barHandles));bar.append(avatar);
  const main=el('div','bar-main');
  main.append(el('div','bar-title',info.title));
  const track=el('div','bar-track'),fill=el('div','bar-fill');
  track.append(fill);main.append(track);bar.append(main);
  const status=el('div','bar-status',info.status);status.setAttribute('aria-live','polite');bar.append(status);
  const close=el('button','bar-close');close.type='button';close.setAttribute('aria-label',t('关闭进度条','Close progress'));close.title=t('只关闭进度条，不中止发送','Close this bar; sending continues');close.append(lucide(['M18 6 6 18','m6 6 12 12']));close.addEventListener('click',closeBar);bar.append(close);
 }
 const fill=bar.querySelector('.bar-fill');
 if(fill){
  fill.classList.toggle('indeterminate',!!info.indeterminate);
  fill.style.width=info.indeterminate?'':`${Math.max(0,Math.min(100,info.percent))}%`;
  fill.style.background=info.error?'#e5484d':'';
 }
 const title=bar.querySelector('.bar-title');if(title)title.textContent=info.title;
 const status=bar.querySelector('.bar-status');if(status)status.textContent=info.status;
 $('card').hidden=true;$('avatar').hidden=true;$('picker').hidden=true;bar.hidden=false;
 document.documentElement.dataset.ready='true';
 requestAnimationFrame(reportSize);
 if(!barError&&receipt?.status==='sent'){
  if(!barTimer){const openAfter=background?.openAfter,botId=background?.botId;barTimer=setTimeout(()=>{if(background?.id===receipt.id){closeBar();if(openAfter)void api.openBot(botId).catch(()=>{});}},2500);}
 }else{
  clearTimeout(barTimer);barTimer=null;
 }
}
function render(){
 if(part==='avatar'){renderAvatar();return;}
 if(part==='picker'){renderPickerOnly();return;}
 if(background){renderBar();return;}
 if(!state)return;
 clearBarHandles();
 document.documentElement.lang=chinese()?'zh-CN':'en';
 document.documentElement.dataset.part='card';
 document.documentElement.dataset.theme=state.theme;
 const bots=ordered();
 if(!bots.some(bot=>bot.id===draft.botId)){const next=bots[0]?.id??'';if(next!==draft.botId){fileToken=null;queuedFiles=null;}draft.botId=next;}
 const bot=bots.find(item=>item.id===draft.botId);
 $('picker').hidden=true;$('avatar').hidden=true;$('bar').hidden=true;
 const card=$('card');card.hidden=false;
 const held=bot?(state.inbox??[]).find(item=>item.botId===bot.id&&item.status==='unconfirmed'&&!item.holdResolved):null;
 const nextStamp=JSON.stringify([bot?.id??'',draft.names,draft.remote.map(file=>file.name),held?.id??'',prefs().dismissOnOutside,sending,largeConfirm?.total??0,largeConfirm?.largest?.bytes??0,draft.preparing?.id??'',draft.preparing?.timedOut??false]);
 if(!bot){cardStamp='';card.replaceChildren();card.append(el('p','issue',t('登录后才能发送。','Sign in to send.')));$('avatar').replaceChildren();avatarKey='';reportSize();return;}
 if(nextStamp===cardStamp&&card.contains(field)){const send=card.querySelector('.send');if(send)send.disabled=sending||!canSend();if(field.value!==draft.text)field.value=draft.text;if(focus){focus=false;focusField();}document.documentElement.dataset.ready='true';requestAnimationFrame(reportSize);return;}
 cardStamp=nextStamp;card.replaceChildren();
 paintAvatar(bot);
 const grip=el('div','grip');grip.title=t('拖动输入框','Drag composer');grip.setAttribute('aria-hidden','true');card.append(grip);
 field.placeholder=t('消息','Message');field.setAttribute('aria-label',t(`发给${bot.name}的消息`,`Message ${bot.name}`));
 if(field.value!==draft.text)field.value=draft.text;
 card.append(field);
 if(draft.preparing){
  const line=el('p',`preparing${draft.preparing.timedOut?' timed-out':''}`,draft.preparing.timedOut?t('附件还没有准备好，可以先发文字。','Attachments are not ready yet. You can send text now.'):t('正在载入附件…','Loading attachments…'));
  card.append(line);
 }
 if(held){
  const line=el('p','hold');line.append(el('span','',t('上次投递尚未确认。','The last delivery is still unconfirmed. ')));
  const unlock=el('button','',t('解除暂停','Unlock'));unlock.type='button';unlock.addEventListener('click',()=>void api.resolve(held.id).catch(error=>toast(errors[error.message]?t(...errors[error.message]):t('没有完成。','That did not finish.'))));
  line.append(unlock);card.append(line);
 }
 const files=[...draft.remote.map((file,index)=>({name:file.name,kind:'remote',index})),...draft.names.map((name,index)=>({name,kind:'local',index}))];
 if(files.length){
  const chips=el('div','chips');
  for(const file of files){
   const chip=el('span','chip');chip.append(el('span','',file.name));
   const remove=el('button','','×');remove.type='button';remove.setAttribute('aria-label',t('移除','Remove'));
   remove.addEventListener('click',()=>{
    largeConfirm=null;
    if(file.kind==='remote')draft.remote.splice(file.index,1);
    else{draft.names.splice(file.index,1);draft.paths.splice(file.index,1);}
    render();
   });
   chip.append(remove);chips.append(chip);
  }
  card.append(chips);
 }
 const bar=el('div','toolbar');
 const attach=el('button','icon');attach.type='button';attach.setAttribute('aria-label',t('添加文件','Add files'));attach.append(lucide(['m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551']));
 attach.addEventListener('click',()=>void addPicked());
 const close=el('button','close');close.type='button';close.setAttribute('aria-label',t('收起','Close'));close.title=t('收起','Close');close.append(lucide(['M18 6 6 18','m6 6 12 12']));close.addEventListener('click',()=>void api.hideComposer(true));
 const sendButton=el('button','send');sendButton.type='button';sendButton.setAttribute('aria-label',t('发送','Send'));sendButton.append(lucide(['m5 12 7-7 7 7','M12 19V5']));
 sendButton.disabled=sending||!canSend();sendButton.addEventListener('click',()=>void send());
 bar.append(attach,el('div','spacer'),close,sendButton);
 const confirm=largeConfirm?largeConfirmCard():null;if(confirm)card.append(confirm);
 card.append(bar);
 card.ondragover=event=>event.preventDefault();
 card.ondrop=event=>{event.preventDefault();addPaths(api.filePaths([...event.dataTransfer.files]));};
 grow(field);
 if(focus){focus=false;focusField();}
 document.documentElement.dataset.ready='true';
 requestAnimationFrame(reportSize);
}
function largeConfirmCard(){
 const box=el('section','large-confirm');box.setAttribute('role','alertdialog');box.setAttribute('aria-label',t('附件较大，继续发送？','Large attachments'));
 box.append(el('p','large-title',t('附件较大，继续发送？','Large attachments. Send anyway?')));
 const largest=largeConfirm?.largest;
 const detail=largest&&largest.bytes>LARGE_FILE_BYTES?`${largest.name} · ${fileSizeLabel(largest.bytes)}`:'';
 box.append(el('p','large-body',t(`附件总大小约 ${fileSizeLabel(largeConfirm?.total??0)}。超过 50 MB 的上传可能失败。`, `Attachments total about ${fileSizeLabel(largeConfirm?.total??0)}. Uploads over 50 MB may fail.`)));
 if(detail)box.append(el('p','large-file',detail));
 const actions=el('div','large-actions');
 const cancel=el('button','','');cancel.type='button';cancel.textContent=t('取消','Cancel');cancel.addEventListener('click',()=>{largeConfirm=null;render();});
 const go=el('button','primary',t('继续发送','Send anyway'));go.type='button';go.addEventListener('click',()=>{largeConfirm=null;void send(true);});
 actions.append(cancel,go);box.append(actions);
 box.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();largeConfirm=null;render();}
  else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.stopPropagation();largeConfirm=null;void send(true);}
 });
 queueMicrotask(()=>{if(go.isConnected)go.focus();});
 return box;
}
function onKey(event){
 if(event.isComposing||event.keyCode===229)return;
 if(background){if(event.key==='Escape'){event.preventDefault();closeBar();}return;}
 if(largeConfirm){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();largeConfirm=null;render();return;}
  if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();largeConfirm=null;void send(true);return;}
  return;
 }
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(picking){picking=false;render();}else void api.hideComposer(true);return;}
 if(event.key==='Tab'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
  event.preventDefault();
  if(picking)confirmPick();
  else if(ordered().length){pickIndex=Math.max(0,ordered().findIndex(bot=>bot.id===draft.botId));picking=true;render();}
  return;
 }
 if(picking&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
  if(event.key==='+'||event.key==='='){event.preventDefault();movePick(0,1);render();return;}
  if(event.key==='-'||event.key==='_'){event.preventDefault();movePick(0,-1);render();return;}
  if(!event.shiftKey&&event.key>='1'&&event.key<='9'){event.preventDefault();const next=Math.floor(pickIndex/columns)*columns+(Number(event.key)-1);if(ordered()[next]){pickIndex=next;confirmPick();}return;}
  if(!event.shiftKey&&event.key==='0'){event.preventDefault();const next=Math.floor(pickIndex/columns)*columns+9;if(ordered()[next]){pickIndex=next;confirmPick();}return;}
  if(event.key==='ArrowLeft'){event.preventDefault();movePick(-1,0);render();return;}
  if(event.key==='ArrowRight'){event.preventDefault();movePick(1,0);render();return;}
  if(event.key==='ArrowUp'){event.preventDefault();movePick(0,-1);render();return;}
  if(event.key==='ArrowDown'){event.preventDefault();movePick(0,1);render();return;}
 }
 if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(picking)confirmPick();else void send();}
}
function addPaths(paths){largeConfirm=null;mergePaths(paths);render();}
async function addPicked(){try{addPaths(await api.pickFiles());}catch(error){toast(errors[error.message]?t(...errors[error.message]):t('没有选到文件。','No file was chosen.'));}}
async function send(confirmed=false){
 const bot=ordered().find(item=>item.id===draft.botId);
 if(!bot||sending||(draft.preparing&&!draft.preparing.timedOut)||(!draft.text.trim()&&!draft.paths.length&&!draft.remote.length))return;
 if(!confirmed){
  let warning=null;
  try{warning=await largeAttachmentWarning();}catch{}
  if(warning){largeConfirm=warning;render();return;}
 }
 sending=true;largeConfirm=null;barError='';render();
 try{
  const result=await api.sendDraft(bot.id,draft.text,draft.paths,draft.receiptId,draft.receiptId?draft.remote.map(file=>file.index).filter(Number.isInteger):undefined);
  if(!result?.id)throw new Error(result?.error||'SEND_FAILED');
  draft.text='';draft.paths=[];draft.names=[];draft.remote=[];draft.receiptId=null;
  const recipient=state?.recipients?.find(row=>row.botId===bot.id);
  background={id:result.id,botId:bot.id,openAfter:composerAfterSend(recipient,prefs())==='open'};
  if(earlySendError?.id===result.id){barError=earlySendError.error||'SEND_FAILED';earlySendError=null;}
  await api.keepComposerOpen(true).catch(()=>{});
  sending=false;focus=false;render();
 }catch(error){
  sending=false;focus=true;
  toast(errors[error.message]?t(...errors[error.message]):t('没有发出去。','It was not sent.'));
  render();
 }
}
window.addEventListener('resize',()=>reportSize());
window.addEventListener('keydown',event=>{
 if(background&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closeBar();return;}
 if(!largeConfirm||event.defaultPrevented)return;
 if(event.key==='Escape'){event.preventDefault();largeConfirm=null;render();}
 else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();largeConfirm=null;void send(true);}
});
if(part==='avatar'){
 api.onChange(message=>{
  if(message.event==='composer-focus'){focus=true;if(field.isConnected)field.focus();return;}
  if(message.event==='composer-show'){playEnter();return;}
  if(message.event==='state')state=message.data;
  if(message.event==='composer'&&message.data?.botId)draft.botId=message.data.botId;
  if(message.event==='state'&&state?.activeBotId)draft.botId=state.activeBotId;
  renderAvatar();
 });
}else if(part==='picker'){
 api.onChange(message=>{
  if(message.event==='state')state=message.data;
  if(message.event==='picker'){picking=!!message.data?.open;pickIndex=message.data?.index??pickIndex;placed='';}
  if(message.event==='composer')picking=false;
  renderPickerOnly();
 });
}else{
 api.onChange(message=>{
  if(message.event==='send-error'){
   const data=message.data;
   if(background&&data?.id===background.id){barError=data.error||'SEND_FAILED';renderBar();}
   else if(!background&&data?.id)earlySendError=data;
   return;
  }
  if(message.event==='composer-clear'){draft.paths=[];draft.names=[];draft.remote=[];fileToken=null;queuedFiles=null;updatePreparing(null);if(state)render();return;}
  if(message.event==='composer-focus'){if(!background){focus=true;if(field.isConnected)field.focus();}return;}
  if(message.event==='composer-show'){if(!background)playEnter();return;}
  if(message.event==='composer-files'){acceptComposerFiles(message.data,true);return;}
  if(message.event==='composer'){if(background){clearTimeout(barTimer);barTimer=null;clearBarHandles();background=null;barError='';}placed='';applyPayload(message.data);}
  if(message.event==='pick'&&message.data?.botId){const index=ordered().findIndex(bot=>bot.id===message.data.botId);if(index>=0)pickIndex=index;confirmPick();return;}
  if(message.event==='state')state=message.data;
  if(state)render();
 });
}
try{
 state=await api.state();
 if(part==='card'){const pending=await api.pendingComposer();if(pending)applyPayload(pending);}
 if(part==='avatar'){const pending=await api.pendingComposer();if(pending?.botId)draft.botId=pending.botId;else if(state?.activeBotId)draft.botId=state.activeBotId;}
 render();
}catch{document.documentElement.dataset.ready='true';}
