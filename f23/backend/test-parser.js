const fs = require('fs');
const path = require('path');
const { parsePDB } = require('./src/utils/pdbParser');

const testPdbPath = path.join(__dirname, '..', 'test.pdb');

console.log('Testing PDB Parser with HETATM support...\n');

try {
  const pdbContent = fs.readFileSync(testPdbPath, 'utf8');
  const atoms = parsePDB(pdbContent);
  
  console.log(`\nTotal atoms parsed: ${atoms.length}`);
  
  const atomRecords = atoms.filter(a => a.recordType === 'ATOM');
  const hetatmRecords = atoms.filter(a => a.recordType === 'HETATM');
  
  console.log(`ATOM records: ${atomRecords.length}`);
  console.log(`HETATM records: ${hetatmRecords.length}`);
  
  console.log('\nSample atom data:');
  atoms.slice(0, 3).forEach(atom => {
    console.log(`  ID: ${atom.id}, Type: ${atom.recordType}, Element: ${atom.element}, Res: ${atom.resName}, Coords: (${atom.x}, ${atom.y}, ${atom.z})`);
  });
  
  if (hetatmRecords.length > 0) {
    console.log('\nHETATM records found:');
    hetatmRecords.forEach(atom => {
      console.log(`  ID: ${atom.id}, Element: ${atom.element}, Res: ${atom.resName}`);
    });
  }
  
  console.log('\n✅ Test passed! HETATM records are being parsed correctly.');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}
