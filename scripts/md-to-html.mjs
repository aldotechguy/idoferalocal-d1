import fs from 'node:fs';

// Converts a help Markdown file into a self-contained, print-styled HTML file,
// ready to be rendered to PDF by a headless browser.
//
// Usage: node scripts/md-to-html.mjs <src.md> <out.html> "<document title>"
//
// Scope is deliberately small: ATX headings, paragraphs, bold/italic/inline code,
// links, images (standalone and inline), bullet and ordered lists, GFM tables,
// blockquotes and horizontal rules. Not a general-purpose parser.

const SRC = process.argv[2] || 'docs/mall-storefront-help.md';
const OUT = process.argv[3] || 'docs/mall-storefront-help.html';
const TITLE = process.argv[4] || 'IdoferaMall — Storefront Help Guide';

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = escapeHtml(out);

  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
    `<img src="${src}" alt="${alt}">`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
    `<a href="${href}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[i])}</code>`);
}

function convert(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let i = 0;
  let para = [];

  const joinContinuation = (base, extra) => `${base} ${extra}`;

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { flushPara(); i++; continue; }

    if (/^---+\s*$/.test(line)) { flushPara(); html.push('<hr>'); i++; continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++; continue;
    }

    const imgOnly = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgOnly) {
      flushPara();
      html.push(`<figure><img src="${imgOnly[2]}" alt="${imgOnly[1]}"><figcaption>${escapeHtml(imgOnly[1])}</figcaption></figure>`);
      i++; continue;
    }

    const isSeparator = (s) => s.includes('|') && /^[\s|:-]+$/.test(s) && s.includes('-');
    if (line.includes('|') && isSeparator(lines[i + 1] || '')) {
      flushPara();
      const parseRow = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) { rows.push(parseRow(lines[i])); i++; }
      html.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      const quoted = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quoted.push(lines[i].replace(/^>\s?/, '')); i++; }
      html.push(`<blockquote>${convert(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*]\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
          item = joinContinuation(item, lines[i].trim());
          i++;
        }
        items.push(inline(item));
      }
      html.push('<ul>' + items.map((t) => `<li>${t}</li>`).join('') + '</ul>');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*\d+\.\s+/, '');
        i++;
        const subs = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          subs.push(lines[i].replace(/^\s*[-*]\s+/, '').trim());
          i++;
        }
        while (i < lines.length && /^\s{3,}\S/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
          item = joinContinuation(item, lines[i].trim());
          i++;
        }
        let li = inline(item);
        if (subs.length) li += '<ul>' + subs.map((s) => `<li>${inline(s)}</li>`).join('') + '</ul>';
        items.push(li);
      }
      html.push('<ol>' + items.map((t) => `<li>${t}</li>`).join('') + '</ol>');
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return html.join('\n');
}

const md = fs.readFileSync(SRC, 'utf8');
const body = convert(md);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1e293b; font-size: 11.5px; line-height: 1.55; margin: 0;
  }
  h1 { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 {
    font-size: 16px; font-weight: 800; color: #0f172a;
    margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0;
    page-break-after: avoid;
  }
  h3 { font-size: 13px; font-weight: 800; color: #1e293b; margin: 16px 0 6px; page-break-after: avoid; }
  p { margin: 0 0 8px; }
  ul, ol { margin: 0 0 10px; padding-left: 20px; }
  li { margin: 0 0 4px; }
  li > ul { margin-top: 4px; }
  a { color: #2563eb; text-decoration: none; word-break: break-word; }
  strong { color: #0f172a; }
  code {
    background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px;
    padding: 0 4px; font-family: "Cascadia Code", Consolas, monospace; font: 10.5px;
  }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0; }
  blockquote {
    margin: 0 0 12px; padding: 10px 14px; background: #fffbeb;
    border-left: 4px solid #f59e0b; border-radius: 0 6px 6px 0; color: #78350f;
  }
  blockquote p { margin: 0; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 14px; page-break-inside: avoid; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-weight: 700; color: #0f172a; }
  figure { margin: 10px 0 16px; page-break-inside: avoid; text-align: center; }
  figure img {
    max-width: 62%; max-height: 300px; height: auto; border: 1px solid #e2e8f0;
    border-radius: 10px; box-shadow: 0 1px 4px rgba(15,23,42,0.08);
  }
  figcaption { font-size: 10px; color: #64748b; margin-top: 6px; }
</style>
</head>
<body>
${body}
</body>
</html>`;

fs.writeFileSync(OUT, page, 'utf8');
console.log(`Wrote ${OUT} (${page.length} bytes)`);
