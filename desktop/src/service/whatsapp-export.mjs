import {open, mkdir, writeFile, readFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {inflateRawSync} from 'node:zlib';

const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const ODD_SPACE = /[\u00A0\u202F\u2007\u2009]/g;
const CHAT_NAME_PATTERNS = [
  /^WhatsApp Chat\s*[-–—]\s*(.+)$/i,
  /^WhatsApp Chat with\s+(.+)$/i,
  /^WhatsApp Chat mit\s+(.+)$/i,
  /^Chat de WhatsApp con\s+(.+)$/i,
  /^Discussion WhatsApp avec\s+(.+)$/i,
  /^Conversa do WhatsApp com\s+(.+)$/i,
  /^与\s*(.+?)\s*的\s*WhatsApp\s*聊天(?:记录)?$/,
  /^WhatsApp\s*聊天(?:记录)?\s*[-–—]\s*(.+)$/,
  /^WhatsApp 与\s*(.+?)\s*的聊天$/
];
const DATE_RE = /^(?:(\d{4})年(\d{1,2})月(\d{1,2})日|(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{2,4}))[,，]?\s*/;
const TIME_RE = /^(?:(上午|下午|am|pm|a\.m\.|p\.m\.)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(上午|下午|am|pm|a\.m\.|p\.m\.))?/i;
const SYSTEM_HINT = /端到端加密|end-to-end encrypted|security code|安全码|已添加|添加了|added |removed |移除了|退出了|left$|created group|创建了群组|changed the subject|更改了|changed this group|you're now an admin|你现在是管理员|this message was deleted|已删除|missed voice call|missed video call|未接语音|未接视频|changed their phone number|商业账|waiting for this message|这条消息正在等待|pinned a message|置顶了|disappearing messages|限时消息/i;
const ATTACHED_RE = /<attached:\s*([^>]+)>|<附件[:：]\s*([^>]+)>|([^\s<>"]+?\.[A-Za-z0-9]{1,8})\s*\(file attached\)/gi;
const OMITTED_RE = /(image|video|audio|sticker|GIF|document|contact card)\s+omitted|(图像|图片|视频|音频|贴纸|文档|名片|媒体(?:文件)?)已省略|<媒体文件已省略>|<Media omitted>/gi;
const MAX_CHAT_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACT_BYTES = 200 * 1024 * 1024;
const MAX_EXTRACT_FILES = 99;

export function chatNameFromFilename(name) {
  const base = String(name ?? '').replace(/\.(zip|txt)$/i, '').trim();
  if (!base || /^_chat$/i.test(base)) return '';
  for (const pattern of CHAT_NAME_PATTERNS) {
    const match = pattern.exec(base);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function cleanText(value) {
  return String(value ?? '').replace(BIDI, '').replace(ODD_SPACE, ' ');
}

function matchStamp(input) {
  const date = DATE_RE.exec(input);
  if (!date) return null;
  const parsed = date[1]
    ? {kind: 'ymd', a: Number(date[1]), b: Number(date[2]), c: Number(date[3])}
    : {kind: 'num', a: Number(date[4]), b: Number(date[5]), c: Number(date[6])};
  const time = TIME_RE.exec(input.slice(date[0].length));
  if (!time) return null;
  const minute = Number(time[3]);
  const second = time[4] ? Number(time[4]) : 0;
  const hour = Number(time[2]);
  if (minute > 59 || second > 59 || hour > 23) return null;
  const ampm = (time[1] || time[5] || '').toLowerCase();
  return {date: parsed, ampm, hour, minute, second, consumed: date[0].length + time[0].length, uses12h: !!ampm};
}

function matchHeader(line) {
  if (line.startsWith('[')) {
    const close = line.indexOf(']');
    if (close < 1) return null;
    const inside = line.slice(1, close).trim();
    const stamp = matchStamp(inside);
    if (!stamp || stamp.consumed !== inside.length) return null;
    return {...stamp, rest: line.slice(close + 1).replace(/^\s/, ''), style: 'ios'};
  }
  const stamp = matchStamp(line);
  if (!stamp) return null;
  const separator = /^\s*[-–—]\s+/.exec(line.slice(stamp.consumed));
  if (!separator) return null;
  return {...stamp, rest: line.slice(stamp.consumed + separator[0].length), style: 'android'};
}

function inferDateOrder(samples, uses12h) {
  let dayFirst = false;
  let monthFirst = false;
  for (const sample of samples) {
    if (sample.kind === 'ymd' || sample.a >= 1000) continue;
    if (sample.a > 12) dayFirst = true;
    if (sample.b > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return 'dmy';
  if (monthFirst && !dayFirst) return 'mdy';
  if (dayFirst && monthFirst) return 'mixed';
  return uses12h ? 'mdy' : 'dmy';
}

function toYear(value) {
  if (value >= 1000) return value;
  return value >= 70 ? 1900 + value : 2000 + value;
}

function validDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function resolveDate(sample, order) {
  if (sample.kind === 'ymd' || sample.a >= 1000) return validDate(sample.a, sample.b, sample.c) ? {y: sample.a, m: sample.b, d: sample.c} : null;
  const year = toYear(sample.c);
  let month = sample.b;
  let day = sample.a;
  const local = order === 'mixed' ? (sample.a > 12 ? 'dmy' : sample.b > 12 ? 'mdy' : order) : order;
  if (local === 'mdy') { month = sample.a; day = sample.b; }
  if (!validDate(year, month, day)) return null;
  return {y: year, m: month, d: day};
}

function toHour(hour, ampm) {
  if (!ampm) return hour <= 23 ? hour : null;
  const pm = ampm === '下午' || ampm === 'pm' || ampm === 'p.m.';
  const am = ampm === '上午' || ampm === 'am' || ampm === 'a.m.';
  if (!pm && !am) return null;
  if (hour < 1 || hour > 12) return null;
  if (pm) return hour === 12 ? 12 : hour + 12;
  return hour === 12 ? 0 : hour;
}

function splitSender(rest) {
  const text = cleanText(rest).trim();
  const senderMatch = /^([^:\n]{1,40}):\s([\s\S]*)$/.exec(text);
  if (!senderMatch || SYSTEM_HINT.test(senderMatch[1]) || /[.。!！]/.test(senderMatch[1]) || senderMatch[1].trim().split(/\s+/).length > 6) {
    return {system: true, text};
  }
  return {system: false, sender: senderMatch[1].trim(), text: senderMatch[2]};
}

function collectAttachments(text) {
  const names = [];
  const source = cleanText(text);
  for (const match of source.matchAll(ATTACHED_RE)) {
    const name = (match[1] || match[2] || match[3] || '').trim();
    if (name) names.push(name);
  }
  const omitted = [];
  for (const match of source.matchAll(OMITTED_RE)) omitted.push(match[0]);
  return {names, omitted};
}

function formatStamp(stamp) {
  const pad = value => String(value).padStart(2, '0');
  return `${stamp.y}-${pad(stamp.m)}-${pad(stamp.d)} ${pad(stamp.h)}:${pad(stamp.min)}`;
}

export function parseWhatsAppChat(raw) {
  const transcript = cleanText(raw).replace(/^\uFEFF/, '');
  if (!transcript.trim()) return null;
  const lines = transcript.split(/\r?\n/);
  const headers = lines.map(line => matchHeader(line.trim()));
  const samples = headers.filter(Boolean).map(header => header.date);
  if (!samples.length) return null;
  const uses12h = headers.some(header => header?.uses12h);
  const order = inferDateOrder(samples, uses12h);
  const messages = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = headers[index];
    if (!header) {
      if (messages.length) messages[messages.length - 1].text += `\n${lines[index]}`;
      continue;
    }
    const date = resolveDate(header.date, order);
    const hour = toHour(header.hour, header.ampm);
    if (!date || hour === null) {
      if (messages.length) messages[messages.length - 1].text += `\n${lines[index]}`;
      continue;
    }
    const body = splitSender(header.rest);
    const attachments = collectAttachments(body.text);
    messages.push({
      ...date,
      h: hour,
      min: header.minute,
      second: header.second,
      style: header.style,
      system: body.system,
      sender: body.sender ?? '',
      text: body.text,
      attachments
    });
  }
  if (!messages.length) return null;
  const participants = [];
  const seen = new Set();
  const attachmentNames = [];
  const attachmentSeen = new Set();
  for (const message of messages) {
    if (!message.system && message.sender && !seen.has(message.sender)) {
      seen.add(message.sender);
      participants.push(message.sender);
    }
    for (const name of message.attachments.names) {
      if (!attachmentSeen.has(name)) {
        attachmentSeen.add(name);
        attachmentNames.push(name);
      }
    }
  }
  const stamps = messages.map(message => ({...message, value: Date.UTC(message.y, message.m - 1, message.d, message.h, message.min, message.second)}));
  const sorted = [...stamps].sort((a, b) => a.value - b.value);
  return {
    messages,
    participants,
    start: formatStamp(sorted[0]),
    end: formatStamp(sorted[sorted.length - 1]),
    transcript: transcript.trim(),
    attachmentNames,
    order
  };
}

export function renderWhatsAppDelivery(parsed, {prefix = ''} = {}) {
  const lines = ['[WhatsApp]'];
  const instruction = String(prefix ?? '').trim();
  if (instruction) lines.push(instruction);
  lines.push('');
  if (parsed.chatName) lines.push(`聊天：${parsed.chatName}`);
  if (parsed.participants?.length) lines.push(`参与者：${parsed.participants.join('、')}`);
  if (parsed.start || parsed.end) lines.push(`时间：${parsed.start || '…'} – ${parsed.end || '…'}`);
  lines.push('');
  if (parsed.transcript) lines.push(parsed.transcript);
  if (parsed.note) lines.push('', parsed.note);
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > 2_000_000) text = `${text.slice(0, 1_999_000)}\n…`;
  return text;
}

export function prependInstruction(text, instruction) {
  const prefix = String(instruction ?? '').trim();
  const body = String(text ?? '');
  if (!prefix || body === prefix || body.startsWith(`${prefix}\n`)) return body;
  return body.trim() ? `${prefix}\n\n${body}` : prefix;
}

function decodeChat(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) return buffer.toString('utf16le');
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return buffer.toString('utf8');
  return buffer.toString('utf8');
}

function decodeZipName(buffer, flags) {
  if (flags & 0x800) return buffer.toString('utf8');
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  return buffer.toString('latin1');
}

function safeZipPath(name) {
  const normalized = String(name ?? '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '..')) return '';
  return normalized;
}

async function readExact(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const {bytesRead} = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error('ZIP_UNSUPPORTED');
  return buffer;
}

async function readZipEntries(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const {size} = await handle.stat();
    if (size < 22 || size > 2 * 1024 * 1024 * 1024) throw new Error('ZIP_UNSUPPORTED');
    const tailLen = Math.min(size, 22 + 65535);
    const tail = await readExact(handle, size - tailLen, tailLen);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
    }
    if (eocd < 0) throw new Error('ZIP_UNSUPPORTED');
    const total = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) throw new Error('ZIP_UNSUPPORTED');
    const directory = await readExact(handle, cdOffset, cdSize);
    const entries = [];
    let cursor = 0;
    while (cursor + 46 <= directory.length && entries.length < total) {
      if (directory.readUInt32LE(cursor) !== 0x02014b50) break;
      const flags = directory.readUInt16LE(cursor + 8);
      const method = directory.readUInt16LE(cursor + 10);
      const compSize = directory.readUInt32LE(cursor + 20);
      const uncompSize = directory.readUInt32LE(cursor + 24);
      const nameLen = directory.readUInt16LE(cursor + 28);
      const extraLen = directory.readUInt16LE(cursor + 30);
      const commentLen = directory.readUInt16LE(cursor + 32);
      const localOffset = directory.readUInt32LE(cursor + 42);
      const name = safeZipPath(decodeZipName(directory.subarray(cursor + 46, cursor + 46 + nameLen), flags));
      if (name && !name.endsWith('/') && !(flags & 0x1) && (method === 0 || method === 8) && compSize !== 0xFFFFFFFF) {
        entries.push({name, flags, method, compSize, uncompSize, localOffset});
      }
      cursor += 46 + nameLen + extraLen + commentLen;
    }
    return {handle, entries};
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function readZipEntry(handle, entry, maxBytes) {
  if (entry.uncompSize > maxBytes || entry.compSize > maxBytes) throw new Error('ZIP_TOO_LARGE');
  const header = await readExact(handle, entry.localOffset, 30);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP_UNSUPPORTED');
  const dataOffset = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const compressed = await readExact(handle, dataOffset, entry.compSize);
  if (entry.method === 0) return compressed;
  const inflated = inflateRawSync(compressed);
  if (inflated.length > maxBytes) throw new Error('ZIP_TOO_LARGE');
  return inflated;
}

function isChatFile(name) {
  return /^_chat\.txt$/i.test(basename(String(name ?? '')));
}

function fileHint(name) {
  const base = basename(String(name ?? ''));
  if (isChatFile(base)) return 'strong';
  if (chatNameFromFilename(base)) return 'strong';
  if (/\.(zip|txt)$/i.test(base)) return 'maybe';
  return '';
}

function acceptParsed(parsed, hint) {
  if (!parsed?.messages?.length) return false;
  if (hint === 'strong') return true;
  const system = parsed.messages.some(message => message.system && /端到端加密|end-to-end encrypted|file attached|<attached:|已省略/i.test(`${message.text} ${message.attachments?.names?.join(' ') ?? ''}`));
  return system || parsed.messages.length >= 3;
}

function safeExtractName(name, used) {
  const base = basename(name).replace(/[\u0000-\u001f]/g, '').slice(-120);
  if (!base || base === '.' || base === '..' || base.startsWith('.')) return '';
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${suffix}-${base}`;
  }
  used.add(candidate);
  return candidate;
}

export async function inspectWhatsAppIntake({files = [], fileNames, text = '', title = '', prefix = '', extractDir} = {}) {
  const named = files.map((file, index) => ({path: file, name: fileNames?.[index] || basename(file)}));
  let chatName = chatNameFromFilename(title);
  let parsed = null;
  let hint = 'text';
  const zip = named.find(file => /\.zip$/i.test(file.name) && fileHint(file.name));
  const chat = named.find(file => isChatFile(file.name)) ?? named.find(file => fileHint(file.name) === 'strong' && /\.txt$/i.test(file.name));
  let archive = null;
  try {
    if (chat) {
      hint = 'strong';
      chatName = chatName || chatNameFromFilename(chat.name) || chatNameFromFilename(basename(dirname(chat.path)));
      const buffer = await readFile(chat.path);
      if (buffer.length <= MAX_CHAT_BYTES) parsed = parseWhatsAppChat(decodeChat(buffer));
    } else if (zip) {
      hint = fileHint(zip.name);
      chatName = chatName || chatNameFromFilename(zip.name);
      const opened = await readZipEntries(zip.path);
      archive = opened;
      const entry = opened.entries.find(item => isChatFile(item.name)) ?? opened.entries.find(item => /\.txt$/i.test(item.name) && hint === 'strong');
      if (entry) {
        if (isChatFile(entry.name)) hint = 'strong';
        const buffer = await readZipEntry(opened.handle, entry, MAX_CHAT_BYTES);
        parsed = parseWhatsAppChat(decodeChat(buffer));
      }
    } else if (text.trim()) {
      parsed = parseWhatsAppChat(text);
    }
  } catch {
    parsed = null;
  }
  if (!acceptParsed(parsed, hint) && !(hint === 'strong' && (chat || zip))) {
    await archive?.handle?.close().catch(() => {});
    return null;
  }
  const record = parsed ?? {participants: [], start: '', end: '', transcript: cleanText(text).trim(), attachmentNames: [], messages: []};
  const noteParts = [];
  const outFiles = named.map(file => file.path);
  const outNames = named.map(file => basename(file.name).replace(/[\\/]/g, '') || 'attachment');
  if (archive && extractDir && parsed) {
    try {
      await mkdir(extractDir, {recursive: true, mode: 0o700});
      const used = new Set(outNames);
      let extractedBytes = 0;
      let skipped = 0;
      for (const entry of archive.entries) {
        if (isChatFile(entry.name) || entry.name.includes('__MACOSX/')) continue;
        if (outFiles.length >= 100 || extractedBytes >= MAX_EXTRACT_BYTES) { skipped += 1; continue; }
        if (entry.uncompSize > MAX_ENTRY_BYTES) { skipped += 1; continue; }
        const filename = safeExtractName(entry.name, used);
        if (!filename) continue;
        try {
          const bytes = await readZipEntry(archive.handle, entry, MAX_ENTRY_BYTES);
          if (!bytes.length) continue;
          extractedBytes += bytes.length;
          const target = join(extractDir, filename);
          await writeFile(target, bytes, {mode: 0o600});
          outFiles.push(target);
          outNames.push(filename);
        } catch { skipped += 1; }
      }
      if (skipped) noteParts.push(`还有 ${skipped} 个媒体没有展开。`);
    } catch { /* The original archive stays attached. */ }
  }
  await archive?.handle?.close().catch(() => {});
  const delivery = {...record, chatName, note: noteParts.join('\n')};
  return {
    chatName,
    participants: record.participants,
    start: record.start,
    end: record.end,
    attachmentNames: record.attachmentNames ?? [],
    text: renderWhatsAppDelivery(delivery, {prefix}),
    files: outFiles,
    fileNames: outNames,
    sourceTag: 'WhatsApp'
  };
}
