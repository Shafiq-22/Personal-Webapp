/**
 * YAML frontmatter reader/writer.
 *
 * Obsidian's frontmatter is a small, flat-ish subset of YAML: scalars, block
 * lists and the occasional nested map. Cortex writes that subset and parses it
 * back, rather than pulling in a full YAML engine that the iOS side would then
 * have to match byte for byte.
 */

export type FrontmatterValue = string | number | boolean | null | FrontmatterValue[] | { [key: string]: FrontmatterValue };
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
  /** True when the source actually had a frontmatter block. */
  hadFrontmatter: boolean;
}

/**
 * Quote only when a bare scalar would change meaning: leading/trailing space, a
 * leading YAML indicator character, an embedded `: ` or ` #`, an exact boolean
 * or null token, or a pure number. A DOI or a URL stays readable.
 */
const NEEDS_QUOTES = /^\s|\s$|^[-?:,[\]{}#&*!|>'"%@`]|:\s|\s#|^(?:true|false|null|yes|no|on|off|~)$|^-?\d+(?:\.\d+)?$/i;

export function serializeValue(value: FrontmatterValue, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `\n${value.map((v) => `${pad}  - ${serializeInline(v)}`).join('\n')}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `\n${entries.map(([k, v]) => `${pad}  ${k}: ${serializeValue(v, indent + 2)}`).join('\n')}`;
  }
  return quoteIfNeeded(value);
}

function serializeInline(value: FrontmatterValue): string {
  if (Array.isArray(value)) return `[${value.map(serializeInline).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([k, v]) => `${k}: ${serializeInline(v)}`).join(', ')}}`;
  }
  if (typeof value === 'string') return quoteIfNeeded(value);
  return serializeValue(value);
}

function quoteIfNeeded(value: string): string {
  if (value === '') return '""';
  if (/\n/.test(value)) return JSON.stringify(value);
  if (NEEDS_QUOTES.test(value) && !/^\d{4}-\d{2}-\d{2}/.test(value)) return JSON.stringify(value);
  return value;
}

export function serializeFrontmatter(data: Frontmatter): string {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => `${key}: ${serializeValue(value)}`);
  return `---\n${lines.join('\n')}\n---`;
}

export function renderNote(frontmatter: Frontmatter, body: string): string {
  return `${serializeFrontmatter(frontmatter)}\n\n${body.trimStart()}`.trimEnd() + '\n';
}

function parseScalar(raw: string): FrontmatterValue {
  const value = raw.trim();
  if (value === '' || value === '~' || value.toLowerCase() === 'null') return null;
  if (value === 'true' || value === 'yes') return true;
  if (value === 'false' || value === 'no') return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d*\.\d+$/.test(value)) return Number.parseFloat(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const inner = value.slice(1, -1);
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return inner;
      }
    }
    return inner.replace(/''/g, "'");
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((part) => parseScalar(part));
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    const out: Frontmatter = {};
    if (!inner) return out;
    for (const part of splitTopLevel(inner)) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      out[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
    }
    return out;
  }
  return value;
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of input) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim());
}

export function parseNote(source: string): ParsedNote {
  const normalized = source.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { frontmatter: {}, body: normalized.trim(), hadFrontmatter: false };

  const frontmatter: Frontmatter = {};
  const lines = (match[1] ?? '').split('\n');
  let currentKey: string | null = null;
  let currentList: FrontmatterValue[] | null = null;
  let currentMap: Frontmatter | null = null;

  const flush = () => {
    if (currentKey === null) return;
    if (currentList) frontmatter[currentKey] = currentList;
    else if (currentMap) frontmatter[currentKey] = currentMap;
    currentList = null;
    currentMap = null;
  };

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && currentKey !== null) {
      currentList = currentList ?? [];
      currentList.push(parseScalar(listItem[1] ?? ''));
      continue;
    }

    const nested = /^\s{2,}([\w.-]+):\s*(.*)$/.exec(line);
    if (nested && currentKey !== null && !currentList) {
      currentMap = currentMap ?? {};
      currentMap[nested[1] ?? ''] = parseScalar(nested[2] ?? '');
      continue;
    }

    const entry = /^([\w.-]+):\s*(.*)$/.exec(line);
    if (entry) {
      flush();
      currentKey = entry[1] ?? '';
      const rest = entry[2] ?? '';
      if (rest === '') {
        // value continues on the following lines (list or map)
        frontmatter[currentKey] = null;
      } else {
        frontmatter[currentKey] = parseScalar(rest);
        currentKey = null;
      }
    }
  }
  flush();

  return {
    frontmatter,
    body: normalized.slice(match[0].length).trim(),
    hadFrontmatter: true,
  };
}

/** Read a frontmatter value as a string array, tolerating a single scalar. */
export function asStringArray(value: FrontmatterValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined).map((v) => String(v));
  return [String(value)];
}
