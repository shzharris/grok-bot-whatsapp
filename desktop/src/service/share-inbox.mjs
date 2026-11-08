import {mkdir,readdir,readFile,lstat,realpath,rename,writeFile} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';
import {inspectWhatsAppIntake} from './whatsapp-export.mjs';

const SHARE_SOURCES=['wechat','whatsapp'];

export class ShareInbox {
  constructor({root,session,onReceipt=()=>{},onError=()=>{},onPreparing=()=>{}}){Object.assign(this,{root,session,onReceipt,onError,onPreparing});this.busy=false;this.preparing=new Set();}
  async initialize(){for(const folder of ['Ready','Staging','Imported','Rejected','Preparing'])await mkdir(join(this.root,folder),{recursive:true,mode:0o700});}
  async drain(){
    if(this.busy||!this.session.account||this.session.transition)return;
    this.busy=true;
    try{
      for(const file of await readdir(join(this.root,'Preparing'))){
        const match=/^([A-Za-z0-9_-]{1,100})\.json$/.exec(file);
        if(!match||this.preparing.has(match[1]))continue;
        const id=match[1],markerPath=join(this.root,'Preparing',file);
        try{
          const info=await lstat(markerPath);
          if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024)continue;
          const m=JSON.parse(await readFile(markerPath,'utf8'));
          if(m.version!==1||m.id!==id||!SHARE_SOURCES.includes(m.source)||typeof m.accountId!=='string'||typeof m.botId!=='string'||!['compose','direct'].includes(m.mode))continue;
          if(this.session.account?.id!==m.accountId||this.session.transition)continue;
          if(typeof this.session.store.recipient==='function'){
            const recipient=this.session.store.recipient(m.accountId,m.botId);
            if(!recipient.enabled||!(recipient.sources?.wechat||recipient.sources?.whatsapp))continue;
          }
          if(this.session.store.list(m.accountId).some(row=>row.sourceId===`wechat:${id}`||row.sourceId===`whatsapp:${id}`))continue;
          this.preparing.add(id);
          this.onPreparing({id,accountId:m.accountId,botId:m.botId,mode:m.mode,createdAt:Number.isSafeInteger(m.createdAt)?m.createdAt:Date.now()});
        }catch{continue;}
      }
      for(const name of await readdir(join(this.root,'Ready'))){
        if(!/^[A-Za-z0-9_-]{1,100}$/.test(name))continue;
        const directory=join(this.root,'Ready',name);
        try{
          if(!(await lstat(directory)).isDirectory()||(await lstat(directory)).isSymbolicLink())throw new Error('SHARE_PATH_INVALID');
          const manifestPath=join(directory,'manifest.json'),info=await lstat(manifestPath);
          if(!info.isFile()||info.isSymbolicLink()||info.size>8*1024*1024)throw new Error('SHARE_MANIFEST_INVALID');
          const m=JSON.parse(await readFile(manifestPath,'utf8'));
          if(m.version!==1||m.id!==name||!SHARE_SOURCES.includes(m.source)||typeof m.accountId!=='string'||typeof m.botId!=='string'||!['compose','direct'].includes(m.mode)||typeof m.prefix!=='string'||m.prefix.length>10000||typeof m.text!=='string'||m.text.length>2_000_000||typeof m.title!=='string'||m.title.length>1000||!Number.isSafeInteger(m.createdAt)||!Array.isArray(m.files)||m.files.length>100)throw new Error('SHARE_MANIFEST_INVALID');
          if(this.session.account?.id!==m.accountId||this.session.transition)continue;
          let files=[];
          for(const file of m.files){
            if(typeof file.relativePath!=='string'||isAbsolute(file.relativePath)||file.relativePath.split(/[\\/]/).some(part=>part==='..'||part==='')||typeof file.name!=='string'||!file.name||/[\\/]/.test(file.name))throw new Error('SHARE_PATH_INVALID');
            const path=join(directory,file.relativePath),fileInfo=await lstat(path),resolved=await realpath(path),base=await realpath(directory),rel=relative(base,resolved);
            if(fileInfo.isSymbolicLink()||!fileInfo.isFile()||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('SHARE_PATH_INVALID');
            files.push(path);
          }
          if(m.sessionId!==undefined&&(typeof m.sessionId!=='string'||m.sessionId.length>256))throw new Error('SHARE_MANIFEST_INVALID');
          let source=m.source,text=m.text,title=m.title,fileNames=m.files.map(f=>f.name),sourceTag,originSource;
          const defaults=typeof this.session.sourceDefaults==='function'?this.session.sourceDefaults():{whatsapp:{prefix:''}};
          try{
            const inspected=await inspectWhatsAppIntake({files,fileNames,text,title,prefix:defaults.whatsapp?.prefix??'',extractDir:join(directory,'extracted')});
            if(inspected){
              source='whatsapp';text=inspected.text;title=inspected.chatName||title;files=inspected.files;fileNames=inspected.fileNames;sourceTag='WhatsApp';
              if(m.source!=='whatsapp')originSource=m.source;
            }
          }catch{/* A chat that cannot be read still imports as the manifest described it. */}
          const sourceId=`${source}:${m.id}`;
          const duplicate=this.session.store.list(m.accountId).find(row=>row.sourceId===sourceId||row.sourceId===`wechat:${m.id}`||row.sourceId===`whatsapp:${m.id}`);
          if(duplicate){await rename(directory,join(this.root,'Imported',name));continue;}
          const item=await this.session.receive({botId:m.botId,expectedAccountId:m.accountId,source,text,title,files,fileNames,sourceId,sourceTag,originSource,policy:{mode:m.mode,prefix:m.prefix,createdAt:m.createdAt,sessionId:m.sessionId??''}});
          await rename(directory,join(this.root,'Imported',name));this.onReceipt(item);
        }catch(error){
          // Configuration/identity errors leave content available for the user.
          if(['ACCOUNT_BUSY','LOGIN_REQUIRED','SOURCE_DISABLED','BOT_NOT_FOUND','RECEIPT_SCOPE_MISMATCH'].includes(error.message))continue;
          const rejectedInfo=await lstat(directory).catch(()=>null);
          if(rejectedInfo?.isDirectory()&&!rejectedInfo.isSymbolicLink())await writeFile(join(directory,'failure.txt'),'The local share could not be imported. Files were retained.',{flag:'wx',mode:0o600}).catch(()=>{});
          await rename(directory,join(this.root,'Rejected',name)).catch(()=>{});this.onError('SHARE_IMPORT_FAILED');
        }
      }
    }finally{this.busy=false;}
  }
}
