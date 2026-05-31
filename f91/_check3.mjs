import fs from 'fs';
import path from 'path';

let src = fs.readFileSync('public/js/main.js', 'utf8');
// strip imports/exports and make it parseable as top-level script
src = src.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+/gm, '');
const tmp = path.resolve('_syntax_check.mjs');
fs.writeFileSync(tmp, src);
import('file:///' + path.resolve(tmp).replace(/\\/g, '/')).then(() => {
  console.log('OK');
}).catch((e) => {
  console.log('ERR:', e.message);
  if (e.stack) console.log(e.stack);
}).finally(() => {
  try { fs.unlinkSync(tmp); } catch {}
});
