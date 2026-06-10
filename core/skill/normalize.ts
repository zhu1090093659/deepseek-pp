/**
 * Normalize a skill name by trimming, lowercasing, and replacing
 * non-alphanumeric / non-CJK characters with hyphens.
 *
 * The CJK range (U+4E00–U+9FFF) is intentionally allowlisted in the
 * i18n coverage audit because this function is the single source of
 * truth for which characters are valid in skill names.
 */
export function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9一-鿿-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalized) throw new Error('Skill name cannot be empty');
  return normalized;
}
