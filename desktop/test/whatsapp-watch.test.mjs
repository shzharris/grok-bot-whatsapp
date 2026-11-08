import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {InboxStore} from '../src/service/store.mjs';
import {AccountSession} from '../src/service/session.mjs';
import {isIgnoredWatchName} from '../src/service/whatsapp-watch.mjs';

const bot = {id: 'bot-one', name: 'Research', sessionId: 's'};
const chat = Buffer.from('[31/12/2024, 23:59:59] Alice: Hello\n[01/01/2025, 09:01:00] Bob: Hi\n');

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const stored = deflateRawSync(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, stored);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + stored.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const exportZip = () => zip([{name: '_chat.txt', data: chat}]);

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'gba-watch-'));
  const downloads = join(root, 'Downloads');
  const other = join(root, 'Other');
  await mkdir(downloads);
  await mkdir(other);
  const store = new InboxStore(join(root, 'inbox'));
  const events = [];
  const client = {getMe: async () => ({authId: 'account-a', email: 'person@example.test'}), listBots: async () => ({bots: [bot], truncated: false}), sendMessage: async () => ({delivery: 'accepted'})};
  const session = new AccountSession({store, sdk: {GrokBotClient: class {constructor() {return client;}}}, downloadsDir: downloads, onEvent: message => events.push(message)});
  t.after(async () => {session.close(); store.close(); await rm(root, {recursive: true, force: true});});
  await session.connect({accessToken: 'test-secret'});
  session.setSourceDefaults({whatsapp: {botId: bot.id, prefix: '整理要点、痛点和可做的选题'}});
  return {session, store, downloads, other, events};
}

test('partial downloads are ignored by name', () => {
  assert.equal(isIgnoredWatchName('WhatsApp Chat - News.zip.crdownload'), true);
  assert.equal(isIgnoredWatchName('WhatsApp Chat - News.zip.download'), true);
  assert.equal(isIgnoredWatchName('.hidden.zip'), true);
  assert.equal(isIgnoredWatchName('WhatsApp Chat - News.zip'), false);
  assert.equal(isIgnoredWatchName('_chat.txt'), false);
});

test('auto-import is off until enabled and does not take files already in the folder', async t => {
  const {session, store, downloads} = await setup(t);
  assert.equal(session.whatsappWatch.view().enabled, false);
  assert.equal(session.whatsappWatch.view().usingDefault, true);
  assert.equal(session.whatsappWatch.view().path, downloads);
  const existing = join(downloads, 'WhatsApp Chat - Old.zip');
  const bytes = exportZip();
  await writeFile(existing, bytes);
  await session.whatsappWatch.scan();
  await session.whatsappWatch.scan();
  assert.equal(store.list('account-a').length, 0);
  await session.whatsappWatch.set({enabled: true});
  await session.whatsappWatch.scan();
  await session.whatsappWatch.scan();
  assert.equal(store.list('account-a').length, 0);
  assert.deepEqual(await readFile(existing), bytes);
});

test('a finished export that appears after enabling is delivered once and left in place', async t => {
  const {session, store, downloads, events} = await setup(t);
  await session.whatsappWatch.set({enabled: true});
  const path = join(downloads, 'WhatsApp Chat - News.zip');
  const bytes = exportZip();
  await writeFile(path, bytes);
  await writeFile(join(downloads, 'WhatsApp Chat - News.zip.crdownload'), bytes);
  await writeFile(join(downloads, 'notes.txt'), 'not a chat');
  await session.whatsappWatch.scan();
  assert.equal(store.list('account-a').length, 0);
  await session.whatsappWatch.scan();
  const items = store.list('account-a');
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'whatsapp');
  assert.equal(items[0].sourceTag, 'WhatsApp');
  assert.equal(items[0].title, 'News');
  assert.match(items[0].text, /\[WhatsApp\]/);
  assert.match(items[0].text, /整理要点、痛点和可做的选题/);
  assert.match(items[0].text, /参与者：Alice、Bob/);
  assert.deepEqual(await readFile(path), bytes);
  assert.equal(events.filter(event => event.event === 'whatsapp.imported').length, 1);
  assert.equal(events.find(event => event.event === 'whatsapp.imported').data.chatName, 'News');
  await session.whatsappWatch.scan();
  await session.whatsappWatch.scan();
  assert.equal(store.list('account-a').length, 1);
});

test('changing the folder baselines it, and reset returns to Downloads', async t => {
  const {session, store, downloads, other} = await setup(t);
  await session.whatsappWatch.set({enabled: true});
  const parked = join(other, 'WhatsApp Chat - Parked.zip');
  await writeFile(parked, exportZip());
  await session.whatsappWatch.set({dir: other});
  assert.equal(session.whatsappWatch.view().usingDefault, false);
  assert.equal(session.whatsappWatch.view().path, await realpath(other));
  await session.whatsappWatch.scan();
  await session.whatsappWatch.scan();
  assert.equal(store.list('account-a').length, 0);
  assert.deepEqual(await readFile(parked), exportZip());
  const fresh = join(other, 'WhatsApp Chat - Fresh.zip');
  await writeFile(fresh, exportZip());
  await session.whatsappWatch.scan();
  await session.whatsappWatch.scan();
  assert.equal(store.list('account-a').length, 1);
  assert.equal(store.list('account-a')[0].title, 'Fresh');
  await session.whatsappWatch.set({resetDir: true});
  assert.equal(session.whatsappWatch.view().usingDefault, true);
  assert.equal(session.whatsappWatch.view().path, downloads);
  await assert.rejects(session.whatsappWatch.set({dir: 'Downloads'}), /WATCH_DIR_INVALID/);
  await writeFile(join(downloads, 'not-a-dir.txt'), 'x');
  await assert.rejects(session.whatsappWatch.set({dir: join(downloads, 'not-a-dir.txt')}), /WATCH_DIR_INVALID/);
  assert.equal(session.whatsappWatch.view().usingDefault, true);
});

test('the settings offer a folder picker and a reset to Downloads', async () => {
  const renderer = await readFile(new URL('../src/renderer/app.mjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main/main.mjs', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  assert.match(renderer, /自动导入 WhatsApp 导出/);
  assert.match(renderer, /选择文件夹/);
  assert.match(renderer, /恢复为下载文件夹/);
  assert.match(renderer, /chooseWhatsAppWatchDir/);
  assert.match(main, /chooseWhatsAppWatchDir/);
  assert.match(main, /openDirectory/);
  assert.match(main, /whatsapp\.imported/);
  assert.match(preload, /chooseWhatsAppWatchDir/);
});
