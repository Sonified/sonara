/**
 * SONARA Audio Engine
 * Synthesized space sounds for each section using Web Audio API.
 */

let ctx = null;
const activeNodes = {};

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

// ===== HERO: Solar wind atmosphere =====
function heroSound(ac, master) {
  const nodes = [];
  const now = ac.currentTime;
  const noiseBuf = makeNoise(ac, 4);

  // Filtered solar wind
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 350;
  bp.Q.value = 1.5;
  bp.frequency.setValueAtTime(250, now);
  bp.frequency.linearRampToValueAtTime(500, now + 6);
  bp.frequency.linearRampToValueAtTime(250, now + 12);
  const ng = ac.createGain();
  ng.gain.value = 0;
  ng.gain.linearRampToValueAtTime(0.45, now + 3);
  noise.connect(bp);
  bp.connect(ng);
  ng.connect(master);
  noise.start();
  nodes.push(noise);

  // Deep sub hum
  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 60;
  const subG = ac.createGain();
  subG.gain.value = 0;
  subG.gain.linearRampToValueAtTime(0.15, now + 2);
  sub.connect(subG);
  subG.connect(master);
  sub.start();
  nodes.push(sub);

  // Warm harmonic shimmer
  [196, 293.66, 440].forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 8;
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.06 - i * 0.015, now + 3 + i * 0.5);
    osc.connect(g);
    g.connect(master);
    osc.start();
    nodes.push(osc);
  });

  return { nodes };
}

// ===== CITIZEN SCIENCE: Discovery pings over drone =====
function citizenScienceSound(ac, master) {
  const nodes = [];
  const now = ac.currentTime;

  // Background drone (magnetosphere)
  const hum = ac.createOscillator();
  hum.type = 'triangle';
  hum.frequency.value = 110;
  const humG = ac.createGain();
  humG.gain.value = 0;
  humG.gain.linearRampToValueAtTime(0.08, now + 1);
  hum.connect(humG);
  humG.connect(master);
  hum.start();
  nodes.push(hum);

  // Teal-colored reverb
  const conv = ac.createConvolver();
  conv.buffer = makeReverb(ac, 2.5, 2.2);
  const revG = ac.createGain();
  revG.gain.value = 0.5;
  conv.connect(revG);
  revG.connect(master);

  // Discovery pings
  const pitches = [523.25, 659.25, 783.99, 1046.5, 587.33, 698.46];
  for (let i = 0; i < 24; i++) {
    const t = now + 0.3 + i * 0.55 + Math.random() * 0.25;
    const freq = pitches[Math.floor(Math.random() * pitches.length)];
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.09, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(g);
    g.connect(conv);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 1);
    nodes.push(osc);
  }

  return { nodes };
}

// ===== STEM-MUSIC: Sequencer groove =====
function stemMusicSound(ac, master) {
  const nodes = [];
  const now = ac.currentTime;
  const bpm = 120;
  const step = 60 / bpm / 2;

  // Reverb
  const conv = ac.createConvolver();
  conv.buffer = makeReverb(ac, 2, 2);
  const revG = ac.createGain();
  revG.gain.value = 0.3;
  conv.connect(revG);
  revG.connect(master);

  // Kick pattern
  const kickPattern = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0];
  kickPattern.forEach((hit, i) => {
    if (!hit) return;
    const t = now + i * step + 0.2;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.4);
    nodes.push(osc);
  });

  // Hi-hat (noise burst) pattern
  const hatPattern = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,1,1,0];
  const hatBuf = makeNoise(ac, 0.1);
  hatPattern.forEach((hit, i) => {
    if (!hit) return;
    const t = now + i * step + 0.2;
    const src = ac.createBufferSource();
    src.buffer = hatBuf;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(hp);
    hp.connect(g);
    g.connect(master);
    src.start(t);
    nodes.push(src);
  });

  // Melodic space tone
  const melody = [392, 440, 523.25, 440, 392, 349.23, 392, 440];
  melody.forEach((freq, i) => {
    const t = now + i * step * 2 + 0.2;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    lp.Q.value = 3;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + step * 1.8);
    osc.connect(lp);
    lp.connect(g);
    g.connect(conv);
    g.connect(master);
    osc.start(t);
    osc.stop(t + step * 2);
    nodes.push(osc);
  });

  return { nodes };
}

// ===== PLANETARIUM: Immersive dome atmosphere =====
function planetariumSound(ac, master) {
  const nodes = [];
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

  return { nodes };
}

const generators = {
  'hero': heroSound,
  'citizen-science': citizenScienceSound,
  'stem-music': stemMusicSound,
  'planetarium': planetariumSound
};

export function play(id) {
  if (activeNodes[id]) {
    stop(id);
    return false;
  }

  const ac = getContext();
  const master = createMaster(ac);
  const gen = generators[id];
  if (!gen) return false;

  const result = gen(ac, master);
  activeNodes[id] = { ...result, master };
  return true;
}

export function stop(id) {
  if (!activeNodes[id]) return;
  const { nodes, master } = activeNodes[id];
  const ac = getContext();
  const now = ac.currentTime;

  master.gain.linearRampToValueAtTime(0, now + 0.5);

  setTimeout(() => {
    nodes.forEach(n => { try { n.stop(); } catch(e) {} });
    try { master.disconnect(); } catch(e) {}
  }, 600);

  delete activeNodes[id];
}

export function stopAll() {
  Object.keys(activeNodes).forEach(stop);
}
