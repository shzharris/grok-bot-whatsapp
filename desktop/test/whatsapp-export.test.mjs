import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {chatNameFromFilename,inspectWhatsAppIntake,parseWhatsAppChat,renderWhatsAppDelivery} from '../src/service/whatsapp-export.mjs';

const fixture = name => readFile(new URL(`./fixtures/whatsapp/${name}`, import.meta.url), 'utf8');

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 0;
    const stored = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
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
    central.writeUInt16LE(method, 10);
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

test('iOS 12-hour exports keep multiline text, attachments, and the time range', async () => {
  const parsed = parseWhatsAppChat(await fixture('ios-en-12h.txt'));
  assert.deepEqual(parsed.participants, ['Alice', 'Bob']);
  assert.equal(parsed.start, '2024-12-31 23:59');
  assert.equal(parsed.end, '2025-01-01 09:01');
  assert.equal(parsed.attachmentNames[0], '00000001-PHOTO.jpg');
  assert.match(parsed.messages[0].text, /Hello\nthis continues/);
  assert.equal(parsed.messages.some(message => message.system && /end-to-end encrypted/.test(message.text)), true);
  assert.equal(parsed.order, 'mdy');
});

test('Chinese bracketed exports ignore system lines and keep the afternoon clock', async () => {
  const parsed = parseWhatsAppChat(await fixture('ios-zh.txt'));
  assert.deepEqual(parsed.participants, ['小明', '小红']);
  assert.equal(parsed.start, '2024-01-15 15:45');
  assert.equal(parsed.end, '2024-01-15 16:01');
  assert.match(parsed.messages.find(message => message.sender === '小红').text, /图像已省略\n还没发图/);
  assert.equal(parsed.messages.filter(message => message.system).length, 1);
});

test('Android dash exports accept day-first dates, dotted dates, and Chinese attachment placeholders', async () => {
  const dmy = parseWhatsAppChat(await fixture('android-dmy.txt'));
  assert.equal(dmy.order, 'dmy');
  assert.equal(dmy.start, '2024-02-13 08:00');
  assert.equal(dmy.end, '2025-01-01 09:05');
  assert.deepEqual(dmy.participants, ['Alice', 'Bob']);
  assert.match(dmy.messages.find(message => message.sender === 'Bob').text, /image omitted\n下一行/);
  const dots = parseWhatsAppChat(await fixture('android-dots.txt'));
  assert.equal(dots.start, '2024-02-13 18:05');
  assert.deepEqual(dots.attachmentNames, ['笔记.pdf']);
  const mdy = parseWhatsAppChat(await fixture('android-mdy-12h.txt'));
  assert.equal(mdy.order, 'mdy');
  assert.equal(mdy.start, '2024-02-13 13:05');
  assert.deepEqual(mdy.participants, ['Alice']);
  assert.equal(mdy.messages.some(message => message.system), true);
});

test('ambiguous dates follow the clock: month-first with AM/PM, day-first in 24-hour exports', () => {
  const us = parseWhatsAppChat('[01/02/03, 1:05 PM] Ann: Hi\n[01/03/03, 2:00 PM] Ann: Next');
  assert.equal(us.start, '2003-01-02 13:05');
  const eu = parseWhatsAppChat('01/02/03, 13:05 - Ann: Hi\n03/02/03, 14:00 - Ann: Next');
  assert.equal(eu.start, '2003-02-01 13:05');
  assert.equal(eu.end, '2003-02-03 14:00');
});

test('chat names come from the export filename', () => {
  assert.equal(chatNameFromFilename('WhatsApp Chat - 家庭群.zip'), '家庭群');
  assert.equal(chatNameFromFilename('WhatsApp Chat with Alice.txt'), 'Alice');
  assert.equal(chatNameFromFilename('与项目组的 WhatsApp 聊天.zip'), '项目组');
  assert.equal(chatNameFromFilename('_chat.txt'), '');
});

test('delivery text carries the WhatsApp tag and the scenario prefix', async () => {
  const parsed = {...parseWhatsAppChat(await fixture('ios-zh.txt')), chatName: '家庭群'};
  const text = renderWhatsAppDelivery(parsed, {prefix: '整理要点、痛点和可做的选题'});
  assert.match(text, /^\[WhatsApp\]/);
  assert.match(text, /整理要点、痛点和可做的选题/);
  assert.match(text, /聊天：家庭群/);
  assert.match(text, /参与者：小明、小红/);
  assert.match(text, /时间：2024-01-15 15:45 – 2024-01-15 16:01/);
});

test('a zip with or without media is detected from _chat.txt and does not follow unsafe paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gba-wa-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const chat = Buffer.from(await fixture('ios-zh.txt'), 'utf8');
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const withMedia = join(root, 'WhatsApp Chat - 家庭群.zip');
  await writeFile(withMedia, zip([
    {name: '_chat.txt', data: chat, method: 8},
    {name: '00000001-PHOTO.jpg', data: photo, method: 0},
    {name: '../secret.txt', data: Buffer.from('nope')}
  ]));
  const extracted = join(root, 'media');
  const rich = await inspectWhatsAppIntake({files: [withMedia], fileNames: ['WhatsApp Chat - 家庭群.zip'], prefix: '整理要点、痛点和可做的选题', extractDir: extracted});
  assert.equal(rich.chatName, '家庭群');
  assert.equal(rich.sourceTag, 'WhatsApp');
  assert.match(rich.text, /\[WhatsApp\]/);
  assert.match(rich.text, /整理要点、痛点和可做的选题/);
  assert.ok(rich.fileNames.includes('00000001-PHOTO.jpg'));
  assert.equal(rich.fileNames.includes('secret.txt'), false);
  const bare = join(root, 'chat-only.zip');
  await writeFile(bare, zip([{name: '_chat.txt', data: chat, method: 8}]));
  const plain = await inspectWhatsAppIntake({files: [bare], fileNames: ['chat-only.zip'], extractDir: join(root, 'none')});
  assert.deepEqual(plain.participants, ['小明', '小红']);
  assert.deepEqual(plain.fileNames, ['chat-only.zip']);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(await fixture('android-dots.txt'), 'utf16le')]);
  const utfPath = join(root, '_chat.txt');
  await writeFile(utfPath, utf16);
  const decoded = await inspectWhatsAppIntake({files: [utfPath], fileNames: ['_chat.txt']});
  assert.deepEqual(decoded.attachmentNames, ['笔记.pdf']);
  const notes = join(root, 'forward.zip');
  await writeFile(notes, Buffer.alloc(64, 1));
  assert.equal(await inspectWhatsAppIntake({files: [notes], fileNames: ['forward.zip'], text: '会议记录'}), null);
});
