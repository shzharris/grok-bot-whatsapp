export const SOURCE_DEFAULT_KEYS = ['wechat', 'whatsapp'];

export function emptySourceDefaults() {
  return {wechat: {botId: '', prefix: ''}, whatsapp: {botId: '', prefix: ''}};
}

// A stored value is coerced. A user write passes knownIds and rejects an unknown Bot.
export function normalizeSourceDefaults(value, base = emptySourceDefaults(), knownIds = null) {
  const next = emptySourceDefaults();
  const source = value && typeof value === 'object' ? value : {};
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
