import {createAvatar} from './avatar-adapter.mjs';

const api=window.anywhere;
const list=document.getElementById('list');
const empty=document.getElementById('empty');
const hint=document.getElementById('hint');
const send=document.getElementById('send');
const cancel=document.getElementById('cancel');
const avatars=[];

let bots=[];
let index=0;
let busy=false;
let reduced=false;
let uiLocale='en';
const t=(cn,en)=>String(uiLocale).toLowerCase().startsWith('zh')?cn:en;
function useLocale(value){
  if(value!=='zh'&&value!=='en')return;
  uiLocale=value;
}
function applyCopy(){
  document.documentElement.lang=t('zh-CN','en');
  document.title=t('分享给','Share with');
  document.getElementById('title').textContent=document.title;
  document.getElementById('list').setAttribute('aria-label',t('Bot 列表','Bots'));
  cancel.textContent=t('取消','Cancel');
  send.textContent=t('发送','Send');
  if(!bots.length&&empty.hidden)empty.textContent=t('没有 Bot 开启分享。','No Bot is receiving shares.');
}

function row(bot,position){
  const element=document.createElement('div');
  element.className='pick';
  element.setAttribute('role','option');
  element.setAttribute('aria-selected',String(position===index));
  element.dataset.index=String(position);

  const avatar=document.createElement('div');
  avatar.className='avatar';
  element.append(avatar);

  const name=document.createElement('span');
  name.className='name';
  name.textContent=bot.name;
  element.append(name);

  element.addEventListener('click',()=>select(position));
  element.addEventListener('dblclick',()=>confirm(bot.botId));
  return {element,avatar};
}

function pictureUrl(value){
  if(typeof value!=='string'||!value)return '';
  try{const url=new URL(value);return ['https:','data:','blob:'].includes(url.protocol)?url.href:'';}catch{return '';}
}
function paintEngine(bot,avatar){
  avatar.classList.remove('picture');
  try{
    avatars.push(createAvatar(avatar,{
      agentId:bot.botId,
      shape:bot.avatarShape,
      color:bot.avatarColor,
      size:36,
      main:false,
      state:bot.running?'working':'idle',
      theme:'auto',
      reducedMotion:reduced
    }));
  }catch{
    // The engine can refuse a Bot whose avatar data is incomplete; a plain
    // disc keeps the row recognisable instead of leaving a hole.
    const fallback=document.createElement('span');
    fallback.className='avatar-fallback';
    fallback.style.background=bot.avatarColor||'#8a8a8f';
    avatar.append(fallback);
  }
}
function paint(){
  applyCopy();
  list.replaceChildren();
  for(const handle of avatars.splice(0))handle?.dispose?.();
  bots.forEach((bot,position)=>{
    const {element,avatar}=row(bot,position);
    list.append(element);
    requestAnimationFrame(()=>{
      if(!avatar.isConnected || !bot.botId)return;
      const picture=pictureUrl(bot.avatarPicture);
      if(picture){
        const image=document.createElement('img');
        image.alt='';image.decoding='async';
        image.addEventListener('error',()=>{if(!avatar.isConnected)return;image.remove();paintEngine(bot,avatar);},{once:true});
        avatar.classList.add('picture');image.src=picture;avatar.append(image);return;
      }
      paintEngine(bot,avatar);
    });
  });
  empty.hidden=bots.length>0;
  send.disabled=!bots.length||busy;
  if(bots.length){
    const bot=bots[index];
    hint.textContent=reduced?'':t('↑↓ 选择 · Enter 发送 · Esc 取消','↑↓ select · Enter sends · Esc cancels');
    for(const element of list.children)element.setAttribute('aria-selected',String(Number(element.dataset.index)===index));
    bot && void bot;
  }else{
    hint.textContent=t('Esc 关闭','Esc closes');
    empty.textContent=t('没有 Bot 开启分享。','No Bot is receiving shares.');
  }
  requestAnimationFrame(fitHeight);
}

function select(position){
  if(busy||!bots.length)return;
  index=Math.min(Math.max(0,position),bots.length-1);
  for(const element of list.children)element.setAttribute('aria-selected',String(Number(element.dataset.index)===index));
  list.children[index]?.scrollIntoView({block:'nearest'});
}

async function confirm(botId){
  if(busy)return;
  const target=botId??bots[index]?.botId;
  if(!target)return;
  busy=true;send.disabled=true;
  try{await api.sharePickerConfirm(target);}finally{busy=false;}
}

cancel.addEventListener('click',()=>{void api.sharePickerCancel();});
send.addEventListener('click',()=>{void confirm();});

// 5 columns, matching the grid in share-picker.css.
const COLUMNS=5;
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();void api.sharePickerCancel();return;}
  if(event.key==='ArrowRight'){event.preventDefault();select(index+1);return;}
  if(event.key==='ArrowLeft'){event.preventDefault();select(index-1);return;}
  if(event.key==='ArrowDown'){event.preventDefault();select(index+COLUMNS);return;}
  if(event.key==='ArrowUp'){event.preventDefault();select(index-COLUMNS);return;}
  if(event.key==='Enter'){event.preventDefault();void confirm();}
});

reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;

function fitHeight(){
  // Height follows the content: header + rows + footer, capped so a long roster
  // still scrolls instead of growing past the screen.
  const head=document.getElementById('head').offsetHeight;
  const foot=document.getElementById('foot').offsetHeight;
  const rows=list.scrollHeight;
  const desired=Math.ceil(head+foot+Math.min(rows,360)+4);
  void api.sharePickerResize(desired).catch(()=>{});
}

async function load(){
  try{
    const data=await api.sharePickerData();
    useLocale(data?.uiLocale);
    bots=data?.bots??[];
    index=0;
    paint();
    list.focus?.();
    if(bots.length)document.querySelector('.pick')?.scrollIntoView({block:'nearest'});
  }catch(error){
    // Never leave a blank panel: a failed read must say why.
    bots=[];
    paint();
    empty.hidden=false;
    empty.textContent=t(`没有读到可以分享的 Bot（${error?.message??'未知错误'}）。`,`Could not load Bots to share (${error?.message??'unknown error'}).`);
  }
}

api.onChange?.(message=>{
  if(message.event!=='state')return;
  const next=message.data?.host?.uiLocale;
  if(next!==uiLocale&&(next==='zh'||next==='en')){uiLocale=next;paint();}
});
void load();
