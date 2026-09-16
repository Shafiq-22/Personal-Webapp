/**
 * Deterministic + random identifier helpers.
 *
 * `randomId` prefers the platform WebCrypto UUID (Node 20+, browsers, Deno edge
 * functions) and degrades to a time-seeded fallback so the core stays usable in
 * exotic runtimes.
 */
export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const rand = () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  return `${rand()}-${rand().slice(0, 4)}-4${rand().slice(0, 3)}-a${rand().slice(0, 3)}-${rand()}${rand().slice(0, 4)}`;
}

/** FNV-1a 32-bit - fast, stable across platforms, good enough for dedupe keys. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 64-bit-ish content hash (two FNV passes) rendered as 16 hex chars. */
export function contentHash(...parts: Array<string | undefined | null>): string {
  const joined = parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
  const a = fnv1a(joined).toString(16).padStart(8, '0');
  const b = fnv1a(`${joined.length}:${joined}`).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

const DIACRITICS = /[\u0300-\u036f]/g;

/** URL-safe slug used for Obsidian filenames and share tokens. */
export function slugify(input: string, maxLength = 80): string {
  const slug = input
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug.length > maxLength ? slug.slice(0, maxLength).replace(/-+$/g, '') : slug) || 'untitled';
}
