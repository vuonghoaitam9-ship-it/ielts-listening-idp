import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const TARGET_DIRS = ['public/data', 'dist/data']
  .map((rel) => ({ rel, full: path.join(ROOT, rel) }))
  .filter((entry) => fs.existsSync(entry.full));

const WARN_FILE_BYTES = 50 * 1024 * 1024; // 50 MB GitHub warning threshold
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB GitHub hard limit
const MAX_SITE_BYTES = 950 * 1024 * 1024; // Safety margin below 1 GB GitHub Pages limit

function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      results.push({ path: fullPath, size: stat.size });
    }
  }
  return results;
}

if (TARGET_DIRS.length === 0) {
  console.error('Khong tim thay public/data hoac dist/data. Hay chay prepare-data truoc.');
  process.exit(1);
}

let hasFatal = false;

for (const { rel, full } of TARGET_DIRS) {
  const files = walkFiles(full);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const sorted = [...files].sort((a, b) => b.size - a.size);
  const over50 = sorted.filter((f) => f.size > WARN_FILE_BYTES);
  const over100 = sorted.filter((f) => f.size > MAX_FILE_BYTES);

  console.log(`\n=== Kiem tra dung luong: ${rel} ===`);
  console.log(`Tong so file: ${files.length}`);
  console.log(`Tong dung luong: ${(totalBytes / 1048576).toFixed(2)} MB (gioi han Pages ~950 MB)`);
  if (sorted[0]) {
    console.log(
      `File lon nhat: ${path.relative(ROOT, sorted[0].path)} (${(sorted[0].size / 1048576).toFixed(2)} MB)`
    );
  }
  if (over50.length > 0) {
    console.warn(`Canh bao (${over50.length} file > 50 MB):`);
    for (const f of over50) {
      console.warn(`  - ${path.relative(ROOT, f.path)}: ${(f.size / 1048576).toFixed(2)} MB`);
    }
  }
  if (over100.length > 0) {
    hasFatal = true;
    console.error(`LOI: Co ${over100.length} file vuot gioi han 100 MB cua GitHub!`);
  }
  if (totalBytes > MAX_SITE_BYTES) {
    hasFatal = true;
    console.error('LOI: Tong dung luong vuot nguong an toan 950 MB cho GitHub Pages!');
  }
}

if (hasFatal) {
  process.exit(1);
}
console.log('\n[OK] Tat ca file va tong dung luong dat chuan GitHub & GitHub Pages.');
