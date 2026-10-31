// Machine translation of lyrics, line by line so each translation stays under its original.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TARGETS = new Set(['ko', 'en']);
const MAX_CHUNK_CHARS = 4000;
const RETRY_DELAY_MS = 800;

const memory = new Map();
const dir = () => path.join(app.getPath('userData'), 'lyrics');
const fileOf = (key) => path.join(dir(), `tr-${key}.json`);

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + text.length.toString(36);
}

async function request(text, target) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT + target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
      body: `q=${encodeURIComponent(text)}`,
    });
    if (res.ok) {
      const data = await res.json();
      return { text: (data?.[0] || []).map((part) => part?.[0] || '').join(''), from: data?.[2] || null };
    }
    if (attempt) throw new Error(`translate ${res.status}`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
}

function chunksOf(items) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    if (current.length && size + item.text.length + 1 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.text.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// Returns one translation per line, empty where the line is empty. `from` is the language it detected.
export async function translateLines(lines, target) {
  if (!TARGETS.has(target) || !Array.isArray(lines)) return { from: null, lines: [] };
  const clean = lines.map((l) => String(l ?? ''));
  const key = hash(`${target}\n${clean.join('\n')}`);
  const known = memory.get(key);
  if (known) return known;
  try {
    const saved = JSON.parse(fs.readFileSync(fileOf(key), 'utf8'));
    if (saved.lines?.length === clean.length) {
      memory.set(key, saved);
      return saved;
    }
  } catch { /* not translated yet */ }

  const out = clean.map(() => '');
  const items = clean.map((text, i) => ({ i, text: text.trim() })).filter((item) => item.text);
  let from = null;
  for (const chunk of chunksOf(items)) {
    const answer = await request(chunk.map((item) => item.text).join('\n'), target);
    from ??= answer.from;
    const parts = answer.text.split('\n');
    if (parts.length === chunk.length) {
      chunk.forEach((item, n) => { out[item.i] = parts[n].trim(); });
    } else {
      // The service merged or split some lines. Asking one at a time always keeps them apart.
      for (const item of chunk) out[item.i] = (await request(item.text, target)).text.trim();
    }
  }

  const result = { from, lines: out };
  memory.set(key, result);
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(fileOf(key), JSON.stringify(result));
  } catch { /* the cache is only an optimisation */ }
  return result;
}
