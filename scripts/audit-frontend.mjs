import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|css)$/.test(entry.name)) files.push(full);
  }
}
walk(root);

const rules = [
  { name: 'merge conflict marker', pattern: /^(<<<<<<<|=======|>>>>>>>)/m },
  { name: 'native alert dialog', pattern: /\b(?:window\.)?alert\s*\(/ },
  { name: 'native confirm dialog', pattern: /\bwindow\.confirm\s*\(/ },
];
const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const rule of rules) if (rule.pattern.test(source)) failures.push(`${path.relative(process.cwd(), file)}: ${rule.name}`);
}
if (failures.length) {
  console.error(`Frontend audit failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(`Frontend audit passed (${files.length} source files checked).`);