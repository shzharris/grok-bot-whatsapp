import {COLORS,SHAPES,colorHex,createAvatar,renderAvatarSvg} from './avatar-adapter.mjs';
import {cutoutStack,groupMembers,isGroup,listedBots,placeStack,stackPlan} from './group-avatar.mjs';
import {acceleratorFromEvent,formatAccelerator} from '../shortcuts.mjs';
import {spliceWechatOrder} from '../share/order.mjs';
import {coalBallSvg,confirmAccountStill,confirmCopy,toolboxShareOff} from '../shell/actions.mjs';
import {renderMarkdown} from './markdown.mjs';
import {captionGlyph,windowCaptionButtons,windowCaptionLabel} from '../shell/window-chrome.mjs';
const api=window.anywhere;
let state,page='bots',selected='',search='',searchOpen=true,grouped=false,avatars=[],busy=false,recordingSlot=null,inboxBot='',inboxFilterController,inboxAvatarObserver,menuReading=false,toastTimer,viewKey='',gridKey='';
let settingsTab='general',copying=false,confirmState=null,copyOpener=null,moreMenu=null,botDetail=null,avatarEditor=null;
try{grouped=localStorage.getItem('gba.grouped')==='1';}catch{}
const chinese=()=>state?.host?.locale?.startsWith('zh')??navigator.language.startsWith('zh');
const t=(cn,en)=>chinese()?cn:en;
const SHAPE_NAMES={
 blob:['团子','Blob'],pebble:['卵石','Pebble'],bean:['豆子','Bean'],egg:['蛋','Egg'],squircle:['方圆','Squircle'],tablet:['药片','Tablet'],capsule:['胶囊','Capsule'],cylinder:['圆柱','Cylinder'],hex:['六边形','Hex'],gem:['宝石','Gem'],crystal:['水晶','Crystal'],wedge:['楔形','Wedge'],shield:['盾牌','Shield'],dome:['穹顶','Dome'],arch:['拱门','Arch'],cloud:['云','Cloud'],teardrop:['水滴','Teardrop'],leaf:['叶子','Leaf'],square:['方形','Square'],sparkle:['闪光','Sparkle'],clover:['四叶草','Clover'],flower:['花','Flower'],heart:['心','Heart'],house:['房子','House'],star:['星','Star'],pumpkin:['南瓜','Pumpkin']
};
const COLOR_NAMES={black:['黑色','Black'],brown:['棕色','Brown'],red:['红色','Red'],orange:['橙色','Orange'],yellow:['黄色','Yellow'],green:['绿色','Green'],cyan:['青色','Cyan'],blue:['蓝色','Blue'],violet:['紫色','Violet'],magenta:['品红','Magenta'],gray:['灰色','Gray']};
const shapeLabel=shape=>{const pair=SHAPE_NAMES[shape];return pair?t(...pair):shape;};
const colorLabel=id=>{const pair=COLOR_NAMES[id];return pair?t(...pair):id;};
const themeName=()=>state?.theme==='system'?'auto':state?.theme??'auto';
const themeMode=()=>state?.theme==='dark'||(state?.theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';
const $=id=>document.getElementById(id);
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const errorMessages={
 NATIVE_COMPOSER_UNAVAILABLE:['输入框暂时打不开，请重新打开应用。','The composer is unavailable. Reopen the app.'],
 SOURCE_DISABLED:['请先为这个 Bot 打开接收，并打开对应来源。','Enable this Bot and the source you are using.'],
 LOGIN_REQUIRED:['请登录后发送。内容已留在这台电脑上。','Sign in to send. Your context stays on this computer.'],
 BOT_SEND_HELD:['这个 Bot 有一条未确认的发送，请先到发送记录里核对。','This Bot has an unconfirmed send. Check Send history first.'],
 PREVIEW_ONLY:['当前是预览，不能发送。','Messages cannot be sent in preview.'],
 DELIVERY_IN_PROGRESS:['上一条还在发送，请稍等。','Delivery is still running.'],
 ACCOUNT_BUSY:['账号操作还在进行。','An account operation is in progress.'],
 RECEIPT_NOT_SENDABLE:['这条内容现在不能发送。','This item cannot be sent right now.'],
 RECEIPT_EMPTY:['先写一点内容，或加上文件。','Write something or add a file.'],
 REQUEST_TIMEOUT:['等得太久了，请到发送记录里看结果。','The operation timed out. Check Send history.'],
 CREDENTIAL_STORAGE_UNAVAILABLE:['系统凭据存储暂不可用。','System credential storage is unavailable.'],
 SERVICE_EXITED:['后台停了，请重新打开应用。','The background service stopped. Reopen the app.'],
 MENU_RECIPIENT_REQUIRED:['请先为接收单位打开通用或 WhatsApp 来源。','Enable the general source or WhatsApp for a recipient first.'],
 MENU_UPDATE_FAILED:['分享菜单没有更新，原来的菜单还在。','The share menu could not be updated.'],
 MENU_UNAVAILABLE:['这个版本没有带上分享扩展。','This build does not include sharing extensions.'],
 SHORTCUT_INVALID:['这个按键组合不能用。请带上 Ctrl、Option 或 Command。','Use a shortcut with Ctrl, Option, or Command.'],
 SHORTCUT_UNAVAILABLE:['这个快捷键被占用了，请另外录一个。','That shortcut is taken. Record another one.'],
 BOT_NOT_FOUND:['没有找到这个 Bot。','That Bot was not found.'],
 AVATAR_INVALID:['这个头像形状或颜色不可用。','That avatar shape or color is unavailable.'],
 BOT_NOT_EDITABLE:['这个 Bot 不能在这里改头像。','This Bot cannot be edited here.'],
 AVATAR_UPDATE_UNAVAILABLE:['这个账号暂时不能改头像。','Avatar editing is unavailable for this account.'],
 DUPLICATE_UNAVAILABLE:['这个版本还不能复制 Bot。','This version cannot copy a Bot.'],
 BOT_NOT_COPYABLE:['群聊不能复制。','A group chat cannot be copied.'],
 GROK_BOT_OPEN_FAILED:['没有打开 Grok Bot。请确认已经安装。','Grok Bot did not open. Check that it is installed.'],
 SEND_UNCONFIRMED:['发送结果未确认，请到发送记录里核对。这条不会自动重发。','Delivery was not confirmed. Check Send history. It will not be resent.'],
 SEND_EXPIRED:['直接发送超时，没有发出去。内容还在发送记录里。','Direct send expired before it was sent. It is still in Send history.'],
 SEND_FAILED:['没有发出去，请到发送记录里重试。','Delivery failed. Retry it from Send history.'],
 SHARE_IMPORT_FAILED:['这次转发没有导入，内容还在本地。','This forward could not be imported. The content stays local.'],
 CLI_BUNDLE_MISSING:['这个版本没有带上命令行。','This build does not include the command line.'],
 CLI_RUNTIME_MISSING:['命令行运行环境不可用。','The command-line runtime is unavailable.'],
 CLI_COMMAND_EXISTS:['这里已经有别人安装的 grok-bot 命令或 skill，没有替换。','A grok-bot command or skill from somewhere else is already here, so it was left in place.'],
 CLI_INSTALL_FAILED:['命令行没有安装成功。','The command line could not be installed.'],
 LOGIN_ITEM_FAILED:['开机自启动没有写进系统。','Launch at login was not written to the system.'],
 EXPLORER_SYNC_FAILED:['资源管理器右键菜单没有同步。','The Explorer menu did not sync.'],
 EXPLORER_MENU_UNAVAILABLE:['这个系统没有资源管理器右键菜单。','This system has no Explorer menu.'],
 WATCH_DIR_INVALID:['这个文件夹打不开。','That folder could not be opened.'],
 DEEPLINK_IGNORED:['这个链接没有执行。','This link did not run.']
};
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
async function run(action){try{await action();}catch(error){const pair=errorMessages[error.message];toast(pair?t(...pair):t('操作没有完成，请重试。','The operation did not complete. Please try again.'));}}
function applyConfig(botId,patch,rollback){
 return api.configure(botId,patch).catch(error=>{rollback?.();const pair=errorMessages[error.message];toast(pair?t(...pair):t('操作没有完成，请重试。','The operation did not complete. Please try again.'));});
}
function recipientOf(id){return state.recipients.find(item=>item.botId===id);}
function orderedBots(){
 const visible=new Set(listedBots(state.bots).map(bot=>bot.id));
 return state.bots.map((bot,index)=>({bot,index,order:recipientOf(bot.id)?.order??0})).filter(item=>visible.has(item.bot.id)).sort((a,b)=>a.order-b.order||a.index-b.index).map(item=>item.bot);
}
function avatar(bot,size=48){
 const members=groupMembers(bot,state?.bots??[]);
 if(members.length>=2)return avatarStack(members,size);
 return singleAvatar(members[0]??bot,size);
}
function pictureUrl(bot){
 const value=bot.avatar?.kind==='picture'?bot.avatar.picture?.url:'';
 if(typeof value!=='string'||!value)return '';
 try{const url=new URL(value);return ['https:','data:','blob:'].includes(url.protocol)?url.href:'';}catch{return '';}
}
function paintCharacter(target,bot,size,still=false){
 target.classList.remove('picture');
 requestAnimationFrame(()=>{if(!target.isConnected)return;const handle=createAvatar(target,{agentId:bot.id,shape:bot.avatarShape,color:bot.avatarColor,size,main:!still&&state.runtime?.mainAgentId===bot.id,state:still?'idle':state.runtime?.statuses?.some(row=>row.agentId===bot.id&&row.isRunning)?'working':'idle',theme:state.theme==='system'?'auto':state.theme,reducedMotion:still||matchMedia('(prefers-reduced-motion:reduce)').matches});target.__avatar=handle;avatars.push(handle);});
}
function singleAvatar(bot,size,still=false){
 const target=el('div','avatar');target.style.width=target.style.height=`${size}px`;
 const url=pictureUrl(bot);
 if(url){
  const image=el('img');image.alt='';image.decoding='async';
  image.addEventListener('error',()=>{if(!target.isConnected)return;image.remove();paintCharacter(target,bot,size,still);},{once:true});
  image.src=url;target.classList.add('picture');target.append(image);return target;
 }
 paintCharacter(target,bot,size,still);
 return target;
}
function avatarStack(members,size){
 const plan=stackPlan(members),root=el('div','avatar-stack');
 root.style.width=root.style.height=`${size}px`;root.dataset.count=String(plan.count);
 const faceSize=Math.round(size*plan.ratio);
 const add=node=>{const face=el('div','stack-face');face.append(node);root.append(face);return face;};
 if(plan.extra){const badge=add(el('span','stack-more',`+${plan.extra}`));badge.style.fontSize=`${(faceSize*0.34).toFixed(1)}px`;}
 for(const member of plan.shown)add(singleAvatar(member,faceSize,true));
 placeStack(root);root.__cutout=cutoutStack(root);
 return root;
}
function dropTree(root){
 for(const stack of root.querySelectorAll?.('.avatar-stack')??[]){stack.__cutout?.();stack.__cutout=null;}
 for(const face of root.querySelectorAll?.('.avatar')??[]){
  const handle=face.__avatar;if(!handle)continue;
  handle.destroy();const index=avatars.indexOf(handle);if(index>=0)avatars.splice(index,1);face.__avatar=null;
 }
}
function mountHost(face){
 if(face.dataset.ready==='1')return;
 const bot=state.bots.find(item=>item.id===face.dataset.bot);if(!bot)return;
 face.dataset.ready='1';face.replaceChildren(avatar(bot,Number(face.dataset.size)||32));
}
function clearHost(face){dropTree(face);face.replaceChildren();delete face.dataset.ready;}
function icon(name){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
 svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
 const paths={
  history:['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8','M3 3v5h5','M12 7v5l4 2'],
  settings:['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'],
  up:['m18 15-6-6-6 6'],
  down:['m6 9 6 6 6-6'],
  search:['M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z','m21 21-4.3-4.3'],
  sync:['M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8','M3 3v5h5','M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16','M21 21v-5h-5'],
  group:['M3 7V5c0-1.1.9-2 2-2h2','M17 3h2c1.1 0 2 .9 2 2v2','M21 17v2c0 1.1-.9 2-2 2h-2','M7 21H5c-1.1 0-2-.9-2-2v-2'],
  more:['M12 12h.01','M19 12h.01','M5 12h.01'],
  copy:['M9 9h10v10H9z','M5 15V5h10'],
  info:['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z','M12 16v-4','M12 8h.01'],
  close:['M18 6 6 18','m6 6 12 12'],
  pencil:['M12 20h9','M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z']
 };
 for(const d of paths[name]){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}
 if(name==='settings'){const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','12');circle.setAttribute('cy','12');circle.setAttribute('r','3');svg.append(circle);}
 if(name==='group'){for(const attrs of [{width:'7',height:'5',x:'7',y:'7',rx:'1'},{width:'7',height:'5',x:'10',y:'12',rx:'1'}]){const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const [key,value] of Object.entries(attrs))rect.setAttribute(key,value);svg.append(rect);}}
 return svg;
}
function viewSignature(){
 const bots=orderedBots().map(bot=>{const recipient=recipientOf(bot.id);return [bot.id,bot.name,bot.description??'',bot.kind??'',bot.memberAgentIds??[],bot.avatarShape??'',bot.avatarColor??'',bot.avatar?.kind==='picture'?bot.avatar.picture?.url??'':'',recipient?.order??0];});
 const running=(state.runtime?.statuses??[]).filter(row=>row.isRunning).map(row=>row.agentId).sort();
 const pins=state.runtime?.pinnedAgentIds??[];
 const sections=(state.runtime?.sections??[]).map(section=>[section.id,section.name,section.agentIds,section.collapsed]);
 return JSON.stringify({theme:state.theme,material:state.host?.material??'',platform:state.host?.platform??'',locale:state.host?.locale??'',preview:!!state.host?.preview,issue:state.host?.issue??'',connected:!!state.connected,account:state.account?.name??'',page,selected,search,searchOpen,grouped,busy,recording:recordingSlot??'',inboxBot,menuReading,settingsTab,openAtLogin:!!state.host?.openAtLogin,touchBarPinned:!!state.host?.touchBarPinned,shortcuts:state.shortcuts??null,prefs:state.composerPrefs??null,cli:state.host?.cli??null,main:state.runtime?.mainAgentId??'',running,pins,sections,bots,menu:page==='settings'?state.host?.menu??null:null,inbox:page==='inbox'?state.inbox??null:null});
}
function botRowKey(bot,running){
 const recipient=recipientOf(bot.id);
 return [bot.id,bot.name,bot.description??'',recipient?.enabled?1:0,running.has(bot.id)?1:0,(bot.memberAgentIds??[]).join(','),bot.avatarShape??'',bot.avatarColor??'',bot.avatar?.kind==='picture'?bot.avatar.picture?.url??'':''].join('\u0001');
}
function visibleBots(){
 const query=search.toLocaleLowerCase();
 return orderedBots().filter(bot=>bot.name.toLocaleLowerCase().includes(query));
}
function findVisible(bots,id){
 return bots.find(bot=>bot.id===id)??bots.find(bot=>bot.serverId===id);
}
function sidebarEntries(){
 const bots=visibleBots();
 if(!grouped){
  return [{title:'',bots:[...bots.filter(bot=>!isGroup(bot)),...bots.filter(bot=>isGroup(bot))]}];
 }
 const used=new Set(),sections=[];
 const take=ids=>{
  const rows=[];
  for(const id of ids??[]){
   const bot=findVisible(bots,id);
   if(!bot||used.has(bot.id))continue;
   used.add(bot.id);rows.push(bot);
  }
  return rows;
 };
 const pins=take(state.runtime?.pinnedAgentIds);
 if(pins.length)sections.push({title:t('置顶','Pinned'),bots:pins});
 const searching=search.trim().length>0;
 for(const section of state.runtime?.sections??[]){
  const members=take(section.agentIds);
  if(!members.length){
   if(!searching)sections.push({title:(section.name??'').trim()||t('未命名分组','Untitled group'),bots:[]});
   continue;
  }
  sections.push({title:(section.name??'').trim()||t('未命名分组','Untitled group'),bots:members});
 }
 const rest=bots.filter(bot=>!used.has(bot.id));
 if(rest.length)sections.push({title:t('未分组','Ungrouped'),bots:rest});
 else if(!sections.length&&!searching)sections.push({title:t('未分组','Ungrouped'),bots:[]});
 return sections;
}
function gridIdentity(){
 const running=new Set((state.runtime?.statuses??[]).filter(row=>row.isRunning).map(row=>row.agentId));
 const rows=sidebarEntries().map(section=>[section.title,section.bots.map(bot=>botRowKey(bot,running)).join('\u0002')].join('\u0001')).join('\u0003');
 return [state.theme??'',state.runtime?.mainAgentId??'',grouped?1:0,rows].join('\u0004');
}
function paintGridSelection(){
 for(const cell of $('grid').querySelectorAll('.bot-cell')){
  const active=page==='bots'&&cell.dataset.id===selected;
  cell.classList.toggle('selected',active);
  cell.setAttribute('aria-pressed',String(active));
 }
}
function paintGridDots(){
 for(const cell of $('grid').querySelectorAll('.bot-cell')){
  const face=cell.querySelector('.bot-face');if(!face)continue;
  const on=!!recipientOf(cell.dataset.id)?.enabled;
  const dot=face.querySelector('.bot-dot');
  if(on&&!dot)face.append(el('span','bot-dot'));
  else if(!on&&dot)dot.remove();
 }
}
let windowChrome={maximized:false,focused:true,inset:0};
function paintWindowControls(){
 const win=state?.host?.platform==='win32';
 const root=document.documentElement;
 root.classList.toggle('maximized',!!win&&windowChrome.maximized);
 root.classList.toggle('window-focused',!win||windowChrome.focused);
 root.style.setProperty('--win-inset',win?`${Math.max(0,windowChrome.inset|0)}px`:'0px');
 let bar=$('win-controls');
 if(!win){bar?.remove();return;}
 if(!bar){
  bar=el('div','win-controls');bar.id='win-controls';
  for(const spec of windowCaptionButtons('win32')){
   const button=el('button','win-control');button.type='button';button.dataset.action=spec.action;
   button.addEventListener('click',()=>{void api.windowControl(spec.action).catch(()=>{});});
   bar.append(button);
  }
  document.querySelector('.titlebar').append(bar);
 }
 for(const button of bar.children){
  const action=button.dataset.action;
  const glyph=action==='toggleMaximize'?(windowChrome.maximized?'restore':'maximize'):action;
  const label=windowCaptionLabel(action,{maximized:windowChrome.maximized,zh:chinese()});
  button.classList.toggle('win-control-close',action==='close');
  button.setAttribute('aria-label',label);button.title=label;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 10 10');svg.setAttribute('aria-hidden','true');
  for(const d of captionGlyph(glyph)){
   const path=document.createElementNS('http://www.w3.org/2000/svg','path');
   path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1');
   svg.append(path);
  }
  button.replaceChildren(svg);
 }
}
function render(){
 if(moreMenu)closeMoreMenu();
 const visible=orderedBots();
 if(!visible.some(bot=>bot.id===selected)){
  const current=state.bots.find(bot=>bot.id===selected);
  const name=current?.name.trim()??'';
  selected=visible.find(bot=>name&&isGroup(bot)&&bot.name.trim()===name)?.id??visible[0]?.id??'';
 }
 if(inboxBot&&!state.bots.some(bot=>bot.id===inboxBot))inboxBot='';
 const key=viewSignature();
 if(key===viewKey){paintGridDots();return;}
 inboxFilterController?.abort();
 inboxAvatarObserver?.disconnect();
 viewKey=key;
 const nextGrid=gridIdentity();
 const keepGrid=nextGrid===gridKey&&!!$('grid').querySelector('.bot-cell');
 if(keepGrid)dropTree($('content'));
 else{
  for(const stack of document.querySelectorAll('.avatar-stack')){stack.__cutout?.();stack.__cutout=null;}
  for(const handle of avatars)handle.destroy();avatars=[];
  gridKey=nextGrid;
 }
 document.documentElement.lang=chinese()?'zh-CN':'en';document.documentElement.dataset.theme=state.theme;
 document.documentElement.dataset.material=state.host?.material||'none';
 document.documentElement.classList.toggle('os-mac',state.host?.platform==='darwin');
 document.documentElement.classList.toggle('os-windows',state.host?.platform==='win32');
 paintWindowControls();
 document.querySelector('.shell').classList.toggle('search-collapsed',!searchOpen);
 const searchToggle=$('search-toggle');
 searchToggle.setAttribute('aria-pressed',String(searchOpen));
 searchToggle.setAttribute('aria-label',searchOpen?t('隐藏搜索','Hide search'):t('显示搜索','Show search'));
 searchToggle.title=searchToggle.getAttribute('aria-label');
 searchToggle.replaceChildren(icon('search'));
 $('titlebar-title').textContent=titlebarLabel();
 const sync=$('sync');
 sync.setAttribute('aria-label',t('同步','Sync'));
 sync.title=sync.getAttribute('aria-label');
 sync.replaceChildren(icon('sync'));
 const groupToggle=$('group-toggle');
 groupToggle.setAttribute('aria-pressed',String(grouped));
 groupToggle.setAttribute('aria-label',grouped?t('按列表显示','Show as a list'):t('分组模式','Group mode'));
 groupToggle.title=groupToggle.getAttribute('aria-label');
 groupToggle.replaceChildren(icon('group'));
 $('search').placeholder=t('搜索','Search');$('search').setAttribute('aria-label',$('search').placeholder);
 if(keepGrid)paintGridSelection();else renderGrid();
 paintGridDots();
 renderNav();renderMain();
 document.documentElement.dataset.ready='true';
 refreshOverlayScroll();
 paintOverlay();
}
function renderGrid(){
 const grid=$('grid'),top=grid.scrollTop,left=grid.scrollLeft;
 grid.replaceChildren();
 const sections=sidebarEntries();
 const bots=sections.flatMap(section=>section.bots);
 if(!bots.length){grid.append(el('p','list-empty',state.bots.length?t('没有匹配的 Bot','No matching Bots'):t('登录后，Bot 会出现在这里','Bots show up here after you sign in')));return;}
 for(const section of sections){
  if(section.title)grid.append(el('div','bot-section',section.title));
  for(const bot of section.bots){
   const recipient=recipientOf(bot.id),active=page==='bots'&&bot.id===selected,cell=el('button',`bot-cell${active?' selected':''}`);cell.type='button';cell.dataset.id=bot.id;
   cell.setAttribute('aria-pressed',String(active));cell.title=t(`拖放文件给 ${bot.name}`,`Drop files for ${bot.name}`);
   const face=el('div','bot-face');face.append(avatar(bot,34));if(recipient?.enabled)face.append(el('span','bot-dot'));
   const meta=el('span','bot-meta');meta.append(el('span','bot-cell-name',bot.name));
   if(bot.description)meta.append(el('span','bot-cell-sub',bot.description));
   cell.append(face,meta);
   cell.addEventListener('click',()=>{selected=bot.id;page='bots';void api.noteBot(bot.id).catch(()=>{});render();});
   cell.addEventListener('dragover',event=>{event.preventDefault();cell.classList.add('selected');});
   cell.addEventListener('dragleave',()=>{if(!(page==='bots'&&bot.id===selected))cell.classList.remove('selected');});
   cell.addEventListener('drop',event=>{event.preventDefault();selected=bot.id;page='bots';render();void run(()=>api.dropFiles(bot.id,[...event.dataTransfer.files]));});
   grid.append(cell);
  }
 }
 grid.scrollTop=top;grid.scrollLeft=left;
}
function renderNav(){
 $('navigation').replaceChildren();
 $('navigation').setAttribute('aria-label',t('导航','Navigation'));
 for(const [id,label,glyph] of [['inbox',t('发送记录','Send history'),'history'],['settings',t('设置','Settings'),'settings']]){
  const button=el('button',`nav-button${page===id?' selected':''}`);button.type='button';button.dataset.page=id;button.setAttribute('aria-current',page===id?'page':'false');
  button.append(icon(glyph),el('span','',label));
  button.addEventListener('click',()=>{page=id;render();});$('navigation').append(button);
 }
 const issueCode=state.host?.issue&&state.host.issue!=='ACCOUNT_BUSY'?state.host.issue:'';
 $('notice').hidden=!state.host?.preview&&!issueCode;
 $('notice').textContent=state.host?.preview?t('界面预览，不会发送消息','Preview. Messages are not sent.'):errorMessages[issueCode]?t(...errorMessages[issueCode]):t('请检查账号连接。','Check the account connection.');
}
function titlebarLabel(){
 if(page==='inbox')return t('发送记录','Send history');
 if(page==='settings')return t('设置','Settings');
 return state.bots.find(item=>item.id===selected)?.name||t('你的 Bot','Your Bots');
}
function renderMain(){
 // 同页刷新保滚动；切 Bot/页面仍回顶
 // 2026-10-31 content.scrollTop / dataset.view：重建前后
 const content=$('content'),top=content.scrollTop,view=`${page}\0${selected}\0${inboxBot}\0${settingsTab}`;
 const same=content.dataset.view===view;
 content.replaceChildren();
 if(page==='inbox')renderInbox(content);else if(page==='settings')renderSettings(content);else renderChat(content);
 content.dataset.view=view;
 content.scrollTop=same?top:0;
}
function settingRow(label,control,help){
 const row=el('div','group-row'),copy=el('div','group-copy');
 copy.append(el('div','group-label',label));
 if(help)copy.append(el('div','group-help',help));
 row.append(copy,control);return row;
}
function renderChat(content){
 if(!state.bots.length){
  const panel=el('div','empty');panel.append(el('h1','',t('你的 Bot','Your Bots')),el('p','',t('连接账号后，从左边选择一个 Bot。','Connect an account, then choose a Bot on the left.')));
  const actions=el('div','row-actions');actions.append(loginButton());if(state.host?.platform==='darwin')actions.append(smallButton(t('使用本机登录','Use local login'),()=>api.desktopLogin()));panel.append(actions);content.append(panel);return;
 }
 const bot=state.bots.find(item=>item.id===selected),recipient=recipientOf(bot.id);
 const detail=el('div','detail'),hero=el('section','hero'),face=el('div','hero-face');
 const accent=botAccent(bot);
 detail.style.setProperty('--accent',accent);
 detail.style.setProperty('--on-accent',accentInk(accent));
 face.append(avatar(bot,112));
 hero.append(face,el('h1','hero-name',bot.name));
 const actions=el('div','hero-actions');
 actions.append(smallButton(t('开始对话','Start'),()=>api.compose(bot.id),'primary'),smallButton(t('在 Grok Bot 中打开','Open in Grok Bot'),()=>api.openBot(bot.id),'secondary'),moreButton(bot));
 hero.append(actions);
 const ownShortcut=state.shortcuts?.bots?.[bot.id];
 if(ownShortcut)hero.append(el('p','hero-shortcut',formatAccelerator(ownShortcut,state.host?.platform)));
 const members=isGroup(bot)?groupMembers(bot,state.bots):[];
 const memberCard=isGroup(bot)?memberList(members):null;
 const card=el('section','group');
 const enabled=el('input','switch');enabled.type='checkbox';enabled.checked=!!recipient?.enabled;enabled.setAttribute('aria-label',t(`让 ${bot.name} 接收转发`,`Let ${bot.name} receive forwards`));
 const settingsBody=el('div','recipient-settings');settingsBody.hidden=!enabled.checked;
 enabled.addEventListener('change',()=>{
  const next=enabled.checked;settingsBody.hidden=!next;
  void applyConfig(bot.id,{enabled:next},()=>{enabled.checked=!next;settingsBody.hidden=next;});
 });
 card.append(settingRow(t('接收转发','Receive forwards'),enabled,t('WhatsApp 和通用来源才会把内容交给这个 Bot。','WhatsApp and the general source deliver content to this Bot.')));
 let currentMode=recipient?.mode==='direct'?'direct':'compose';
 const selectSegment=(node,value)=>{for(const button of node.children)button.classList.toggle('selected',button.dataset.value===value);};
 const mode=el('div','segment');mode.setAttribute('aria-label',t('收到之后','After receiving'));
 let prefixRow=null;
 for(const [value,label] of [['compose',t('先放进输入框','Open in composer')],['direct',t('直接发送','Send directly')]]){
  const choice=el('button',value===currentMode?'selected':'',label);choice.type='button';choice.dataset.value=value;
  choice.addEventListener('click',()=>{const previous=currentMode;currentMode=value;selectSegment(mode,value);if(prefixRow)prefixRow.hidden=value!=='direct';void applyConfig(bot.id,{mode:value},()=>{currentMode=previous;selectSegment(mode,previous);if(prefixRow)prefixRow.hidden=previous!=='direct';});});
  mode.append(choice);
 }
 settingsBody.append(settingRow(t('收到之后','After receiving'),mode));
 const generalKeys=['drop','share'];
 let generalOn=generalKeys.some(key=>recipient?.sources?.[key]);
 const sources=el('div','sources');
 const general=el('button',`source-chip${generalOn?' selected':''}`,t('通用','General'));
 general.type='button';general.setAttribute('aria-pressed',String(generalOn));general.title=t('拖放和系统分享。','Drop and system share.');
 general.addEventListener('click',()=>{
  const previous=generalOn;generalOn=!previous;general.classList.toggle('selected',generalOn);general.setAttribute('aria-pressed',String(generalOn));
  void applyConfig(bot.id,{sources:Object.fromEntries(generalKeys.map(key=>[key,generalOn]))},()=>{generalOn=previous;general.classList.toggle('selected',previous);general.setAttribute('aria-pressed',String(previous));});
 });
 const showShortcuts=state.host?.platform!=='darwin';
 let shortcutOn=!!recipient?.sources?.shortcuts;
 const shortcut=showShortcuts?el('button',`source-chip${shortcutOn?' selected':''}`,t('快捷指令','Shortcuts')):null;
 if(shortcut){
  shortcut.type='button';shortcut.setAttribute('aria-pressed',String(shortcutOn));
  shortcut.title=t('允许快捷指令和 grokbotanywhere 链接把文字交给这个 Bot。通过链接收到的内容会先放进输入框，由你确认后再发送。','Allow Shortcuts and grokbotanywhere links to deliver text to this Bot. Content received from a link is placed in the composer first. It is sent only after you confirm.');
  shortcut.addEventListener('click',()=>{
   const previous=shortcutOn;shortcutOn=!previous;shortcut.classList.toggle('selected',shortcutOn);shortcut.setAttribute('aria-pressed',String(shortcutOn));
   void applyConfig(bot.id,{sources:{shortcuts:shortcutOn}},()=>{shortcutOn=previous;shortcut.classList.toggle('selected',previous);shortcut.setAttribute('aria-pressed',String(previous));});
  });
 }
 let whatsappOn=!!recipient?.sources?.whatsapp;
 const whatsapp=el('button',`source-chip${whatsappOn?' selected':''}`,t('WhatsApp','WhatsApp'));
 whatsapp.type='button';whatsapp.setAttribute('aria-pressed',String(whatsappOn));
 whatsapp.addEventListener('click',()=>{
  const previous=whatsappOn;whatsappOn=!previous;whatsapp.classList.toggle('selected',whatsappOn);whatsapp.setAttribute('aria-pressed',String(whatsappOn));
  void applyConfig(bot.id,{sources:{whatsapp:whatsappOn}},()=>{whatsappOn=previous;whatsapp.classList.toggle('selected',previous);whatsapp.setAttribute('aria-pressed',String(previous));});
 });
 sources.append(general,...(shortcut?[shortcut]:[]),whatsapp);
 // Windows has a single share entry for every receiving Bot, so the per-source
 // switches would promise a choice that does not exist there.
 if(state.host?.platform!=='win32')settingsBody.append(settingRow(t('来源','Sources'),sources));
 const prefix=el('input','prefix');prefix.placeholder=t('加在正文前','Prefix');prefix.setAttribute('aria-label',t('直接发送时加在正文前','Prefix for direct sends'));prefix.value=recipient?.prefix??'';
 prefix.addEventListener('change',()=>void applyConfig(bot.id,{prefix:prefix.value}));
 prefixRow=settingRow(t('前缀','Prefix'),prefix);prefixRow.hidden=currentMode!=='direct';settingsBody.append(prefixRow);
 card.append(settingsBody);
 let afterValue=recipient?.composerAfterSend??'inherit';
 const afterMode=el('div','segment');afterMode.setAttribute('aria-label',t('输入框发送后','Composer after sending'));
 for(const [value,label] of [['inherit',t('跟随全局','Use global')],['hide',t('隐藏','Hide')],['open',t('打开 Bot','Open Bot')]]){
  const choice=el('button',afterValue===value?'selected':'',label);choice.type='button';choice.dataset.value=value;
  choice.addEventListener('click',()=>{const previous=afterValue;afterValue=value;selectSegment(afterMode,value);void applyConfig(bot.id,{composerAfterSend:value},()=>{afterValue=previous;selectSegment(afterMode,previous);});});
  afterMode.append(choice);
 }
 card.append(settingRow(t('输入框发送后','Composer after sending'),afterMode,t('覆盖全局设置；默认跟随全局。','Overrides the global setting; follows it by default.')));
 card.append(shortcutRow(bot.id,t('打开悬浮输入框','Open composer'),t('只打开这个 Bot 的悬浮输入框。','Opens the floating composer for this Bot.')));
 card.append(shortcutRow(`grok:${bot.id}`,t('在 Grok Bot 中打开','Open in Grok Bot'),t('在 Grok Bot 里打开这个 Bot。','Opens this Bot in Grok Bot.')));
 if(state.host?.platform!=='darwin')card.append(settingRow(t('快捷指令','Shortcuts'),smallButton(t('复制快捷指令链接','Copy shortcut link'),async()=>{await api.copyComposeLink(bot.id);toast(t('已复制快捷指令链接','Shortcut link copied'));},'secondary'),t('在快捷指令里用「打开 URL」。','Use Open URL in Shortcuts.')));
 detail.append(hero,...memberCard?[memberCard]:[],card);content.append(detail);
}
function memberList(members){
 const panel=el('section','group member-card'),head=el('div','group-row');
 head.append(el('span','group-label',t('成员','Members')));
 if(members.length)head.append(el('span','member-count',String(members.length)));
 panel.append(head);
 if(!members.length){panel.append(el('p','member-empty',t('同步后会列出这个群里的 Bot。','Sync to list the Bots in this group.')));return panel;}
 for(const member of members){
  const row=el('button','member-row');row.type='button';
  row.setAttribute('aria-label',t(`打开 ${member.name}`,`Open ${member.name}`));
  row.append(singleAvatar(member,32),el('span','member-name',member.name));
  row.addEventListener('click',()=>{selected=member.id;page='bots';void api.noteBot(member.id).catch(()=>{});render();$('content').scrollTop=0;});
  panel.append(row);
 }
 return panel;
}
function statusLabel(item){return {sent:t('已发送','Sent'),unconfirmed:t('未确认','Unconfirmed'),failed:t('失败','Failed'),expired:t('过期','Expired'),'needs-input':t('待发送','Waiting')}[item.status]??item.status;}
function renderInbox(content){
 const pageEl=el('div','page');
 pageEl.append(inboxBotFilter());
 const items=inboxBot?state.inbox.filter(item=>item.botId===inboxBot):state.inbox;
 if(!state.inbox.length){pageEl.append(el('p','empty-note',t('还没有发送记录。','No sends yet.')));content.append(pageEl);return;}
 if(!items.length){pageEl.append(el('p','empty-note',t('这个 Bot 还没有发送记录。','This Bot has no sends yet.')));content.append(pageEl);return;}
 const list=el('section','group');
 for(const item of items){
  const row=el('article','receipt'),top=el('div','receipt-top'),label=el('div','receipt-label');
  const bot=state.bots.find(entry=>entry.id===item.botId);
  if(bot){const face=el('div','face-host');face.dataset.bot=bot.id;face.dataset.size='32';top.append(face);}
  label.append(el('h2','',item.title||item.botName),el('div','receipt-meta',[item.sourceTag,new Date(item.createdAt).toLocaleString(document.documentElement.lang)].filter(Boolean).join(' · ')));
  top.append(label,el('span',`status ${item.status}`,['uploading','sending'].includes(item.phase)?t('正在发送','Sending'):statusLabel(item)));row.append(top);
  if(item.text)row.append(el('p','record-text',item.text));
  const files=el('div','files');for(const file of item.files??[])files.append(el('span','file',`${file.name} · ${(file.bytes/1024/1024).toFixed(1)} MB`));if(item.files?.length)row.append(files);
  const actions=el('div','row-actions');
  if(item.status==='needs-input')actions.append(smallButton(t('放入输入框','Open in composer'),()=>api.openReceipt(item.id),'primary'));
  if(item.status==='failed')actions.append(smallButton(t('重试','Retry'),()=>api.retry(item.id)));
  if(item.status==='unconfirmed'&&!item.holdResolved)actions.append(smallButton(t('已核对，恢复发送','Checked, unlock sending'),()=>api.resolve(item.id)));
  if(actions.childElementCount)row.append(actions);
  for(const reply of item.replies??[])row.append(el('p','reply',reply.text));
  list.append(row);
 }
 pageEl.append(list);content.append(pageEl);
 inboxAvatarObserver=new IntersectionObserver(entries=>{
  for(const entry of entries){if(!entry.isIntersecting){clearHost(entry.target);continue;}mountHost(entry.target);}
 },{root:content,rootMargin:'80px 0px'});
 for(const face of list.querySelectorAll('.face-host'))inboxAvatarObserver.observe(face);
}
function inboxBotFilter(){
 const wrap=el('div','bot-filter'),field=el('div','bot-filter-field'),input=el('input','bot-filter-input'),menu=el('div','bot-filter-menu');
 const current=()=>state.bots.find(bot=>bot.id===inboxBot);
 input.type='search';input.spellcheck=false;input.autocomplete='off';input.placeholder=t('搜索 Bot','Search Bots');
 input.setAttribute('role','combobox');input.setAttribute('aria-expanded','false');input.setAttribute('aria-label',t('筛选 Bot','Filter by Bot'));
 input.value=current()?.name??'';
 menu.hidden=true;menu.setAttribute('role','listbox');
 let query='',highlight=0;
 const rows=()=>{
  const q=query.trim().toLocaleLowerCase();
  const bots=orderedBots().filter(bot=>!q||bot.name.toLocaleLowerCase().includes(q));
  return [...(q?[]:[{id:'',name:t('全部','All'),bot:null}]),...bots.map(bot=>({id:bot.id,name:bot.name,bot}))];
 };
 let observer;
 const dropAvatars=root=>{observer?.disconnect();for(const face of root.querySelectorAll('.face-host'))clearHost(face);};
 const watchFaces=()=>{
  observer?.disconnect();
  observer=new IntersectionObserver(entries=>{
   for(const entry of entries){if(!entry.isIntersecting){clearHost(entry.target);continue;}mountHost(entry.target);}
  },{root:menu,rootMargin:'48px 0px'});
  for(const face of menu.querySelectorAll('.face-host'))observer.observe(face);
 };
 const choose=id=>{inboxBot=id;render();};
 const close=()=>{menu.hidden=true;input.setAttribute('aria-expanded','false');query='';input.value=current()?.name??'';dropAvatars(menu);menu.replaceChildren();};
 const mark=scroll=>{
  const options=[...menu.querySelectorAll('.bot-filter-option')];
  options.forEach((option,index)=>{const selected=option.dataset.id===inboxBot;option.classList.toggle('highlighted',index===highlight);option.classList.toggle('selected',selected);option.setAttribute('aria-selected',String(selected));});
  if(scroll)options[highlight]?.scrollIntoView({block:'nearest'});
 };
 const paint=()=>{
  dropAvatars(menu);menu.replaceChildren();
  const list=rows();
  if(!list.length){menu.append(el('p','bot-filter-empty',t('没有匹配的 Bot','No matching Bots')));return;}
  highlight=Math.min(highlight,list.length-1);
  list.forEach((row,index)=>{
   const option=el('button',`bot-filter-option${row.id===inboxBot?' selected':''}${index===highlight?' highlighted':''}`);
   option.type='button';option.dataset.id=row.id;option.setAttribute('role','option');option.setAttribute('aria-selected',String(row.id===inboxBot));
   if(row.bot){const face=el('div','face-host');face.dataset.bot=row.bot.id;face.dataset.size='24';option.append(face);}else option.append(el('span','bot-filter-spacer'));
   option.append(el('span','bot-filter-name',row.name));
   option.addEventListener('click',()=>choose(row.id));
   option.addEventListener('pointerenter',()=>{if(highlight===index)return;highlight=index;mark(false);});
   menu.append(option);
  });
  watchFaces();
  mark(true);
 };
 const open=()=>{
  if(menu.hidden){query='';input.value='';highlight=Math.max(0,rows().findIndex(row=>row.id===inboxBot));}
  menu.hidden=false;input.setAttribute('aria-expanded','true');paint();
 };
 input.addEventListener('focus',open);
 input.addEventListener('input',()=>{query=input.value;highlight=0;open();});
 input.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close();input.blur();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(menu.hidden)open();const list=rows();highlight=event.key==='ArrowDown'?Math.min(highlight+1,Math.max(list.length-1,0)):Math.max(highlight-1,0);mark(true);return;}
  if(event.key==='Enter'&&!menu.hidden){const list=rows();if(!list.length)return;event.preventDefault();choose(list[Math.min(highlight,list.length-1)].id);}
 });
 if(current()){
  const clear=el('button','bot-filter-clear','×');clear.type='button';clear.setAttribute('aria-label',t('查看全部','Show all'));
  clear.addEventListener('click',()=>{if(!menu.hidden&&query){query='';input.value='';highlight=0;input.focus();paint();return;}choose('');});field.append(input,clear);
 }else field.append(input);
 const toggle=el('button','bot-filter-toggle');toggle.type='button';toggle.setAttribute('aria-label',t('选择 Bot','Choose a Bot'));
 toggle.addEventListener('mousedown',event=>event.preventDefault());
 toggle.addEventListener('click',()=>{if(menu.hidden){input.focus();open();}else{close();input.blur();}});
 field.append(toggle);wrap.append(field,menu);
 inboxFilterController=new AbortController();
 document.addEventListener('pointerdown',event=>{if(!wrap.contains(event.target))close();},{capture:true,signal:inboxFilterController.signal});
 return wrap;
}
function settingsTabBar(){
 const tabs=[['general',t('常规','General')],['shortcuts',t('快捷键','Shortcuts')],['composer',t('输入框','Composer')],...(state.host?.platform==='darwin'?[['share',t('分享菜单','Share menu')]]:[]),['toolbox',t('工具箱','Toolbox')]];
 const aliases={account:'general',appearance:'general',cli:'toolbox',wechat:'share'};
 if(aliases[settingsTab])settingsTab=aliases[settingsTab];
 if(!tabs.some(([id])=>id===settingsTab))settingsTab='general';
 const tablist=el('div','settings-tabs');
 tablist.setAttribute('role','tablist');tablist.setAttribute('aria-label',t('设置分组','Settings sections'));
 tabs.forEach(([id,label],index)=>{
  const tab=el('button',`settings-tab${settingsTab===id?' selected':''}`,label);
  tab.type='button';tab.id=`settings-tab-${id}`;tab.dataset.settingsTab=id;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(settingsTab===id));tab.setAttribute('aria-controls','settings-panel');tab.tabIndex=settingsTab===id?0:-1;
  tab.addEventListener('click',()=>{settingsTab=id;render();});
  tab.addEventListener('keydown',event=>{
   let next=index;
   if(event.key==='ArrowRight')next=(index+1)%tabs.length;
   else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
   else if(event.key==='Home')next=0;
   else if(event.key==='End')next=tabs.length-1;
   else return;
   event.preventDefault();
   settingsTab=tabs[next][0];
   render();
   document.getElementById(`settings-tab-${settingsTab}`)?.focus();
  });
  tablist.append(tab);
 });
 return tablist;
}
function sourceDefaultsPanel(){
 const panel=el('section','group');
 panel.append(settingRow(t('来源','Sources'),el('span'),t('WhatsApp 和通用来源可以各自指定默认 Bot 和一段前缀。分享时点哪个 Bot 就交给哪个；默认 Bot 会打开对应来源。WhatsApp 导出会带上来源标记 WhatsApp 和这里的前缀。其他分享走通用来源。','WhatsApp and the general source can each have a default Bot and a prefix. The Bot you tap in the share sheet still receives that share; the default Bot turns that source on. A WhatsApp export carries the WhatsApp tag and this prefix. Other shares use the general source.')));
 for(const [source,label] of [['share',t('通用','General')],['whatsapp','WhatsApp']]){
  const current=state.sourceDefaults?.[source]??{botId:'',prefix:''};
  const picker=el('div','source-picker');
  const choose=(botId,prefix)=>{
   const previous=state.sourceDefaults;
   void run(async()=>{
    try{await api.setSourceDefaults({[source]:{botId,prefix}});}
    catch(error){state.sourceDefaults=previous;render();throw error;}
   });
  };
  const none=el('button',`source-chip${current.botId?'':' selected'}`,t('未指定','None'));
  none.type='button';none.setAttribute('aria-pressed',String(!current.botId));
  none.addEventListener('click',()=>choose('',current.prefix));
  picker.append(none);
  for(const bot of orderedBots()){
   const chip=el('button',`source-chip${current.botId===bot.id?' selected':''}`,bot.name);
   chip.type='button';chip.setAttribute('aria-pressed',String(current.botId===bot.id));
   chip.addEventListener('click',()=>choose(bot.id,current.prefix));
   picker.append(chip);
  }
  panel.append(settingRow(t(`${label}默认 Bot`,`${label} default Bot`),picker));
  const prefix=el('input','prefix');
  prefix.placeholder=t('例如：整理要点、痛点和可做的选题','For example: list the decisions and open questions');
  prefix.setAttribute('aria-label',t(`${label}前缀`,`${label} prefix`));
  prefix.value=current.prefix??'';
  prefix.addEventListener('change',()=>choose(current.botId,prefix.value));
  panel.append(settingRow(t(`${label}前缀`,`${label} prefix`),prefix));
 }
 return panel;
}
function whatsAppWatchPanel(){
 const watch=state.whatsappWatch??{enabled:false,path:'',usingDefault:true};
 const panel=el('section','group');
 panel.append(hostSwitch(t('自动导入 WhatsApp 导出','Auto-import WhatsApp exports'),t('监视文件夹里新出现、并且已经写完的 WhatsApp 导出，交给 WhatsApp 的默认 Bot，前缀和分享导入相同。不会移动或删除原来的文件。','Watches for WhatsApp exports that appear after this is on, once the file has finished writing, and gives them to the WhatsApp default Bot with that prefix. The original files stay where they are.'),!!watch.enabled,t('自动导入 WhatsApp 导出','Auto-import WhatsApp exports'),next=>api.setWhatsAppWatch({enabled:next})));
 const copy=el('div','group-copy');
 copy.append(el('div','group-label',t('文件夹','Folder')),el('div','watch-path',watch.path||'~/Downloads'),el('div','group-help',watch.usingDefault?t('默认是下载文件夹。换文件夹后，只导入之后新出现的文件。','Downloads is the default. After a folder change, only files that appear later are imported.'):t('换文件夹后，只导入之后新出现的文件。','After a folder change, only files that appear later are imported.')));
 const choose=smallButton(t('选择文件夹','Choose folder'),()=>api.chooseWhatsAppWatchDir());
 const reset=smallButton(t('恢复为下载文件夹','Reset to Downloads'),()=>api.setWhatsAppWatch({resetDir:true}),'secondary');
 reset.disabled=!!watch.usingDefault;
 const buttons=el('div','row-actions');buttons.append(choose,reset);
 panel.append(el('div','group-row',''));panel.lastChild.append(copy,buttons);
 return panel;
}
function hostSwitch(label,help,checked,aria,apply){
 const row=el('div','group-row'),copy=el('div','group-copy');
 copy.append(el('div','group-label',label));
 if(help)copy.append(el('div','group-help',help));
 const input=el('input','switch');input.type='checkbox';input.checked=checked;input.setAttribute('aria-label',aria);
 input.addEventListener('change',()=>{const next=input.checked;run(async()=>{try{await apply(next);}catch(error){input.checked=!next;throw error;}});});
 row.append(copy,input);return row;
}
function renderSettings(content){
 const pageEl=el('div','page');
 pageEl.append(settingsTabBar());
 const panel=el('div','settings-panel');
 panel.id='settings-panel';
 panel.setAttribute('role','tabpanel');
 panel.setAttribute('aria-labelledby',`settings-tab-${settingsTab}`);
 const account=el('section','group'),accountRow=el('div','group-row'),name=el('div'),heading=el('div','account-heading');
 heading.append(el('span',`account-dot${state.connected?' connected':''}`),el('span','group-label',state.account?.name??t('尚未连接','Not connected')));
 name.append(heading,el('div','group-help',state.connected?t('账号已连接','Connected'):t('登录后同步 Bot','Sign in to sync Bots')));
 const actions=el('div','row-actions');
 if(state.connected)actions.append(smallButton(t('退出','Sign out'),()=>api.logout()));
 else{actions.append(loginButton());if(state.host?.platform==='darwin')actions.append(smallButton(t('本机登录','Local login'),()=>api.desktopLogin()));}
 accountRow.append(name,actions);account.append(accountRow);
 account.append(hostSwitch(t('开机自启动','Launch at login'),t('登录这台电脑后在后台打开。','Opens in the background when you sign in to this computer.'),!!state.host?.openAtLogin,t('开机自启动','Launch at login'),next=>api.setOpenAtLogin(next)));

 const appearance=el('section','group'),themeRow=el('div','group-row');themeRow.append(el('span','group-label',t('外观','Appearance')));
 const themes=el('div','segment');
 for(const [value,label] of [['system',t('系统','System')],['light',t('白','Light')],['dark',t('黑','Dark')]]){
  const choice=el('button',state.theme===value?'selected':'',label);choice.type='button';choice.addEventListener('click',()=>run(()=>api.theme(value)));themes.append(choice);
 }
 themeRow.append(themes);appearance.append(themeRow);if(settingsTab==='general')panel.append(account,appearance,sourceDefaultsPanel(),whatsAppWatchPanel());
 const keys=el('section','group');
 keys.append(shortcutRow('compose',t('通用快捷键','General shortcut'),t('打开上次用过的 Bot。点按键，再按下组合。Esc 取消。','Opens the Bot you used last. Click the key, then press a combination. Esc cancels.')));
 keys.append(shortcutRow('open',t('在 Grok Bot 中打开','Open in Grok Bot'),t('打开上次选中的 Bot。链接是 grokbot://app/v1/agent?id= 加上这个 Bot 的编号。','Opens the Bot you selected last. The link is grokbot://app/v1/agent?id= plus that Bot id.')));
 if(state.host?.platform==='darwin')keys.append(hostSwitch(t('常驻 Touch Bar','Keep on the Touch Bar'),t('切到别的应用时，Touch Bar 上仍保留 Bot。点一下当前 Bot 会打开悬浮输入框。','The Touch Bar keeps the Bots while another app is in front. Press the current Bot to open the floating composer.'),!!state.host?.touchBarPinned,t('常驻 Touch Bar','Keep on the Touch Bar'),next=>api.setTouchBarPinned(next)));
 if(settingsTab==='shortcuts')panel.append(keys);
 const prefs=state.composerPrefs??{afterSend:'hide',dismissOnOutside:true};
 const behavior=el('section','group'),afterRow=el('div','group-row'),afterCopy=el('div','group-copy');
 afterCopy.append(el('div','group-label',t('发送后','After sending')),el('div','group-help',t('默认隐藏输入框。单个 Bot 可以覆盖这个设置。','The composer hides by default. Each Bot can override this.')));
 const after=el('div','segment');
 for(const [value,label] of [['hide',t('隐藏输入框','Hide composer')],['open',t('打开 Grok Bot','Open Grok Bot')]]){
  const choice=el('button',(prefs.afterSend??'hide')===value?'selected':'',label);choice.type='button';
  choice.addEventListener('click',()=>run(()=>api.setComposerPrefs({afterSend:value,dismissOnOutside:prefs.dismissOnOutside!==false})));
  after.append(choice);
 }
 afterRow.append(afterCopy,after);behavior.append(afterRow);
 const dismissRow=el('div','group-row'),dismissCopy=el('div');
 dismissCopy.append(el('div','group-label',t('点按外部关闭','Click outside closes')),el('div','group-help',t('关掉以后，悬浮输入框会显示关闭按钮。','When this is off, the floating composer shows a close button.')));
 const dismiss=el('input','switch');dismiss.type='checkbox';dismiss.checked=prefs.dismissOnOutside!==false;dismiss.setAttribute('aria-label',t('点按外部关闭','Click outside closes'));
 dismiss.addEventListener('change',()=>run(()=>api.setComposerPrefs({afterSend:prefs.afterSend??'hide',dismissOnOutside:dismiss.checked})));
 dismissRow.append(dismissCopy,dismiss);behavior.append(dismissRow);if(settingsTab==='composer')panel.append(behavior);
 const cli=state.host?.cli??{enabled:false,credential:false},cliPanel=el('section','group'),cliRow=el('div','group-row'),cliCopy=el('div');
 const cliPlain=t('命令行使用的登录信息会以明文保存在本机用户目录。新开的终端才会使用新的命令路径。','The login used by the command line is stored in plain text in this computer\'s user folder. New terminals pick up the new command path.');
 const cliHelp=`${cli.enabled?(cli.credential?t('已注册 grok-bot。命令使用当前登录，不需要再登录。','grok-bot is registered and uses this login.'):t('已注册 grok-bot。登录后，命令会使用这个账号。','grok-bot is registered. Sign in and the command uses that account.')):t('开启后注册 grok-bot，把 skill 装到全局技能目录，并在 Claude Code 里加上软链接。运行环境由本应用提供。','Turn this on to register grok-bot, install the skill, and link it for Claude Code. This app provides the runtime.')} ${cliPlain}`;
 cliCopy.append(el('div','group-label',t('命令行','Command line')),el('div','group-help',cliHelp));
 const cliSwitch=el('input','switch');cliSwitch.type='checkbox';cliSwitch.checked=!!cli.enabled;cliSwitch.setAttribute('aria-label',t('命令行','Command line'));
 cliSwitch.addEventListener('change',()=>{const next=cliSwitch.checked;run(async()=>{try{await api.setCli(next);}catch(error){cliSwitch.checked=!next;throw error;}});});
 cliRow.append(cliCopy,cliSwitch);cliPanel.append(cliRow);
 if(settingsTab==='share'&&state.host?.platform==='darwin'){
  const menu=state.host.menu??{},wechatPanel=el('section','group'),row=el('div','group-row'),info=el('div');
  info.append(el('div','group-label',t('分享菜单','Share menu')),el('div','group-help',!menu.available?t('这个版本没有分享扩展','Sharing extensions are not in this build'):menu.busy?t('正在同步菜单','Syncing the menu'):menu.needsUpdate?t('设置已保存，需要重新同步','Saved. Sync to update.'):t(`已启用 ${menu.registered??0} 个入口。WhatsApp 和通用来源共用这 12 个槽。`,`${menu.registered??0} destinations on. WhatsApp and the general source share these 12 slots.`)));
  const update=smallButton(t('重新同步','Sync again'),async()=>{update.disabled=true;try{const result=await api.updateMenu();toast(t(`已同步 ${result.registered} 个入口。若系统分享里没变化，请完全退出正在使用的应用再打开；系统会缓存旧的分享菜单。`,`Synced ${result.registered} destinations. If the share sheet still shows the old menu, quit that app completely and reopen it; the system caches the sharing menu.`));}catch{}finally{update.disabled=false;}});
  update.disabled=!menu.available||menu.busy||!!state.accountBusy;row.append(info,update);wechatPanel.append(row);
  const read=smallButton(menuReading?t('正在读取','Reading'):t('读取当前顺序','Read current order'),readMenuOrder);
  read.disabled=menuReading;
  wechatPanel.append(settingRow(t('菜单顺序','Menu order'),read,t('读取系统分享里现在的顺序。排好以后，按这个顺序重新注册菜单。最多 12 个。','Read the current share-sheet order. After you sort, the menu is registered in that order. Up to 12.')));
  const menuBots=shareMenuBots();
  menuBots.forEach((bot,index)=>{
   const line=el('div','menu-order-row'),buttons=el('div','order-buttons');
   const up=el('button','icon-button');up.type='button';up.disabled=index===0;up.setAttribute('aria-label',t('前移','Earlier'));up.append(icon('up'));
   up.addEventListener('click',()=>run(()=>moveMenu(bot.id,-1)));
   const down=el('button','icon-button');down.type='button';down.disabled=index===menuBots.length-1;down.setAttribute('aria-label',t('后移','Later'));down.append(icon('down'));
   down.addEventListener('click',()=>run(()=>moveMenu(bot.id,1)));
   buttons.append(up,down);line.append(el('span','menu-order-name',bot.name),buttons);wechatPanel.append(line);
  });
  const diagnose=el('section','group');
  const copyLog=smallButton(t('复制报错日志','Copy error log'),async()=>{
   copyLog.disabled=true;
   try{const result=await api.copyDiagnostics();toast(t(`已复制 ${result.characters} 个字符，可以直接粘贴给维护者。`,`Copied ${result.characters} characters. Paste it to the maintainer.`));}
   catch{toast(t('复制失败','Could not copy'));}
   finally{copyLog.disabled=false;}
  });
  diagnose.append(settingRow(t('排查','Troubleshoot'),copyLog,t('复制分享菜单状态、宿主版本和最近一次更新错误。可能包含本机路径，不包含登录凭据。','Copies share-menu status, host build and the latest update error. May include local paths, never credentials.')));
  panel.append(wechatPanel,diagnose);
 }
 if(settingsTab==='toolbox'){
  const plans=toolboxShareOff(state.bots??[],state.recipients??[]);
  const tool=el('section','group');
  const row=el('div','group-row'),copy=el('div','group-copy');
  copy.append(el('div','group-label',t('关闭接收转发','Turn off receive-forward')),el('div','group-help',plans.length?t('关掉每个已开启接收转发的 Bot。来源、方式和前缀都留着，可以再打开。','Turns off receive-forward for every Bot that has it on. Sources, mode, and prefix stay, so you can turn them back on.'):t('没有已开启接收的 Bot','No Bot is receiving.')));
  const turnOff=smallButton(t('一键关闭','Turn off all'),disableAllShare,'secondary');
  turnOff.disabled=!plans.length;
  row.append(copy,turnOff);
  tool.append(row);panel.append(tool,cliPanel);
  if(state.host?.platform==='win32'){
   const menuOn=state.host?.explorerMenu!==false;
   const windows=el('section','group');
   const help=t('在资源管理器的文件右键菜单里显示已开启接收转发的 Bot。如果别的程序的菜单显示异常，先点『全部移除』再重启那个程序，确认是不是它引起的。','Shows Bots that receive forwards in the Explorer file menu. If another app\'s menu looks wrong, choose Remove all, restart that app, and see if that was the cause.');
   const toggle=el('input','switch');toggle.type='checkbox';toggle.checked=menuOn;toggle.setAttribute('aria-label',t('在资源管理器右键菜单显示','Show in the Explorer menu'));
   toggle.addEventListener('change',()=>{const next=toggle.checked;run(async()=>{try{await api.explorerMenu({action:'set',enabled:next});}catch(error){toggle.checked=!next;throw error;}});});
   windows.append(settingRow(t('Windows 右键菜单','Windows menu'),toggle,help));
   const actions=el('div','row-actions');
   actions.append(smallButton(t('重建','Rebuild'),async()=>{await api.explorerMenu({action:'rebuild'});toast(t('已重建','Rebuilt'));}),smallButton(t('全部移除','Remove all'),async()=>{
    const confirmed=await askConfirm({title:t('移除资源管理器右键菜单？','Remove the Explorer menu?'),body:t('会清掉本应用写过的右键菜单，并关掉「在资源管理器右键菜单显示」。','This removes the menus this app wrote and turns off Show in the Explorer menu.'),confirmLabel:t('全部移除','Remove all')});
    if(!confirmed)return;
    await api.explorerMenu({action:'remove'});
    toast(t('已移除','Removed'));
   },'secondary'));
   windows.append(el('div','group-row',''));
   windows.lastChild.append(actions);
   panel.append(windows);
  }
 }
 pageEl.append(panel);
 content.append(pageEl);
}
function botAccent(bot){
 const mode=state.theme==='dark'||(state.theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';
 const hex=colorHex(bot.avatarColor||'',mode);
 return typeof hex==='string'&&hex.startsWith('#')?hex:'#059669';
}
function accentInk(hex){
 let text=String(hex||'').trim();
 if(/^#[0-9a-f]{3}$/i.test(text))text=`#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
 const value=Number.parseInt(text.slice(1,7),16);
 if(!Number.isFinite(value))return '#fff';
 const channel=part=>part<=0.03928?part/12.92:((part+0.055)/1.055)**2.4;
 const r=channel(((value>>16)&255)/255),g=channel(((value>>8)&255)/255),b=channel((value&255)/255);
 const luminance=0.2126*r+0.7152*g+0.0722*b;
 return (1.05)/(luminance+0.05)<1.4?'#111':'#fff';
}
function loginButton(){return smallButton(busy?t('正在登录…','Signing in…'):t('连接账号','Connect'),async()=>{busy=true;render();try{await api.login();}finally{busy=false;render();}},'primary');}
function smallButton(text,action,className='text-button'){const button=el('button',className,text);button.type='button';button.addEventListener('click',()=>run(action));return button;}
function closeMoreMenu(){
 if(!moreMenu)return;
 const current=moreMenu;moreMenu=null;current.cleanup();
 current.menu.remove();current.anchor.setAttribute('aria-expanded','false');
}
function positionMoreMenu(){
 if(!moreMenu)return;
 const {menu,anchor}=moreMenu,rect=anchor.getBoundingClientRect();
 const width=menu.offsetWidth,height=menu.offsetHeight;
 let left=Math.min(Math.max(8,rect.right-width),window.innerWidth-width-8);
 let top=rect.bottom+6;
 if(top+height>window.innerHeight-8)top=Math.max(8,rect.top-height-6);
 menu.style.left=`${Math.round(left)}px`;menu.style.top=`${Math.round(top)}px`;
}
function openMoreMenu(bot,anchor){
 closeMoreMenu();
 const menu=el('div','more-menu');menu.id='bot-more-menu';menu.setAttribute('role','menu');menu.tabIndex=-1;
 const item=(label,iconName,action)=>{
  const button=el('button','more-item');button.type='button';button.setAttribute('role','menuitem');
  button.append(icon(iconName),el('span','',label));
  button.addEventListener('click',event=>{event.stopPropagation();closeMoreMenu();action();});
  menu.append(button);return button;
 };
 item(t('查看发送记录','View send history'),'history',()=>{inboxBot=bot.id;page='inbox';render();$('content').scrollTop=0;});
 if(!isGroup(bot))item(t('复制此 Bot','Copy this Bot'),'copy',()=>{void copyBot(bot.id);});
 if(canEditAvatar(bot))item(t('编辑头像','Edit avatar'),'pencil',()=>openAvatarEditor(bot,anchor));
 item(t('查看详情','View details'),'info',()=>openBotDetail(bot.id,anchor));
 const outside=event=>{if(menu.contains(event.target)||anchor.contains(event.target))return;closeMoreMenu();};
 const nearby=()=>positionMoreMenu();
 const closeOnScroll=event=>{if(menu.contains(event.target))return;closeMoreMenu();};
 document.addEventListener('pointerdown',outside,true);
 window.addEventListener('resize',closeMoreMenu);
 window.addEventListener('scroll',closeOnScroll,true);
 const cleanup=()=>{
  document.removeEventListener('pointerdown',outside,true);
  window.removeEventListener('resize',closeMoreMenu);
  window.removeEventListener('scroll',closeOnScroll,true);
 };
 menu.addEventListener('keydown',event=>{
  const items=[...menu.querySelectorAll('.more-item')];const index=items.indexOf(document.activeElement);
  if(event.key==='Escape'){event.preventDefault();closeMoreMenu();anchor.focus();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();const next=event.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;items[next]?.focus();return;
  }
  if(event.key==='Home'){event.preventDefault();items[0]?.focus();return;}
  if(event.key==='End'){event.preventDefault();items.at(-1)?.focus();}
 });
 moreMenu={botId:bot.id,anchor,menu,cleanup};
 anchor.setAttribute('aria-expanded','true');
 document.body.append(menu);
 positionMoreMenu();
 requestAnimationFrame(()=>{if(!moreMenu)return;moreMenu.menu.querySelector('.more-item')?.focus();});
}
function moreButton(bot){
 const button=el('button','secondary more-button');button.type='button';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
 button.append(el('span','',t('更多','More')),icon('down'));
 button.addEventListener('click',event=>{event.stopPropagation();if(moreMenu?.anchor===button)closeMoreMenu();else openMoreMenu(bot,button);});
 return button;
}
function openBotDetail(botId,opener){
 const bot=state.bots?.find(item=>item.id===botId);if(!bot)return;
 closeMoreMenu();
 botDetail={bot,opener:opener instanceof HTMLElement?opener:null};
 paintOverlay();
}
function canEditAvatar(bot){
 return !!bot&&!isGroup(bot)&&bot.avatar?.kind!=='picture'&&bot.viewerCanManage!==false&&!state.host?.preview;
}
function openAvatarEditor(bot,opener){
 if(!canEditAvatar(bot))return;
 closeMoreMenu();
 const initialShape=bot.avatarShape||bot.avatar?.character?.shape||'blob';
 const initialColor=bot.avatarColor||bot.avatar?.character?.color||'brown';
 avatarEditor={botId:bot.id,shape:SHAPES.includes(initialShape)?initialShape:'blob',color:COLORS.some(item=>item.id===initialColor)?initialColor:'brown',saving:false,error:'',opener:opener instanceof HTMLElement?opener:null};
 paintOverlay();
}
function closeAvatarEditor(){
 if(!avatarEditor)return;
 const opener=avatarEditor.opener;avatarEditor=null;paintOverlay();focusOpener(opener);
}
async function saveAvatarEditor(){
 const current=avatarEditor;if(!current||current.saving)return;
 current.saving=true;current.error='';paintOverlay();
 try{
  const next=await api.updateBotAvatar(current.botId,current.shape,current.color);
  state=next;
  if(botDetail&&botDetail.bot?.id===current.botId){const updated=state.bots?.find(item=>item.id===current.botId);if(updated)botDetail={...botDetail,bot:updated};}
  avatarEditor=null;render();paintOverlay();toast(t('头像已更新','Avatar updated'));
 }catch(error){
  current.saving=false;const pair=errorMessages[error.message];current.error=pair?t(...pair):t('没有保存，请重试。','Could not save. Try again.');paintOverlay();
 }
}
function paintAvatarEditor(layer){
 const editor=avatarEditor;if(!editor)return;
 const card=el('section','avatar-editor-card');
 card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label',t('编辑头像','Edit avatar'));
 const head=el('header','avatar-editor-head');
 const title=el('div','avatar-editor-titles');
 title.append(el('h2','avatar-editor-title',t('编辑头像','Edit avatar')),el('p','avatar-editor-subtitle',t('选择形状和颜色','Choose a shape and color')));
 const close=el('button','icon-button');close.type='button';close.setAttribute('aria-label',t('关闭头像编辑','Close avatar editor'));close.append(icon('close'));close.addEventListener('click',closeAvatarEditor);
 head.append(title,close);
 const preview=el('div','avatar-editor-preview');
 const previewFace=el('div','avatar-preview');
 previewFace.innerHTML=renderAvatarSvg({shape:editor.shape,color:editor.color,size:96,id:'avatar-editor-preview',theme:themeName()});
 preview.append(previewFace,el('p','avatar-editor-current',`${shapeLabel(editor.shape)} · ${colorLabel(editor.color)}`));
 const body=el('div','avatar-editor-body');
 const shapeSection=el('section','avatar-editor-section');
 shapeSection.setAttribute('role','group');shapeSection.setAttribute('aria-label',t('形状','Shape'));
 const grid=el('div','avatar-shape-grid');
 for(const shape of SHAPES){
  const selected=shape===editor.shape;
  const button=el('button',`avatar-shape-cell${selected?' selected':''}`);button.type='button';button.dataset.shape=shape;button.disabled=editor.saving;
  button.setAttribute('aria-label',shapeLabel(shape));button.setAttribute('aria-pressed',String(selected));button.title=shapeLabel(shape);
  button.innerHTML=renderAvatarSvg({shape,color:editor.color,size:36,id:`avatar-editor-shape-${shape}`,theme:themeName()});
  button.addEventListener('click',()=>{if(editor.saving)return;avatarEditor.shape=shape;paintOverlay();queueMicrotask(()=>layer.querySelector(`.avatar-shape-cell[data-shape="${shape}"]`)?.focus());});
  grid.append(button);
 }
 shapeSection.append(grid);
 const colorSection=el('section','avatar-editor-section');
 colorSection.setAttribute('role','group');colorSection.setAttribute('aria-label',t('颜色','Color'));
 const colorRow=el('div','avatar-color-row');
 for(const color of COLORS){
  const selected=color.id===editor.color;
  const button=el('button',`avatar-color-cell${selected?' selected':''}`);button.type='button';button.dataset.color=color.id;button.disabled=editor.saving;
  button.setAttribute('aria-label',colorLabel(color.id));button.setAttribute('aria-pressed',String(selected));button.title=colorLabel(color.id);
  const swatch=el('span','avatar-color-swatch');swatch.style.background=colorHex(color.id,themeMode())||color.value;button.append(swatch);
  button.addEventListener('click',()=>{if(editor.saving)return;avatarEditor.color=color.id;paintOverlay();queueMicrotask(()=>layer.querySelector(`.avatar-color-cell[data-color="${color.id}"]`)?.focus());});
  colorRow.append(button);
 }
 colorSection.append(colorRow);
 body.append(shapeSection,colorSection);
 if(editor.error)body.append(el('p','avatar-editor-error',editor.error));
 const footer=el('footer','avatar-editor-footer');
 const cancel=el('button','secondary',t('取消','Cancel'));cancel.type='button';cancel.disabled=editor.saving;cancel.addEventListener('click',closeAvatarEditor);
 const save=el('button','primary',editor.saving?t('正在保存…','Saving…'):t('保存','Save'));save.type='button';save.disabled=editor.saving;save.addEventListener('click',saveAvatarEditor);
 footer.append(cancel,save);
 card.append(head,preview,body,footer);layer.append(card);
 layer.setAttribute('aria-label',t('编辑头像','Edit avatar'));
 layer.onclick=event=>{if(event.target===layer)closeAvatarEditor();};
 queueMicrotask(()=>{const selected=card.querySelector('.avatar-shape-cell[aria-pressed="true"]');(selected??close).focus();});
}
function closeBotDetail(){
 if(!botDetail)return;
 if(avatarEditor)avatarEditor=null;
 const opener=botDetail.opener;botDetail=null;paintOverlay();focusOpener(opener);
}
function shortcutRow(slot,label,help){
 const shown=slot==='compose'?state.shortcuts?.compose:slot==='open'?state.shortcuts?.open:slot.startsWith('grok:')?state.shortcuts?.opens?.[slot.slice(5)]:state.shortcuts?.bots?.[slot];
 const recording=recordingSlot===slot;
 const cap=el('button',`keycap${recording?' recording':''}`,recording?t('请按键','Press keys'):(shown?formatAccelerator(shown,state.host?.platform):t('未设置','None')));
 cap.type='button';cap.addEventListener('click',()=>{if(recordingSlot===slot)void finishRecording(null);else void beginRecording(slot);});
 const actions=el('div','row-actions');
 actions.append(cap,smallButton(t('清除','Clear'),()=>api.setShortcut(slot,'')));
 return settingRow(label,actions,help);
}
function shareMenuBots(){return orderedBots().filter(bot=>{const recipient=recipientOf(bot.id);return recipient?.enabled&&(recipient.sources?.share||recipient.sources?.whatsapp);}).slice(0,12);}
async function applyBotOrder(ids){
 for(let position=0;position<ids.length;position++)if((recipientOf(ids[position])?.order??0)!==position)await api.configure(ids[position],{order:position});
}
async function moveMenu(id,delta){
 const ids=shareMenuBots().map(bot=>bot.id),index=ids.indexOf(id),next=index+delta;
 if(index<0||next<0||next>=ids.length)return;
 const order=ids.slice();const [moved]=order.splice(index,1);order.splice(next,0,moved);
 await applyBotOrder(spliceWechatOrder(orderedBots().map(bot=>bot.id),ids,order));
}
async function readMenuOrder(){
 if(menuReading)return;
 menuReading=true;render();
 try{
  const result=await api.menuOrder();
  const message={system:t('已按系统分享里的顺序排好','Sorted to match the share sheet.'),installed:t('已按当前安装的菜单排好','Sorted to match the installed menu.'),settings:t('没有读到系统分享菜单','Could not read the share menu.')}[result?.source]??t('没有读到系统分享菜单','Could not read the share menu.');
  if(result?.source==='system'||result?.source==='installed')await applyBotOrder(spliceWechatOrder(orderedBots().map(bot=>bot.id),shareMenuBots().map(bot=>bot.id),result.ids??[]));
  toast(message);
 }finally{menuReading=false;render();}
}
async function beginRecording(slot){recordingSlot=slot;render();try{await api.suppressShortcuts(true);}catch{recordingSlot=null;render();}}
async function finishRecording(accelerator){
 const slot=recordingSlot;
 if(!slot&&accelerator==null)return;recordingSlot=null;
 try{if(accelerator&&slot)await api.setShortcut(slot,accelerator);}
 catch(error){const pair=errorMessages[error.message];toast(pair?t(...pair):t('操作没有完成，请重试。','The operation did not complete. Please try again.'));}
 finally{try{await api.suppressShortcuts(false);}catch{}render();}
}
function attachOverlayScroll(scroller){
 if(!scroller||scroller.dataset.overlayScroll)return;
 scroller.dataset.overlayScroll='1';
 const thumb=el('div','overlay-thumb');
 thumb.setAttribute('aria-hidden','true');
 document.body.append(thumb);
 let hideTimer=0;
 const layout=()=>{
  if(!scroller.isConnected){cleanup();return;}
  const rect=scroller.getBoundingClientRect();
  const overflow=scroller.scrollHeight-scroller.clientHeight;
  if(overflow<=1||rect.height<24||rect.width<8){thumb.hidden=true;return;}
  thumb.hidden=false;
  const bar=Math.max(28,Math.round(rect.height*(scroller.clientHeight/scroller.scrollHeight)));
  const travel=Math.max(1,rect.height-bar);
  const top=rect.top+(scroller.scrollTop/overflow)*travel;
  const sidebar=scroller.id==='grid'?scroller.closest('.sidebar'):null;
  const width=scroller.id==='content'||sidebar?6:4;
  const edge=sidebar?sidebar.getBoundingClientRect().right:rect.right;
  const left=sidebar?edge-width-2:rect.right-width-(scroller.id==='content'?4:2);
  thumb.style.width=`${width}px`;
  thumb.style.height=`${bar}px`;
  thumb.style.left=`${Math.round(left)}px`;
  thumb.style.top=`${Math.round(top)}px`;
 };
 const hoverHost=scroller.id==='grid'?scroller.closest('.sidebar')??scroller:scroller;
 const show=()=>{clearTimeout(hideTimer);thumb.classList.add('visible');};
 const hideSoon=()=>{
  clearTimeout(hideTimer);
  hideTimer=setTimeout(()=>{if(!hoverHost.matches(':hover')&&!thumb.matches(':hover')&&!thumb.classList.contains('dragging'))thumb.classList.remove('visible');},700);
 };
 scroller.addEventListener('scroll',()=>{layout();show();hideSoon();},{passive:true});
 hoverHost.addEventListener('pointerenter',()=>{layout();show();});
 hoverHost.addEventListener('pointerleave',hideSoon);
 const observer=new ResizeObserver(layout);
 observer.observe(scroller);
 thumb.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  event.preventDefault();
  event.stopPropagation();
  thumb.classList.add('dragging');
  show();
  const startY=event.clientY,startScroll=scroller.scrollTop;
  const move=ev=>{
   const room=scroller.scrollHeight-scroller.clientHeight;
   const bar=thumb.getBoundingClientRect().height||28;
   scroller.scrollTop=startScroll+(ev.clientY-startY)*(room/Math.max(1,scroller.clientHeight-bar));
   layout();
  };
  const up=()=>{thumb.classList.remove('dragging');thumb.removeEventListener('pointermove',move);thumb.removeEventListener('pointerup',up);hideSoon();};
  thumb.addEventListener('pointermove',move);
  thumb.addEventListener('pointerup',up);
 });
 function cleanup(){clearTimeout(hideTimer);observer.disconnect();thumb.remove();delete scroller.dataset.overlayScroll;scroller.__overlayLayout=null;}
 scroller.__overlayLayout=layout;
 scroller.__overlayCleanup=cleanup;
 layout();
}
function refreshOverlayScroll(){for(const node of document.querySelectorAll('[data-overlay-scroll]'))node.__overlayLayout?.();}
function mountOverlayScroll(){
 attachOverlayScroll($('content'));
 attachOverlayScroll($('grid'));
 document.querySelectorAll('.bot-filter-menu,.record-text,.reply').forEach(attachOverlayScroll);
 const detach=node=>{
  if(node.nodeType!==1)return;
  if(node.dataset?.overlayScroll&&node.id!=='content'&&node.id!=='grid')node.__overlayCleanup?.();
  node.querySelectorAll?.('[data-overlay-scroll]').forEach(item=>{if(item.id!=='content'&&item.id!=='grid')item.__overlayCleanup?.();});
 };
 const scan=node=>{
  if(node.nodeType!==1)return;
  if(node.matches?.('.bot-filter-menu,.record-text,.reply'))attachOverlayScroll(node);
  node.querySelectorAll?.('.bot-filter-menu,.record-text,.reply').forEach(attachOverlayScroll);
 };
 const changes=new MutationObserver(records=>{
  for(const record of records){
   for(const node of record.removedNodes)detach(node);
   for(const node of record.addedNodes)scan(node);
  }
  refreshOverlayScroll();
 });
 changes.observe($('content'),{childList:true,subtree:true});
 changes.observe($('grid'),{childList:true,subtree:true});
 window.addEventListener('resize',refreshOverlayScroll);
}
$('search').addEventListener('input',()=>{search=$('search').value;render();});
$('search-toggle').addEventListener('click',()=>{searchOpen=!searchOpen;render();});
$('group-toggle').addEventListener('click',()=>{
 grouped=!grouped;
 try{localStorage.setItem('gba.grouped',grouped?'1':'0');}catch{}
 render();
});
function confirmKey(item){return `${item.title}\n${item.body}\n${item.confirmLabel}`;}
function focusOpener(opener){
 if(opener?.isConnected){opener.focus();return;}
 const list=$('grid');
 if(!list)return;
 if(!list.hasAttribute('tabindex'))list.tabIndex=-1;
 list.focus();
}
function askConfirm({title,body,confirmLabel}){
 if(confirmState||copying)return Promise.resolve(false);
 const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const accountId=state?.account?.id??null;
 return new Promise(resolve=>{confirmState={title,body,confirmLabel,resolve,opener,accountId};paintOverlay();});
}
function settleConfirm(value){
 const current=confirmState;
 if(!current){paintOverlay();return;}
 if(value&&!confirmAccountStill(current.accountId,state?.account?.id??null)){
  confirmState=null;paintOverlay();current.resolve(false);
  toast(t('账号已切换，请重试','The account changed. Try again.'));
  return;
 }
 confirmState=null;paintOverlay();current.resolve(value);
}
function setBackgroundInert(on){
 for(const node of document.body.children){
  if(node.id==='app-overlay'||node.id==='toast')continue;
  if(on)node.setAttribute('inert','');
  else node.removeAttribute('inert');
 }
}
function paintOverlay(){
 let layer=document.getElementById('app-overlay');
 if(!copying&&!confirmState&&!botDetail&&!avatarEditor){
  if(!layer)return;
  const opener=layer.__opener??null;
  layer.remove();
  setBackgroundInert(false);
  focusOpener(opener);
  return;
 }
 if(!botDetail&&confirmState&&!copying&&layer?.dataset.confirmKey===confirmKey(confirmState)&&layer.querySelector('.confirm-card')){
  setBackgroundInert(true);
  return;
 }
 if(!layer){layer=el('div','app-overlay');layer.id='app-overlay';document.body.append(layer);}
 layer.setAttribute('role','dialog');
 layer.setAttribute('aria-modal','true');
 layer.__opener=copying?(copyOpener??layer.__opener??null):(avatarEditor?.opener??botDetail?.opener??confirmState?.opener??layer.__opener??null);
 setBackgroundInert(true);
 layer.replaceChildren();
 layer.onclick=null;
 if(avatarEditor){
  paintAvatarEditor(layer);
  return;
 }
 if(botDetail){
  const bot=botDetail.bot,card=el('section','bot-detail-card');
  card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label',t(`${bot.name} 的详情`,`Details for ${bot.name}`));
  const head=el('header','bot-detail-head'),identity=el('div','bot-detail-identity'),face=el('div','bot-detail-avatar');
  face.append(avatar(bot,48));
  const titles=el('div','bot-detail-titles');titles.append(el('h2','bot-detail-name',bot.name),el('p','bot-detail-type',isGroup(bot)?t('群聊','Group'):t('Bot','Bot')));
  identity.append(face,titles);
  const close=el('button','icon-button');close.type='button';close.setAttribute('aria-label',t('关闭详情','Close details'));close.append(icon('close'));close.addEventListener('click',closeBotDetail);
  head.append(identity,close);
  const body=el('div','bot-detail-body');
  body.append(el('h3','bot-detail-section',t('指令描述','Instructions')));
  const markdown=el('div','markdown-body');markdown.innerHTML=renderMarkdown(bot.description||t('这个 Bot 没有描述。','This Bot has no description.'));body.append(markdown);
  const meta=el('dl','bot-detail-meta');
  const addMeta=(label,value)=>{const term=el('dt','',label),detail=el('dd','',value);meta.append(term,detail);};
  addMeta(t('ID','ID'),bot.id);
  addMeta(t('类型','Type'),isGroup(bot)?t('群聊','Group'):t('Bot','Bot'));
  if(isGroup(bot))addMeta(t('成员','Members'),groupMembers(bot,state.bots).map(item=>item.name).join(chinese()?'、':', ')||t('暂无','None'));
  body.append(meta);
  card.append(head,body);layer.append(card);
  layer.setAttribute('aria-label',t(`${bot.name} 的详情`,`Details for ${bot.name}`));
  layer.onclick=event=>{if(event.target===layer)closeBotDetail();};
  queueMicrotask(()=>{if(close.isConnected)close.focus();});
  return;
 }
 if(copying){
  delete layer.dataset.confirmKey;
  const ball=el('div','coal-ball');ball.innerHTML=coalBallSvg();
  layer.append(ball,el('p','copy-status',t('正在复制','Copying')));
  layer.setAttribute('aria-busy','true');
  layer.setAttribute('aria-label',t('正在复制','Copying'));
  return;
 }
 layer.dataset.confirmKey=confirmKey(confirmState);
 layer.removeAttribute('aria-busy');
 const card=el('div','confirm-card');
 card.setAttribute('role','dialog');
 card.setAttribute('aria-modal','true');
 card.append(el('h2','',confirmState.title),el('p','',confirmState.body));
 const row=el('div','row-actions');
 const cancel=smallButton(t('取消','Cancel'),()=>settleConfirm(false),'secondary');
 row.append(cancel,smallButton(confirmState.confirmLabel,()=>settleConfirm(true),'primary'));
 card.append(row);layer.append(card);
 queueMicrotask(()=>{if(cancel.isConnected)cancel.focus();});
}
async function disableAllShare(){
 const plans=toolboxShareOff(state.bots??[],state.recipients??[]);
 if(!plans.length)return;
 const count=plans.length;
 const confirmed=await askConfirm({title:t('关闭所有接收转发？','Turn off receive-forward for every Bot?'),body:t(`会关闭 ${count} 个 Bot 的接收转发，分享菜单和右键菜单里的入口随之消失。拖放来源也会随之关闭。可以在每个 Bot 里重新打开。`,`This turns off receive-forward for ${count} Bots. Entries in the share menu and the right-click menu disappear. Drop sources turn off too. You can turn each Bot back on.`),confirmLabel:t('关闭','Turn off')});
 if(!confirmed)return;
 await run(async()=>{
  const result=await api.disableAllReceive();
  try{state=await api.state();}catch{/* The switches are already off. */}
  render();
  toast(t(`已关闭 ${result?.closed??count} 个`,`Turned off ${result?.closed??count}`));
 });
}
async function copyBot(id){
 const bot=state.bots.find(item=>item.id===id);
 if(!confirmCopy({isRoom:isGroup(bot),confirmed:true}).duplicate)return;
 const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const confirmed=await askConfirm({title:t('复制这个 Bot？','Copy this Bot?'),body:t('会新建一个 Bot。WhatsApp 和通用来源都保持关闭。','This creates a new Bot. WhatsApp and the general source stay off.'),confirmLabel:t('复制','Copy')});
 if(!confirmCopy({isRoom:isGroup(bot),confirmed}).duplicate)return;
 copyOpener=trigger;
 copying=true;paintOverlay();
 try{
  const result=await api.duplicateBot(id);
  try{state=await api.refresh();}catch{state=result;}
  if(result.duplicatedBotId&&state.bots?.some(item=>item.id===result.duplicatedBotId))selected=result.duplicatedBotId;
  page='bots';render();
 }catch(error){
  if(error?.message==='REQUEST_TIMEOUT')toast(t('复制可能已经完成，请刷新 Bot 列表确认','The copy may already be done. Refresh the Bot list to check.'));
  else{const pair=errorMessages[error.message];toast(pair?t(...pair):t('操作没有完成，请重试。','The operation did not complete. Please try again.'));}
 }
 finally{copying=false;paintOverlay();copyOpener=null;}
}
let syncing=false;
$('sync').addEventListener('click',()=>{
 if(syncing)return;
 syncing=true;$('sync').disabled=true;
 run(async()=>{state=await api.refresh();render();}).finally(()=>{syncing=false;const button=$('sync');if(button)button.disabled=false;});
});
window.addEventListener('keydown',event=>{
 if(avatarEditor&&event.key==='Escape'){event.preventDefault();closeAvatarEditor();return;}
 if(botDetail&&event.key==='Escape'){event.preventDefault();closeBotDetail();return;}
 if(confirmState&&event.key==='Escape'){event.preventDefault();settleConfirm(false);return;}
 if(!recordingSlot)return;
 event.preventDefault();
 if(event.key==='Escape'){void finishRecording(null);return;}
 const accelerator=acceleratorFromEvent(event);
 if(accelerator)void finishRecording(accelerator);
});
api.onWindowState(next=>{
 windowChrome={maximized:!!next?.maximized,focused:next?.focused!==false,inset:Number(next?.inset)||0};
 paintWindowControls();
});
api.onChange(message=>{
 if(message.event==='navigate'&&message.data?.page)page=message.data.page;
 if(message.event==='composer'&&message.data?.botId)selected=message.data.botId;
 if(message.event==='toast'){
  const code=typeof message.data==='string'?message.data:message.data?.code;
  const pair=errorMessages[code];
  toast(pair?t(...pair):t('操作没有完成，请重试。','The operation did not complete. Please try again.'));
 }
 if(message.event==='state')state=message.data;
 if(state)render();
});
try{state=await api.state();selected=orderedBots()[0]?.id??'';if(selected)void api.noteBot(selected).catch(()=>{});render();}catch{toast(t('应用没有打开，请再试一次。','The app did not open. Please try again.'));}
mountOverlayScroll();
