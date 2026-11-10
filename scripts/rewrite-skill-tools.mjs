/**
 * Rewrite upstream WPS skill bodies from raw MCP tool names to the facade
 * convention used by this bundle.
 *
 *   node scripts/rewrite-skill-tools.mjs --check   # report only
 *   node scripts/rewrite-skill-tools.mjs           # rewrite skill/<name>/SKILL.md
 *
 * Examples:
 *   `wps_excel_generate_formula`                   → `wps_excel({ method: "generate_formula" })`
 *   `wps_ppt_add_slide({ layout: "title" })`       → `wps_ppt({ method: "add_slide", args: { layout: "title" } })`
 *   `wps_ppt_set_shape_text(1, 2, "x")`            → `wps_ppt({ method: "set_shape_text", args: { slideIndex: 1, shapeIndex: 2, text: "x" } })`
 *   `wps_check_connection`                         → `wps_office({ method: "check_connection" })`
 *   `wps_excel_*`                                  → `wps_excel`
 *
 * Positional arguments are mapped to object keys using the MCP server's
 * declared input-schema property order. The script is idempotent: facade names
 * and already rewritten calls are skipped.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __internal } from '../lib/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(ROOT, 'skill');
const CHECK_ONLY = process.argv.includes('--check');

const FACADES = new Set(['wps_excel', 'wps_word', 'wps_ppt', 'wps_office', 'wps_help']);
const FACADE_OF = { excel: 'wps_excel', word: 'wps_word', ppt: 'wps_ppt', office: 'wps_office' };

const silent = { info() {}, warn() {}, debug() {} };

/** Return the index of the balanced closer for `text[openIndex]`, or -1. */
function findBalanced(text, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split top-level comma-separated arguments, ignoring nested groups/strings. */
function splitArguments(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  const push = (end) => {
    const piece = text.slice(start, end).trim();
    if (piece) parts.push(piece);
    start = end + 1;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) push(i);
  }
  push(text.length);
  return parts;
}

/** Object keys for a method, in declared order, from the live MCP catalog. */
function schemaKeys(catalog, rawName) {
  for (const app of Object.keys(catalog.groups)) {
    for (const item of catalog.groups[app]) {
      if (item.raw !== rawName) continue;
      const properties = item.inputSchema?.properties;
      return properties && typeof properties === 'object' ? Object.keys(properties) : [];
    }
  }
  return [];
}

function buildArgs(rawName, argsText, catalog, stats) {
  const trimmed = argsText.trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('{')) {
    const close = findBalanced(trimmed, 0);
    if (close === trimmed.length - 1) return `, args: ${trimmed}`;
  }
  const keys = schemaKeys(catalog, rawName);
  const values = splitArguments(trimmed);
  if (keys.length === 0 || values.length > keys.length) {
    stats.unmapped.push(`${rawName}(${trimmed.slice(0, 40)})`);
    return null;
  }
  const pairs = values.map((value, index) => {
    const key = keys[index];
    return value === key ? key : `${key}: ${value}`;
  });
  return `, args: { ${pairs.join(', ')} }`;
}

/** Rewrite one markdown document. */
function rewrite(text, catalog, stats) {
  const pattern = /wps_[A-Za-z0-9_]+/g;
  let output = '';
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    let app = null;
    let method = null;
    const namespaced = /^wps_(excel|word|ppt)_(.+)$/.exec(token);
    if (namespaced) {
      [, app, method] = namespaced;
    } else if (!FACADES.has(token)) {
      app = 'office';
      method = token.replace(/^wps_/, '');
    }
    if (!app || !method) continue;
    const facade = FACADE_OF[app];

    // `wps_excel_*` / `wps_excel_` → bare facade name.
    if (method.endsWith('_') || text[end] === '*') {
      let consumed = end;
      if (text[end] === '*') consumed += 1;
      output += `${text.slice(last, start)}${facade}`;
      last = consumed;
      pattern.lastIndex = consumed;
      stats.wildcard += 1;
      continue;
    }

    let cursor = end;
    while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor += 1;
    let replacement = `${facade}({ method: "${method}" })`;
    let consumed = end;
    if (text[cursor] === '(') {
      const close = findBalanced(text, cursor);
      if (close === -1) {
        stats.unmapped.push(`${token}(…) 括号不匹配`);
        continue;
      }
      const args = buildArgs(token, text.slice(cursor + 1, close), catalog, stats);
      if (args === null) continue;
      replacement = `${facade}({ method: "${method}"${args} })`;
      consumed = close + 1;
      stats.withArgs += 1;
    } else {
      stats.bare += 1;
    }
    output += `${text.slice(last, start)}${replacement}`;
    last = consumed;
    pattern.lastIndex = consumed;
  }
  output += text.slice(last);
  return output;
}

const bridge = __internal.createBridge({ eagerConnect: true }, silent);
await bridge.connect();
const catalog = bridge.catalog;
await bridge.close();
console.log(`catalog: ${catalog.total} methods`);

const stats = { bare: 0, withArgs: 0, wildcard: 0, unmapped: [] };
for (const name of ['wps-excel', 'wps-word', 'wps-ppt', 'wps-office']) {
  const file = path.join(SKILL_DIR, name, 'SKILL.md');
  const before = readFileSync(file, 'utf8');
  const after = rewrite(before, catalog, stats);
  const changed = before !== after;
  console.log(`${name}: ${changed ? 'changed' : 'unchanged'}`);
  if (changed && !CHECK_ONLY) writeFileSync(file, after, 'utf8');
}
console.log(`rewritten: bare=${stats.bare} withArgs=${stats.withArgs} wildcard=${stats.wildcard}`);
if (stats.unmapped.length > 0) {
  console.warn(`unmapped (${stats.unmapped.length}):`);
  for (const item of [...new Set(stats.unmapped)]) console.warn(`  - ${item}`);
}
if (CHECK_ONLY) console.log('check mode: no files written');
