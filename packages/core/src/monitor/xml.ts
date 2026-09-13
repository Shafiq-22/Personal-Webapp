/**
 * Deliberately small XML reader.
 *
 * Feed parsing has to run in three places - Node (web app), Deno (edge
 * functions) and JavaScriptCore (the iOS fallback path) - so the core ships its
 * own scanner instead of depending on a DOM. It handles exactly what real
 * RSS/Atom feeds use: nested elements, attributes, CDATA and entities.
 */

export interface XmlNode {
  name: string;
  /** Namespace-stripped lower-case name, e.g. `dc:creator` -> `creator`. */
  localName: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function stripHtml(input: string): string {
  return decodeEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const key = (m[1] ?? '').toLowerCase();
    attrs[key] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const CDATA_MARK = '\u0000';

const TAG_RE = /<(\/)?([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g;

/** Parse a document into a tree. Unclosed tags are tolerated. */
export function parseXml(xml: string): XmlNode {
  // CDATA can contain anything, including text that looks like markup, so it is
  // lifted out before the tag scanner runs and put back verbatim afterwards.
  const cdata: string[] = [];
  const source = xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, body: string) => {
      cdata.push(body);
      return `${CDATA_MARK}${cdata.length - 1}${CDATA_MARK}`;
    });

  const restore = (text: string): string =>
    text.replace(new RegExp(`${CDATA_MARK}(\\d+)${CDATA_MARK}`, 'g'), (_m, index: string) => cdata[Number(index)] ?? '');
  const root: XmlNode = { name: '#root', localName: '#root', attributes: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let cursor = 0;

  const appendText = (node: XmlNode, chunk: string) => {
    if (!chunk) return;
    node.text += chunk;
  };

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(source)) !== null) {
    const current = stack[stack.length - 1] as XmlNode;
    const between = source.slice(cursor, match.index);
    if (between) appendText(current, restore(decodeEntities(between)));
    cursor = match.index + match[0].length;

    const closing = Boolean(match[1]);
    const name = match[2] ?? '';
    const selfClosing = Boolean(match[4]);

    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if ((stack[i] as XmlNode).name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node: XmlNode = {
      name,
      localName: name.includes(':') ? (name.split(':')[1] ?? name).toLowerCase() : name.toLowerCase(),
      attributes: parseAttributes(match[3] ?? ''),
      children: [],
      text: '',
    };
    current.children.push(node);
    if (!selfClosing) stack.push(node);
  }

  const tail = source.slice(cursor);
  if (tail) appendText(stack[stack.length - 1] as XmlNode, restore(decodeEntities(tail)));
  return root;
}

/** Depth-first search for every node with the given local name. */
export function findAll(node: XmlNode, localName: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const child of n.children) {
      if (child.localName === localName) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

export function findFirst(node: XmlNode, localName: string): XmlNode | null {
  for (const child of node.children) {
    if (child.localName === localName) return child;
  }
  for (const child of node.children) {
    const nested = findFirst(child, localName);
    if (nested) return nested;
  }
  return null;
}

/** Direct-child lookup - safer than `findFirst` inside a feed entry. */
export function child(node: XmlNode, localName: string): XmlNode | null {
  return node.children.find((c) => c.localName === localName) ?? null;
}

export function childText(node: XmlNode, ...localNames: string[]): string {
  for (const name of localNames) {
    const found = child(node, name);
    if (found) {
      const text = found.text.trim();
      if (text) return text;
    }
  }
  return '';
}
