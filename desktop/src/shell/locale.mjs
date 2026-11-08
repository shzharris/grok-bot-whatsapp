export function normalizeLanguage(value) {
  return value === 'zh' || value === 'en' || value === 'system' ? value : 'system';
}

// A missing or unknown preference stays on the system locale, so older databases keep working.
export function resolveUiLocale(language, osLocale = '') {
  const choice = normalizeLanguage(language);
  if (choice === 'zh' || choice === 'en') return choice;
  return String(osLocale ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function shareSlotTitle(botName, locale) {
  const name = String(botName ?? '').trim();
  if (!name) return 'Grok Bot';
  return String(locale ?? '').toLowerCase().startsWith('zh') ? `发给 ${name}` : `Send to ${name}`;
}
