/**
 * SONARA Audio Engine
 * Synthesized space sounds for each section using Web Audio API.
 */

let ctx = null;
const activeNodes = {};
let stemAnalyser = null;
let heroAnalyser = null;
let citizenAnalyser = null;
const bufferCache = {};

// Two-phase loading: fetch raw bytes immediately (no AudioContext needed),
// decode to AudioBuffer on demand when AudioContext exists.
const rawCache = {};  // url → ArrayBuffer (fetched on page load)

async function prefetchBuffer(url) {
  if (rawCache[url]) return;
  const name = url.split('/').pop();
  console.log(`[audio] fetching: ${name}`);
  const resp = await fetch(url);
  rawCache[url] = await resp.arrayBuffer();
  console.log(`[audio] fetched:  ${name}`);
}

async function loadBuffer(url) {
  if (bufferCache[url]) return bufferCache[url];
  const name = url.split('/').pop();
  // Fetch if not already prefetched
  if (!rawCache[url]) {
    console.log(`[audio] fetching: ${name}`);
    const resp = await fetch(url);
    rawCache[url] = await resp.arrayBuffer();
  }
  console.log(`[audio] decoding: ${name}`);
  const ac = getContext();
  const audioBuf = await ac.decodeAudioData(rawCache[url]);
  bufferCache[url] = audioBuf;
  console.log(`[audio] ready:    ${name} (${audioBuf.duration.toFixed(1)}s)`);
  return audioBuf;
}

// Wavetable PeriodicWaves — pre-computed harmonic data loaded from JSON
const periodicWaveCache = {};
let periodicWaveData = null;  // raw JSON, fetched eagerly

// Wavetables to skip (inaudible as PeriodicWave oscillators)
const skipWavetables = [
  'WT_MMS_MAG_Dawn_Chorus_1',
  'WT_MMS_MAG_Dawn_Chorus_2',
  'WT_MMS_MAG_Dawn_Chorus_3',
];

async function prefetchPeriodicWaves() {
  console.log('[audio] fetching: periodic_waves.json');
  const resp = await fetch('audio/wavetables/periodic_waves.json');
  periodicWaveData = await resp.json();
  const total = Object.keys(periodicWaveData).length;
  const active = total - skipWavetables.length;
  console.log(`[audio] fetched:  periodic_waves.json (${active} active, ${skipWavetables.length} skipped)`);
  // Populate the wavetable dropdown
  const wtWrap = document.getElementById('wt-select');
  const wtCurrent = document.getElementById('wt-current');
  const wtList = document.getElementById('wt-list');
  if (wtWrap && wtCurrent && wtList) {
    wtList.innerHTML = '';
    // Sort: THEMIS first, then Proton Beam, then the rest
    const wtOrder = (n) => n.includes('THEMIS') ? 0 : n.includes('Proton_Beam') ? 1 : 2;
    const wtKeys = Object.keys(periodicWaveData)
      .filter(n => !skipWavetables.includes(n))
      .sort((a, b) => wtOrder(a) - wtOrder(b));
    let first = true;
    for (const name of wtKeys) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = name;
      btn.textContent = name.replace('WT_', '');
      if (first) { btn.classList.add('active'); }
      btn.addEventListener('click', () => {
        wtList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        wtCurrent.textContent = name.replace('WT_', '');
        wtWrap.dataset.value = name;
        wtWrap.classList.remove('open');
        try { localStorage.setItem('sonara-wavetable', name); } catch(e) {}
      });
      wtList.appendChild(btn);
      if (first) {
        wtCurrent.textContent = name.replace('WT_', '');
        wtWrap.dataset.value = name;
        first = false;
      }
    }
    // Restore saved wavetable
    try {
      const saved = localStorage.getItem('sonara-wavetable');
      if (saved) {
        const btn = wtList.querySelector(`button[data-value="${saved}"]`);
        if (btn) {
          wtList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          wtCurrent.textContent = saved.replace('WT_', '');
          wtWrap.dataset.value = saved;
        }
      }
    } catch(e) {}

    wtCurrent.addEventListener('click', (e) => {
      e.stopPropagation();
      wtWrap.classList.toggle('open');
    });
    document.addEventListener('click', () => wtWrap.classList.remove('open'));
    wtList.addEventListener('click', (e) => e.stopPropagation());
  }
}

function buildPeriodicWaves() {
  if (Object.keys(periodicWaveCache).length > 0 || !periodicWaveData) return;
  const ac = getContext();
  for (const [name, { real, imag }] of Object.entries(periodicWaveData)) {
    if (skipWavetables.includes(name)) continue;
    periodicWaveCache[name] = ac.createPeriodicWave(
      new Float32Array(real), new Float32Array(imag),
      { disableNormalization: false }
    );
  }
  const keys = Object.keys(periodicWaveCache);
  console.log(`[audio] built ${keys.length} PeriodicWaves`);
  keys.forEach(k => console.log(`[audio]   ✓ ${k.replace('WT_', '')}`));
}

function getSelectedWavetable() {
  buildPeriodicWaves();
  const wtWrap = document.getElementById('wt-select');
  const val = wtWrap?.dataset?.value;
  if (val && periodicWaveCache[val]) {
    return periodicWaveCache[val];
  }
  const keys = Object.keys(periodicWaveCache);
  return keys.length > 0 ? periodicWaveCache[keys[0]] : null;
}

// Audio resources grouped by section (fetch-only, no AudioContext)
const sectionAudio = {
  'hero':            () => { prefetchBuffer('audio/mp3/Solar_Hum_Loop_More_Filtered_Short.mp3'); },
  'citizen-science': () => { prefetchBuffer('audio/mp3/THE_20120302_Cleaned_MAX.mp3'); },
  'stem-music':      () => {
    prefetchBuffer('audio/mp3/Kick_Processed_Final__WIND_BGSE_z_2007_08_13_LFEvent_CLEANED_ISOLATED_SHORT.mp3');
    prefetchBuffer('audio/mp3/Solar_Shaker_1.mp3');
    prefetchPeriodicWaves();
  },
};
const sectionOrder = ['hero', 'citizen-science', 'stem-music'];

// Prefetch: runs immediately on page load — fetches raw bytes, no AudioContext
(function prefetchAll() {
  const visible = new Set();
  document.querySelectorAll('.section').forEach(s => {
    const rect = s.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      const sound = s.dataset.sound || s.id;
      visible.add(sound);
    }
  });

  console.log(`[audio] visible sections: ${[...visible].join(', ') || 'none detected yet'}`);

  const loaded = new Set();
  for (const id of visible) {
    if (sectionAudio[id]) { sectionAudio[id](); loaded.add(id); }
  }
  for (const id of sectionOrder) {
    if (!loaded.has(id)) sectionAudio[id]();
  }
})();

// preload() now just builds PeriodicWaves (needs AudioContext from user gesture)
let preloaded = false;
function preload() {
  if (preloaded) return;
  preloaded = true;
  buildPeriodicWaves();
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
  'audio/mp3/Solar_Hum_Loop_More_Filtered_Short.mp3',
  // 'audio/mp3/Proton_Beam_Raw_WI_H2_MFI_181819_000_002.mp3',
  // 'audio/mp3/TRIMMED_SHORTER_MMS1_SCM_BRST_L2_Dawn_Chorus.mp3',
];
// Shuffle once on load — Fisher-Yates
for (let i = heroFiles.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [heroFiles[i], heroFiles[j]] = [heroFiles[j], heroFiles[i]];
}
let heroFileIdx = 0;
let heroStartTime = 0;
let heroBufDuration = 0;

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
  heroStartTime = now;
  heroBufDuration = buf.duration;
  nodes.push(src);
  gains.push(g);
  return { nodes, gains };
}

// ===== CITIZEN SCIENCE: Audified THEMIS data =====
async function citizenScienceSound(ac, master) {
  const nodes = [];
  const gains = [];
  const buf = await loadBuffer('audio/mp3/THE_20120302_Cleaned_MAX.mp3');
  const now = ac.currentTime;

  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(0.375, now + 0.5);
  src.connect(g);
  g.connect(master);
  src.start();
  nodes.push(src);
  gains.push(g);
  return { nodes, gains, duration: buf.duration };
}

// ===== STEM-MUSIC: Pattern generation + playback =====
export function generateStemPattern() {
  const bpm = 125;
  const step = 60 / bpm / 2;

  // Kick — more likely overall, especially on downbeats (0, 4, 8, 12)
  const kick = new Array(16).fill(0);
  kick[0] = 1; // always beat 1
  for (let i = 1; i < 16; i++) {
    const downBeat = i % 4 === 0;
    const eighth = i % 2 === 0;
    const chance = downBeat ? 0.9 : (eighth ? 0.38 : 0.24);
    kick[i] = Math.random() < chance ? 1 : 0;
  }
  if (kick.reduce((sum, v) => sum + v, 0) < 2) {
    const fallbackSlots = [4, 8, 12, 2, 6, 10, 14];
    const slot = fallbackSlots.find(idx => !kick[idx]);
    if (slot !== undefined) kick[slot] = 1;
  }

  // Hat — biased toward off-beats (odd steps)
  const hat = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) {
    const offBeat = i % 2 === 1;
    hat[i] = Math.random() < (offBeat ? 0.5 : 0.15) ? 1 : 0;
  }

  // Melody — single octave, 5 notes = 5 rows (one pitch per row)
  const scales = [
    [261.63, 293.66, 329.63, 392, 440],       // C4 D4 E4 G4 A4
    [293.66, 329.63, 392, 440, 523.25],       // D4 E4 G4 A4 C5
    [349.23, 392, 440, 523.25, 587.33],       // F4 G4 A4 C5 D5
  ];
  const scale = scales[Math.floor(Math.random() * scales.length)];
  const pitches = [...scale].sort((a, b) => b - a); // high→low, 5 pitches = 5 rows
  const melodyRows = pitches.map(() => new Array(16).fill(0));
  const melodyFreqs = Array.from({ length: 16 }, () => []);

  const noteCount = 8 + Math.floor(Math.random() * 5);
  const waveTypes = ['sawtooth', 'triangle', 'square'];
  const waveType = waveTypes[Math.floor(Math.random() * waveTypes.length)];

  // Weighted step selection: downbeats (0,4,8,12) ~3x more likely
  const stepWeights = Array.from({ length: 16 }, (_, i) => i % 4 === 0 ? 3 : 1);
  const totalWeight = stepWeights.reduce((a, b) => a + b, 0);
  function weightedStep() {
    let r = Math.random() * totalWeight;
    for (let i = 0; i < 16; i++) { r -= stepWeights[i]; if (r <= 0) return i; }
    return 15;
  }

  for (let n = 0; n < noteCount; n++) {
    const stepIdx = weightedStep();
    const rowIdx = Math.floor(Math.random() * 5);
    melodyRows[rowIdx][stepIdx] = 1;
    if (!melodyFreqs[stepIdx].includes(pitches[rowIdx])) {
      melodyFreqs[stepIdx].push(pitches[rowIdx]);
    }
  }

  return { kick, hat, melodyRows, melodyFreqs, pitches, waveType, bpm, step, steps: 16 };
}

// Live step sequencer — one central clock, triggers notes per step
let seqInterval = null;
let seqStep = 0;
let seqAc = null;
let seqMaster = null;
let seqSynthBus = null;
let seqRevG = null;
let seqConv = null;
let seqKickBuf = null;
let seqHatBuf = null;
let seqLooping = (() => { try { return localStorage.getItem('sonara-loop') === '1'; } catch(e) { return false; } })();
let seqReverbOn = (() => {
  try {
    const saved = localStorage.getItem('sonara-reverb');
    return saved === null ? true : saved !== '0';
  } catch(e) {
    return true;
  }
})();
let seqDelayOn = (() => {
  try {
    const saved = localStorage.getItem('sonara-delay');
    return saved === null ? true : saved === '1';
  } catch(e) {
    return true;
  }
})();
let seqDelayNode = null;
let seqDelayFeedback = null;
let seqDelayGain = null;

export function setSeqReverb(val) { seqReverbOn = val; try { localStorage.setItem('sonara-reverb', val ? '1' : '0'); } catch(e) {} updateReverbRouting(); }
export function getSeqReverb() { return seqReverbOn; }

function updateReverbRouting() {
  if (!seqConv || !seqSynthBus) return;
  if (seqReverbOn) {
    try { seqSynthBus.connect(seqConv); } catch(e) {}
    if (seqDelayGain) try { seqDelayGain.connect(seqConv); } catch(e) {}
  } else {
    try { seqSynthBus.disconnect(seqConv); } catch(e) {}
    if (seqDelayGain) try { seqDelayGain.disconnect(seqConv); } catch(e) {}
  }
}

export function setSeqDelay(val) { seqDelayOn = val; try { localStorage.setItem('sonara-delay', val ? '1' : '0'); } catch(e) {} updateDelayRouting(); }
export function getSeqDelay() { return seqDelayOn; }

function updateDelayRouting() {
  if (!seqDelayNode || !seqSynthBus) return;
  if (seqDelayOn) {
    try { seqSynthBus.connect(seqDelayNode); } catch(e) {}
  } else {
    try { seqSynthBus.disconnect(seqDelayNode); } catch(e) {}
  }
}

export function setSeqLoop(val) {
  // When turning off loop, reset step to current position within the bar
  // so the sequence finishes the current pass instead of stopping immediately
  if (!val && seqLooping && seqStep >= 16) {
    seqStep = seqStep % 16;
  }
  seqLooping = val;
  try { localStorage.setItem('sonara-loop', val ? '1' : '0'); } catch(e) {}
}
export function getSeqLoop() { return seqLooping; }

function seqTriggerStep(pat) {
  const col = seqStep % 16;
  const t = seqAc.currentTime + 0.05;
  const step = pat.step;
  const wt = getSelectedWavetable();

  // Kick
  if (pat.kick[col] && seqKickBuf) {
    const src = seqAc.createBufferSource();
    src.buffer = seqKickBuf;
    const g = seqAc.createGain();
    g.gain.value = 0.8;
    src.connect(g);
    g.connect(seqMaster);
    src.start(t);
  }

  // Hat
  if (pat.hat[col] && seqHatBuf) {
    const src = seqAc.createBufferSource();
    src.buffer = seqHatBuf;
    src.playbackRate.value = 2.2 + Math.random() * 1.3;
    const g = seqAc.createGain();
    g.gain.value = 0.2;
    src.connect(g);
    g.connect(seqMaster);
    src.start(t);
  }

  // Melody
  const freqs = pat.melodyFreqs[col];
  if (freqs && freqs.length) {
    const voiceGain = 0.04 / Math.max(freqs.length, 1);
    freqs.forEach(freq => {
      const osc = seqAc.createOscillator();
      if (wt) osc.setPeriodicWave(wt);
      else osc.type = pat.waveType;
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 10;
      const lp = seqAc.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500 + Math.random() * 1500;
      lp.Q.value = 2 + Math.random() * 3;
      const g = seqAc.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(voiceGain + Math.random() * 0.02, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + step * 1.5 + Math.random() * step);
      osc.connect(lp);
      lp.connect(g);
      g.connect(seqSynthBus);
      osc.start(t);
      osc.stop(t + step * 2);
    });
  }

  seqStep++;
}

async function stemMusicSound(ac, master, prePattern) {
  const pat = prePattern || generateStemPattern();

  // Set up persistent audio graph (reused across restarts)
  seqAc = ac;
  seqMaster = master;

  if (!seqRevG) {
    // Chain: synthBus → master (dry)
    //        synthBus → [delay →] conv → revG → master (wet)
    // Delay feeds INTO reverb so echoes get the wash.
    seqSynthBus = ac.createGain();
    seqSynthBus.gain.value = 1;
    seqSynthBus.connect(master);                   // dry path always on

    // Delay: synthBus → delay → feedback → delayGain
    seqDelayNode = ac.createDelay(1.0);
    seqDelayNode.delayTime.value = 0.33;
    seqDelayFeedback = ac.createGain();
    seqDelayFeedback.gain.value = 0.4;
    seqDelayGain = ac.createGain();
    seqDelayGain.gain.value = 0.35;
    seqDelayNode.connect(seqDelayFeedback);
    seqDelayFeedback.connect(seqDelayNode);
    seqDelayNode.connect(seqDelayGain);
    seqDelayGain.connect(master);                  // delay dry out
    if (seqDelayOn) seqSynthBus.connect(seqDelayNode);

    // Reverb: conv → revG → master (last in chain)
    seqConv = ac.createConvolver();
    seqConv.buffer = makeReverb(ac, 3, 1.5);
    seqRevG = ac.createGain();
    seqRevG.gain.value = 0.55;
    seqConv.connect(seqRevG);
    seqRevG.connect(master);
    // Feed both dry synth AND delay output into reverb
    if (seqReverbOn) {
      seqSynthBus.connect(seqConv);
      seqDelayGain.connect(seqConv);
    }
  }

  // Load samples
  seqKickBuf = await loadBuffer('audio/mp3/Kick_Processed_Final__WIND_BGSE_z_2007_08_13_LFEvent_CLEANED_ISOLATED_SHORT.mp3');
  seqHatBuf = await loadBuffer('audio/mp3/Solar_Shaker_1.mp3');

  // Reset step counter
  seqStep = 0;

  // Clear previous interval
  if (seqInterval) clearInterval(seqInterval);

  // Start stepping
  const stepMs = pat.step * 1000;
  seqTriggerStep(pat); // trigger step 0 immediately
  seqInterval = setInterval(() => {
    // Stop after 16 steps when not looping
    if (seqStep >= 16 && !seqLooping) {
      clearInterval(seqInterval);
      seqInterval = null;
      // Clear state immediately so next play() creates fresh graph
      const entry = activeNodes['stem-music'];
      delete activeNodes['stem-music'];
      stemAnalyser = null;
      seqRevG = null;
      seqConv = null;
      seqSynthBus = null;
      seqDelayNode = null;
      seqDelayFeedback = null;
      seqDelayGain = null;
      // Delay master disconnect so last notes ring out
      if (entry) {
        setTimeout(() => {
          try { entry.master.disconnect(); } catch(e) {}
        }, 1500);
      }
      return;
    }
    const current = pendingStemPattern || pat;
    seqTriggerStep(current);
  }, stepMs);

  const pattern = { ...pat, startTime: ac.currentTime };
  return { nodes: [], gains: [seqRevG], duration: 16 * pat.step, pattern, synthBus: seqSynthBus };
}

export function seqRestart() {
  seqStep = 0;
}

// ===== EDUCATION: Immersive dome atmosphere =====
function educationSound(ac, master) {
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
  'education': educationSound
};

let pendingStemPattern = null;

export function setStemPattern(pat) {
  pendingStemPattern = pat;
}

export async function play(id) {
  if (id === 'stem-music' && activeNodes[id]) { seqRestart(); activeNodes[id].pattern.startTime = getContext().currentTime; return true; }
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
  // Attach analyser for stem-music oscilloscope — only the synth melody feeds it
  if (id === 'stem-music') {
    stemAnalyser = ac.createAnalyser();
    stemAnalyser.fftSize = 2048;
    (result.synthBus || master).connect(stemAnalyser);
    if (seqDelayGain) seqDelayGain.connect(stemAnalyser);
    if (seqRevG) seqRevG.connect(stemAnalyser);
  }
  // Attach analyser for hero audio reactivity
  if (id === 'hero') {
    heroAnalyser = ac.createAnalyser();
    heroAnalyser.fftSize = 256;
    master.connect(heroAnalyser);
  }
  // Attach analyser for citizen-science waveform reactivity
  if (id === 'citizen-science') {
    citizenAnalyser = ac.createAnalyser();
    citizenAnalyser.fftSize = 256;
    master.connect(citizenAnalyser);
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
  if (id === 'stem-music') {
    stemAnalyser = null;
    seqRevG = null;
    seqConv = null;
    seqSynthBus = null;
    seqDelayNode = null;
    seqDelayFeedback = null;
    seqDelayGain = null;
    if (seqInterval) { clearInterval(seqInterval); seqInterval = null; }
  }
  if (id === 'hero') heroAnalyser = null;
  if (id === 'citizen-science') citizenAnalyser = null;

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

export function killNow(id) {
  const entry = activeNodes[id];
  if (!entry) return;
  const { nodes, master } = entry;
  delete activeNodes[id];
  if (id === 'stem-music') {
    stemAnalyser = null;
    seqRevG = null;
    seqConv = null;
    seqSynthBus = null;
    seqDelayNode = null;
    seqDelayFeedback = null;
    seqDelayGain = null;
    if (seqInterval) { clearInterval(seqInterval); seqInterval = null; }
  }
  if (id === 'hero') heroAnalyser = null;
  if (id === 'citizen-science') citizenAnalyser = null;
  nodes.forEach(n => { try { n.stop(); } catch(e) {} });
  try { master.disconnect(); } catch(e) {}
}

export function getEndTime(id) {
  return activeNodes[id]?.endTime || null;
}

export function now() {
  return ctx ? ctx.currentTime : 0;
}

// Stop sequencer: kill new notes + visual, let reverb/delay ring, then full cleanup
export function seqSilence() {
  if (seqInterval) { clearInterval(seqInterval); seqInterval = null; }
  stemAnalyser = null; // kill waveform visual immediately
  // Delayed full teardown — gives reverb/delay ~4s to ring out
  const entry = activeNodes['stem-music'];
  if (entry) {
    delete activeNodes['stem-music'];
    seqRevG = null;
    seqConv = null;
    seqSynthBus = null;
    seqDelayNode = null;
    seqDelayFeedback = null;
    seqDelayGain = null;
    setTimeout(() => {
      try {
        entry.nodes.forEach(n => { try { n.stop(); } catch(e) {} });
        entry.master.disconnect();
      } catch(e) {}
    }, 4000);
  }
}

export function getStemAnalyser() {
  return stemAnalyser;
}

export function getHeroAnalyser() {
  return heroAnalyser;
}

export function getHeroProgress() {
  if (!heroBufDuration || !ctx) return 0;
  const elapsed = ctx.currentTime - heroStartTime;
  return (elapsed % heroBufDuration) / heroBufDuration;
}

export function getCitizenAnalyser() {
  return citizenAnalyser;
}

export function getStemPattern() {
  return activeNodes['stem-music']?.pattern || null;
}

export function stopAll() {
  Object.keys(activeNodes).forEach(id => stop(id));
}
