const vm = require('vm');
const fs = require('fs');
let src = fs.readFileSync('public/js/main.js', 'utf8');
src = src.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+/gm, '');
try {
  new vm.Script(src);
  console.log('OK');
} catch (e) {
  console.log('ERR', e.message);
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const before = lines.slice(0, i + 1).join('\n');
    try { new vm.Script(before); } catch (e2) {
      if (i >= 110 && i <= 125) {
        console.log('line', i + 1, 'causes:', e2.message);
        console.log('  raw:', JSON.stringify(lines[i]));
      }
    }
  }
}
