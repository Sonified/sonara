/**
 * SONARA Audio Engine
 * Synthesized space sounds for each section using Web Audio API.
 */

let ctx = null;
const activeNodes = {};
let stemAnalyser = null;
let heroAnalyser = null;
const bufferCache = {};

async function loadBuffer(url) {
  if (bufferCache[url]) return bufferCache[url];
  const ac = getContext();
  const resp = await fetch(url);
  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await ac.decodeAudioData(arrayBuf);
  bufferCache[url] = audioBuf;
  return audioBuf;
}

// Preload audio files on first user interaction
let preloaded = false;
function preload() {
  if (preloaded) return;
  preloaded = true;
  loadBuffer('audio/mp3/THE_20120302_Cleaned_MAX.mp3');
  loadBuffer('audio/mp3/Proton_Beam_Raw_WI_H2_MFI_181819_000_002.mp3');
  loadBuffer('audio/mp3/Solar_Hum_Loop_More_Filtered_Short.mp3');
  loadBuffer('audio/mp3/TRIMMED_SHORTER_MMS1_SCM_BRST_L2_Dawn_Chorus.mp3');
  loadBuffer('audio/mp3/Kick_Processed_Final__WIND_BGSE_z_2007_08_13_LFEvent_CLEANED_ISOLATED_SHORT.mp3');
  loadBuffer('audio/mp3/Solar_Shaker_1.mp3');
}

function getContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function createMaster(ac) {
  const compressor = ac.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  const gain = ac.createGain();
  gain.gain.value = 0.3;
  gain.connect(compressor);
  compressor.connect(ac.destination);
  return gain;
}

function makeNoise(ac, seconds) {
  const len = ac.sampleRate * seconds;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buf;
}

function makeReverb(ac, duration, decay) {
  const len = ac.sampleRate * duration;
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// ===== HERO: Solar wind — alternates between two audified sources =====
const heroFiles = [
  'audio/mp3/Proton_Beam_Raw_WI_H2_MFI_181819_000_002.mp3',
  'audio/mp3/Solar_Hum_Loop_More_Filtered_Short.mp3',
  // 'audio/mp3/TRIMMED_SHORTER_MMS1_SCM_BRST_L2_Dawn_Chorus.mp3',
];
// Shuffle once on load — Fisher-Yates
for (let i = heroFiles.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [heroFiles[i], heroFiles[j]] = [heroFiles[j], heroFiles[i]];
}
let heroFileIdx = 0;

async function heroSound(ac, master) {
  const nodes = [];
  const gains = [];
  const url = heroFiles[heroFileIdx % heroFiles.length];
  heroFileIdx++;
  const buf = await loadBuffer(url);
  const now = ac.currentTime;

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const g = ac.createGain();
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(1.0, now + 2);
  src.connect(g);
  g.connect(master);
  src.start();
  nodes.push(src);
  gains.push(g);
  return { nodes, gains };
}

// ===== CITIZEN SCIENCE: Audified THEMIS data =====
function citizenScienceSound(ac, master) {
  const nodes = [];
  const gains = [];
  const now = ac.currentTime;
  const buf = bufferCache['audio/mp3/THE_20120302_Cleaned_MAX.mp3'];

  if (buf) {
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.75, now + 0.5);
    src.connect(g);
    g.connect(master);
    src.start();
    nodes.push(src);
    gains.push(g);
    return { nodes, gains, duration: buf.duration };
  }

  // Fallback if not yet loaded — play silence briefly, then retry will work
  return { nodes, gains, duration: 0.1 };
}

// ===== STEM-MUSIC: Pattern generation + playback =====
export function generateStemPattern() {
  const bpm = 110 + Math.floor(Math.random() * 30);
  const step = 60 / bpm / 2;

  // Kick — biased toward on-beats (0, 4, 8, 12)
  const kick = new Array(16).fill(0);
  kick[0] = 1; // always beat 1
  for (let i = 1; i < 16; i++) {
    const onBeat = i % 4 === 0;
    kick[i] = Math.random() < (onBeat ? 0.6 : 0.1) ? 1 : 0;
  }

  // Hat — biased toward off-beats (odd steps)
  const hat = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    const offBeat = i % 2 === 1;
    hat[i] = Math.random() < (offBeat ? 0.5 : 0.15) ? 1 : 0;
  }

  // Melody
  const scales = [
    [261.63, 293.66, 329.63, 392, 440],
    [293.66, 329.63, 392, 440, 523.25],
    [349.23, 392, 440, 523.25, 587.33],
  ];
  const scale = scales[Math.floor(Math.random() * scales.length)];
  // 10 pitches (5 base + 5 octave-up) sorted high→low, paired into 5 rows
  const allPitches = [...scale, ...scale.map(f => f * 2)].sort((a, b) => b - a); // 10 pitches
  const melodyRows = [0,1,2,3,4].map(() => new Array(16).fill(0)); // 5 rows
  const melodyFreqs = new Array(16).fill(0);

  const noteCount = 6 + Math.floor(Math.random() * 3);
  const waveTypes = ['sawtooth', 'triangle', 'square'];
  const waveType = waveTypes[Math.floor(Math.random() * waveTypes.length)];

  for (let i = 0; i < noteCount; i++) {
    const stepIdx = i * 2;
    if (stepIdx >= 16) break;
    const baseFreq = scale[Math.floor(Math.random() * scale.length)];
    const freq = Math.random() < 0.3 ? baseFreq * 2 : baseFreq;
    const pitchIdx = allPitches.indexOf(freq);
    // 10 pitches → 5 rows: pitches 0,1 → row 0 (highest), 2,3 → row 1, etc.
    const rowIdx = Math.floor(pitchIdx / 2);
    if (rowIdx >= 0 && rowIdx < 5) melodyRows[rowIdx][stepIdx] = 1;
    melodyFreqs[stepIdx] = freq;
  }

  return { kick, hat, melodyRows, melodyFreqs, pitches: allPitches, waveType, bpm, step, steps: 16 };
}

async function stemMusicSound(ac, master, prePattern) {
  const pat = prePattern || generateStemPattern();
  const nodes = [];
  const gains = [];
  const step = pat.step;

  // Reverb
  const conv = ac.createConvolver();
  conv.buffer = makeReverb(ac, 2, 2);
  const revG = ac.createGain();
  revG.gain.value = 0.3;
  conv.connect(revG);
  revG.connect(master);

  // Kicks (space kick sample)
  const kickBuf = await loadBuffer('audio/mp3/Kick_Processed_Final__WIND_BGSE_z_2007_08_13_LFEvent_CLEANED_ISOLATED_SHORT.mp3');
  const now = ac.currentTime;
  pat.kick.forEach((hit, i) => {
    if (!hit) return;
    const t = now + i * step + 0.2;
    const src = ac.createBufferSource();
    src.buffer = kickBuf;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.8, t);
    src.connect(g);
    g.connect(master);
    src.start(t);
    nodes.push(src);
  });

  // Hats (solar shaker sample)
  const hatBuf = await loadBuffer('audio/mp3/Solar_Shaker_1.mp3');
  pat.hat.forEach((hit, i) => {
    if (!hit) return;
    const t = now + i * step + 0.2;
    const src = ac.createBufferSource();
    src.buffer = hatBuf;
    src.playbackRate.value = 1.5 + Math.random();
    const g = ac.createGain();
    g.gain.setValueAtTime(0.5, t);
    src.connect(g);
    g.connect(master);
    src.start(t);
    nodes.push(src);
  });

  // Melody
  pat.melodyFreqs.forEach((freq, i) => {
    if (!freq) return;
    const t = now + i * step + 0.2 + (Math.random() - 0.5) * step * 0.3;
    const osc = ac.createOscillator();
    osc.type = pat.waveType;
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 10;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500 + Math.random() * 1500;
    lp.Q.value = 2 + Math.random() * 3;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04 + Math.random() * 0.03, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + step * 1.5 + Math.random() * step);
    osc.connect(lp);
    lp.connect(g);
    g.connect(conv);
    g.connect(master);
    osc.start(t);
    osc.stop(t + step * 2);
    nodes.push(osc);
  });

  gains.push(revG);
  const duration = 16 * step + 0.2;
  const pattern = { ...pat, startTime: now + 0.2 };
  return { nodes, gains, duration, pattern };
}

// ===== PLANETARIUM: Immersive dome atmosphere =====
function planetariumSound(ac, master) {
  const nodes = [];
  const gains = [];
  const now = ac.currentTime;

  // Deep spatial reverb
  const conv = ac.createConvolver();
  conv.buffer = makeReverb(ac, 4, 2);
  const revG = ac.createGain();
  revG.gain.value = 0.6;
  conv.connect(revG);
  revG.connect(master);

  // Evolving pad
  const padFreqs = [130.81, 196, 261.63, 329.63, 392]; // C3, G3, C4, E4, G4
  padFreqs.forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 12;
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.06 - i * 0.008, now + 2 + i * 0.4);

    // Slow tremolo
    const trem = ac.createOscillator();
    trem.frequency.value = 0.15 + i * 0.05;
    const tremG = ac.createGain();
    tremG.gain.value = 0.02;
    trem.connect(tremG);
    tremG.connect(g.gain);
    trem.start();

    osc.connect(g);
    g.connect(conv);
    g.connect(master);
    osc.start();
    nodes.push(osc, trem);
    gains.push(g);
  });

  // Sub bass pulse
  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 50;
  const subG = ac.createGain();
  subG.gain.value = 0;
  subG.gain.linearRampToValueAtTime(0.12, now + 3);
  // Slow pulsation
  const subLfo = ac.createOscillator();
  subLfo.frequency.value = 0.08;
  const subLfoG = ac.createGain();
  subLfoG.gain.value = 0.06;
  subLfo.connect(subLfoG);
  subLfoG.connect(subG.gain);
  subLfo.start();
  sub.connect(subG);
  subG.connect(master);
  sub.start();
  nodes.push(sub, subLfo);
  gains.push(subG);

  // Sparkle pings (stars)
  for (let i = 0; i < 15; i++) {
    const t = now + 1 + Math.random() * 10;
    const freq = 800 + Math.random() * 3000;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.02 + Math.random() * 0.03, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5 + Math.random() * 0.5);
    osc.connect(g);
    g.connect(conv);
    osc.start(t);
    osc.stop(t + 1.5);
    nodes.push(osc);
  }

  gains.push(revG);
  return { nodes, gains };
}

const generators = {
  'hero': heroSound,
  'citizen-science': citizenScienceSound,
  'stem-music': stemMusicSound,
  'planetarium': planetariumSound
};

let pendingStemPattern = null;

export function setStemPattern(pat) {
  pendingStemPattern = pat;
}

export async function play(id) {
  if (activeNodes[id]) return false; // already playing

  const ac = getContext();
  preload();
  const master = createMaster(ac);
  const gen = generators[id];
  if (!gen) return false;

  // For stem-music, pass the pending pattern (from the displayed grid)
  const result = (id === 'stem-music')
    ? await gen(ac, master, pendingStemPattern)
    : await gen(ac, master);
  if (id === 'stem-music') pendingStemPattern = null; // used it, next play gets fresh
  // Store the exact audio-clock end time for precise sync
  if (result.duration) {
    result.endTime = ac.currentTime + result.duration;
  }
  // Attach analyser for stem-music oscilloscope
  if (id === 'stem-music') {
    stemAnalyser = ac.createAnalyser();
    stemAnalyser.fftSize = 2048;
    master.connect(stemAnalyser);
  }
  // Attach analyser for hero audio reactivity
  if (id === 'hero') {
    heroAnalyser = ac.createAnalyser();
    heroAnalyser.fftSize = 256;
    master.connect(heroAnalyser);
  }
  activeNodes[id] = { ...result, master };
  return result.duration || true;
}

export function stop(id) {
  const fadeTime = 0.25; // time constant in seconds — fast fade
  const entry = activeNodes[id];
  if (!entry) return Promise.resolve();

  const { nodes, gains = [], master } = entry;
  delete activeNodes[id];
  if (id === 'stem-music') stemAnalyser = null;
  if (id === 'hero') heroAnalyser = null;

  try {
    const ac = getContext();
    const now = ac.currentTime;

    // Fade each individual gain node (before the compressor can interfere)
    for (const g of gains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.setTargetAtTime(0, now, fadeTime);
      } catch(e) { /* automation may conflict — keep going */ }
    }

    // Also fade master as a safety net
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.setTargetAtTime(0, now, fadeTime);
    } catch(e) {}
  } catch(e) {}

  return new Promise(resolve => {
    setTimeout(() => {
      nodes.forEach(n => { try { n.stop(); } catch(e) {} });
      try { master.disconnect(); } catch(e) {}
      resolve();
    }, 800); // ~3 time constants at 0.25s = 0.75s, round up
  });
}

export function getEndTime(id) {
  return activeNodes[id]?.endTime || null;
}

export function now() {
  return ctx ? ctx.currentTime : 0;
}

export function getStemAnalyser() {
  return stemAnalyser;
}

export function getHeroAnalyser() {
  return heroAnalyser;
}

export function getStemPattern() {
  return activeNodes['stem-music']?.pattern || null;
}

export function stopAll() {
  Object.keys(activeNodes).forEach(id => stop(id));
}
