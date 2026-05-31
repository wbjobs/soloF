const vm = require('vm');
const fs = require('fs');
let src = fs.readFileSync('public/js/main.js', 'utf8');
src = src.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+/gm, '');
const lines = src.split('\n');
for (let i = 118; i < 122; i++) {
  const snippet = lines.slice(0, i + 1).join('\n');
  console.log('\n=== lines 0..' + (i + 1) + ' ===');
  try {
    new vm.Script(snippet);
    console.log('OK');
  } catch (e) {
    console.log('ERR:', e.message);
    const idx = (e.stack && e.stack.match(/<anonymous>:(\d+)/));
    if (idx) console.log('line', idx[1], 'in snippet');
  }
}
