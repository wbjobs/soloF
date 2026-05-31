function parsePDB(pdbContent) {
  const atoms = [];
  const lines = pdbContent.split('\n');
  let atomCount = 0;
  let hetatmCount = 0;

  for (const line of lines) {
    if (line.startsWith('ATOM')) {
      const atom = parseAtomLine(line, 'ATOM');
      if (atom) {
        atoms.push(atom);
        atomCount++;
      }
    } else if (line.startsWith('HETATM')) {
      const atom = parseAtomLine(line, 'HETATM');
      if (atom) {
        atoms.push(atom);
        hetatmCount++;
      }
    }
  }

  console.log(`Parsed ${atomCount} ATOM records and ${hetatmCount} HETATM records`);
  return atoms;
}

function safeParseInt(str, defaultValue = 0) {
  const trimmed = str?.trim();
  if (!trimmed) return defaultValue;
  const parsed = parseInt(trimmed, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function safeParseFloat(str, defaultValue = 0.0) {
  const trimmed = str?.trim();
  if (!trimmed) return defaultValue;
  const parsed = parseFloat(trimmed);
  return isNaN(parsed) ? defaultValue : parsed;
}

function safeSubstring(line, start, end) {
  if (start >= line.length) return '';
  return line.substring(start, Math.min(end, line.length));
}

function parseAtomLine(line, recordType) {
  try {
    const serial = safeParseInt(safeSubstring(line, 6, 11));
    const name = safeSubstring(line, 12, 16).trim();
    const altLoc = safeSubstring(line, 16, 17).trim();
    const resName = safeSubstring(line, 17, 20).trim();
    const chainID = safeSubstring(line, 21, 22).trim();
    const resSeq = safeParseInt(safeSubstring(line, 22, 26));
    const iCode = safeSubstring(line, 26, 27).trim();
    const x = safeParseFloat(safeSubstring(line, 30, 38));
    const y = safeParseFloat(safeSubstring(line, 38, 46));
    const z = safeParseFloat(safeSubstring(line, 46, 54));
    const occupancy = safeParseFloat(safeSubstring(line, 54, 60));
    const tempFactor = safeParseFloat(safeSubstring(line, 60, 66));
    
    let element = safeSubstring(line, 76, 78).trim();
    if (!element) {
      const nameLetters = name.replace(/[^A-Za-z]/g, '');
      if (nameLetters.length >= 2) {
        const firstTwo = nameLetters.substring(0, 2).toUpperCase();
        const twoLetterElements = ['FE', 'MN', 'CO', 'NI', 'CU', 'ZN', 'BR', 'CL', 'CA', 'MG', 'NA', 'K'];
        if (twoLetterElements.includes(firstTwo)) {
          element = firstTwo;
        } else {
          element = nameLetters.charAt(0).toUpperCase();
        }
      } else {
        element = nameLetters.charAt(0).toUpperCase() || 'X';
      }
    }
    if (!element) {
      element = 'X';
    }

    return {
      id: serial,
      name,
      element: element.toUpperCase(),
      x,
      y,
      z,
      resName,
      chainID,
      resSeq,
      occupancy,
      tempFactor,
      recordType
    };
  } catch (error) {
    console.error(`Error parsing ${recordType} line:`, line.substring(0, 80), error.message);
    return null;
  }
}

module.exports = { parsePDB };
