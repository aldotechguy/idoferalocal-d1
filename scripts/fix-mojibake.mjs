// Fixes double-encoded (mojibake) string literals in source files.
// Pattern: original UTF-8 text was decoded as Windows-1252, then re-encoded as UTF-8.
// Recovery: convert chars back to Windows-1252 bytes, decode those bytes as UTF-8; repeat while still mojibake.
import fs from 'fs';
import path from 'path';

// Windows-1252 bytes 0x80-0x9F that appear in mojibake
const CP1252 = {
  '\u20AC': 0x80, '\u201A': 0x82, '\u0192': 0x83, '\u201E': 0x84, '\u2026': 0x85,
  '\u2020': 0x86, '\u2021': 0x87, '\u02C6': 0x88, '\u2030': 0x89, '\u0160': 0x8A,
  '\u2039': 0x8B, '\u0152': 0x8C, '\u017D': 0x8E, '\u2018': 0x91, '\u2019': 0x92,
  '\u201C': 0x93, '\u201D': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
  '\u02DC': 0x98, '\u2122': 0x99, '\u0161': 0x9A, '\u203A': 0x9B, '\u0153': 0x9C,
  '\u017E': 0x9E, '\u0178': 0x9F,
};
// Any of these or Latin-1 letters that commonly start mojibake sequences
const SUSPECT = /[\u00A1-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;

function to1252Bytes(s) {
  const bytes = [];
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]);
    else if (code <= 0xFF) bytes.push(code);
    else return null; // not representable — stop
  }
  return Buffer.from(bytes);
}

function decodeOnce(s) {
  const bytes = to1252Bytes(s);
  if (!bytes) return null;
  try {
    const out = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return out;
  } catch {
    return null;
  }
}

const REGRESSIONS = new Map([
  ['•', '•'], ['–', '–'], ['—', '—'],
  ['…', '…'], ['•', '•'], ['“', '“'],
  ['’', '’'],
]);

function applyRegressions(s) {
  let out = s;
  for (const [bad, good] of REGRESSIONS) out = out.split(bad).join(good);
  return out;
}

function fix(s) {
  // Split on characters, replace maximal runs of suspect chars + following chars they encode.
  // Simpler robust approach: find every occurrence of a known mojibake start and try decoding forward.
  let out = '';
  let i = 0;
  let fixed = 0;
  while (i < s.length) {
    if (SUSPECT.test(s[i])) {
      // try progressively longer windows starting here, prefer the longest that decodes cleanly and repeatedly
      let best = null, bestEnd = i;
      for (let end = i + 2; end <= Math.min(s.length, i + 40); end++) {
        let cur = s.slice(i, end);
        let depth = 0;
        let dec = cur;
        while (depth < 5) {
          const next = decodeOnce(dec);
          if (next === null || next === dec) break;
          dec = next;
          depth++;
        }
        if (depth > 0 && !SUSPECT.test(dec) && dec.length >= 1) {
          // valid full decode; prefer longest window whose decode consumed everything
          best = dec;
          bestEnd = end;
        }
      }
      if (best !== null) {
        out += best;
        fixed++;
        i = bestEnd;
        continue;
      }
    }
    out += s[i];
    i++;
  }
  return { out, fixed };
}

const roots = ['src', 'scripts', 'index.html', 'server.ts'];
const exts = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html']);
const files = [];
function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) {
      if (f === 'node_modules' || f.startsWith('.')) continue;
      walk(path.join(p, f));
    }
  } else if (exts.has(path.extname(p))) files.push(p);
}
for (const r of roots) {
  try { walk(r); } catch { }
}

let totalFixed = 0, changedFiles = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const pre = applyRegressions(src);
  if (pre !== src) fs.writeFileSync(f, pre, 'utf8');
  if (!SUSPECT.test(pre)) continue;
  const { out, fixed } = fix(pre);
  if (fixed > 0) {
    fs.writeFileSync(f, out, 'utf8');
    changedFiles++;
    totalFixed += fixed;
    console.log(`${f}: ${fixed} sequence(s) fixed`);
  } else if (pre !== src) {
    changedFiles++;
    console.log(`${f}: regression pass only`);
  }
}
console.log(`\nDone. ${totalFixed} sequences fixed in ${changedFiles} files.`);
