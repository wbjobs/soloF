const Router = require('koa-router');
const { v4: uuidv4 } = require('uuid');
const { uploadFile, getFileAsString } = require('../config/minio');
const { parsePDB } = require('../utils/pdbParser');

const router = new Router({ prefix: '/api' });

function filterAtoms(atoms, filters = {}) {
  let filtered = [...atoms];

  if (filters.resName) {
    const resNames = filters.resName.split(',').map(r => r.trim().toUpperCase());
    filtered = filtered.filter(atom => resNames.includes(atom.resName.toUpperCase()));
  }

  if (filters.recordType) {
    const types = filters.recordType.split(',').map(t => t.trim().toUpperCase());
    filtered = filtered.filter(atom => types.includes(atom.recordType));
  }

  if (filters.element) {
    const elements = filters.element.split(',').map(e => e.trim().toUpperCase());
    filtered = filtered.filter(atom => elements.includes(atom.element.toUpperCase()));
  }

  if (filters.chainID) {
    const chains = filters.chainID.split(',').map(c => c.trim());
    filtered = filtered.filter(atom => chains.includes(atom.chainID));
  }

  return filtered;
}

router.post('/upload', async (ctx) => {
  try {
    const file = ctx.request.files?.file;
    if (!file) {
      ctx.status = 400;
      ctx.body = { error: 'No file uploaded' };
      return;
    }

    const fs = require('fs');
    const fileBuffer = fs.readFileSync(file.filepath);
    const fileId = uuidv4();
    const fileName = `${fileId}.pdb`;

    await uploadFile(fileName, fileBuffer, 'text/plain');

    ctx.body = {
      success: true,
      moleculeId: fileId,
      fileName: file.originalFilename
    };
  } catch (error) {
    console.error('Upload error:', error);
    ctx.status = 500;
    ctx.body = { error: 'Upload failed' };
  }
});

router.get('/molecule/:id', async (ctx) => {
  try {
    const moleculeId = ctx.params.id;
    const fileName = `${moleculeId}.pdb`;
    
    const pdbContent = await getFileAsString(fileName);
    let atoms = parsePDB(pdbContent);

    atoms = filterAtoms(atoms, ctx.query);

    ctx.body = {
      success: true,
      moleculeId,
      totalAtoms: atoms.length,
      filters: ctx.query,
      atoms
    };
  } catch (error) {
    console.error('Get molecule error:', error);
    ctx.status = 404;
    ctx.body = { error: 'Molecule not found' };
  }
});

router.get('/molecule/:id/metadata', async (ctx) => {
  try {
    const moleculeId = ctx.params.id;
    const fileName = `${moleculeId}.pdb`;
    
    const pdbContent = await getFileAsString(fileName);
    const atoms = parsePDB(pdbContent);

    const resNames = [...new Set(atoms.map(a => a.resName).filter(r => r))];
    const elements = [...new Set(atoms.map(a => a.element).filter(e => e))];
    const chainIDs = [...new Set(atoms.map(a => a.chainID).filter(c => c))];
    const recordTypes = [...new Set(atoms.map(a => a.recordType).filter(t => t))];

    ctx.body = {
      success: true,
      moleculeId,
      totalAtoms: atoms.length,
      resNames,
      elements,
      chainIDs,
      recordTypes
    };
  } catch (error) {
    console.error('Get metadata error:', error);
    ctx.status = 404;
    ctx.body = { error: 'Molecule not found' };
  }
});

module.exports = router;
