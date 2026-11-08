export const SOURCE_DEFAULT_KEYS = ['share', 'whatsapp'];

// Choosing the generic default turns on both halves of 通用: system share and drop.
export const SOURCE_DEFAULT_FLAGS = {share: ['share', 'drop'], whatsapp: ['whatsapp']};

export function emptySourceDefaults() {
  return {share: {botId: '', prefix: ''}, whatsapp: {botId: '', prefix: ''}};
}

function blankSlot(slot) {
  return !slot || typeof slot !== 'object' || (!slot.botId && !slot.prefix);
}

// A stored value is coerced. A user write passes knownIds and rejects an unknown Bot.
// Older installs stored a WeChat slot. That slot becomes the generic source when
// the generic slot was never written, and the WeChat key is not returned.
export function normalizeSourceDefaults(value, base = emptySourceDefaults(), knownIds = null) {
  const next = emptySourceDefaults();
  const raw = value && typeof value === 'object' ? value : {};
  const source = {...raw};
  if (!Object.hasOwn(source, 'share') && source.wechat && typeof source.wechat === 'object' && blankSlot(source.share)) {
    source.share = source.wechat;
  }
  const previous = base && typeof base === 'object' ? base : emptySourceDefaults();
  for (const key of SOURCE_DEFAULT_KEYS) {
    const patch = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const prev = previous[key] && typeof previous[key] === 'object' ? previous[key] : {botId: '', prefix: ''};
    let botId = Object.hasOwn(patch, 'botId') ? patch.botId : prev.botId ?? '';
    let prefix = Object.hasOwn(patch, 'prefix') ? patch.prefix : prev.prefix ?? '';
    if (typeof botId !== 'string' || typeof prefix !== 'string' || prefix.length > 10000) {
      if (knownIds) throw new Error('SOURCE_DEFAULTS_INVALID');
      botId = '';
      prefix = '';
    }
    if (botId && knownIds && !knownIds.has(botId)) throw new Error('BOT_NOT_FOUND');
    next[key] = {botId, prefix};
  }
  return next;
}
