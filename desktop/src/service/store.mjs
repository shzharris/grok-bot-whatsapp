import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import {join} from 'node:path';

export const SOURCES = ['wechat','whatsapp','shortcuts','share','drop'];
export class InboxStore {
  constructor(root) {
    this.root = root;
    mkdirSync(root,{recursive:true,mode:0o700});
    this.db = new DatabaseSync(join(root,'inbox.sqlite'));
    chmodSync(join(root,'inbox.sqlite'),0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS recipients (account TEXT, bot TEXT, value TEXT NOT NULL, PRIMARY KEY(account,bot));
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, account TEXT NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS receipt_account ON receipts(account);
      CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    for (const row of this.db.prepare('SELECT id,account,value FROM receipts').all()) {
      const item=JSON.parse(row.value);
      if(item.phase==='sending') this.update(row.id,row.account,{status:'unconfirmed',phase:'held',error:'SEND_UNCONFIRMED'});
      if(item.phase==='uploading') this.update(row.id,row.account,{status:'failed',phase:'ready',error:'UPLOAD_INTERRUPTED'});
    }
  }
  recipient(accountId,botId) {
    const base={botId,enabled:false,mode:'compose',prefix:'',order:0,composerAfterSend:'inherit',sources:Object.fromEntries(SOURCES.map(s=>[s,false]))};
    const row=this.db.prepare('SELECT value FROM recipients WHERE account=? AND bot=?').get(accountId,botId);
    if(!row)return base;
    const saved=JSON.parse(row.value);
    const sources={...base.sources,...(saved.sources??{})};
    // The share extension used to be stored as a WeChat source. The UI no longer
    // has that switch, so a Bot that was on for it keeps receiving as 通用.
    if(sources.wechat===true){sources.share=true;sources.wechat=false;}
    return {...base,...saved,sources};
  }
  saveRecipient(accountId,botId,patch) {
    if(typeof accountId!=='string'||!accountId||typeof botId!=='string'||!botId||!patch||typeof patch!=='object') throw new Error('RECIPIENT_INVALID');
    const old=this.recipient(accountId,botId);
    const value={...old,...patch,botId,sources:{...old.sources,...patch.sources}};
    if(typeof value.enabled!=='boolean'||!['compose','direct'].includes(value.mode)||typeof value.prefix!=='string'||value.prefix.length>10000||!['inherit','hide','open'].includes(value.composerAfterSend)||!Number.isSafeInteger(value.order)||SOURCES.some(s=>typeof value.sources[s]!=='boolean')) throw new Error('RECIPIENT_INVALID');
    this.db.prepare('INSERT OR REPLACE INTO recipients VALUES (?,?,?)').run(accountId,botId,JSON.stringify(value));
    return value;
  }
  disableEnabled(accountId,botIds){
    if(typeof accountId!=='string'||!accountId)throw new Error('RECIPIENT_INVALID');
    const ids=[];
    const seen=new Set();
    for(const botId of botIds??[]){
      if(typeof botId!=='string'||!botId||seen.has(botId))continue;
      seen.add(botId);
      ids.push(botId);
    }
    this.db.exec('BEGIN IMMEDIATE');
    try{
      let closed=0;
      for(const botId of ids){
        const current=this.recipient(accountId,botId);
        if(current.enabled!==true)continue;
        this.saveRecipient(accountId,botId,{enabled:false});
        closed+=1;
      }
      this.db.exec('COMMIT');
      return closed;
    }catch(error){
      try{this.db.exec('ROLLBACK');}catch{/* The original transaction error is the one to surface. */}
      throw error;
    }
  }
  add(item) {this.db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(item.id,item.accountId,JSON.stringify(item)); return item;}
  get(id,accountId) {const row=this.db.prepare('SELECT value FROM receipts WHERE id=? AND account=?').get(id,accountId);return row?JSON.parse(row.value):null;}
  list(accountId) {return this.db.prepare('SELECT value FROM receipts WHERE account=? ORDER BY rowid DESC').all(accountId).map(row=>JSON.parse(row.value));}
  update(id,accountId,patch) {
    const item=this.get(id,accountId);if(!item)throw new Error('RECEIPT_NOT_FOUND');
    const value={...item,...patch,id,accountId};
    this.db.prepare('UPDATE receipts SET value=? WHERE id=? AND account=?').run(JSON.stringify(value),id,accountId);
    return value;
  }
  preference(key,value) {
    if(value!==undefined)this.db.prepare('INSERT OR REPLACE INTO preferences VALUES (?,?)').run(key,JSON.stringify(value));
    const row=this.db.prepare('SELECT value FROM preferences WHERE key=?').get(key);return row?JSON.parse(row.value):null;
  }
  close(){if(this.db){this.db.close();this.db=null;}}
}
