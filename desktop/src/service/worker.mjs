import {InboxStore} from './store.mjs';
import {AccountSession} from './session.mjs';
import {uploadFile} from './upload.mjs';
import {normalizeBot} from 'grok-bot-sdk';
import {ShareInbox} from './share-inbox.mjs';
import {resolveUiLocale} from '../shell/locale.mjs';

const port=process.parentPort;
let store,session,shareInbox,shareTimer,watchTimer;
const emit=message=>port.postMessage(message);
const safeError=error=>/^[A-Z][A-Z0-9_]{1,70}$/.test(error?.code??error?.message??'')?error.code??error.message:'SERVICE_REQUEST_FAILED';
port.on('message',async({data:request})=>{
  if(typeof request?.id!=='string')return;
  try{
    const p=request.params??{};let result;
    if(request.method==='initialize'){
      if(session)throw new Error('ALREADY_INITIALIZED');
      store=new InboxStore(p.root);
      const previewChinese=resolveUiLocale(store.preference('language'),p.locale)==='zh';
      const bots=p.preview?[['研究伙伴','Research companion','cloud','brown'],['代码助手','Code assistant','squircle','blue'],['灵感收集员','Idea collector','pebble','violet'],['写作搭档','Writing partner','tablet','green']].map(([cn,en,avatarShape,avatarColor],index)=>normalizeBot({agentId:`00000000-0000-4000-8000-00000000000${index}`,name:previewChinese?cn:en,avatarShape,avatarColor})):null;
      const previewSdk=bots?{GrokBotClient:class{async getMe(){return {authId:'preview',name:previewChinese?'示例工作空间':'Sample workspace'};}async listBots(){return {bots,truncated:false};}async getRuntimeSettings(){return {mainAgentId:null,pinnedAgentIds:[],sections:[]};}async listStatuses(){return {statuses:[]};}async sendMessage(){throw new Error('PREVIEW_ONLY');}}}:undefined;
      session=new AccountSession({store,upload:uploadFile,onEvent:emit,downloadsDir:typeof p.downloadsDir==='string'?p.downloadsDir:'',...previewSdk?{sdk:previewSdk}:{}});
      if(p.shareRoot&&!p.preview){shareInbox=new ShareInbox({root:p.shareRoot,session,onReceipt:item=>emit({event:'share.received',data:{id:item.id,accountId:item.accountId,botId:item.botId,mode:item.mode,status:item.status,batchId:typeof item.sourceId==='string'?item.sourceId.replace(/^(?:wechat|whatsapp|share):/,''):''}}),onPreparing:data=>emit({event:'share.preparing',data}),onError:code=>emit({event:'share.error',data:{code}})});await shareInbox.initialize();shareTimer=setInterval(()=>void shareInbox.drain().catch(()=>emit({event:'share.error',data:{code:'SHARE_IMPORT_FAILED'}})),250);}
      if(!p.preview)watchTimer=setInterval(()=>void session.whatsappWatch.scan().catch(()=>{}),1000);
      if(p.preview)await session.connect({accessToken:'preview-not-a-token'});
      result=session.snapshot();
    }else{
      if(!session)throw new Error('NOT_INITIALIZED');
      switch(request.method){
        case 'snapshot':result=session.snapshot();break;
        case 'login':result=await session.login();break;
        case 'desktopLogin':result=await session.desktopLogin();break;
        case 'connect':result=await session.connect(p);break;
        case 'logout':result=await session.logout();break;
        case 'refresh':result=await session.refresh();break;
        case 'duplicateBot':result=await session.duplicateBot(p.botId);break;
        case 'updateBotAvatar':result=await session.updateBotAvatar(p.botId,{shape:p.shape,color:p.color});break;
        case 'configure':result=session.configure(p.botId,p.patch);break;
        case 'setSourceDefaults':result=session.setSourceDefaults(p.patch);break;
        case 'setWhatsAppWatch':result=await session.whatsappWatch.set(p);break;
        case 'disableAllReceive':result=session.disableAllReceive();break;
        case 'receive':result=await session.receive(p);break;
        case 'submit':result=await session.submit(p.id,p.text,p.files);break;
        case 'submitAsync':result=session.submitAsync(p.id,p.text,p.files);break;
        case 'retry':result=await session.retry(p.id);break;
        case 'resolve':result=session.resolve(p.id);break;
        case 'composer':result=session.composer(p.id);break;
        case 'dismissComposer':result=await session.dismissComposer(p.id);break;
        case 'resume':result=await session.resume();break;
        case 'theme':result=session.setTheme(p.theme);break;
        case 'setLanguage':result=session.setLanguage(p.language);break;
        case 'setShortcut':result=session.setShortcut(p.slot,p.accelerator);break;
        case 'watch':session.watch(p.botId,p.sessionId);result={watching:true};break;
        case 'shutdown':clearInterval(shareTimer);clearInterval(watchTimer);session.close();store.close();result={};break;
        default:throw new Error('METHOD_UNKNOWN');
      }
    }
    emit({id:request.id,result});
  }catch(error){emit({id:request.id,error:{code:safeError(error)}});}
});
