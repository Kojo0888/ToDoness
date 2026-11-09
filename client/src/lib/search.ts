/** Plain-text search for notes (docs/notes/PRD.md FR-103, decision N12). */

/** Lower case without accents: `Café` → `cafe`. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** True when every word of `query` occurs somewhere in `texts` (case and accents ignored). */
export function matchesSearch(texts: string | readonly string[], query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(typeof texts === 'string' ? texts : texts.join('\n'));
  return words.every((w) => haystack.includes(w));
}
