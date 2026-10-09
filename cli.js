#!/usr/bin/env node
'use strict';

// Localbolt CI runner — self-contained, dependency-free (Node 18+, no npm install).
// This file is yours forever: it was written into your repo by the "Localbolt: Export CI
// Runner" command and does not require the VS Code extension to be installed to keep
// working. It only needs a valid Pro license key, checked OFFLINE (no network call, no
// account, no phone-home) from ~/.localbolt/license or the LOCALBOLT_KEY env var — put the
// latter in your CI secrets.
//
// Usage:
//   node localbolt-ci.cjs check [--dir <path>] [--base <locale>] [--json]
//
// Exit codes:
//   0 - every non-base locale has every key the base locale has
//   1 - one or more locales are missing at least one key
//   2 - configuration error (no locale files found, ambiguous base locale, malformed file)
//   3 - license key missing or invalid
//
// This file is a hand-maintained mirror of ../src/scanner.js + ../src/yaml.js + ../src/
// license.js, kept in sync by test/run.js's parity test (same fixtures through both
// entry points, results asserted identical) rather than a bundler step.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ---------------------------------------------------------------------------------------
// License (BP-001 offline ECDSA-P256 verify) — identical logic to src/license.js
// ---------------------------------------------------------------------------------------
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDXST4uXIYojaKh87zlus/oEOXucVdFJCBxI1F6qejPA8iZp5NJUy7mgn1NmnxarrvrxiQnLGU3NdpVdRfSbC2A==
-----END PUBLIC KEY-----`;
const LICENSE_PRODUCT = 'localbolt-pro';

function b64urlToBuf(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

function verifyLicenseWith(key, pubPem) {
  try {
    if (typeof key !== 'string') return false;
    const parts = key.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'LB1') return false;
    const signedData = `LB1.${parts[1]}`;
    const payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
    if (payload.product !== LICENSE_PRODUCT) return false;
    if (payload.exp && Date.now() > payload.exp) return false;
    const v = crypto.createVerify('SHA256');
    v.update(signedData); v.end();
    return v.verify(pubPem, b64urlToBuf(parts[2]));
  } catch (e) { return false; }
}

function verifyLicense(key) {
  if (PUBLIC_KEY_PEM.includes('PLACEHOLDER')) return false;
  return verifyLicenseWith(key, PUBLIC_KEY_PEM);
}

function readLicenseKey() {
  if (process.env.LOCALBOLT_KEY) return process.env.LOCALBOLT_KEY.trim();
  try {
    return fs.readFileSync(path.join(os.homedir(), '.localbolt', 'license'), 'utf8').trim();
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Minimal YAML reader (read-only subset — see src/yaml.js for the full commented version)
// ---------------------------------------------------------------------------------------
function stripYamlComment(line) {
  let inSingle = false, inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}
function unquoteYaml(raw) {
  if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') return JSON.parse(raw);
  if (raw.length >= 2 && raw[0] === "'" && raw[raw.length - 1] === "'") return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}
function parseYamlScalar(str) {
  const s = str.trim();
  if (s === '' || s === '~' || /^null$/i.test(s)) return null;
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  if (s[0] === '"' || s[0] === "'") return unquoteYaml(s);
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}
function findYamlKeyColon(text) {
  if (text[0] === '"' || text[0] === "'") {
    const quote = text[0]; let end = 1;
    while (end < text.length) {
      if (quote === '"' && text[end] === '\\') { end += 2; continue; }
      if (text[end] === quote) break;
      end++;
    }
    const after = text.slice(end + 1);
    const m = after.match(/^\s*:(\s|$)/);
    if (!m) return -1;
    return end + 1 + after.indexOf(':');
  }
  const idx = text.indexOf(': ');
  if (idx !== -1) return idx;
  if (text.endsWith(':')) return text.length - 1;
  return -1;
}
function yamlParseError(filePath, lineNo, message) {
  const err = new Error(`${filePath}:${lineNo}: ${message}`);
  err.filePath = filePath; err.line = lineNo; err.isParseError = true;
  return err;
}
function toYamlLines(text, filePath) {
  const raw = text.split(/\r\n|\r|\n/);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const lineNo = i + 1;
    if (/^\t/.test(raw[i])) throw yamlParseError(filePath, lineNo, 'tab characters are not allowed for indentation (use spaces)');
    const noComment = stripYamlComment(raw[i]);
    if (noComment.trim() === '') continue;
    const indent = noComment.length - noComment.trimStart().length;
    lines.push({ text: noComment.trim(), indent, lineNo });
  }
  return lines;
}
function parseYamlList(lines, start, indent, filePath) {
  const arr = []; let i = start;
  while (i < lines.length && lines[i].indent === indent && (lines[i].text === '-' || lines[i].text.startsWith('- '))) {
    const rest = lines[i].text === '-' ? '' : lines[i].text.slice(2);
    if (rest.trim() === '') throw yamlParseError(filePath, lines[i].lineNo, "nested block values under list items are not supported by localbolt's YAML reader");
    arr.push(parseYamlScalar(rest)); i++;
  }
  return [arr, i];
}
function parseYamlNode(lines, start, indent, filePath) {
  const line = lines[start];
  if (!line || line.indent !== indent) throw yamlParseError(filePath, line ? line.lineNo : lines[lines.length - 1].lineNo, 'unexpected indentation');
  if (line.text === '-' || line.text.startsWith('- ')) return parseYamlList(lines, start, indent, filePath);
  return parseYamlMap(lines, start, indent, filePath);
}
function parseYamlMap(lines, start, indent, filePath) {
  const obj = {}; let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    const colonIdx = findYamlKeyColon(line.text);
    if (colonIdx === -1) throw yamlParseError(filePath, line.lineNo, `expected "key: value" but got "${line.text}"`);
    const key = unquoteYaml(line.text.slice(0, colonIdx).trim());
    const rest = line.text.slice(colonIdx + 1).trim();
    if (rest === '') {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [childVal, nextI] = parseYamlNode(lines, i + 1, lines[i + 1].indent, filePath);
        obj[key] = childVal; i = nextI;
      } else { obj[key] = null; i++; }
    } else { obj[key] = parseYamlScalar(rest); i++; }
  }
  return [obj, i];
}
function parseYaml(text, filePath) {
  const lines = toYamlLines(text, filePath);
  if (!lines.length) return {};
  const [value, endIdx] = parseYamlNode(lines, 0, lines[0].indent, filePath);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw yamlParseError(filePath, lines[0].lineNo, 'root of a locale file must be a mapping');
  if (endIdx < lines.length) throw yamlParseError(filePath, lines[endIdx].lineNo, 'unexpected content at root indentation after the first mapping ended');
  return value;
}

// ---------------------------------------------------------------------------------------
// Scanner (identical algorithm to src/scanner.js)
// ---------------------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.vscode-test', '.next', 'coverage']);
const LOCALE_DIR_NAMES = new Set(['locales', 'i18n', 'lang', 'langs', 'translations']);
const LOCALE_CODE_RE = /^[a-z]{2}([_-][A-Za-z]{2,4})?$/;

function walk(rootDir, maxDepth) {
  const found = [];
  function recur(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') {
        if (!(entry.isDirectory() && LOCALE_DIR_NAMES.has(entry.name.replace(/^\./, '')))) continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        recur(full, depth + 1);
      } else if (entry.isFile()) {
        found.push(full);
      }
    }
  }
  recur(rootDir, 0);
  return found;
}
function isLocaleFile(filePath) {
  if (!/\.(json|ya?ml)$/i.test(filePath)) return false;
  const segments = filePath.split(path.sep).map((s) => s.toLowerCase());
  return segments.some((s) => LOCALE_DIR_NAMES.has(s));
}
// Position-tracking JSON tokenizer, used instead of bare JSON.parse so malformed-file
// errors always carry a reliable file:line (V8's JSON.parse error message format is not
// stable across Node versions, so regex-scraping "position N" out of it is not safe here).
function jsonTokenError(filePath, offset, text, message) {
  const line = text.slice(0, offset).split('\n').length;
  const err = new Error(`${filePath}:${line}: malformed JSON — ${message}`);
  err.filePath = filePath; err.line = line; err.isParseError = true;
  return err;
}
function tokenizeJson(text, filePath) {
  const tokens = []; let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if ('{}[]:,'.includes(c)) { tokens.push({ type: c, start: i }); i++; continue; }
    if (c === '"') {
      const start = i; i++;
      while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      if (i >= n) throw jsonTokenError(filePath, start, text, 'unterminated string');
      i++;
      tokens.push({ type: 'string', start, raw: text.slice(start, i) });
      continue;
    }
    if (/[-0-9]/.test(c)) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
      if (!m) throw jsonTokenError(filePath, i, text, 'invalid number literal');
      tokens.push({ type: 'number', start: i, raw: m[0] }); i += m[0].length;
      continue;
    }
    const m = /^(true|false|null)/.exec(text.slice(i));
    if (m) { tokens.push({ type: 'literal', start: i, raw: m[0] }); i += m[0].length; continue; }
    throw jsonTokenError(filePath, i, text, `unexpected character "${c}"`);
  }
  return tokens;
}
function parseJsonValue(tokens, pos, filePath, text) {
  const t = tokens[pos];
  if (!t) throw jsonTokenError(filePath, text.length, text, 'unexpected end of input');
  if (t.type === '{') return parseJsonObject(tokens, pos, filePath, text);
  if (t.type === '[') return parseJsonArray(tokens, pos, filePath, text);
  if (t.type === 'string') return [JSON.parse(t.raw), pos + 1];
  if (t.type === 'number') return [Number(t.raw), pos + 1];
  if (t.type === 'literal') return [t.raw === 'true' ? true : t.raw === 'false' ? false : null, pos + 1];
  throw jsonTokenError(filePath, t.start, text, 'unexpected token');
}
function parseJsonObject(tokens, pos, filePath, text) {
  pos++;
  const obj = {};
  if (tokens[pos] && tokens[pos].type === '}') return [obj, pos + 1];
  for (;;) {
    const keyTok = tokens[pos];
    if (!keyTok || keyTok.type !== 'string') throw jsonTokenError(filePath, keyTok ? keyTok.start : text.length, text, 'expected a string key');
    pos++;
    const colon = tokens[pos];
    if (!colon || colon.type !== ':') throw jsonTokenError(filePath, colon ? colon.start : text.length, text, 'expected ":" after key');
    pos++;
    const [val, nextPos] = parseJsonValue(tokens, pos, filePath, text);
    obj[JSON.parse(keyTok.raw)] = val;
    pos = nextPos;
    const sep = tokens[pos];
    if (sep && sep.type === ',') { pos++; continue; }
    if (sep && sep.type === '}') return [obj, pos + 1];
    throw jsonTokenError(filePath, sep ? sep.start : text.length, text, 'expected "," or "}"');
  }
}
function parseJsonArray(tokens, pos, filePath, text) {
  pos++;
  const arr = [];
  if (tokens[pos] && tokens[pos].type === ']') return [arr, pos + 1];
  for (;;) {
    const [val, nextPos] = parseJsonValue(tokens, pos, filePath, text);
    arr.push(val); pos = nextPos;
    const sep = tokens[pos];
    if (sep && sep.type === ',') { pos++; continue; }
    if (sep && sep.type === ']') return [arr, pos + 1];
    throw jsonTokenError(filePath, sep ? sep.start : text.length, text, 'expected "," or "]"');
  }
}
function parseJson(text, filePath) {
  const tokens = tokenizeJson(text, filePath);
  if (!tokens.length) throw jsonTokenError(filePath, 0, text, 'empty file');
  const [value, endPos] = parseJsonValue(tokens, 0, filePath, text);
  if (endPos < tokens.length) throw jsonTokenError(filePath, tokens[endPos].start, text, 'unexpected content after the root value');
  return value;
}
function parseLocaleFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (/\.json$/i.test(filePath)) return parseJson(text, filePath);
  return parseYaml(text, filePath);
}
function flatten(obj, prefix, out) {
  out = out || {};
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) { out[prefix] = obj; return out; }
  const keys = Object.keys(obj);
  if (keys.length === 0 && prefix) { out[prefix] = obj; return out; }
  for (const k of keys) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}
function localeIdFor(filePath, groupBy) {
  const dirName = path.basename(path.dirname(filePath));
  const stem = path.basename(filePath).replace(/\.(json|ya?ml)$/i, '');
  if (groupBy === 'directory') return dirName;
  if (groupBy === 'filename') return stem;
  if (LOCALE_CODE_RE.test(dirName) && !LOCALE_DIR_NAMES.has(dirName.toLowerCase())) return dirName;
  return stem;
}
function namespaceFor(filePath, localeId, groupBy) {
  const dirName = path.basename(path.dirname(filePath));
  const stem = path.basename(filePath).replace(/\.(json|ya?ml)$/i, '');
  if (dirName === localeId || (groupBy !== 'filename' && LOCALE_CODE_RE.test(dirName))) return stem;
  return '__default__';
}
function groupFiles(files, groupBy) {
  const locales = {};
  for (const f of files) {
    const id = localeIdFor(f, groupBy);
    const ns = namespaceFor(f, id, groupBy);
    locales[id] = locales[id] || {};
    locales[id][ns] = f;
  }
  return locales;
}
function findLocaleRootCandidates(rootDir) {
  const all = walk(rootDir, 10).filter(isLocaleFile);
  const roots = new Set();
  for (const f of all) {
    const segments = f.split(path.sep);
    for (let i = 0; i < segments.length; i++) {
      if (LOCALE_DIR_NAMES.has(segments[i].toLowerCase())) { roots.add(segments.slice(0, i + 1).join(path.sep)); break; }
    }
  }
  return Array.from(roots).sort();
}
function inferBaseLocale(localeIds) {
  if (localeIds.includes('en')) return 'en';
  if (localeIds.length === 1) return localeIds[0];
  return null;
}

class ConfigError extends Error {}

function buildReport(rootDir, opts) {
  opts = opts || {};
  const localeDir = opts.localeDir ? path.resolve(rootDir, opts.localeDir) : rootDir;
  const files = walk(localeDir, 10).filter(isLocaleFile);
  if (!files.length) throw new ConfigError(`no locale files found under ${localeDir}`);

  const groupBy = opts.groupBy || 'auto';
  const locales = groupFiles(files, groupBy);
  const localeIds = Object.keys(locales).sort();

  let base = opts.baseLocale;
  if (!base) {
    base = inferBaseLocale(localeIds);
    if (!base) throw new ConfigError(`no base locale configured and none could be inferred (candidates: ${localeIds.join(', ')}) — pass --base <locale>`);
  }
  if (!locales[base]) throw new ConfigError(`base locale "${base}" not found among detected locales: ${localeIds.join(', ')}`);

  const parsed = {};
  for (const id of localeIds) {
    parsed[id] = {};
    for (const ns of Object.keys(locales[id])) {
      const filePath = locales[id][ns];
      parsed[id][ns] = { flat: flatten(parseLocaleFile(filePath), '', {}), filePath };
    }
  }

  const baseFlatKeys = new Set();
  for (const ns of Object.keys(parsed[base])) {
    for (const key of Object.keys(parsed[base][ns].flat)) baseFlatKeys.add(key);
  }

  const result = { baseLocale: base, totalBaseKeys: baseFlatKeys.size, locales: {} };
  let totalMissing = 0;
  for (const id of localeIds) {
    if (id === base) continue;
    const localeFlatKeys = new Set();
    for (const ns of Object.keys(parsed[id])) for (const key of Object.keys(parsed[id][ns].flat)) localeFlatKeys.add(key);
    const missing = [];
    for (const key of baseFlatKeys) if (!localeFlatKeys.has(key)) missing.push(key);
    const present = baseFlatKeys.size - missing.length;
    const percent = baseFlatKeys.size === 0 ? 100 : Math.round((present / baseFlatKeys.size) * 1000) / 10;
    totalMissing += missing.length;
    result.locales[id] = { totalKeys: baseFlatKeys.size, presentKeys: present, missingKeys: missing, missing_count: missing.length, completionPercent: percent };
  }
  result.missing_count = totalMissing;
  return result;
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') { args.dir = argv[++i]; }
    else if (a === '--base') { args.base = argv[++i]; }
    else if (a === '--json') { args.json = true; }
    else if (a === '--help' || a === '-h') { args.help = true; }
    else args._.push(a);
  }
  return args;
}

function printHumanReport(report) {
  console.log(`Localbolt — base locale: ${report.baseLocale} (${report.totalBaseKeys} keys)\n`);
  const ids = Object.keys(report.locales).sort();
  for (const id of ids) {
    const l = report.locales[id];
    console.log(`${id}: ${l.completionPercent}% (${l.presentKeys}/${l.totalKeys}) — ${l.missingKeys.length} missing`);
    for (const key of l.missingKeys) console.log(`  - ${key}`);
  }
  console.log('');
  if (report.missing_count > 0) console.log(`${report.missing_count} key(s) missing across ${ids.length} locale(s).`);
  else console.log('All locales complete.');
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0];

  if (args.help || !command) {
    console.log('Usage: node localbolt-ci.cjs check [--dir <path>] [--base <locale>] [--json]');
    process.exit(command ? 0 : 2);
    return;
  }
  if (command !== 'check') {
    console.error(`Unknown command "${command}". Only "check" is supported.`);
    process.exit(2);
    return;
  }

  const key = readLicenseKey();
  if (!key || !verifyLicense(key)) {
    console.error('Localbolt: no valid Pro license found. Set LOCALBOLT_KEY (CI secret) or run "Localbolt: Enter Pro License Key" in VS Code to write ~/.localbolt/license.');
    process.exit(3);
    return;
  }

  const dir = args.dir ? path.resolve(process.cwd(), args.dir) : process.cwd();
  let report;
  try {
    report = buildReport(dir, { baseLocale: args.base });
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`Localbolt config error: ${e.message}`);
      process.exit(2);
      return;
    }
    if (e.isParseError) {
      console.error(`Localbolt parse error: ${e.message}`);
      process.exit(2);
      return;
    }
    throw e;
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }
  process.exit(report.missing_count > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = { buildReport, verifyLicense, verifyLicenseWith, flatten, parseYaml, ConfigError };
