import {readdir,realpath,stat} from 'node:fs/promises';
import {basename,isAbsolute,join} from 'node:path';
import {inspectWhatsAppIntake} from './whatsapp-export.mjs';

const PREFERENCE = 'whatsappWatch';
const PARTIAL = /\.(crdownload|download|part|tmp)$/i;

export function isIgnoredWatchName(name) {
  const base = basename(String(name ?? ''));
  return !base || base.startsWith('.') || PARTIAL.test(base);
}

export function isWatchCandidate(name) {
  return !isIgnoredWatchName(name) && /\.(zip|txt)$/i.test(basename(String(name)));
}

export function watchIdentity(path, size, mtimeMs) {
  return JSON.stringify([path, Number(size) || 0, Math.round(Number(mtimeMs) || 0)]);
}

// A strong export filename is not enough: the parser has to actually read a chat.
export function isConfirmedWhatsAppExport(inspected) {
  return Boolean(inspected?.sourceTag === 'WhatsApp' && (inspected.participants?.length || inspected.start || inspected.end));
}

function loadStored(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const dir = typeof raw.dir === 'string' && isAbsolute(raw.dir) ? raw.dir : '';
  const seen = Array.isArray(raw.seen) ? raw.seen.filter(item => typeof item === 'string') : [];
  return {enabled: raw.enabled === true, dir, seen};
}

export class WhatsAppFolderWatch {
  constructor({session, downloadsDir = ''} = {}) {
    this.session = session;
    this.downloadsDir = typeof downloadsDir === 'string' && isAbsolute(downloadsDir) ? downloadsDir : '';
    this.pending = new Map();
    this.busy = false;
    this.generation = 0;
  }
  stored() { return loadStored(this.session.store.preference(PREFERENCE)); }
  resolvedDir(stored = this.stored()) { return stored.dir || this.downloadsDir; }
  view() {
    const stored = this.stored();
    return {enabled: stored.enabled, dir: stored.dir, path: this.resolvedDir(stored), usingDefault: !stored.dir};
  }
  save(stored) {
    this.session.store.preference(PREFERENCE, {enabled: stored.enabled === true, dir: stored.dir || '', seen: stored.seen});
  }
  async resolveChosen(dir) {
    if (typeof dir !== 'string' || !isAbsolute(dir)) throw new Error('WATCH_DIR_INVALID');
    let resolved;
    try { resolved = await realpath(dir); } catch { throw new Error('WATCH_DIR_INVALID'); }
    const info = await stat(resolved).catch(() => null);
    if (!info?.isDirectory()) throw new Error('WATCH_DIR_INVALID');
    return resolved;
  }
  async baseline(folder, seen) {
    if (!folder) return;
    let names = [];
    try { names = await readdir(folder); } catch { return; }
    for (const name of names) {
      if (!isWatchCandidate(name)) continue;
      try {
        const path = join(folder, name);
        const info = await stat(path);
        if (!info.isFile()) continue;
        seen.add(watchIdentity(path, info.size, info.mtimeMs));
      } catch { /* A name that disappears is not part of the baseline. */ }
    }
  }
  async set({enabled, dir, resetDir} = {}) {
    this.generation += 1;
    const current = this.stored();
    let nextDir = current.dir;
    if (resetDir === true) nextDir = '';
    else if (typeof dir === 'string') nextDir = dir === '' ? '' : await this.resolveChosen(dir);
    const nextEnabled = typeof enabled === 'boolean' ? enabled : current.enabled;
    const restart = nextEnabled && (!current.enabled || nextDir !== current.dir);
    const seen = new Set(current.seen);
    if (restart) {
      this.pending.clear();
      await this.baseline(nextDir || this.downloadsDir, seen);
    }
    this.save({enabled: nextEnabled, dir: nextDir, seen: [...seen]});
    this.session.emit();
    return this.session.snapshot();
  }
  async scan() {
    if (this.busy) return;
    const generation = this.generation;
    const stored = this.stored();
    if (!stored.enabled || !this.session.account) return;
    const folder = this.resolvedDir(stored);
    const accountId = this.session.account.id;
    const botId = this.session.sourceDefaults().whatsapp?.botId ?? '';
    if (!folder || !botId) return;
    const recipient = this.session.store.recipient(accountId, botId);
    if (!recipient.enabled || recipient.sources?.whatsapp !== true) return;
    this.busy = true;
    try {
      let names = [];
      try { names = await readdir(folder); } catch { return; }
      const seen = new Set(this.stored().seen);
      let dirty = false;
      const remember = () => {
        if (this.generation !== generation) return false;
        const latest = this.stored();
        this.save({enabled: latest.enabled, dir: latest.dir, seen: [...seen]});
        dirty = false;
        return true;
      };
      for (const name of names) {
        if (this.generation !== generation) return;
        if (!isWatchCandidate(name)) continue;
        const path = join(folder, name);
        let info;
        try { info = await stat(path); } catch { continue; }
        if (!info.isFile() || info.size < 1) continue;
        const key = watchIdentity(path, info.size, info.mtimeMs);
        if (seen.has(key)) { this.pending.delete(path); continue; }
        if (this.pending.get(path) !== key) { this.pending.set(path, key); continue; }
        let inspected = null;
        try { inspected = await inspectWhatsAppIntake({files: [path], fileNames: [name], title: name}); } catch { inspected = null; }
        if (this.generation !== generation) return;
        if (!isConfirmedWhatsAppExport(inspected)) {
          seen.add(key);
          this.pending.delete(path);
          dirty = true;
          continue;
        }
        seen.add(key);
        this.pending.delete(path);
        if (!remember()) return;
        const sourceId = `whatsapp:watch:${key}`;
        try {
          const item = await this.session.receive({botId, source: 'whatsapp', files: [path], fileNames: [name], title: inspected.chatName || '', sourceId});
          if (this.generation === generation) this.session.onEvent({event: 'whatsapp.imported', data: {chatName: item?.title || inspected.chatName || '', fileName: name, botId}});
        } catch {
          if (this.generation !== generation) return;
          const landed = this.session.store.list(accountId).some(row => row.sourceId === sourceId);
          if (!landed) { seen.delete(key); remember(); }
        }
      }
      if (dirty) remember();
    } finally { this.busy = false; }
  }
}
