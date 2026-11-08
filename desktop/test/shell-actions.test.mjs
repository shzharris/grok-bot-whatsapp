import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {acceptLateFiles,applyExplorerRegistry,applyLoginItem,composerAfterSend,composerBounds,confirmAccountStill,confirmCopy,createExplorerBatch,createExplorerSync,explorerAccept,explorerCleanupKeys,explorerLogLine,explorerRegistryOps,explorerRejectNotice,explorerTargets,explorerVerdict,floatingComposerTraits,loginItemPayload,loginItemStartup,openedAsLoginItem,parseExplorerForward,resolveExplorerForward,shareResultNotice,shouldApplyLoginItem,toolboxShareOff,touchBarChoice,touchBarPinPayload,trayCommand,trayMenuModel,trimExplorerLog,windowCloseAction,coalBallSvg} from '../src/shell/actions.mjs';
import {normalizeBot} from 'grok-bot-sdk';
import {appIconInset,coalBallAppPng,coalBallGeometry,coalBallIcon,coalBallPng,coalBallRaster,coalBallSample} from '../src/shell/coal-ball.mjs';

const room={id:'room-1',name:'Same',kind:'GROK_BOT_AGENT_KIND_ROOM',memberAgentIds:['bot-a']};
const hidden={id:'bot-hidden',name:'Same',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]};
const kept={id:'bot-a',name:'Alpha',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]};
const other={id:'bot-b',name:'Beta',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]};

test('toolbox turns off receive-forward for every enabled bot, including a hidden twin',()=>{
  const recipients=[
    {botId:'room-1',enabled:true,mode:'direct',prefix:'room',sources:{wechat:true,share:false,shortcuts:true,drop:true}},
    {botId:'bot-hidden',enabled:true,mode:'compose',prefix:'hide',sources:{wechat:true,share:true,shortcuts:false,drop:true}},
    {botId:'bot-a',enabled:false,mode:'compose',prefix:'keep',sources:{wechat:true,share:true,shortcuts:true,drop:true}},
    {botId:'bot-b',enabled:true,mode:'compose',prefix:'beta',sources:{wechat:false,share:false,shortcuts:true,drop:true}}
  ];
  assert.deepEqual(toolboxShareOff([room,hidden,kept,other],[]),[]);
  const plans=toolboxShareOff([room,hidden,kept,other],recipients);
  assert.deepEqual(plans.map(item=>item.botId),['room-1','bot-hidden','bot-b']);
  assert.deepEqual(plans[0].patch,{enabled:false});
  assert.equal(JSON.stringify(plans).includes('sources'),false);
  assert.equal(JSON.stringify(plans).includes('prefix'),false);
  assert.equal(JSON.stringify(plans).includes('mode'),false);
});

test('copy confirm is required before duplicate and a room is rejected',()=>{
  assert.deepEqual(confirmCopy({isRoom:true,confirmed:true}),{duplicate:false,reason:'room'});
  assert.deepEqual(confirmCopy({isRoom:false,confirmed:false}),{duplicate:false,reason:'cancel'});
  assert.deepEqual(confirmCopy({isRoom:false}),{duplicate:false,reason:'cancel'});
  assert.deepEqual(confirmCopy({isRoom:false,confirmed:true}),{duplicate:true});
});

test('tray actions are the three menu items and close hides until quit',()=>{
  const menu=trayMenuModel('zh-CN');
  assert.deepEqual(menu.map(item=>item.label),['打开主页面','打开输入框','退出']);
  assert.deepEqual(menu.map(item=>item.id),['show-main','open-composer','quit']);
  assert.deepEqual(trayMenuModel('en-US').map(item=>item.label),['Open main window','Open composer','Quit']);
  assert.deepEqual(menu.map(item=>item.action),['show-main','open-composer','quit']);
  assert.equal(trayCommand('show-main'),'show-main');
  assert.equal(trayCommand('open-composer'),'open-composer');
  assert.equal(trayCommand('quit'),'quit');
  assert.equal(trayCommand('about'),null);
  assert.equal(windowCloseAction({quitting:false,smoke:false}),'hide');
  assert.equal(windowCloseAction({quitting:false,smoke:false,hasTray:true}),'hide');
  assert.equal(windowCloseAction({quitting:false,smoke:false,hasTray:false}),'quit');
  assert.equal(windowCloseAction({quitting:true,smoke:false}),'quit');
  assert.equal(windowCloseAction({quitting:false,smoke:true}),'quit');
});

test('login item payload follows the switch and the test double is the only caller',()=>{
  assert.equal(loginItemStartup(undefined),null);
  assert.equal(loginItemStartup({known:false,enabled:true}),null);
  assert.deepEqual(loginItemStartup({known:true,enabled:true}),loginItemPayload(true));
  assert.equal(loginItemStartup({known:true,enabled:false}).openAtLogin,false);
  const calls=[];
  const settingsApi={setLoginItemSettings(payload){calls.push(payload);}};
  assert.deepEqual(applyLoginItem(true,settingsApi),{openAtLogin:true,openAsHidden:true,args:['--opened-at-login']});
  assert.deepEqual(applyLoginItem(false,settingsApi),{openAtLogin:false,openAsHidden:true,args:['--opened-at-login']});
  assert.equal(calls.length,2);
  assert.equal(calls[0].openAtLogin,true);
  assert.equal(calls[1].openAtLogin,false);
  assert.equal(openedAsLoginItem({wasOpenedAtLogin:true,argv:[]}),true);
  assert.equal(openedAsLoginItem({wasOpenedAtLogin:false,argv:['app','--opened-at-login']}),true);
  assert.equal(openedAsLoginItem({wasOpenedAtLogin:false,argv:['app']}),false);
  assert.equal(shouldApplyLoginItem({preview:false,packaged:false}),false);
  assert.equal(shouldApplyLoginItem({preview:true,packaged:true}),false);
  assert.equal(shouldApplyLoginItem({preview:false,packaged:true}),true);
});

test('explorer menu lists only bots with receive-forward on',async()=>{
  const bots=[room,hidden,kept,other,{id:'bad id',name:'Nope',memberAgentIds:[]}];
  const amp={id:'amp-1',name:'A & B',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]};
  bots.push(amp);
  const recipients=[
    {botId:'room-1',enabled:true,order:2,sources:{wechat:false,share:false,drop:false,shortcuts:false}},
    {botId:'bot-hidden',enabled:true,sources:{wechat:true,share:true,drop:true,shortcuts:true}},
    {botId:'bot-a',enabled:false,sources:{wechat:true,share:true,drop:true,shortcuts:true}},
    {botId:'bot-b',enabled:true,order:1,sources:{wechat:false,share:false,drop:true,shortcuts:true}},
    {botId:'bad id',enabled:true,sources:{wechat:true,share:true,drop:true,shortcuts:true}},
    {botId:'amp-1',enabled:true,order:0,sources:{wechat:true,share:true,drop:true,shortcuts:true}}
  ];
  assert.deepEqual(explorerTargets(bots,recipients).map(item=>item.botId),['amp-1','bot-b','room-1']);
  assert.equal(explorerAccept('bot-b',recipients,bots),true);
  assert.equal(explorerAccept('bot-a',recipients,bots),false);
  assert.equal(explorerAccept('bot-hidden',recipients,bots),false);
  const ops=explorerRegistryOps({executable:'C:\\App\\Grok Bot Anywhere.exe',bots,recipients});
  const blob=JSON.stringify(ops);
  assert.equal(blob.includes('bot-a'),false);
  assert.equal(blob.includes('bot-hidden'),false);
  assert.equal(blob.includes('bad id'),false);
  assert.equal(blob.includes('bot-b'),true);
  assert.match(ops.filter(item=>item.name==='').map(item=>item.value).join('\n'),/--explorer-forward --bot=bot-b/);
  assert.equal(ops.some(item=>item.key?.endsWith('\\shell\\01_amp-1')&&item.name==='MUIVerb'&&item.value==='A && B'),true);
  assert.equal(ops.some(item=>item.key?.endsWith('\\shell\\02_bot-b')&&item.name==='MUIVerb'),true);
  assert.equal(ops.some(item=>item.key?.endsWith('\\shell\\03_room-1')),true);
  assert.equal(blob.includes('01_bot-b'),false);
  assert.equal(explorerAccept('01_bot-b',recipients,bots),false);
  assert.deepEqual(explorerRejectNotice('zh-CN'),{title:'Grok Bot Anywhere',body:'这个 Bot 没有开启接收转发'});
  assert.deepEqual(explorerRejectNotice('en-US'),{title:'Grok Bot Anywhere',body:'This Bot is not receiving forwards.'});
  assert.equal(ops.filter(item=>item.name==='MultiSelectModel'&&item.value==='Document').length>=2,true);
  const calls=[];
  const skipped=await applyExplorerRegistry(ops,{platform:'darwin',execFile:(...args)=>{calls.push(args);throw new Error('OS_CALLED');}});
  assert.deepEqual(skipped,{applied:false,reason:'not-windows'});
  assert.equal(calls.length,0);
  const written=[];
  const applied=await applyExplorerRegistry(ops,{platform:'win32',execFile:async(...args)=>{written.push(args);}});
  assert.equal(applied.applied,true);
  assert.equal(written.some(args=>JSON.stringify(args).includes('bot-b')),true);
  assert.equal(written.every(args=>args[2]?.windowsHide===true),true);
  assert.equal(written.some(args=>JSON.stringify(args).includes('bot-a')),false);
  assert.deepEqual(parseExplorerForward(['app','--explorer-forward','--bot','bot-b','--','C:\\Files\\a.txt','C:\\Files\\b.txt','%1']),{botId:'bot-b',files:['C:\\Files\\a.txt','C:\\Files\\b.txt']});
  assert.equal(parseExplorerForward(['app']),null);
});

test('explorer batches every file from one menu click, including launches before ready',async()=>{
  const seen=[];
  const batch=createExplorerBatch({delayMs:30});
  assert.equal(batch.push(parseExplorerForward(['app','--explorer-forward','--bot','bot-b','--','C:\\Files\\a.txt'])),true);
  assert.equal(batch.push({botId:'bot-b',files:['C:\\Files\\b.txt','C:\\Files\\a.txt','%1']}),true);
  assert.equal(batch.push({botId:'bot-c',files:['C:\\Files\\c.txt']}),true);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual(seen,[]);
  batch.arm(async(botId,files)=>seen.push({botId,files:[...files]}));
  batch.push({botId:'bot-b',files:['C:\\Files\\d.txt']});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.deepEqual(seen,[
    {botId:'bot-b',files:['C:\\Files\\a.txt','C:\\Files\\b.txt','C:\\Files\\d.txt']},
    {botId:'bot-c',files:['C:\\Files\\c.txt']}
  ]);
});

test('explorer batch waits 800ms unless a shorter delay is passed',async()=>{
  const seen=[];
  const batch=createExplorerBatch();
  batch.arm(async botId=>seen.push(botId));
  assert.equal(batch.push({botId:'bot-b',files:['C:\\Files\\a.txt']}),true);
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.deepEqual(seen,[]);
  await new Promise(resolve=>setTimeout(resolve,700));
  assert.deepEqual(seen,['bot-b']);
});

test('explorer sync skips an unchanged menu and does not overlap writes',async()=>{
  const sync=createExplorerSync();
  const opsA=[{op:'delete',key:'a'}];
  const opsB=[{op:'delete',key:'b'}];
  let active=0,max=0;
  const calls=[];
  const apply=async ops=>{active+=1;max=Math.max(max,active);calls.push(ops[0].key);await new Promise(resolve=>setTimeout(resolve,20));active-=1;return {applied:true};};
  const first=sync.schedule(opsA,apply);
  const same=sync.schedule(opsA,apply);
  assert.equal(first,same);
  const latest=sync.schedule(opsB,apply);
  await Promise.all([first,same,latest]);
  assert.deepEqual(calls,['b']);
  assert.equal(max,1);
  await sync.schedule(opsB,apply);
  assert.deepEqual(calls,['b']);
  const retry=createExplorerSync();
  const failed=[{op:'delete',key:'root'}];
  let attempts=0;
  await assert.rejects(retry.schedule(failed,async()=>{attempts+=1;throw new Error('REG_FAILED');}));
  await retry.schedule(failed,async()=>{attempts+=1;return {applied:true};});
  assert.equal(attempts,2);
});

function recipient(botId,patch={}){
  const base={botId,enabled:false,mode:'compose',prefix:'',order:0,sources:{wechat:false,shortcuts:false,share:false,drop:false}};
  return {...base,...patch,botId,sources:{...base.sources,...patch.sources}};
}

test('explorer forward keeps a real bot through Chromium argv and does not call a cold start disabled',async()=>{
  const upper=normalizeBot({agentId:'A1B2C3D4-E29B-41D4-A716-446655440000',id:'srv_1',name:'Upper',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]});
  const snake=normalizeBot({agentId:'bot_name-1',id:'srv-2',name:'Snake',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]});
  assert.equal(upper.id,upper.agentId??upper.id);
  assert.equal(typeof upper.serverId,'string');
  const bots=[upper,snake];
  const recipients=[
    recipient(upper.id,{enabled:true,order:1,mode:'compose',prefix:'',sources:{wechat:true,shortcuts:true,share:true,drop:true}}),
    recipient(snake.id,{enabled:true,order:0,mode:'direct',prefix:'go',sources:{wechat:true,shortcuts:true,share:true,drop:false}})
  ];
  const ops=explorerRegistryOps({executable:'C:\\Program Files\\Grok Bot Anywhere\\Grok Bot Anywhere.exe',appArgs:['C:\\dev\\app'],bots,recipients});
  const command=ops.find(item=>item.key==='HKCU\\Software\\Classes\\GrokBotAnywhere.Menu\\shell\\02_'+upper.id+'\\command').value;
  assert.match(command,/--explorer-forward --bot=A1B2C3D4-E29B-41D4-A716-446655440000 -- "%1"/);
  const devArgv=['electron.exe','C:\\dev\\app','--explorer-forward','--bot',`"${upper.id}"`,'--','C:\\path with space\\a.txt'];
  const parsed=parseExplorerForward(devArgv);
  assert.equal(parsed.botId,upper.id);
  assert.deepEqual(parsed.files,['C:\\path with space\\a.txt']);
  assert.equal(explorerAccept(parsed.botId,recipients,bots),true);
  const split=['electron.exe','--explorer-forward','--bot','--allow-file-access-from-files','--original-process-start-time=13213718723637733',upper.id.toLowerCase(),'--','C:\\path with space\\a.txt'];
  const recovered=parseExplorerForward(split);
  assert.equal(recovered.botId,upper.id.toLowerCase());
  assert.equal(explorerAccept(recovered.botId,recipients,bots),true);
  assert.equal(explorerVerdict({botId:recovered.botId,bots,recipients,connected:true,hasAccount:true}).reason,'accepted');
  assert.equal(explorerVerdict({botId:'srv_1',bots,recipients,connected:true,hasAccount:true}).botId,upper.id);
  assert.equal(explorerAccept('01_'+upper.id,recipients,bots),false);
  assert.equal(explorerVerdict({botId:upper.id,bots,recipients:recipients.map(item=>item.botId===upper.id?{...item,enabled:false}:item),connected:true,hasAccount:true}).reason,'not-enabled');
  assert.equal(explorerVerdict({botId:upper.id}).reason,'not-loaded');
  assert.equal(explorerVerdict({botId:upper.id,bots:[],recipients:[],connected:false,hasAccount:false}).reason,'not-signed-in');
  assert.deepEqual(explorerRejectNotice('zh-CN','not-loaded'),{title:'Grok Bot Anywhere',body:'应用还在连接账号，请稍后再试'});
  assert.deepEqual(explorerRejectNotice('zh-CN','not-signed-in'),{title:'Grok Bot Anywhere',body:'请先登录'});
  assert.deepEqual(explorerRejectNotice('en-US','not-enabled'),{title:'Grok Bot Anywhere',body:'This Bot is not receiving forwards.'});
  let clock=0;
  let settled=false;
  const waited=await resolveExplorerForward({
    read:()=>settled?{botId:upper.id,bots,recipients,connected:true,hasAccount:true,settled}:{botId:upper.id,connected:false,hasAccount:false,settled},
    waitMs:15000,intervalMs:100,now:()=>clock,sleep:async ms=>{clock+=ms;settled=true;}
  });
  assert.equal(waited.accept,true);
  assert.equal(clock,100);
  clock=0;
  const signedOut=await resolveExplorerForward({
    read:()=>({botId:upper.id,bots:[],recipients:[],connected:false,hasAccount:false,settled:true}),
    waitMs:15000,intervalMs:5000,now:()=>clock,sleep:async ms=>{clock+=ms;}
  });
  assert.equal(signedOut.reason,'not-signed-in');
  assert.equal(clock,0);
  const line=explorerLogLine({at:'2026-11-01T00:00:00.000Z',argv:split,botId:recovered.botId,state:{connected:true,bots,recipients},reason:'not-enabled'});
  const logged=JSON.parse(line);
  assert.equal(logged.botListed,true);
  assert.equal(logged.recipient.enabled,true);
  assert.equal(logged.recipient.mode,'compose');
  assert.equal(logged.recipient.sources.share,true);
  assert.equal(logged.argv.includes('C:\\path with space\\a.txt'),false);
  assert.equal(logged.argv.includes('.txt'),true);
  assert.equal(logged.argv.includes('--allow-file-access-from-files'),true);
  const trimmed=trimExplorerLog('x'.repeat(300*1024),line);
  assert.ok(Buffer.byteLength(trimmed)<=256*1024);
  assert.equal(trimmed.endsWith(line+'\n')||trimmed.includes(line),true);
});

test('explorer registry publishes commands before the parent and rolls back a failed write',async()=>{
  const bots=[
    normalizeBot({agentId:'A1B2C3D4-E29B-41D4-A716-446655440000',id:'srv_1',name:'Upper',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]}),
    normalizeBot({agentId:'bot_name-1',id:'srv-2',name:'A & B',kind:'GROK_BOT_AGENT_KIND_AGENT',memberAgentIds:[]})
  ];
  const recipients=bots.map((bot,index)=>recipient(bot.id,{enabled:true,order:index,sources:{wechat:true,shortcuts:true,share:true,drop:true}}));
  const ops=explorerRegistryOps({executable:'C:\\App\\Grok Bot Anywhere.exe',bots,recipients});
  const parentAt=ops.findIndex(item=>item.name==='ExtendedSubCommandsKey');
  const commandAdds=ops.filter(item=>item.op==='add'&&item.key.endsWith('\\command'));
  assert.ok(commandAdds.length>=2);
  assert.ok(commandAdds.every(item=>item.value.includes('--bot=')&&item.value.includes('"%1"')));
  assert.ok(commandAdds.every(item=>ops.indexOf(item)<parentAt));
  const childKeys=ops.filter(item=>item.op==='add'&&/\\shell\\\d{2}_[^\\]+$/.test(item.key)).map(item=>item.key);
  for(const key of childKeys)assert.ok(ops.some(item=>item.op==='add'&&item.key===`${key}\\command`&&item.value));
  assert.equal(ops.some(item=>item.name==='SubCommands'),false);
  assert.equal(ops.find(item=>item.name==='ExtendedSubCommandsKey').value,'GrokBotAnywhere.Menu');
  assert.equal(ops.some(item=>item.key.endsWith('\\shell\\02_bot_name-1')&&item.value==='A && B'),true);
  for(const key of explorerCleanupKeys())assert.ok(ops.some(item=>item.op==='delete'&&item.key===key));
  const removed=explorerRegistryOps({executable:'C:\\App\\Grok Bot Anywhere.exe',bots,recipients,enabled:false});
  assert.ok(removed.every(item=>item.op==='delete'));
  assert.deepEqual(removed.map(item=>item.key),explorerCleanupKeys());
  const calls=[];
  await assert.rejects(applyExplorerRegistry(ops,{platform:'win32',execFile:async(_file,args)=>{
    calls.push(args);
    if(args[0]==='add'&&String(args[1]).includes('GrokBotAnywhere.Staging')&&args.includes('MUIVerb'))throw new Error('REG_FAILED');
  }}));
  assert.equal(calls.some(args=>args[0]==='delete'&&String(args[1]).includes('\\*\\shell\\GrokBotAnywhere')),false);
  assert.equal(calls.some(args=>args[0]==='delete'&&String(args[1]).endsWith('GrokBotAnywhere.Staging')),true);
  const live=[];
  await assert.rejects(applyExplorerRegistry(ops,{platform:'win32',execFile:async(_file,args)=>{
    live.push(args);
    if(args[0]==='add'&&String(args[1]).includes('GrokBotAnywhere.Menu\\shell')&&args.includes('MUIVerb'))throw new Error('REG_FAILED');
  }}));
  const failedAt=live.findIndex(args=>args[0]==='add'&&String(args[1]).includes('GrokBotAnywhere.Menu\\shell')&&args.includes('MUIVerb'));
  assert.ok(live.slice(0,failedAt).some(args=>args[0]==='delete'&&String(args[1]).includes('\\*\\shell\\GrokBotAnywhere')));
  assert.equal(live.some(args=>args.includes('ExtendedSubCommandsKey')),false);
  assert.equal(live.slice(failedAt+1).some(args=>args[0]==='delete'&&String(args[1]).endsWith('GrokBotAnywhere.Menu')),true);
});

test('composer after-send prefers the Bot setting and defaults to hide',()=>{
 assert.equal(composerAfterSend({composerAfterSend:'inherit'},{afterSend:'open'}),'open');
 assert.equal(composerAfterSend({composerAfterSend:'hide'},{afterSend:'open'}),'hide');
 assert.equal(composerAfterSend({composerAfterSend:'open'},{afterSend:'hide'}),'open');
 assert.equal(composerAfterSend(undefined,{afterSend:'hide'}),'hide');
 assert.equal(composerAfterSend(undefined,{}),'hide');
});
test('touch bar press opens the composer and a scrub only selects',()=>{
  assert.deepEqual(touchBarChoice({moved:false,startId:'bot-a',selectedId:'bot-a'}),{action:'compose',botId:'bot-a'});
  assert.deepEqual(touchBarChoice({moved:true,startId:'bot-a',selectedId:'bot-b'}),{action:'select',botId:'bot-b'});
  assert.deepEqual(touchBarChoice({moved:false,startId:'',selectedId:'bot-a'}),{action:'select',botId:'bot-a'});
  assert.deepEqual(touchBarChoice({moved:false,startId:'',selectedId:''}),{action:'none'});
  assert.deepEqual(touchBarPinPayload(true),{pinned:true});
  assert.deepEqual(touchBarPinPayload(false),{pinned:false});
  assert.equal(floatingComposerTraits('win32').thickFrame,false);
  assert.equal(floatingComposerTraits('win32').skipTaskbar,true);
  assert.equal(floatingComposerTraits('win32').alwaysOnTop,true);
  assert.equal(floatingComposerTraits('darwin').thickFrame,undefined);
});

test('windows walkthrough marks each required feature',async()=>{
  const text=await readFile(fileURLToPath(new URL('../../docs/platforms/windows.md',import.meta.url)),'utf8');
  for(const feature of ['微信分享','Explorer','悬浮输入框','命令行','skills'])assert.match(text,new RegExp(feature));
  assert.match(text,/微信分享[\s\S]*(实机验证|只有一个入口)/);
  // The page must keep separating what ran on a real Windows machine from what
  // did not; the section headings are the structure that enforces it.
  assert.match(text,/部分实机验证/);
  assert.match(text,/## 实机验证结果/);
  assert.match(text,/## 未验证项/);
  assert.match(text,/未运行/);
  assert.match(text,/start "" "grokbotanywhere:\/\/send\?bot=<id>&text=<text>"/);
  assert.match(text,/WM_SETTINGCHANGE/);
  assert.match(text,/常驻 PowerShell/);
  assert.match(text,/第一个标签/);
  assert.match(text,/显示更多选项/);
  assert.match(text,/15 项/);
  const readme=await readFile(fileURLToPath(new URL('../../README.md',import.meta.url)),'utf8');
  assert.match(readme,/Windows[\s\S]*部分实机验证/);
  assert.match(readme,/docs\/platforms\/windows\.md/);
});

test('shipped main and renderer call the confirm, tray, login, and explorer decisions',async()=>{
  const root=fileURLToPath(new URL('../src/',import.meta.url));
  const main=await readFile(`${root}main/main.mjs`,'utf8');
  const renderer=await readFile(`${root}renderer/app.mjs`,'utf8');
  assert.match(main,/windowCloseAction\(/);
  assert.doesNotMatch(main,/action==='service'\)\{showMainWindow/);
  assert.match(main,/process\.platform==='darwin'&&!window\?\.isMinimized\(\)\)return/);
  assert.match(main,/if\(!mainWasVisible\)hideDock\(\)/);
  assert.match(main,/app\.isPackaged\?join\(process\.resourcesPath,'native\/avatar\/index\.html'\)/);
  assert.match(main,/app\.focus\(\{steal:true\}\)/);
  assert.match(main,/argv\.includes\('--share-intake'\)/);
  assert.match(main,/notify\('composer-focus'/);
  assert.match(main,/if\(!window\|\|window\.isDestroyed\(\)\|\|!window\.isVisible\(\)\)hideDock\(\)/);
  assert.match(main,/trayMenuModel\(/);
  assert.match(main,/applyLoginItem\(/);
  assert.match(main,/loginItemStartup\(/);
  assert.match(main,/applyExplorerRegistry\(/);
  assert.match(main,/createExplorerSync\(/);
  assert.match(main,/createExplorerBatch\(/);
  assert.match(main,/explorerBatch\.push\(/);
  assert.match(main,/explorerBatch\.arm\(/);
  assert.match(main,/openedAsLoginItem\(/);
  assert.match(main,/touchBarChoice\(/);
  assert.match(main,/const current=touchBarSelection\|\|activeBotId/);
  assert.match(main,/startId:current/);
  assert.doesNotMatch(main,/touchBarSelection\|\|bot\.id/);
  assert.match(main,/floatingComposerTraits\(/);
  assert.match(main,/coalBallIcon\(/);
  const signature=renderer.slice(renderer.indexOf('function viewSignature'),renderer.indexOf('function botRowKey'));
  assert.match(signature,/settingsTab/);
  const composer=await readFile(`${root}renderer/composer.mjs`,'utf8');
  assert.match(composer,/function paintOne\(bot,size,reducedMotion,bucket=handles\)/);
  assert.match(composer,/paintFace\(item,36,true,pickerHandles\)/);
  assert.doesNotMatch(composer,/reducedMotion\?pickerHandles/);
  const copy=renderer.slice(renderer.indexOf('async function copyBot'),renderer.indexOf('let syncing'));
  assert.match(copy,/confirmCopy\(/);
  assert.ok(copy.indexOf('confirmCopy')<copy.indexOf('api.duplicateBot'));
  assert.match(renderer,/toolboxShareOff\(/);
  const turnOff=renderer.slice(renderer.indexOf('async function disableAllShare'),renderer.indexOf('async function copyBot'));
  assert.match(turnOff,/disableAllReceive\(/);
  assert.doesNotMatch(turnOff,/api\.configure/);
  assert.match(renderer,/没有已开启接收的 Bot/);
  assert.match(turnOff,/会关闭 \$\{count\} 个 Bot 的接收转发/);
  assert.match(copy,/api\.refresh\(/);
  assert.match(copy,/复制可能已经完成，请刷新 Bot 列表确认/);
  assert.match(renderer,/setAttribute\('role','dialog'\)/);
  assert.match(renderer,/aria-modal/);
  assert.match(renderer,/setAttribute\('inert'/);
  assert.match(renderer,/命令行使用的登录信息会以明文保存在本机用户目录/);
  assert.match(renderer,/LOGIN_ITEM_FAILED/);
  assert.match(renderer,/EXPLORER_SYNC_FAILED/);
  assert.match(composer,/acceptLateFiles/);
  assert.match(composer,/composer-files/);
  assert.match(composer,/attachToken/);
  assert.match(main,/showMainWindow\(/);
  assert.match(main,/session-end/);
  assert.match(main,/tray\.destroy\(/);
  assert.match(main,/localAppData/);
  assert.match(main,/EXPLORER_SYNC_FAILED/);
  assert.match(main,/shouldApplyLoginItem\(/);
  assert.match(main,/explorerRejectNotice\(/);
  assert.match(main,/resolveExplorerForward\(/);
  assert.match(main,/explorer-forward\.log/);
  assert.match(main,/setAppUserModelId\('dev\.ronglecat\.grokbotanywhere'\)/);
  assert.ok(main.indexOf("setAppUserModelId('dev.ronglecat.grokbotanywhere')")<main.indexOf('app.whenReady'));
  assert.match(main,/coalBallAppPng\(256,\{platform:'win32'\}\)/);
  assert.match(main,/additionalData/);
  assert.match(main,/explorerBatch\.arm\([\s\S]*rpc\.call\('connect'/);
  assert.match(main,/case 'explorerMenu'/);
  assert.match(renderer,/Windows 右键菜单/);
  assert.match(renderer,/如果别的程序的菜单显示异常，先点『全部移除』再重启那个程序，确认是不是它引起的。/);
  assert.match(renderer,/platform==='win32'/);
  assert.match(renderer,/explorerMenu\(\{action:'rebuild'\}/);
  assert.match(renderer,/explorerMenu\(\{action:'remove'\}/);
  const preload=await readFile(`${root}preload.cjs`,'utf8');
  assert.match(preload,/explorerMenu:/);
  assert.match(main,/hasTray:!!tray/);
  assert.match(main,/LOGIN_ITEM_FAILED/);
  assert.match(main,/composer-files/);
  assert.match(main,/quietLaunch/);
  assert.match(main,/openedAsLoginItem\(\{argv:argv/);
  assert.match(renderer,/data-page="settings"|dataset\.page=id/);
  assert.match(renderer,/常驻 Touch Bar/);
  assert.match(renderer,/开机自启动/);
  assert.match(renderer,/工具箱/);
  assert.match(renderer,/拖放来源也会随之关闭/);
  assert.match(renderer,/账号已切换，请重试/);
  assert.match(renderer,/通过链接收到的内容会先放进输入框，由你确认后再发送/);
  assert.match(renderer,/新开的终端才会使用新的命令路径/);
  assert.match(renderer,/role','tabpanel'/);
  assert.match(renderer,/aria-labelledby/);
  assert.match(renderer,/ArrowRight/);
  assert.match(renderer,/ArrowLeft/);
  assert.match(renderer,/Home/);
  assert.match(renderer,/End/);
  assert.match(renderer,/dataset\.confirmKey/);
  assert.match(renderer,/copyOpener/);
  assert.match(renderer,/confirmAccountStill\(/);
  const open=main.slice(main.indexOf('async function openComposer'),main.indexOf('async function intake'));
  assert.ok(open.indexOf('hwndReady')>=0&&open.indexOf('hwndReady')<open.indexOf('float.show()'));
  assert.ok(open.indexOf('composer-files')>open.indexOf('float.show()'));
  assert.ok(open.indexOf('regularFiles(')>open.indexOf('prepared.files()'));
  assert.ok(open.indexOf('regularFiles(')<open.indexOf("notify('composer-files'"));
  assert.match(main,/quietLaunch=.*grokbotanywhere:\/\//);
  assert.match(main,/savedPathSnippet:saved\.pathSnippet/);
  assert.match(main,/forgetCliCredential\(/);
  const account=main.slice(main.indexOf('async function accountAction'),main.indexOf('async function nativeRequest'));
  assert.match(account,/try\{await syncCliCredential\(result\.credentials\);\}catch\(error\)\{cliStatus\.error=/);
  assert.ok(account.indexOf('syncCliCredential')<account.indexOf("rpc.call('resume')"));
  const logout=main.slice(main.indexOf("case 'logout'"),main.indexOf("case 'refresh'"));
  assert.match(logout,/forgetCliCredential\(/);
  assert.doesNotMatch(logout,/cliStatus\.enabled/);
  const expired=main.slice(main.indexOf("event==='auth.expired'"),main.indexOf("event==='auth.expired'")+400);
  assert.match(expired,/forgetCliCredential\(/);
  const handle=main.slice(main.indexOf('async function handleDeeplink'),main.indexOf("if(process.platform!=='darwin')for(const arg"));
  assert.match(handle,/manual:true/);
  assert.match(handle,/deeplinkIssue\(/);
  assert.match(handle,/parsed\.hasText/);
  assert.match(handle,/if\(!parsed\.ok\)\{deeplinkIssue\('DEEPLINK_IGNORED'\)/);
  assert.match(renderer,/这个链接没有执行/);
  assert.doesNotMatch(handle,/hostIssue\s*=/);
  assert.match(main,/notify\('toast'/);
});

function pngPixels(png,size){
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let offset=8,idat=Buffer.alloc(0);
  while(offset+8<=png.length){
    const length=png.readUInt32BE(offset);
    const type=png.subarray(offset+4,offset+8).toString('ascii');
    const data=png.subarray(offset+8,offset+8+length);
    if(type==='IDAT')idat=Buffer.concat([idat,data]);
    offset+=12+length;
    if(type==='IEND')break;
  }
  return inflateSync(idat);
}

test('application icon keeps a transparent safe area on macOS',()=>{
  assert.equal(appIconInset(1024,'darwin'),100);
  const size=256,inset=appIconInset(size,'darwin');
  const raw=pngPixels(coalBallAppPng(size,{platform:'darwin'}),size),stride=1+size*4;
  const at=(x,y)=>raw.subarray(y*stride+1+x*4,y*stride+1+x*4+4);
  assert.equal(at(0,0)[3],0);
  assert.equal(at(Math.floor(inset)-1,size/2)[3],0);
  assert.deepEqual([...at(size/2,size/2)],[18,18,21,255]);
  let eye=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(at(x,y)[0]>240&&at(x,y)[3]===255)eye++;
  assert.ok(eye>4);
  assert.ok(appIconInset(256,'win32')<appIconInset(256,'darwin'));
});

test('packaging points at the generated application icons',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.build.mac.icon,'build/icon.icns');
  assert.equal(pkg.build.win.icon,'build/icon.ico');
  assert.equal(pkg.build.win.signExecutable,false);
  assert.equal(pkg.build.win.signAndEditExecutable,undefined);
  assert.equal(pkg.scripts['build:icons'],'node scripts/build-app-icons.mjs');
});

test('shipped application icon assets are valid',()=>{
  const icns=readFileSync(new URL('../build/icon.icns',import.meta.url));
  const ico=readFileSync(new URL('../build/icon.ico',import.meta.url));
  const png=readFileSync(new URL('../build/icon.png',import.meta.url));
  assert.equal(icns.subarray(0,4).toString('ascii'),'icns');
  assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.ok(ico.readUInt16LE(4)>=5);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});

test('tray image is the classic black coal ball',()=>{
  const icon=coalBallIcon(32);
  assert.equal(icon.source,'coal-ball');
  assert.notEqual(icon.source,'bubble.left.and.bubble.right');
  assert.ok(Buffer.isBuffer(icon.png));
  assert.ok(icon.png.length>32);
  const raw=pngPixels(icon.png,32);
  const stride=1+32*4;
  assert.equal(raw.length,32*stride);
  const at=(x,y)=>raw.subarray(y*stride+1+x*4,y*stride+1+x*4+4);
  assert.deepEqual([...at(16,16)],[10,10,12,255]);
  assert.equal(at(0,0)[3],0);
  assert.equal(at(31,31)[3],0);
  let white=0;
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(at(x,y)[0]===249&&at(x,y)[3]===255)white++;
  assert.ok(white>4);
  const svg=coalBallSvg();
  assert.match(svg,/circle/);
  assert.match(svg,/#0a0a0c/);
  assert.equal(svg.includes('bubble.left'),false);
  assert.equal(coalBallPng(16).length>32,true);
  assert.equal(confirmAccountStill('acct-a','acct-a'),true);
  assert.equal(confirmAccountStill('acct-a','acct-b'),false);
  assert.equal(confirmAccountStill(null,null),true);
  assert.equal(confirmAccountStill(undefined,null),true);
});

test('windows tray icon is the idle coal ball: black body, light rim, pill holes filled light',()=>{
  for(const size of [16,32,64]){
    const raster=coalBallRaster(size);
    const {cx,cy}=coalBallGeometry(size,{rim:1});
    const at=(x,y)=>raster.rgba.subarray((y*size+x)*4,(y*size+x)*4+4);
    assert.deepEqual([...at(Math.round(cx),Math.round(cy))],[10,10,12,255]);
    assert.equal(at(0,0)[3],0);
    let eye=0,rim=0,body=0;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const kinds=new Set([0.125,0.375,0.625,0.875].flatMap(ox=>[0.125,0.375,0.625,0.875].map(oy=>[ox,oy])).map(([ox,oy])=>coalBallSample(size,x+ox,y+oy,{rim:1})));
      const pixel=at(x,y);
      if(kinds.size===1&&kinds.has('eye')){assert.deepEqual([...pixel],[249,249,249,255]);eye++;}
      if(kinds.size===1&&kinds.has('body')){assert.deepEqual([...pixel],[10,10,12,255]);body++;}
      if(kinds.has('rim')&&!kinds.has('eye')&&pixel[3]>150&&pixel[0]>120)rim++;
    }
    assert.ok(body>0);
    if(size>=32)assert.ok(rim>0);
    if(size>=32)assert.ok(eye>0);
    const raw=pngPixels(coalBallPng(size),size);
    const stride=1+size*4;
    assert.deepEqual([...raw.subarray(Math.round(cy)*stride+1+Math.round(cx)*4,Math.round(cy)*stride+1+Math.round(cx)*4+4)],[10,10,12,255]);
  }
});

test('coal ball geometry matches assets/bloub/idle.svg exactly',()=>{
  const idle=readFileSync(new URL('../../assets/bloub/idle.svg',import.meta.url),'utf8');
  for(const matrix of ['matrix(0.87,-0.33,0.45,0.84,21.42,-43.32)','matrix(0.64,-0.06,0.45,0.84,62.98,-53.9)'])assert.ok(idle.includes(matrix));
  const svg=coalBallSvg();
  for(const matrix of ['matrix(0.87,-0.33,0.45,0.84,21.42,-43.32)','matrix(0.64,-0.06,0.45,0.84,62.98,-53.9)'])assert.ok(svg.includes(matrix));
  assert.ok(svg.includes('M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z'));
  // Centres of the two holes, in the 256px canvas, sit upper right of the ball centre.
  const size=256,{cx,cy,scale}=coalBallGeometry(size);
  assert.equal(coalBallSample(size,cx+21.42*scale,cy-43.32*scale),'eye');
  assert.equal(coalBallSample(size,cx+62.98*scale,cy-53.9*scale),'eye');
  assert.equal(coalBallSample(size,cx-40*scale,cy+10*scale),'body');
});

test('late composer files are dropped when the token or bot no longer matches',()=>{
  const paths=['C:\\Files\\a.txt','',1];
  assert.deepEqual(acceptLateFiles({token:2,current:2,botId:'bot-a',currentBotId:'bot-a',paths}),['C:\\Files\\a.txt']);
  assert.deepEqual(acceptLateFiles({token:1,current:2,botId:'bot-a',currentBotId:'bot-a',paths:['C:\\Files\\a.txt']}),[]);
  assert.deepEqual(acceptLateFiles({token:2,current:2,botId:'bot-a',currentBotId:'bot-b',paths:['C:\\Files\\a.txt']}),[]);
  assert.deepEqual(acceptLateFiles({token:null,current:null,botId:'bot-a',currentBotId:'bot-a',paths:['C:\\Files\\a.txt']}),[]);
  assert.deepEqual(acceptLateFiles({token:2,current:undefined,botId:'bot-a',currentBotId:'bot-a',paths:['C:\\Files\\a.txt']}),[]);
});

test('a dragged composer keeps its clamped position instead of recentering',()=>{
  const area={x:0,y:0,width:1440,height:900};
  assert.deepEqual(composerBounds({workArea:area,width:368,height:120}),{x:536,y:772,width:368,height:120});
  assert.deepEqual(composerBounds({workArea:area,current:{x:200,y:140},width:368,height:160,moved:true}),{x:200,y:140,width:368,height:160});
  assert.deepEqual(composerBounds({workArea:area,current:{x:-50,y:2000},width:368,height:160,moved:true}),{x:8,y:732,width:368,height:160});
});

test('a direct share failure produces a visible notice, a success does not',()=>{
  assert.equal(shareResultNotice({status:'sent',botName:'Alpha',locale:'zh-CN'}),null);
  assert.match(shareResultNotice({status:'failed',botName:'Alpha',locale:'zh-CN'}).body,/Alpha/);
  assert.match(shareResultNotice({status:'expired',botName:'Alpha',locale:'en'}).body,/Alpha/);
  assert.match(shareResultNotice({status:'unconfirmed',botName:'Alpha',locale:'en'}).body,/not confirmed/);
  assert.match(shareResultNotice({status:'needs-input',botName:'Alpha',locale:'zh-CN'}).body,/发送记录/);
});

test('composer chrome keeps an always-visible close control and a drag grip',async()=>{
  const root=fileURLToPath(new URL('../src/',import.meta.url));
  const composer=await readFile(`${root}renderer/composer.mjs`,'utf8');
  const css=await readFile(`${root}renderer/composer.css`,'utf8');
  const main=await readFile(`${root}main/main.mjs`,'utf8');
  const app=await readFile(`${root}renderer/app.mjs`,'utf8');
  assert.match(composer,/const close=el\('button','close'\)/);
  assert.doesNotMatch(composer,/if\(!prefs\(\)\.dismissOnOutside\)\{const close/);
  assert.match(composer,/classList\.add\('grip'\)|el\('div','grip'\)/);
  assert.match(css,/\.grip\{[^}]*-webkit-app-region:drag/);
  assert.match(css,/\.avatar\.picture\{[^}]*overflow:hidden/);
  assert.match(css,/\.avatar img\{[^}]*object-fit:cover/);
  assert.match(css,/\.float-avatar\{[^}]*drop-shadow/);
  assert.match(main,/avatarBox=104/);
  assert.match(main,/movable:true/);
  assert.match(main,/floatWindow\.on\('move'/);
  assert.match(main,/process\.platform==='darwin'\?\{parent:floatWindow\}/);
  assert.match(main,/process\.platform!=='darwin'\)layoutExtras\(\)/);
  assert.match(main,/case 'fileSizes'/);
  assert.match(main,/submitAsync/);
  assert.match(main,/case 'keepComposerOpen'/);
  assert.match(main,/latestState\.accountBusy\)throw new Error\('ACCOUNT_BUSY'\)/);
  assert.match(app,/update\.disabled=!menu\.available\|\|menu\.busy\|\|!!state\.accountBusy/);
  assert.match(app,/function paintGridDots/);
  assert.match(app,/recipient-settings/);
  const signature=app.slice(app.indexOf('function viewSignature'),app.indexOf('function botRowKey'));
  assert.doesNotMatch(signature,/recipient\?\.enabled/);
  assert.doesNotMatch(signature,/recipient\?\.sources/);
  assert.match(composer,/function renderBar/);
  assert.match(composer,/card\.hidden=false/);
  assert.match(composer,/largeConfirmCard/);
  assert.match(composer,/50\*1024\*1024/);
  assert.match(composer,/keepComposerOpen/);
  assert.match(composer,/draft\.preparing/);
  assert.match(main,/share\.preparing/);
  assert.match(css,/\.send-bar\{/);
  const hide=main.slice(main.indexOf('function hideFloat'),main.indexOf('function wireFloat'));
  assert.match(hide,/Do not blur the main window/);
  assert.doesNotMatch(hide,/window\.blur\(/);
});

test('an accent-colored selected control uses the computed readable ink',async()=>{
  const root=fileURLToPath(new URL('../src/',import.meta.url));
  const app=await readFile(`${root}renderer/app.mjs`,'utf8');
  const css=await readFile(`${root}renderer/styles.css`,'utf8');
  assert.match(app,/setProperty\('--on-accent',accentInk\(accent\)\)/);
  assert.match(css,/\.detail \.segment button\.selected[^}]*color:var\(--on-accent/);
  assert.match(css,/\.detail \.source-chip\.selected[^}]*color:var\(--on-accent/);
});
