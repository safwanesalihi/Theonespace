// Writes public/fonts/thmanyah/subset/ from the original Thmanyah Sans files (styles/fonts.css): the
// characters of its unicode-range, every layout feature (Arabic shaping, ligatures, kerning) and the
// hinting, nothing else. Needs Python with fontTools and brotli (pip install fonttools brotli).
// node scripts/subset-fonts.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';

const range = 'U+0020-007E,U+00A0-00FF,U+0600-06FF,U+0750-077F,U+2000-206F,U+20AC,U+FD3E-FD3F';
const dir = 'public/fonts/thmanyah';
mkdirSync(`${dir}/subset`, { recursive: true });
for (const weight of ['Light', 'Regular', 'Medium', 'Bold', 'Black']) {
  const out = `${dir}/subset/thmanyahsans-${weight}.woff2`;
  execFileSync('python', ['-m', 'fontTools.subset', `${dir}/thmanyahsans-${weight}.woff2`, `--unicodes=${range}`, '--layout-features=*', '--flavor=woff2', `--output-file=${out}`], { stdio: 'inherit' });
  console.log(out, `${(statSync(out).size / 1024).toFixed(1)} KB`);
}
