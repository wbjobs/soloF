export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const NOTE_TO_MIDI = {
  'C': 60, 'C#': 61, 'D': 62, 'D#': 63, 'E': 64, 'F': 65,
  'F#': 66, 'G': 67, 'G#': 68, 'A': 69, 'A#': 70, 'B': 71
}

export const INTERVALS = {
  root: 0,
  minor2nd: 1,
  major2nd: 2,
  minor3rd: 3,
  major3rd: 4,
  perfect4th: 5,
  flat5th: 6,
  perfect5th: 7,
  minor6th: 8,
  major6th: 9,
  minor7th: 10,
  major7th: 11,
  octave: 12,
  flat9th: 13,
  ninth: 14,
  sharp9th: 15,
  eleventh: 17,
  sharp11th: 18,
  flat13th: 20,
  thirteenth: 21
}

export const MUSIC_STYLES = {
  jazz: {
    name: '爵士',
    icon: '🎷',
    description: '丰富的扩展和弦，Walking Bass和摇摆节奏',
    color: '#8B5CF6',
    voicing: {
      chordTypes: {
        major: ['maj7', 'maj9', 'maj13', '6/9'],
        minor: ['m7', 'm9', 'm13', 'm7b5'],
        dominant: ['7', '9', '13', '7b9', '7#9', '7alt'],
        diminished: ['dim7', 'dim'],
        augmented: ['aug', '7#5']
      },
      extensions: {
        use9th: true,
        use11th: true,
        use13th: true,
        useAltered: true,
        probability: 0.8
      },
      inversion: {
        rootPosition: 0.2,
        firstInversion: 0.4,
        secondInversion: 0.3,
        thirdInversion: 0.1
      },
      dropVoicing: {
        drop2: 0.5,
        drop2and4: 0.3,
        close: 0.2
      },
      spread: {
        min: 12,
        max: 36,
        preferred: 24
      }
    },
    rhythm: {
      timeSignature: '4/4',
      bpmRange: { min: 80, max: 180, default: 120 },
      swingRatio: 0.67,
      compingPatterns: ['four-to-the-floor', ' Charleston', 'syncopated'],
      articulation: {
        staccato: 0.3,
        legato: 0.7,
        accent: 0.4
      },
      dynamics: {
        min: 0.5,
        max: 0.9,
        variation: true
      }
    },
    instruments: {
      chords: 'electricPiano1',
      bass: 'acousticBass',
      drums: 'jazzKit'
    }
  },
  electronic: {
    name: '电子',
    icon: '🎹',
    description: '合成器音色，四到地板节奏，琶音和琶音模式',
    color: '#06B6D4',
    voicing: {
      chordTypes: {
        major: ['maj', 'maj7', 'sus2', 'sus4'],
        minor: ['m', 'm7', 'msus4'],
        dominant: ['7', '7sus4'],
        diminished: ['dim'],
        augmented: ['aug']
      },
      extensions: {
        use9th: true,
        use11th: true,
        use13th: false,
        useAltered: false,
        probability: 0.5
      },
      inversion: {
        rootPosition: 0.7,
        firstInversion: 0.2,
        secondInversion: 0.1,
        thirdInversion: 0
      },
      dropVoicing: {
        drop2: 0.2,
        drop2and4: 0.1,
        close: 0.7
      },
      spread: {
        min: 8,
        max: 24,
        preferred: 16
      }
    },
    rhythm: {
      timeSignature: '4/4',
      bpmRange: { min: 100, max: 140, default: 128 },
      swingRatio: 0.5,
      compingPatterns: ['four-to-the-floor', 'offbeat', 'arpeggio'],
      articulation: {
        staccato: 0.8,
        legato: 0.2,
        accent: 0.6
      },
      dynamics: {
        min: 0.6,
        max: 1.0,
        variation: true
      }
    },
    instruments: {
      chords: 'synthPad',
      bass: 'synthBass',
      drums: 'electronicKit'
    }
  },
  classical: {
    name: '古典',
    icon: '🎻',
    description: '三和弦和七和弦，四部和声，阿尔贝蒂低音',
    color: '#10B981',
    voicing: {
      chordTypes: {
        major: ['maj', 'maj7'],
        minor: ['m', 'm7'],
        dominant: ['7'],
        diminished: ['dim', 'dim7'],
        augmented: ['aug']
      },
      extensions: {
        use9th: false,
        use11th: false,
        use13th: false,
        useAltered: false,
        probability: 0
      },
      inversion: {
        rootPosition: 0.4,
        firstInversion: 0.4,
        secondInversion: 0.2,
        thirdInversion: 0
      },
      dropVoicing: {
        drop2: 0.1,
        drop2and4: 0,
        close: 0.9
      },
      spread: {
        min: 10,
        max: 30,
        preferred: 18
      },
      voiceLeading: {
        stepwiseMotion: true,
        avoidParallelFifths: true,
        doubleRoot: true
      }
    },
    rhythm: {
      timeSignature: '4/4',
      bpmRange: { min: 60, max: 120, default: 90 },
      swingRatio: 0.5,
      compingPatterns: ['alberti', 'block', 'broken'],
      articulation: {
        staccato: 0.2,
        legato: 0.8,
        accent: 0.3
      },
      dynamics: {
        min: 0.4,
        max: 0.9,
        variation: true
      }
    },
    instruments: {
      chords: 'acousticGrandPiano',
      bass: 'cello',
      drums: 'timpani'
    }
  },
  rock: {
    name: '摇滚',
    icon: '🎸',
    description: '强力和弦，稳定的八分音符节奏，失真音色',
    color: '#EF4444',
    voicing: {
      chordTypes: {
        major: ['maj', '5', 'sus2', 'sus4'],
        minor: ['m', 'm5'],
        dominant: ['7', '5'],
        diminished: ['dim'],
        augmented: ['aug']
      },
      extensions: {
        use9th: false,
        use11th: false,
        use13th: false,
        useAltered: false,
        probability: 0
      },
      inversion: {
        rootPosition: 0.9,
        firstInversion: 0.1,
        secondInversion: 0,
        thirdInversion: 0
      },
      dropVoicing: {
        drop2: 0,
        drop2and4: 0,
        close: 1
      },
      spread: {
        min: 6,
        max: 18,
        preferred: 12
      },
      powerChords: {
        rootAndFifth: true,
        octaveDoubling: true
      }
    },
    rhythm: {
      timeSignature: '4/4',
      bpmRange: { min: 100, max: 180, default: 140 },
      swingRatio: 0.5,
      compingPatterns: ['eighth-note', 'power-chord', 'palm-mute'],
      articulation: {
        staccato: 0.7,
        legato: 0.3,
        accent: 0.8
      },
      dynamics: {
        min: 0.7,
        max: 1.0,
        variation: true
      }
    },
    instruments: {
      chords: 'electricGuitar',
      bass: 'electricBass',
      drums: 'rockKit'
    }
  },
  latin: {
    name: '拉丁',
    icon: '💃',
    description: '蒙图诺节奏，巴萨诺瓦和弦，拉丁打击乐',
    color: '#F59E0B',
    voicing: {
      chordTypes: {
        major: ['maj7', '6', '6/9'],
        minor: ['m7', 'm9'],
        dominant: ['7', '9', '13'],
        diminished: ['dim7'],
        augmented: ['aug']
      },
      extensions: {
        use9th: true,
        use11th: false,
        use13th: true,
        useAltered: false,
        probability: 0.7
      },
      inversion: {
        rootPosition: 0.3,
        firstInversion: 0.5,
        secondInversion: 0.2,
        thirdInversion: 0
      },
      dropVoicing: {
        drop2: 0.6,
        drop2and4: 0.2,
        close: 0.2
      },
      spread: {
        min: 10,
        max: 28,
        preferred: 20
      }
    },
    rhythm: {
      timeSignature: '4/4',
      bpmRange: { min: 90, max: 160, default: 120 },
      swingRatio: 0.55,
      compingPatterns: ['montuno', 'bossa-nova', 'clave'],
      articulation: {
        staccato: 0.6,
        legato: 0.4,
        accent: 0.5
      },
      dynamics: {
        min: 0.5,
        max: 0.9,
        variation: true
      }
    },
    instruments: {
      chords: 'acousticGuitar',
      bass: 'acousticBass',
      drums: 'latinPercussion'
    }
  }
}

export const CHORD_FORMULAS = {
  maj: ['root', 'major3rd', 'perfect5th'],
  maj7: ['root', 'major3rd', 'perfect5th', 'major7th'],
  maj9: ['root', 'major3rd', 'perfect5th', 'major7th', 'ninth'],
  maj13: ['root', 'major3rd', 'perfect5th', 'major7th', 'ninth', 'thirteenth'],
  m: ['root', 'minor3rd', 'perfect5th'],
  m7: ['root', 'minor3rd', 'perfect5th', 'minor7th'],
  m9: ['root', 'minor3rd', 'perfect5th', 'minor7th', 'ninth'],
  m13: ['root', 'minor3rd', 'perfect5th', 'minor7th', 'ninth', 'thirteenth'],
  m7b5: ['root', 'minor3rd', 'flat5th', 'minor7th'],
  '7': ['root', 'major3rd', 'perfect5th', 'minor7th'],
  '9': ['root', 'major3rd', 'perfect5th', 'minor7th', 'ninth'],
  '13': ['root', 'major3rd', 'perfect5th', 'minor7th', 'ninth', 'thirteenth'],
  '7b9': ['root', 'major3rd', 'perfect5th', 'minor7th', 'flat9th'],
  '7#9': ['root', 'major3rd', 'perfect5th', 'minor7th', 'sharp9th'],
  '7alt': ['root', 'major3rd', 'flat5th', 'minor7th', 'flat9th'],
  '6': ['root', 'major3rd', 'perfect5th', 'major6th'],
  '6/9': ['root', 'major3rd', 'perfect5th', 'major6th', 'ninth'],
  sus2: ['root', 'major2nd', 'perfect5th'],
  sus4: ['root', 'perfect4th', 'perfect5th'],
  '7sus4': ['root', 'perfect4th', 'perfect5th', 'minor7th'],
  dim: ['root', 'minor3rd', 'flat5th'],
  dim7: ['root', 'minor3rd', 'flat5th', 'major6th'],
  aug: ['root', 'major3rd', 'flat5th'],
  '7#5': ['root', 'major3rd', 'flat5th', 'minor7th'],
  '5': ['root', 'perfect5th']
}

export const RHYTHM_PATTERNS = {
  'four-to-the-floor': [
    { time: 0, duration: 0.25, velocity: 0.9 },
    { time: 1, duration: 0.25, velocity: 0.8 },
    { time: 2, duration: 0.25, velocity: 0.85 },
    { time: 3, duration: 0.25, velocity: 0.75 }
  ],
  Charleston: [
    { time: 0, duration: 0.25, velocity: 0.9 },
    { time: 0.75, duration: 0.25, velocity: 0.7 },
    { time: 2, duration: 0.25, velocity: 0.85 },
    { time: 2.75, duration: 0.25, velocity: 0.65 }
  ],
  syncopated: [
    { time: 0, duration: 0.3, velocity: 0.9 },
    { time: 1.5, duration: 0.25, velocity: 0.75 },
    { time: 2.5, duration: 0.3, velocity: 0.85 },
    { time: 3.5, duration: 0.25, velocity: 0.7 }
  ],
  offbeat: [
    { time: 0.5, duration: 0.4, velocity: 0.85 },
    { time: 1.5, duration: 0.4, velocity: 0.85 },
    { time: 2.5, duration: 0.4, velocity: 0.85 },
    { time: 3.5, duration: 0.4, velocity: 0.85 }
  ],
  arpeggio: [
    { time: 0, duration: 0.2, velocity: 0.85, noteIndex: 0 },
    { time: 0.25, duration: 0.2, velocity: 0.8, noteIndex: 1 },
    { time: 0.5, duration: 0.2, velocity: 0.75, noteIndex: 2 },
    { time: 0.75, duration: 0.2, velocity: 0.7, noteIndex: 3 },
    { time: 1, duration: 0.2, velocity: 0.85, noteIndex: 0 },
    { time: 1.25, duration: 0.2, velocity: 0.8, noteIndex: 1 },
    { time: 1.5, duration: 0.2, velocity: 0.75, noteIndex: 2 },
    { time: 1.75, duration: 0.2, velocity: 0.7, noteIndex: 3 }
  ],
  alberti: [
    { time: 0, duration: 0.25, velocity: 0.7, noteIndex: 0 },
    { time: 0.25, duration: 0.25, velocity: 0.65, noteIndex: 2 },
    { time: 0.5, duration: 0.25, velocity: 0.65, noteIndex: 1 },
    { time: 0.75, duration: 0.25, velocity: 0.6, noteIndex: 2 },
    { time: 1, duration: 0.25, velocity: 0.7, noteIndex: 0 },
    { time: 1.25, duration: 0.25, velocity: 0.65, noteIndex: 2 },
    { time: 1.5, duration: 0.25, velocity: 0.65, noteIndex: 1 },
    { time: 1.75, duration: 0.25, velocity: 0.6, noteIndex: 2 }
  ],
  block: [
    { time: 0, duration: 1, velocity: 0.8 },
    { time: 2, duration: 1, velocity: 0.75 }
  ],
  broken: [
    { time: 0, duration: 0.5, velocity: 0.8, noteIndex: 0 },
    { time: 0.5, duration: 0.5, velocity: 0.75, noteIndex: 1 },
    { time: 1, duration: 0.5, velocity: 0.8, noteIndex: 2 },
    { time: 2, duration: 0.5, velocity: 0.75, noteIndex: 0 },
    { time: 2.5, duration: 0.5, velocity: 0.7, noteIndex: 1 },
    { time: 3, duration: 0.5, velocity: 0.75, noteIndex: 2 }
  ],
  'eighth-note': [
    { time: 0, duration: 0.45, velocity: 0.9 },
    { time: 0.5, duration: 0.45, velocity: 0.85 },
    { time: 1, duration: 0.45, velocity: 0.9 },
    { time: 1.5, duration: 0.45, velocity: 0.85 },
    { time: 2, duration: 0.45, velocity: 0.9 },
    { time: 2.5, duration: 0.45, velocity: 0.85 },
    { time: 3, duration: 0.45, velocity: 0.9 },
    { time: 3.5, duration: 0.45, velocity: 0.85 }
  ],
  'power-chord': [
    { time: 0, duration: 1, velocity: 1.0 },
    { time: 1, duration: 1, velocity: 0.95 },
    { time: 2, duration: 1, velocity: 1.0 },
    { time: 3, duration: 1, velocity: 0.95 }
  ],
  'palm-mute': [
    { time: 0, duration: 0.2, velocity: 0.85 },
    { time: 0.25, duration: 0.2, velocity: 0.8 },
    { time: 0.5, duration: 0.2, velocity: 0.85 },
    { time: 0.75, duration: 0.2, velocity: 0.8 },
    { time: 1, duration: 0.2, velocity: 0.9 },
    { time: 1.5, duration: 0.3, velocity: 0.85 },
    { time: 2, duration: 0.2, velocity: 0.85 },
    { time: 2.25, duration: 0.2, velocity: 0.8 },
    { time: 2.5, duration: 0.2, velocity: 0.85 },
    { time: 2.75, duration: 0.2, velocity: 0.8 },
    { time: 3, duration: 0.2, velocity: 0.9 },
    { time: 3.5, duration: 0.3, velocity: 0.85 }
  ],
  montuno: [
    { time: 0, duration: 0.4, velocity: 0.9 },
    { time: 0.66, duration: 0.3, velocity: 0.75 },
    { time: 1, duration: 0.4, velocity: 0.85 },
    { time: 1.66, duration: 0.3, velocity: 0.7 },
    { time: 2, duration: 0.4, velocity: 0.9 },
    { time: 2.66, duration: 0.3, velocity: 0.75 },
    { time: 3, duration: 0.4, velocity: 0.85 },
    { time: 3.66, duration: 0.3, velocity: 0.7 }
  ],
  'bossa-nova': [
    { time: 0, duration: 0.5, velocity: 0.85 },
    { time: 0.75, duration: 0.25, velocity: 0.7 },
    { time: 1.5, duration: 0.5, velocity: 0.8 },
    { time: 2.25, duration: 0.25, velocity: 0.65 },
    { time: 3, duration: 0.5, velocity: 0.85 }
  ],
  clave: [
    { time: 0, duration: 0.3, velocity: 0.9 },
    { time: 1, duration: 0.3, velocity: 0.85 },
    { time: 2, duration: 0.3, velocity: 0.9 },
    { time: 3.5, duration: 0.3, velocity: 0.85 }
  ]
}

export const generateChordNotes = (rootNote, chordType, octave = 4) => {
  const rootMidi = NOTE_TO_MIDI[rootNote] + (octave - 4) * 12
  const formula = CHORD_FORMULAS[chordType] || CHORD_FORMULAS.maj
  
  return formula.map(intervalName => {
    const interval = INTERVALS[intervalName]
    return rootMidi + interval
  })
}

export const applyInversion = (notes, inversionLevel) => {
  const result = [...notes]
  for (let i = 0; i < inversionLevel && i < result.length; i++) {
    result[i] += 12
  }
  return result.sort((a, b) => a - b)
}

export const applyDropVoicing = (notes, dropType) => {
  if (dropType === 'close') return notes
  
  const sorted = [...notes].sort((a, b) => a - b)
  if (sorted.length < 4) return sorted
  
  if (dropType === 'drop2') {
    [sorted[1], sorted[0]] = [sorted[0], sorted[1] - 12]
  } else if (dropType === 'drop2and4') {
    sorted[1] -= 12
    sorted[3] -= 12
  }
  
  return sorted.sort((a, b) => a - b)
}

export const getChordQuality = (chordName) => {
  if (chordName.includes('m')) return 'minor'
  if (chordName.includes('dim')) return 'diminished'
  if (chordName.includes('aug')) return 'augmented'
  if (chordName.includes('7') && !chordName.includes('maj')) return 'dominant'
  return 'major'
}

export const selectChordTypeForStyle = (style, chordName) => {
  const styleConfig = MUSIC_STYLES[style]
  const quality = getChordQuality(chordName)
  const availableTypes = styleConfig.voicing.chordTypes[quality]
  
  if (!availableTypes || availableTypes.length === 0) {
    return quality === 'minor' ? 'm' : 'maj'
  }
  
  return availableTypes[Math.floor(Math.random() * availableTypes.length)]
}

export const stylizeChord = (chordName, style, octave = 4) => {
  const rootNote = chordName.replace(/m|maj|dim|aug|7|9|13|sus|#|b/g, '')
  const chordType = selectChordTypeForStyle(style, chordName)
  const styleConfig = MUSIC_STYLES[style]
  
  let notes = generateChordNotes(rootNote, chordType, octave)
  
  const invRand = Math.random()
  let invLevel = 0
  let cumProb = 0
  for (const [level, prob] of Object.entries(styleConfig.voicing.inversion)) {
    cumProb += prob
    if (invRand < cumProb) {
      invLevel = parseInt(level.replace('rootPosition', '0')
        .replace('firstInversion', '1')
        .replace('secondInversion', '2')
        .replace('thirdInversion', '3'))
      break
    }
  }
  notes = applyInversion(notes, invLevel)
  
  const dropRand = Math.random()
  let dropType = 'close'
  cumProb = 0
  for (const [type, prob] of Object.entries(styleConfig.voicing.dropVoicing)) {
    cumProb += prob
    if (dropRand < cumProb) {
      dropType = type
      break
    }
  }
  notes = applyDropVoicing(notes, dropType)
  
  return {
    root: rootNote,
    type: chordType,
    quality: getChordQuality(chordName),
    notes: notes,
    inversion: invLevel,
    dropType: dropType,
    style: style
  }
}

export const generateRhythmPattern = (style, numBars = 4) => {
  const styleConfig = MUSIC_STYLES[style]
  const patterns = styleConfig.rhythm.compingPatterns
  const selectedPattern = patterns[Math.floor(Math.random() * patterns.length)]
  
  const basePattern = RHYTHM_PATTERNS[selectedPattern] || RHYTHM_PATTERNS['four-to-the-floor']
  
  const fullPattern = []
  for (let bar = 0; bar < numBars; bar++) {
    basePattern.forEach(event => {
      fullPattern.push({
        ...event,
        time: event.time + bar * 4
      })
    })
  }
  
  return {
    pattern: fullPattern,
    patternName: selectedPattern,
    style: style,
    swingRatio: styleConfig.rhythm.swingRatio
  }
}

export const midiToNoteName = (midiNote) => {
  const octave = Math.floor(midiNote / 12) - 1
  const noteIndex = midiNote % 12
  return NOTE_NAMES[noteIndex] + octave
}

export default {
  MUSIC_STYLES,
  CHORD_FORMULAS,
  RHYTHM_PATTERNS,
  INTERVALS,
  NOTE_TO_MIDI,
  NOTE_NAMES,
  stylizeChord,
  generateRhythmPattern,
  generateChordNotes,
  applyInversion,
  applyDropVoicing,
  getChordQuality,
  midiToNoteName
}
