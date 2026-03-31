/**
 * SONARA Canvas Visuals
 * Hero particle field, citizen science waveform, dome starfield, synth wave.
 */

import * as audio from './audio.js?v=9';
const getStemAnalyser = audio.getStemAnalyser;
const getHeroAnalyser = audio.getHeroAnalyser;
const getHeroSourceNode = audio.getHeroSourceNode;
const getCitizenAnalyser = typeof audio.getCitizenAnalyser === 'function'
  ? audio.getCitizenAnalyser
  : () => null;

// Fast sine lookup table (256 entries, linear interpolation)
const SIN_LUT_SIZE = 256;
const SIN_LUT = new Float32Array(SIN_LUT_SIZE + 1);
for (let i = 0; i <= SIN_LUT_SIZE; i++) SIN_LUT[i] = Math.sin((i / SIN_LUT_SIZE) * Math.PI * 2);
const SIN_SCALE = SIN_LUT_SIZE / (Math.PI * 2);
function fastSin(x) {
  let t = (x * SIN_SCALE) % SIN_LUT_SIZE;
  if (t < 0) t += SIN_LUT_SIZE;
  const i = t | 0;
  return SIN_LUT[i] + (t - i) * (SIN_LUT[i + 1] - SIN_LUT[i]);
}

// x^1.5 lookup table for radial attenuation (input 0-1)
const POW15_LUT_SIZE = 256;
const POW15_LUT = new Float32Array(POW15_LUT_SIZE + 1);
for (let i = 0; i <= POW15_LUT_SIZE; i++) { const x = i / POW15_LUT_SIZE; POW15_LUT[i] = x * Math.sqrt(x); }
function fastPow15(x) {
  const t = x * POW15_LUT_SIZE;
  const i = t | 0;
  return POW15_LUT[i] + (t - i) * (POW15_LUT[i + 1] - POW15_LUT[i]);
}

// Unified rAF loop — all canvas draw functions register here
const drawCallbacks = [];
function registerDraw(fn) { drawCallbacks.push(fn); }
function rafLoop() {
  for (let i = 0; i < drawCallbacks.length; i++) drawCallbacks[i]();
  requestAnimationFrame(rafLoop);
}

let mouseX = 0, mouseY = 0;
let mouseActive = false;
document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  mouseActive = true;
});

// Mobile detection — touch device with narrow viewport
const isMobileView = ('ontouchstart' in window) && window.innerWidth <= 768;

// Shared visibility tracker — returns { visible, wasHidden } per section
function trackVisibility(sectionId) {
  const state = { visible: sectionId === 'hero', firstReveal: true, _intersecting: sectionId === 'hero' };
  const el = document.getElementById(sectionId);
  if (!el) return state;
  const obs = new IntersectionObserver(([entry]) => {
    state._intersecting = entry.isIntersecting;
    state.visible = state._intersecting && !document.hidden;
  }, { threshold: 0, rootMargin: '-1px 0px -1px 0px' });
  obs.observe(el);
  document.addEventListener('visibilitychange', () => {
    state.visible = state._intersecting && !document.hidden;
  });
  return state;
}


// ===== Shared tuning constants =====
const HERO_DEBUG_DEFAULTS = {
  seedParticles: {
    mobile: 1000,
    desktop: 2000,
  },
  maxParticles: {
    mobile: 2000,
    desktop: 3000,
  },
  rippleBase: 20,
  rippleVariance: 2,
  rippleInnerRadius: 400,
  brightnessAttack: 0.1,
  brightnessRelease: 0.1,
  spinAttack: 0.6,
  spinRelease: 0.46,
  connDist: 170,
  maxConn: 3,
  connSkip: 10,
  whiteParticlePct: 20,
  whiteBrightnessCap: 75,
  swirlForce: 0.065,
  pullForce: 0.012,
  friction: 0.98,
  swirlCenter: 'listen',
  connFadeIn: 0.04,
  connFadeOut: 0.025,
  connKillAlpha: 0.02,
  lineBase: 0.08,
};

const FORCE_RADIUS = 0.64; // default: 0.6 — fraction of canvas size for audio/swirl force reach
const HERO_GOLD_RGB = { r: 0.831, g: 0.659, b: 0.263 };
const HERO_SOFT_WHITE_TINT = { r: 1.0, g: 0.97, b: 0.93 };
let RIPPLE_SPEED_BASE = +(localStorage.getItem('sonara_rippleBase') || HERO_DEBUG_DEFAULTS.rippleBase);
let RIPPLE_SPEED_VAR = +(localStorage.getItem('sonara_rippleVariance') || HERO_DEBUG_DEFAULTS.rippleVariance);
let RIPPLE_INNER_RADIUS = +(localStorage.getItem('sonara_rippleInnerRadius') || HERO_DEBUG_DEFAULTS.rippleInnerRadius);
let SHOW_RIPPLE_RADIUS = localStorage.getItem('sonara_showRippleRadius') !== '0';
const legacyRmsAttack = localStorage.getItem('sonara_rmsAttack');
const legacyRmsRelease = localStorage.getItem('sonara_rmsRelease');
let BRIGHTNESS_ATTACK = +(localStorage.getItem('sonara_brightnessAttack') || legacyRmsAttack || HERO_DEBUG_DEFAULTS.brightnessAttack);
let BRIGHTNESS_RELEASE = +(localStorage.getItem('sonara_brightnessRelease') || legacyRmsRelease || HERO_DEBUG_DEFAULTS.brightnessRelease);
let SPIN_ATTACK = +(localStorage.getItem('sonara_spinAttack') || legacyRmsAttack || HERO_DEBUG_DEFAULTS.spinAttack);
let SPIN_RELEASE = +(localStorage.getItem('sonara_spinRelease') || legacyRmsRelease || HERO_DEBUG_DEFAULTS.spinRelease);
let SWIRL_FORCE = +(localStorage.getItem('sonara_swirlForce') || HERO_DEBUG_DEFAULTS.swirlForce);
let PULL_FORCE = +(localStorage.getItem('sonara_pullForce') || HERO_DEBUG_DEFAULTS.pullForce);
let FRICTION = +(localStorage.getItem('sonara_friction') || HERO_DEBUG_DEFAULTS.friction);
function clampLowSpeed(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.8;
  return Math.max(0.2, Math.min(1.0, Math.round(num * 20) / 20));
}
function clampHighSpeed(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1.5;
  return Math.max(0.5, Math.min(2.0, Math.round(num * 20) / 20));
}
function clampSpeedClamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1.0;
  return Math.max(0.5, Math.min(2.0, Math.round(num * 20) / 20));
}
function clampSpeedPeriod(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 80;
  return Math.max(5, Math.min(300, Math.round(num / 5) * 5));
}
let VARIABLE_SPEED = localStorage.getItem('sonara_varSpeed') !== '0';
const legacySpeedDip = localStorage.getItem('sonara_speedDip');
let LOW_SPEED = clampLowSpeed(
  localStorage.getItem('sonara_lowSpeed')
  ?? (legacySpeedDip !== null ? 1 - Number(legacySpeedDip) : 0.8)
);
let HIGH_SPEED = clampHighSpeed(localStorage.getItem('sonara_highSpeed') ?? 1.5);
let SPEED_CLAMP = clampSpeedClamp(localStorage.getItem('sonara_speedClamp') ?? 1.0);
let SPEED_PERIOD = clampSpeedPeriod(localStorage.getItem('sonara_speedPeriod') || 80);
let CONN_KILL_ALPHA = +(localStorage.getItem('sonara_connKillAlpha') || 0.02);
let CONN_FADE_IN = +(localStorage.getItem('sonara_connFadeIn') || 0.04);
let CONN_FADE_OUT = +(localStorage.getItem('sonara_connFadeOut') || 0.025);
let LINE_BASE = +(localStorage.getItem('sonara_lineBase') || 0.08);
let SUPER_CONN = localStorage.getItem('sonara_superConn') === '1';
let GATHER_SELECT = localStorage.getItem('sonara_gatherSelect') === '1';
let FADE_UP_SECS = +(localStorage.getItem('sonara_fadeUpSecs') || 1);
let FADE_FRAMES = Math.round(FADE_UP_SECS * 120);
function clampWhiteParticlePct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return HERO_DEBUG_DEFAULTS.whiteParticlePct;
  return Math.max(0, Math.min(30, Math.round(num / 5) * 5));
}
function clampWhiteBrightnessCap(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return HERO_DEBUG_DEFAULTS.whiteBrightnessCap;
  return Math.max(40, Math.min(100, Math.round(num / 5) * 5));
}
let WHITE_PARTICLE_PERCENT = clampWhiteParticlePct(localStorage.getItem('sonara_whiteParticlePct') ?? HERO_DEBUG_DEFAULTS.whiteParticlePct);
let WHITE_BRIGHTNESS_CAP = clampWhiteBrightnessCap(localStorage.getItem('sonara_whiteBrightnessCap') ?? HERO_DEBUG_DEFAULTS.whiteBrightnessCap);
const getWhiteParticleChance = () => WHITE_PARTICLE_PERCENT / 100;
function getWhiteParticleColor() {
  const cap = WHITE_BRIGHTNESS_CAP / 100;
  return {
    r: HERO_SOFT_WHITE_TINT.r * cap,
    g: HERO_SOFT_WHITE_TINT.g * cap,
    b: HERO_SOFT_WHITE_TINT.b * cap,
  };
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    try {
      if (!document.execCommand('copy')) {
        throw new Error('Copy command was rejected');
      }
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      textarea.remove();
    }
  });
}

// ===== Hero: Audio-reactive particle constellation (WebGL2 + Transform Feedback) =====
function initHeroCanvas() {
  let canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  // ── Physics engine switch ────────────────────────────────────────────
  // false = CPU physics (faster at current particle counts)
  // true  = GPU physics via WebGL2 transform feedback
  const GPU_PHYSICS = false;

  // ── WebGPU compute (async init, hot-swaps from CPU when ready) ──────
  let WEBGPU_ACTIVE = false;
  let gpuFirstReadback = false; // true after first successful readback
  let gpuDevice = null, gpuPhysicsPipeline = null;
  let gpuParticleBuf = null, gpuUniformBuf = null;
  let gpuBrightnessRippleBuf = null, gpuSpinRippleBuf = null;
  let gpuOutputBuf = null, gpuOutputReadBuf = null;
  let gpuBindGroup = null;
  let gpuParticleCount = 0;
  let GPU_PARTICLE_STRIDE = 64; // 16 floats per particle (matches struct) — overridden to 40 if f16
  let GPU_OUTPUT_STRIDE = 32;   // 8 floats per output entry — overridden to 24 if f16
  let gpuHasF16 = false;        // set true in initWebGPU() if shader-f16 is available

  // ── WebGPU connection compute state ──────────────────────────────────
  let gpuConnPool = null, gpuConnHashTable = null;
  let gpuGridCounts = null, gpuGridOffsets = null, gpuGridIndices = null;
  let gpuRenderLines = null, gpuConnAtomics = null, gpuConnUniformBuf = null;
  let gpuNeighborCount = null, gpuLineIndirectBuf = null, gpuConnFreeList = null;
  // Packed tier buffers (merged when maxStorageBuffersPerShaderStage < 12)
  let gpuGridData = null;      // gridCounts + gridOffsets
  let gpuAuxCounters = null;   // connAtomics + lineIndirect
  let gpuAuxPool = null;       // connFreeList + neighborCount
  let gpuCandidateData = null;  // enhanced tier: candidate buffer for gather-select
  let gpuFlagsExtractBuf = null, gpuFlagsReadBuf = null, gpuRenderUniformBuf = null;
  let gpuConnPipelines = {};
  let gpuConnBindGroup = null;
  let gpuConnBindGroup1 = null;
  let gpuLineCountReadBuf = null;  // tiny MAP_READ buffer for connection count debug display
  let gpuLineCount = 0;           // last read line count for debug HUD
  let gpuConnSearchFrame = 0;
  const MAX_CONN_SLOTS = 30000;
  const CONN_HASH_SIZE = 65536;
  const MAX_GRID_CELLS = 256;

  // ── WebGPU render state ──────────────────────────────────────────────
  let WEBGPU_RENDER = false;
  let gpuRenderContext = null;
  let gpuParticleRenderPipeline = null;
  let gpuLineRenderPipeline = null;
  let gpuParticleRenderBindGroup = null;
  let gpuLineRenderBindGroup = null;
  let gpuCanvasFormat = null;
  let gpuResizeScaleX = 1.0, gpuResizeScaleY = 1.0;

  // WebGPU slot management (initialized after BUFFER_CAP is defined)
  let gpuWatermark = 0;
  const gpuFreeSlots = [];
  let gpuSlots = null; // initialized in init() when BUFFER_CAP is available

  // WebGL2 for rendering (both paths) + transform feedback (GPU path)
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return initHeroCanvas2D();

  // --- Shared state ---
  let w, h;
  const _savedSeed = localStorage.getItem('sonara_seedParticles');
  const _savedMax = localStorage.getItem('sonara_maxParticles');
  let SEED_PARTICLES = _savedSeed ? +_savedSeed : (isMobileView ? HERO_DEBUG_DEFAULTS.seedParticles.mobile : HERO_DEBUG_DEFAULTS.seedParticles.desktop);
  let MAX_PARTICLES = _savedMax ? +_savedMax : (isMobileView ? HERO_DEBUG_DEFAULTS.maxParticles.mobile : HERO_DEBUG_DEFAULTS.maxParticles.desktop);
  SEED_PARTICLES = Math.min(SEED_PARTICLES, MAX_PARTICLES);
  let THROTTLE_START = Math.round(MAX_PARTICLES * 0.8);
  const getSeedCount = () => Math.min(SEED_PARTICLES, MAX_PARTICLES);
  const BUFFER_CAP = 12000; // sized for max dropdown value (11000) + headroom for burst spawns

  // WebGPU slot management (now that BUFFER_CAP is defined)
  if (!gpuSlots) {
    gpuSlots = new Array(BUFFER_CAP);
    for (let i = 0; i < BUFFER_CAP; i++) {
      gpuSlots[i] = { dead: true, pid: -1, x: 0, y: 0, vx: 0, vy: 0, canWhiten: false, life: undefined, alpha: 0 };
    }
  }
  function gpuGetSlot() {
    if (gpuFreeSlots.length > 0) return gpuFreeSlots.pop();
    if (gpuWatermark < BUFFER_CAP) return gpuWatermark++;
    return -1;
  }
  let time = 0;
  let lineIntensity = 0;
  const DEBUG_HUD_UPDATE_FPS = 4;
  const DEBUG_HUD_UPDATE_MS = 1000 / DEBUG_HUD_UPDATE_FPS;
  let fpsFrames = 0, debugHudLastUpdate = performance.now(), fpsValue = 0;
  const HERO_PARTICLE_BRIGHTNESS = 1.15;
  let CONN_REACH = +(localStorage.getItem('sonara_connDist') || HERO_DEBUG_DEFAULTS.connDist);
  let CONN_REACH_SQ = CONN_REACH * CONN_REACH;
  let CONN_FADE_START = CONN_REACH * 0.8;
  let CONN_FADE_START_SQ = CONN_FADE_START * CONN_FADE_START;
  let CONN_BUCKET_DIV = CONN_REACH_SQ / 5;
  let MAX_CONN = +(localStorage.getItem('sonara_maxConn') || HERO_DEBUG_DEFAULTS.maxConn);
  function updateConnReach(v) {
    CONN_REACH = v; CONN_REACH_SQ = v * v;
    CONN_FADE_START = v * 0.8; CONN_FADE_START_SQ = CONN_FADE_START * CONN_FADE_START;
    CONN_BUCKET_DIV = CONN_REACH_SQ / 5;
  }
  let CONN_SEARCH_INTERVAL = +(localStorage.getItem('sonara_connSkip') || HERO_DEBUG_DEFAULTS.connSkip);
  const listenBtn = document.querySelector('#hero .listen-btn');
  const getDebugSettingsSnapshot = () => ({
    seedParticles: {
      mobile: isMobileView ? SEED_PARTICLES : HERO_DEBUG_DEFAULTS.seedParticles.mobile,
      desktop: isMobileView ? HERO_DEBUG_DEFAULTS.seedParticles.desktop : SEED_PARTICLES,
    },
    maxParticles: {
      mobile: isMobileView ? MAX_PARTICLES : HERO_DEBUG_DEFAULTS.maxParticles.mobile,
      desktop: isMobileView ? HERO_DEBUG_DEFAULTS.maxParticles.desktop : MAX_PARTICLES,
    },
    rippleBase: Number(RIPPLE_SPEED_BASE.toFixed(1)),
    rippleVariance: Number(RIPPLE_SPEED_VAR.toFixed(1)),
    rippleInnerRadius: RIPPLE_INNER_RADIUS,
    brightnessAttack: Number(BRIGHTNESS_ATTACK.toFixed(2)),
    brightnessRelease: Number(BRIGHTNESS_RELEASE.toFixed(2)),
    spinAttack: Number(SPIN_ATTACK.toFixed(2)),
    spinRelease: Number(SPIN_RELEASE.toFixed(2)),
    connDist: CONN_REACH,
    maxConn: MAX_CONN,
    connSkip: CONN_SEARCH_INTERVAL,
    whiteParticlePct: WHITE_PARTICLE_PERCENT,
    whiteBrightnessCap: WHITE_BRIGHTNESS_CAP,
    varSpeed: VARIABLE_SPEED,
    lowSpeed: LOW_SPEED,
    highSpeed: HIGH_SPEED,
    speedClamp: SPEED_CLAMP,
    speedPeriod: SPEED_PERIOD,
    connKillAlpha: Number(CONN_KILL_ALPHA.toFixed(3)),
    connFadeIn: Number(CONN_FADE_IN.toFixed(3)),
    connFadeOut: Number(CONN_FADE_OUT.toFixed(3)),
    lineBase: Number(LINE_BASE.toFixed(2)),
    superConn: SUPER_CONN,
    gatherSelect: GATHER_SELECT,
    fadeUpSecs: FADE_UP_SECS,
    swirlForce: Number(SWIRL_FORCE.toFixed(3)),
    pullForce: Number(PULL_FORCE.toFixed(3)),
    friction: Number(FRICTION.toFixed(3)),
    swirlCenter: swirlCenterTarget,
  });
  const heroVis = trackVisibility('hero');

  // Debug HUD (localhost only)
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const DEBUG_HUD_PAD_X = 1;
  const DEBUG_TOP_ROW_GAP = 10;
  const DEBUG_SECOND_ROW_GAP = 12;
  const DEBUG_PAIR_GAP = 4;
  const DEBUG_SELECT_STYLE = `background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px ${DEBUG_HUD_PAD_X}px`;
  const DEBUG_CONN_SELECT_STYLE = `background:#111;color:#e4bc58;border:1px solid rgba(228,188,88,0.3);font:bold 16px monospace;padding:2px ${DEBUG_HUD_PAD_X}px`;
  const DEBUG_COPY_BUTTON_STYLE = `background:#1a1208;color:#c97b2a;border:1px solid rgba(201,123,42,0.45);font:bold 16px monospace;padding:2px ${DEBUG_HUD_PAD_X}px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:0 0 11ch;width:11ch;text-align:center;white-space:nowrap`;
  const DEBUG_TOGGLE_BUTTON_STYLE = `position:fixed;top:12px;right:12px;z-index:10000;background:rgba(10,10,12,0.1);color:rgba(228,188,88,0.4);border:1px solid rgba(228,188,88,0.09);font:bold 14px monospace;padding:2px ${DEBUG_HUD_PAD_X}px;cursor:pointer;text-transform:lowercase;box-shadow:0 0 6px rgba(228,188,88,0.025)`;
  const DEBUG_HUD_VISIBLE_KEY = 'sonara_debugHudVisible';
  const appendDebugPair = (rowEl, labelText, controlEl) => {
    const pairEl = document.createElement('span');
    pairEl.style.cssText = `display:inline-flex;align-items:center;gap:${DEBUG_PAIR_GAP}px;white-space:nowrap`;
    const labelEl = document.createElement('span');
    labelEl.textContent = labelText;
    pairEl.appendChild(labelEl);
    pairEl.appendChild(controlEl);
    rowEl.appendChild(pairEl);
    return pairEl;
  };
  const debugBar = document.createElement('div');
  debugBar.id = 'hero-debug-bar';
  debugBar.style.cssText = 'position:fixed;top:12px;left:12px;z-index:9999;color:#00ccff;font:bold 18px/1 monospace;display:flex;flex-direction:column;align-items:flex-start;gap:8px';
  let debugHudVisible = localStorage.getItem(DEBUG_HUD_VISIBLE_KEY) !== '0';
  const debugTopRow = document.createElement('div');
  debugTopRow.style.cssText = `display:flex;align-items:center;gap:${DEBUG_TOP_ROW_GAP}px`;
  const debugSecondRow = document.createElement('div');
  debugSecondRow.style.cssText = `display:flex;align-items:center;gap:${DEBUG_SECOND_ROW_GAP}px`;
  const debugThirdRow = document.createElement('div');
  debugThirdRow.style.cssText = `display:flex;align-items:center;gap:${DEBUG_SECOND_ROW_GAP}px`;
  const debugConnCountEl = document.createElement('span');
  debugConnCountEl.style.cssText = 'pointer-events:none;display:inline-block;min-width:18ch;width:18ch;text-align:right;white-space:nowrap';
  const debugConnRow = document.createElement('div');
  debugConnRow.style.cssText = `display:flex;align-items:center;gap:${DEBUG_SECOND_ROW_GAP}px`;
  const debugConnRow2 = document.createElement('div');
  debugConnRow2.style.cssText = `display:flex;align-items:center;gap:${DEBUG_SECOND_ROW_GAP}px`;
  const debugPerfRow = document.createElement('div');
  debugPerfRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  debugBar.appendChild(debugTopRow);
  debugBar.appendChild(debugSecondRow);
  debugBar.appendChild(debugThirdRow);
  debugBar.appendChild(debugConnRow);
  debugBar.appendChild(debugConnRow2);
  debugBar.appendChild(debugPerfRow);
  const debugToggleBtn = document.createElement('button');
  debugToggleBtn.type = 'button';
  debugToggleBtn.style.cssText = DEBUG_TOGGLE_BUTTON_STYLE;
  const syncDebugHudVisibility = () => {
    debugBar.style.display = debugHudVisible ? 'flex' : 'none';
    debugPerfRow.style.display = debugHudVisible ? 'flex' : 'none';
    debugToggleBtn.textContent = debugHudVisible ? 'hide' : 'show';
    if (!debugHudVisible) {
      fpsFrames = 0;
      fpsValue = 0;
      debugHudLastUpdate = performance.now();
      ftSmooth = 0;
      fpsEl.textContent = '';
      ftEl.textContent = '';
    }
    localStorage.setItem(DEBUG_HUD_VISIBLE_KEY, debugHudVisible ? '1' : '0');
  };
  if (isLocal) {
    const blurDebugControl = (el) => {
      window.setTimeout(() => {
        if (document.activeElement === el) el.blur();
      }, 0);
    };
    debugBar.addEventListener('change', (e) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) {
        blurDebugControl(e.target);
      }
    });
    debugBar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'number') {
        blurDebugControl(e.target);
      }
    });
    debugBar.addEventListener('click', (e) => {
      if (e.target instanceof HTMLButtonElement) {
        blurDebugControl(e.target);
      }
      if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') {
        blurDebugControl(e.target);
      }
    });
    debugToggleBtn.addEventListener('click', () => {
      debugHudVisible = !debugHudVisible;
      syncDebugHudVisibility();
      blurDebugControl(debugToggleBtn);
    });
  }
  // Connection search interval dropdown (left of FPS)
  if (isLocal) {
    const rrSel = document.createElement('select');
    rrSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 16; i++) {
      const v = i * 25;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.rippleInnerRadius) < 0.001;
      opt.textContent = `${v}px${isDefault ? ' ★' : ''}`;
      if (Math.abs(v - RIPPLE_INNER_RADIUS) < 0.001) opt.selected = true;
      rrSel.appendChild(opt);
    }
    rrSel.addEventListener('change', () => { RIPPLE_INNER_RADIUS = +rrSel.value; localStorage.setItem('sonara_rippleInnerRadius', RIPPLE_INNER_RADIUS); });
    appendDebugPair(debugSecondRow, 'Ripple rad:', rrSel);

    const rrToggleLabel = document.createElement('label');
    rrToggleLabel.style.cssText = 'display:inline-flex;align-items:center;gap:6px;color:#00ccff;font:bold 16px monospace';
    const rrToggle = document.createElement('input');
    rrToggle.type = 'checkbox';
    rrToggle.checked = SHOW_RIPPLE_RADIUS;
    rrToggle.style.cssText = 'margin:0';
    rrToggle.addEventListener('change', () => {
      SHOW_RIPPLE_RADIUS = rrToggle.checked;
      localStorage.setItem('sonara_showRippleRadius', SHOW_RIPPLE_RADIUS ? '1' : '0');
    });
    const rrToggleText = document.createElement('span');
    rrToggleText.textContent = 'Show rad';
    rrToggleLabel.appendChild(rrToggle);
    rrToggleLabel.appendChild(rrToggleText);
    debugSecondRow.appendChild(rrToggleLabel);

    const rbSel = document.createElement('select');
    rbSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 40; i++) {
      const v = i;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.rippleBase) < 0.001;
      opt.textContent = v.toFixed(1) + (isDefault ? ' ★' : '');
      if (Math.abs(v - RIPPLE_SPEED_BASE) < 0.001) opt.selected = true;
      rbSel.appendChild(opt);
    }
    rbSel.addEventListener('change', () => { RIPPLE_SPEED_BASE = +rbSel.value; localStorage.setItem('sonara_rippleBase', RIPPLE_SPEED_BASE); });
    appendDebugPair(debugSecondRow, 'Ripple base:', rbSel);

    const rvSel = document.createElement('select');
    rvSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 8; i++) {
      const v = i * 0.5;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.rippleVariance) < 0.001;
      opt.textContent = v.toFixed(1) + (isDefault ? ' ★' : '');
      if (Math.abs(v - RIPPLE_SPEED_VAR) < 0.001) opt.selected = true;
      rvSel.appendChild(opt);
    }
    rvSel.addEventListener('change', () => { RIPPLE_SPEED_VAR = +rvSel.value; localStorage.setItem('sonara_rippleVariance', RIPPLE_SPEED_VAR); });
    appendDebugPair(debugSecondRow, 'Ripple var:', rvSel);

    const baSel = document.createElement('select');
    baSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 50; i++) {
      const v = i * 0.02;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.brightnessAttack) < 0.001;
      opt.textContent = v.toFixed(2) + (isDefault ? ' ★' : '');
      if (Math.abs(v - BRIGHTNESS_ATTACK) < 0.001) opt.selected = true;
      baSel.appendChild(opt);
    }
    baSel.addEventListener('change', () => { BRIGHTNESS_ATTACK = +baSel.value; localStorage.setItem('sonara_brightnessAttack', BRIGHTNESS_ATTACK); });
    appendDebugPair(debugSecondRow, 'Bright atk:', baSel);

    const brSel = document.createElement('select');
    brSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 50; i++) {
      const v = i * 0.02;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.brightnessRelease) < 0.001;
      opt.textContent = v.toFixed(2) + (isDefault ? ' ★' : '');
      if (Math.abs(v - BRIGHTNESS_RELEASE) < 0.001) opt.selected = true;
      brSel.appendChild(opt);
    }
    brSel.addEventListener('change', () => { BRIGHTNESS_RELEASE = +brSel.value; localStorage.setItem('sonara_brightnessRelease', BRIGHTNESS_RELEASE); });
    appendDebugPair(debugSecondRow, 'Bright rel:', brSel);

    const saSel = document.createElement('select');
    saSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 50; i++) {
      const v = i * 0.02;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.spinAttack) < 0.001;
      opt.textContent = v.toFixed(2) + (isDefault ? ' ★' : '');
      if (Math.abs(v - SPIN_ATTACK) < 0.001) opt.selected = true;
      saSel.appendChild(opt);
    }
    saSel.addEventListener('change', () => { SPIN_ATTACK = +saSel.value; localStorage.setItem('sonara_spinAttack', SPIN_ATTACK); });
    appendDebugPair(debugSecondRow, 'Spin atk:', saSel);

    const srSel = document.createElement('select');
    srSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 50; i++) {
      const v = i * 0.02;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.spinRelease) < 0.001;
      opt.textContent = v.toFixed(2) + (isDefault ? ' ★' : '');
      if (Math.abs(v - SPIN_RELEASE) < 0.001) opt.selected = true;
      srSel.appendChild(opt);
    }
    srSel.addEventListener('change', () => { SPIN_RELEASE = +srSel.value; localStorage.setItem('sonara_spinRelease', SPIN_RELEASE); });
    appendDebugPair(debugSecondRow, 'Spin rel:', srSel);

    const sel = document.createElement('select');
    sel.style.cssText = DEBUG_CONN_SELECT_STYLE;
    for (let i = 1; i <= 30; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}${i === HERO_DEBUG_DEFAULTS.connSkip ? ' ★' : ''}`;
      if (i === CONN_SEARCH_INTERVAL) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => { CONN_SEARCH_INTERVAL = +sel.value; connSearchFrame = 0; localStorage.setItem('sonara_connSkip', CONN_SEARCH_INTERVAL); });

    const wpSel = document.createElement('select');
    wpSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 30; i += 5) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}%${i === HERO_DEBUG_DEFAULTS.whiteParticlePct ? ' ★' : ''}`;
      if (i === WHITE_PARTICLE_PERCENT) opt.selected = true;
      wpSel.appendChild(opt);
    }
    wpSel.addEventListener('change', () => {
      WHITE_PARTICLE_PERCENT = clampWhiteParticlePct(wpSel.value);
      wpSel.value = String(WHITE_PARTICLE_PERCENT);
      localStorage.setItem('sonara_whiteParticlePct', WHITE_PARTICLE_PERCENT);
    });
    const wcSel = document.createElement('select');
    wcSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 40; i <= 100; i += 5) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}%${i === HERO_DEBUG_DEFAULTS.whiteBrightnessCap ? ' ★' : ''}`;
      if (i === WHITE_BRIGHTNESS_CAP) opt.selected = true;
      wcSel.appendChild(opt);
    }
    wcSel.addEventListener('change', () => {
      WHITE_BRIGHTNESS_CAP = clampWhiteBrightnessCap(wcSel.value);
      wcSel.value = String(WHITE_BRIGHTNESS_CAP);
      localStorage.setItem('sonara_whiteBrightnessCap', WHITE_BRIGHTNESS_CAP);
    });
    debugConnCountEl.textContent = 'Active conn: 0';
    debugConnCountEl.style.cssText = 'pointer-events:none;display:inline-block;min-width:18ch;width:18ch;text-align:right;white-space:nowrap;color:#e4bc58';
    debugConnRow.appendChild(debugConnCountEl);
    const connSkipPair = appendDebugPair(debugConnRow, 'Skip:', sel);
    connSkipPair.firstChild.style.color = '#e4bc58';

    const cSel = document.createElement('select');
    cSel.style.cssText = DEBUG_CONN_SELECT_STYLE;
    for (let i = 1; i <= 5; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}${i === HERO_DEBUG_DEFAULTS.maxConn ? ' ★' : ''}`;
      if (i === MAX_CONN) opt.selected = true;
      cSel.appendChild(opt);
    }
    cSel.addEventListener('change', () => { MAX_CONN = +cSel.value; localStorage.setItem('sonara_maxConn', MAX_CONN); });
    const connPair = appendDebugPair(debugConnRow, 'Conn:', cSel);
    connPair.firstChild.style.color = '#e4bc58';

    const scToggle = document.createElement('input');
    scToggle.type = 'checkbox';
    scToggle.checked = SUPER_CONN;
    scToggle.style.cssText = 'margin:0;accent-color:#e4bc58';
    scToggle.addEventListener('change', () => {
      SUPER_CONN = scToggle.checked;
      localStorage.setItem('sonara_superConn', SUPER_CONN ? '1' : '0');
    });
    const scPair = appendDebugPair(debugConnRow, 'Superconn:', scToggle);
    scPair.firstChild.style.color = '#e4bc58';

    const gsToggle = document.createElement('input');
    gsToggle.type = 'checkbox';
    gsToggle.checked = GATHER_SELECT;
    gsToggle.style.cssText = 'margin:0;accent-color:#e4bc58';
    gsToggle.addEventListener('change', () => {
      GATHER_SELECT = gsToggle.checked;
      localStorage.setItem('sonara_gatherSelect', GATHER_SELECT ? '1' : '0');
    });
    const gsPair = appendDebugPair(debugConnRow, 'GatherSel:', gsToggle);
    gsPair.firstChild.style.color = '#e4bc58';

    const dSel = document.createElement('select');
    dSel.style.cssText = DEBUG_CONN_SELECT_STYLE;
    for (let i = 100; i <= 200; i += 10) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}px${i === HERO_DEBUG_DEFAULTS.connDist ? ' ★' : ''}`;
      if (i === CONN_REACH) opt.selected = true;
      dSel.appendChild(opt);
    }
    dSel.addEventListener('change', () => { updateConnReach(+dSel.value); localStorage.setItem('sonara_connDist', CONN_REACH); });
    const distPair = appendDebugPair(debugConnRow, 'Dist:', dSel);
    distPair.firstChild.style.color = '#e4bc58';

    appendDebugPair(debugThirdRow, 'White %:', wpSel);
    appendDebugPair(debugThirdRow, 'White cap:', wcSel);

    const debugGold = '#d8d1bf';

    const varSpeedToggle = document.createElement('input');
    varSpeedToggle.type = 'checkbox';
    varSpeedToggle.checked = VARIABLE_SPEED;
    varSpeedToggle.style.cssText = `margin:0;accent-color:${debugGold}`;
    varSpeedToggle.addEventListener('change', () => {
      VARIABLE_SPEED = varSpeedToggle.checked;
      localStorage.setItem('sonara_varSpeed', VARIABLE_SPEED ? '1' : '0');
    });
    const varSpeedPair = appendDebugPair(debugThirdRow, 'Var Speed:', varSpeedToggle);
    varSpeedPair.firstChild.style.color = debugGold;

    const speedPeriodInput = document.createElement('input');
    speedPeriodInput.type = 'number';
    speedPeriodInput.min = '5';
    speedPeriodInput.max = '300';
    speedPeriodInput.step = '5';
    speedPeriodInput.value = String(SPEED_PERIOD);
    speedPeriodInput.style.cssText = `${DEBUG_SELECT_STYLE};width:6ch;color:${debugGold}`;
    speedPeriodInput.addEventListener('change', () => {
      SPEED_PERIOD = clampSpeedPeriod(speedPeriodInput.value);
      speedPeriodInput.value = String(SPEED_PERIOD);
      localStorage.setItem('sonara_speedPeriod', SPEED_PERIOD);
    });
    const speedPeriodPair = appendDebugPair(debugThirdRow, 'Period:', speedPeriodInput);
    speedPeriodPair.firstChild.style.color = debugGold;

    const lowSpeedSel = document.createElement('select');
    lowSpeedSel.style.cssText = `${DEBUG_SELECT_STYLE};color:${debugGold}`;
    for (let i = 20; i <= 100; i += 5) {
      const v = i / 100;
      const opt = document.createElement('option');
      opt.value = v.toFixed(2);
      opt.textContent = `${v.toFixed(2)}${Math.abs(v - 0.8) < 0.001 ? ' ★' : ''}`;
      if (Math.abs(v - LOW_SPEED) < 0.001) opt.selected = true;
      lowSpeedSel.appendChild(opt);
    }
    lowSpeedSel.addEventListener('change', () => {
      LOW_SPEED = clampLowSpeed(lowSpeedSel.value);
      lowSpeedSel.value = LOW_SPEED.toFixed(2);
      localStorage.setItem('sonara_lowSpeed', LOW_SPEED.toFixed(2));
    });
    const lowSpeedPair = appendDebugPair(debugThirdRow, 'LowSpd:', lowSpeedSel);
    lowSpeedPair.firstChild.style.color = debugGold;

    const highSpeedSel = document.createElement('select');
    highSpeedSel.style.cssText = `${DEBUG_SELECT_STYLE};color:${debugGold}`;
    for (let i = 50; i <= 200; i += 5) {
      const v = i / 100;
      const opt = document.createElement('option');
      opt.value = v.toFixed(2);
      opt.textContent = `${v.toFixed(2)}${Math.abs(v - 1.5) < 0.001 ? ' ★' : ''}`;
      if (Math.abs(v - HIGH_SPEED) < 0.001) opt.selected = true;
      highSpeedSel.appendChild(opt);
    }
    highSpeedSel.addEventListener('change', () => {
      HIGH_SPEED = clampHighSpeed(highSpeedSel.value);
      highSpeedSel.value = HIGH_SPEED.toFixed(2);
      localStorage.setItem('sonara_highSpeed', HIGH_SPEED.toFixed(2));
    });
    const highSpeedPair = appendDebugPair(debugThirdRow, 'HighSpd:', highSpeedSel);
    highSpeedPair.firstChild.style.color = debugGold;

    const speedClampSel = document.createElement('select');
    speedClampSel.style.cssText = `${DEBUG_SELECT_STYLE};color:${debugGold}`;
    for (let i = 50; i <= 200; i += 5) {
      const v = i / 100;
      const opt = document.createElement('option');
      opt.value = v.toFixed(2);
      opt.textContent = `${v.toFixed(2)}${Math.abs(v - 1.0) < 0.001 ? ' ★' : ''}`;
      if (Math.abs(v - SPEED_CLAMP) < 0.001) opt.selected = true;
      speedClampSel.appendChild(opt);
    }
    speedClampSel.addEventListener('change', () => {
      SPEED_CLAMP = clampSpeedClamp(speedClampSel.value);
      speedClampSel.value = SPEED_CLAMP.toFixed(2);
      localStorage.setItem('sonara_speedClamp', SPEED_CLAMP.toFixed(2));
    });
    const speedClampPair = appendDebugPair(debugThirdRow, 'Clamp:', speedClampSel);
    speedClampPair.firstChild.style.color = debugGold;

    const ckSel = document.createElement('select');
    ckSel.style.cssText = DEBUG_CONN_SELECT_STYLE;
    for (const v of [0.003, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1]) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = `${v}${Math.abs(v - HERO_DEBUG_DEFAULTS.connKillAlpha) < 0.0001 ? ' ★' : ''}`;
      if (Math.abs(v - CONN_KILL_ALPHA) < 0.0001) opt.selected = true;
      ckSel.appendChild(opt);
    }
    ckSel.addEventListener('change', () => {
      CONN_KILL_ALPHA = +ckSel.value;
      localStorage.setItem('sonara_connKillAlpha', String(CONN_KILL_ALPHA));
    });
    const connKillPair = appendDebugPair(debugConnRow2, 'Kill:', ckSel);
    connKillPair.firstChild.style.color = '#e4bc58';

    // Line weight (LINE_BASE)
    const lwSel = document.createElement('select');
    lwSel.style.cssText = DEBUG_CONN_SELECT_STYLE;
    for (let i = 1; i <= 20; i++) {
      const v = i / 100;
      const opt = document.createElement('option');
      opt.value = v.toFixed(2);
      opt.textContent = `${v.toFixed(2)}${Math.abs(v - HERO_DEBUG_DEFAULTS.lineBase) < 0.001 ? ' ★' : ''}`;
      if (Math.abs(v - LINE_BASE) < 0.001) opt.selected = true;
      lwSel.appendChild(opt);
    }
    lwSel.addEventListener('change', () => { LINE_BASE = +lwSel.value; localStorage.setItem('sonara_lineBase', LINE_BASE); });
    const lwPair = appendDebugPair(debugConnRow2, 'Weight:', lwSel);
    lwPair.firstChild.style.color = '#e4bc58';

    // Fade in rate
    const fiSel = document.createElement('select');
    fiSel.style.cssText = DEBUG_CONN_SELECT_STYLE;
    for (let i = 1; i <= 20; i++) {
      const v = i / 100;
      const opt = document.createElement('option');
      opt.value = v.toFixed(2);
      opt.textContent = `${(v * 100).toFixed(0)}%${Math.abs(v - HERO_DEBUG_DEFAULTS.connFadeIn) < 0.001 ? ' ★' : ''}`;
      if (Math.abs(v - CONN_FADE_IN) < 0.001) opt.selected = true;
      fiSel.appendChild(opt);
    }
    fiSel.addEventListener('change', () => { CONN_FADE_IN = +fiSel.value; localStorage.setItem('sonara_connFadeIn', CONN_FADE_IN); });
    const fiPair = appendDebugPair(debugConnRow2, 'FadeIn:', fiSel);
    fiPair.firstChild.style.color = '#e4bc58';

    // Fade out rate
    const foSel = document.createElement('select');
    foSel.style.cssText = DEBUG_CONN_SELECT_STYLE;
    for (let i = 5; i <= 100; i += 5) {
      const v = i / 1000;
      const opt = document.createElement('option');
      opt.value = v.toFixed(3);
      opt.textContent = `${v.toFixed(3)}${Math.abs(v - HERO_DEBUG_DEFAULTS.connFadeOut) < 0.001 ? ' ★' : ''}`;
      if (Math.abs(v - CONN_FADE_OUT) < 0.001) opt.selected = true;
      foSel.appendChild(opt);
    }
    foSel.addEventListener('change', () => { CONN_FADE_OUT = +foSel.value; localStorage.setItem('sonara_connFadeOut', CONN_FADE_OUT); });
    const foPair = appendDebugPair(debugConnRow2, 'FadeOut:', foSel);
    foPair.firstChild.style.color = '#e4bc58';

    const ffSel = document.createElement('select');
    ffSel.style.cssText = `${DEBUG_SELECT_STYLE};color:#c084fc`;
    for (let v = 0; v <= 10; v += 0.5) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = `${v}s${v === 1 ? ' ★' : ''}`;
      if (v === FADE_UP_SECS) opt.selected = true;
      ffSel.appendChild(opt);
    }
    ffSel.addEventListener('change', () => {
      FADE_UP_SECS = +ffSel.value;
      FADE_FRAMES = Math.round(FADE_UP_SECS * 120);
      localStorage.setItem('sonara_fadeUpSecs', String(FADE_UP_SECS));
    });
    const fadePair = appendDebugPair(debugThirdRow, 'FadeUp:', ffSel);
    fadePair.firstChild.style.color = '#c084fc';

  }

  // FPS + frame budget display (own row, left-aligned)
  const fpsEl = document.createElement('span');
  fpsEl.style.cssText = 'pointer-events:none;display:inline-block;min-width:7ch;white-space:nowrap;color:#f0c040';
  debugPerfRow.appendChild(fpsEl);
  const ftEl = document.createElement('span');
  ftEl.style.cssText = 'pointer-events:none;display:inline-block;min-width:4ch;white-space:nowrap;color:#f0c040';
  debugPerfRow.appendChild(ftEl);
  const ftAvgEl = document.createElement('span');
  ftAvgEl.style.cssText = 'pointer-events:none;display:inline-block;min-width:4ch;white-space:nowrap;color:#888';
  debugPerfRow.appendChild(ftAvgEl);
  const FT_AVG_SAMPLES = 80; // 20s at 4 updates/sec
  const ftAvgBuf = new Float32Array(FT_AVG_SAMPLES);
  let ftAvgIdx = 0;
  let ftAvgCount = 0;

  // f16 toggle checkbox (right of %)
  const f16Label = document.createElement('label');
  f16Label.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;color:#60a5fa;white-space:nowrap';
  const f16Check = document.createElement('input');
  f16Check.type = 'checkbox';
  f16Check.checked = localStorage.getItem('sonara_f16') !== '0'; // default on
  f16Check.style.cssText = 'margin:0;cursor:pointer';
  f16Label.appendChild(f16Check);
  f16Label.appendChild(document.createTextNode('f16'));
  debugPerfRow.appendChild(f16Label);
  f16Check.addEventListener('change', () => {
    localStorage.setItem('sonara_f16', f16Check.checked ? '1' : '0');
    location.reload();
  });

  // GPU Render toggle (local only) — disables WebGPU render path for A/B comparison
  // Each mode has its own full set of settings so you can tune independently
  const GPU_RENDER_EXCLUDE = ['sonara_gpu_render', 'sonara_f16', 'sonara_debugHudVisible'];
  if (isLocal) {
    const gpuRenderLabel = document.createElement('label');
    gpuRenderLabel.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;color:#60a5fa;white-space:nowrap';
    const gpuRenderCheck = document.createElement('input');
    gpuRenderCheck.type = 'checkbox';
    gpuRenderCheck.checked = localStorage.getItem('sonara_gpu_render') !== '0'; // default on
    gpuRenderCheck.style.cssText = 'margin:0;cursor:pointer';
    gpuRenderLabel.appendChild(gpuRenderCheck);
    gpuRenderLabel.appendChild(document.createTextNode('GPURender'));
    debugPerfRow.appendChild(gpuRenderLabel);
    gpuRenderCheck.addEventListener('change', () => {
      const wasGpu = !gpuRenderCheck.checked;
      const fromPrefix = wasGpu ? 'sonara_gpu__' : 'sonara_cpu__';
      const toPrefix = wasGpu ? 'sonara_cpu__' : 'sonara_gpu__';
      // Collect all active sonara_ keys (excluding toggle keys)
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('sonara_') && !k.startsWith('sonara_gpu__') && !k.startsWith('sonara_cpu__')
            && !GPU_RENDER_EXCLUDE.includes(k)) {
          keys.push(k);
        }
      }
      // Save current values under the outgoing mode prefix
      for (const k of keys) {
        localStorage.setItem(fromPrefix + k.slice(7), localStorage.getItem(k));
      }
      // Restore saved values from the incoming mode prefix
      for (const k of keys) {
        const saved = localStorage.getItem(toPrefix + k.slice(7));
        if (saved != null) localStorage.setItem(k, saved);
      }
      localStorage.setItem('sonara_gpu_render', gpuRenderCheck.checked ? '1' : '0');
      location.reload();
    });
  }

  let ftSmooth = 0;

  // Max particles dropdown (between FPS and particle counts)
  if (isLocal) {
    const seedSel = document.createElement('select');
    seedSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 500; i <= 11000; i += 500) {
      const opt = document.createElement('option');
      opt.value = i;
      const defaultSeed = isMobileView ? HERO_DEBUG_DEFAULTS.seedParticles.mobile : HERO_DEBUG_DEFAULTS.seedParticles.desktop;
      opt.textContent = `${i}${i === defaultSeed ? ' ★' : ''}`;
      if (i === SEED_PARTICLES) opt.selected = true;
      seedSel.appendChild(opt);
    }
    seedSel.addEventListener('change', () => {
      SEED_PARTICLES = Math.min(+seedSel.value, MAX_PARTICLES);
      if (+seedSel.value !== SEED_PARTICLES) {
        seedSel.value = String(SEED_PARTICLES);
      }
      localStorage.setItem('sonara_seedParticles', SEED_PARTICLES);
    });
    appendDebugPair(debugTopRow, 'Seed:', seedSel);

    const pSel = document.createElement('select');
    pSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 500; i <= 11000; i += 500) {
      const opt = document.createElement('option');
      opt.value = i;
      const defaultMax = isMobileView ? HERO_DEBUG_DEFAULTS.maxParticles.mobile : HERO_DEBUG_DEFAULTS.maxParticles.desktop;
      opt.textContent = `${i}${i === defaultMax ? ' ★' : ''}`;
      if (i === MAX_PARTICLES) opt.selected = true;
      pSel.appendChild(opt);
    }
    pSel.addEventListener('change', () => {
      MAX_PARTICLES = +pSel.value;
      if (SEED_PARTICLES > MAX_PARTICLES) {
        SEED_PARTICLES = MAX_PARTICLES;
        seedSel.value = String(SEED_PARTICLES);
        localStorage.setItem('sonara_seedParticles', SEED_PARTICLES);
      }
      THROTTLE_START = Math.round(MAX_PARTICLES * 0.8);
      localStorage.setItem('sonara_maxParticles', MAX_PARTICLES);
    });
    appendDebugPair(debugTopRow, 'Max:', pSel);
  }

  // Particle stats
  const counterEl = document.createElement('span');
  counterEl.style.cssText = 'pointer-events:none;display:inline-flex;align-items:center;gap:1ch;white-space:nowrap;color:#c9c7c2';
  const createLockedStat = (label) => {
    const statEl = document.createElement('span');
    statEl.style.cssText = 'display:inline-flex;align-items:center;color:#c9c7c2';

    const statLabelEl = document.createElement('span');
    statLabelEl.textContent = `${label}:`;

    const statValueEl = document.createElement('span');
    statValueEl.style.cssText = 'display:inline-block;flex:0 0 4ch;width:4ch;text-align:right';

    statEl.appendChild(statLabelEl);
    statEl.appendChild(statValueEl);
    return { statEl, statValueEl };
  };
  const autoStat = createLockedStat('A');
  const burstStat = createLockedStat('U');
  const totalStat = createLockedStat('T');
  const highWaterEl = document.createElement('span');
  highWaterEl.style.cssText = 'display:inline-block;color:#c9c7c2';
  counterEl.appendChild(autoStat.statEl);
  counterEl.appendChild(burstStat.statEl);
  counterEl.appendChild(totalStat.statEl);
  counterEl.appendChild(highWaterEl);
  debugTopRow.appendChild(counterEl);

  // Connection tuning dropdowns (top row: physics controls)
  if (isLocal) {
    const sSel = document.createElement('select');
    sSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 100; i += 5) {
      const v = i / 1000; // 0.000 to 0.100 in steps of 0.005
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.swirlForce) < 0.001;
      opt.textContent = v.toFixed(3) + (isDefault ? ' ★' : '');
      if (Math.abs(v - SWIRL_FORCE) < 0.001) opt.selected = true;
      sSel.appendChild(opt);
    }
    sSel.addEventListener('change', () => { SWIRL_FORCE = +sSel.value; localStorage.setItem('sonara_swirlForce', SWIRL_FORCE); });
    appendDebugPair(debugTopRow, 'Swirl:', sSel);

    const plSel = document.createElement('select');
    plSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 0; i <= 100; i += 2) {
      const v = i / 1000; // 0.000 to 0.100 in steps of 0.002
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.pullForce) < 0.001;
      opt.textContent = v.toFixed(3) + (isDefault ? ' ★' : '');
      if (Math.abs(v - PULL_FORCE) < 0.001) opt.selected = true;
      plSel.appendChild(opt);
    }
    plSel.addEventListener('change', () => { PULL_FORCE = +plSel.value; localStorage.setItem('sonara_pullForce', PULL_FORCE); });
    appendDebugPair(debugTopRow, 'Pull:', plSel);

    const frSel = document.createElement('select');
    frSel.style.cssText = DEBUG_SELECT_STYLE;
    for (let i = 950; i <= 1000; i += 5) {
      const v = i / 1000; // 0.950 to 1.000 in steps of 0.005
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.friction) < 0.001;
      opt.textContent = v.toFixed(3) + (isDefault ? ' ★' : '');
      if (Math.abs(v - FRICTION) < 0.001) opt.selected = true;
      frSel.appendChild(opt);
    }
    frSel.addEventListener('change', () => { FRICTION = +frSel.value; localStorage.setItem('sonara_friction', FRICTION); });
    appendDebugPair(debugTopRow, 'Friction:', frSel);

    const scSel = document.createElement('select');
    scSel.style.cssText = DEBUG_SELECT_STYLE;
    const centerOptions = [
      { label: 'Listen', value: 'listen' },
      { label: 'Turning', value: 'turning' },
      { label: 'Sounds', value: 'sounds' },
      { label: 'SONARA', value: 'sonara' },
    ];
    const savedCenter = localStorage.getItem('sonara_swirlCenter') || HERO_DEBUG_DEFAULTS.swirlCenter;
    centerOptions.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label + (o.value === HERO_DEBUG_DEFAULTS.swirlCenter ? ' ★' : '');
      if (o.value === savedCenter) opt.selected = true;
      scSel.appendChild(opt);
    });
    scSel.addEventListener('change', () => { swirlCenterTarget = scSel.value; localStorage.setItem('sonara_swirlCenter', swirlCenterTarget); });
    appendDebugPair(debugTopRow, 'Center:', scSel);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy JSON';
    copyBtn.style.cssText = DEBUG_COPY_BUTTON_STYLE;
    copyBtn.addEventListener('click', async () => {
      const originalLabel = copyBtn.textContent;
      copyBtn.disabled = true;

      try {
        await copyText(JSON.stringify(getDebugSettingsSnapshot(), null, 2));
        copyBtn.textContent = 'Copied';
      } catch (error) {
        console.error('Failed to copy Sonara debug settings', error);
        copyBtn.textContent = 'Copy failed';
      }

      window.setTimeout(() => {
        copyBtn.textContent = originalLabel;
        copyBtn.disabled = false;
      }, 1200);
    });
    debugConnRow2.appendChild(copyBtn);
  }
  if (isLocal) {
    canvas.parentElement.appendChild(debugBar);
    document.body.appendChild(debugToggleBtn);
    syncDebugHudVisibility();
  }

  const rippleRadiusOverlay = document.createElement('div');
  rippleRadiusOverlay.style.cssText = 'position:absolute;left:0;top:0;border:1px solid rgba(228,188,88,0.75);border-radius:50%;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,0.2),0 0 18px rgba(228,188,88,0.18);opacity:0;display:none;transform:translate(-50%,-50%);z-index:3';
  if (canvas.parentElement) {
    const parentStyle = window.getComputedStyle(canvas.parentElement);
    if (parentStyle.position === 'static') {
      canvas.parentElement.style.position = 'relative';
    }
    canvas.parentElement.appendChild(rippleRadiusOverlay);
  }

  // Swirl center target element
  let swirlCenterTarget = localStorage.getItem('sonara_swirlCenter') || HERO_DEBUG_DEFAULTS.swirlCenter;
  const swirlCenterEls = {
    listen: listenBtn,
    turning: document.querySelector('.hero-tagline'),
    sounds: document.querySelector('.hero-expansion'),
    sonara: document.querySelector('.hero-title'),
  };
  function getElementCanvasCenter(el) {
    if (!el) return null;
    const elRect = el.getBoundingClientRect();
    if (elRect.width <= 0) return null;
    const canRect = canvas.getBoundingClientRect();
    const scaleX = w / canRect.width;
    const scaleY = h / canRect.height;
    let tx = 0;
    let ty = 0;
    const transform = window.getComputedStyle(el).transform;
    if (transform && transform !== 'none') {
      try {
        const matrix = new DOMMatrixReadOnly(transform);
        tx = matrix.m41;
        ty = matrix.m42;
      } catch {}
    }
    return {
      x: (elRect.left + elRect.width * 0.5 - tx - canRect.left) * scaleX,
      y: (elRect.top + elRect.height * 0.5 - ty - canRect.top) * scaleY,
    };
  }

  let heroAudioPlaying = false;
  let brightnessIntensity = 0;
  let brightnessTransient = 0;
  let audioIntensity = 0;
  let audioTransient = 0;
  let mouseSwirlMix = 1;
  let wasPlayingLastFrame = false;
  let playStartTime = 0;
  let stopTime = 0;
  const MOUSE_SWIRL_FADE_MS = 5000;
  const MOUSE_SWIRL_RETURN_MS = 1000;
  const MOUSE_INTERACTION_MULT = 0.33;
  const heroRmsData = new Uint8Array(128);
  let rmsSmooth = 0;
  let lastRippleTime = 0;
  let rippleClickTime = 0;
  let radiusFadeOpacity = 0;
  let radiusLocked = false;
  const RIPPLE_BURST_DURATION = 10000;
  let rippleFirstPlay = true;

  function spawnRipple() {
    if (!listenBtn) return;
    const ring = document.createElement('span');
    ring.className = 'listen-ring';
    const rippleAge = rippleClickTime > 0 ? performance.now() - rippleClickTime : 0;
    const decay = rippleClickTime > 0
      ? Math.max(0, 1 - rippleAge / RIPPLE_BURST_DURATION)
      : 1;
    ring.style.setProperty('--ripple-peak-opacity', (decay * 0.24).toFixed(4));
    const dur = 4 + Math.random() * 3;
    ring.style.animation = `ripple ${dur}s ease-out forwards`;
    listenBtn.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove());
  }
  if (listenBtn) {
    const mo = new MutationObserver(() => {
      const wasPlaying = heroAudioPlaying;
      heroAudioPlaying = listenBtn.classList.contains('playing');
      if (wasPlaying && !heroAudioPlaying) rippleFirstPlay = false;
    });
    mo.observe(listenBtn, { attributes: true, attributeFilter: ['class'] });
    listenBtn.addEventListener('click', () => {
      if (rippleFirstPlay) {
        rippleClickTime = performance.now();
        spawnRipple();
      }
    });
  }

  // --- Shader sources (GLSL ES 3.0) ---

  // Transform feedback update vertex shader — all physics happen here (GPU path only)
  const TF_UPDATE_VS = `#version 300 es
    precision highp float;

    in vec4 a_posVel;     // x, y, vx, vy
    in vec4 a_visual;     // phase, alpha, r, age
    in vec4 a_lifecycle;  // fadeIn, life, decay, baseAlpha
    in vec2 a_behavior;   // reactivity, rippleSpeed

    out vec4 v_posVel;
    out vec4 v_visual;
    out vec4 v_lifecycle;
    out vec2 v_behavior;
    out vec2 v_render;    // renderSize, renderAlpha

    uniform float u_time;
    uniform float u_audioIntensity;
    uniform float u_audioTransient;
    uniform float u_mouseX;
    uniform float u_mouseY;
    uniform float u_mouseSwirlMix;
    uniform vec2 u_btnCenter;
    uniform vec2 u_resolution;
    uniform int u_rippleHead;
    uniform float u_seed;
    uniform float u_brightness;
    uniform float u_heroPlaying;
    uniform float u_friction;
    uniform float u_rippleInnerRadius;

    uniform sampler2D u_rippleTex;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      float x = a_posVel.x;
      float y = a_posVel.y;
      float vx = a_posVel.z;
      float vy = a_posVel.w;
      float phase = a_visual.x;
      float alpha = a_visual.y;
      float r = a_visual.z;
      float age = a_visual.w;
      float fadeIn = a_lifecycle.x;
      float life = a_lifecycle.y;
      float decay = a_lifecycle.z;
      float baseAlpha = a_lifecycle.w;
      float reactivity = a_behavior.x;
      float rippleSpeed = a_behavior.y;

      // Dead particle — pass through unchanged
      if (life < -900.0) {
        v_posVel = a_posVel;
        v_visual = a_visual;
        v_lifecycle = a_lifecycle;
        v_behavior = a_behavior;
        v_render = vec2(0.0, 0.0);
        gl_Position = vec4(0.0);
        gl_PointSize = 1.0;
        return;
      }

      // Age increment
      age += 1.0;

      // Life/decay for burst particles
      if (life > 0.0) {
        life -= decay;
        if (life <= 0.0) {
          v_posVel = vec4(x, y, 0.0, 0.0);
          v_visual = vec4(phase, alpha, r, age);
          v_lifecycle = vec4(fadeIn, -999.0, decay, baseAlpha);
          v_behavior = a_behavior;
          v_render = vec2(0.0, 0.0);
          gl_Position = vec4(0.0);
          gl_PointSize = 1.0;
          return;
        }
        alpha = baseAlpha * life;
      }

      // Button distance + delayed audio from ripple buffer
      float dxB = x - u_btnCenter.x;
      float dyB = y - u_btnCenter.y;
      float distFromBtn = length(vec2(dxB, dyB));
      float delayedDist = max(0.0, distFromBtn - u_rippleInnerRadius);
      int delayFrames = rippleSpeed <= 0.0
        ? 0
        : min(int(delayedDist / rippleSpeed), 511);
      int idx = (u_rippleHead - delayFrames + 512) % 512;
      float localIntensity = texelFetch(u_rippleTex, ivec2(idx, 0), 0).r;

      float attenuationRadius = max(u_resolution.x, u_resolution.y) * ${FORCE_RADIUS};
      float radialAttenuation = pow(max(0.0, 1.0 - distFromBtn / attenuationRadius), 1.5);

      // Render values
      float wave = sin(u_time * 2.0 + phase) * 0.5 + 0.5;
      float fadeInFactor = fadeIn > 0.0 ? min(1.0, age / fadeIn) : 1.0;
      float react = reactivity;
      float audioBoost = localIntensity * radialAttenuation * react
                         * (0.8 + sin(u_time * 3.7 + phase * 2.0) * 0.3);
      float rng1 = hash(vec2(x + u_seed, y + u_time));
      float tremble = (rng1 - 0.5) * 0.12 * localIntensity * react;
      float currentAlpha = min(1.0, (alpha * (0.5 + wave * 0.5) * fadeInFactor
                            + audioBoost * 1.5 + tremble) * u_brightness);
      float currentR = r * (0.8 + wave * 0.4) * (1.0 + audioBoost * 0.5);

      // Position update
      x += vx;
      y += vy;

      // Audio swirl
      float dist = max(distFromBtn, 1.0);
      float swirlRadius = max(u_resolution.x, u_resolution.y) * ${FORCE_RADIUS};
      float proximity = max(0.0, 1.0 - dist / swirlRadius);

      if (localIntensity > 0.01 && proximity > 0.0) {
        float nx = dxB / dist;
        float ny = dyB / dist;
        float swirlStr = localIntensity * proximity * ${SWIRL_FORCE};
        vx += -ny * swirlStr;
        vy += nx * swirlStr;
        float pull = localIntensity * proximity * ${PULL_FORCE};
        vx -= nx * pull;
        vy -= ny * pull;
        float jit = react * 0.25 * localIntensity;
        float rng2 = hash(vec2(y + u_seed * 2.0, x + u_time));
        float rng3 = hash(vec2(x * 1.3 + u_seed, y * 0.7 + u_time));
        vx += (rng2 - 0.5) * jit;
        vy += (rng3 - 0.5) * jit;
      }

      // Spread when quiet and not playing
      if (localIntensity < 0.5 && localIntensity > 0.001
          && u_heroPlaying < 0.5 && dist > 1.0) {
        float nx = dxB / dist;
        float ny = dyB / dist;
        float spread = (0.5 - localIntensity) * 0.008;
        vx += nx * spread;
        vy += ny * spread;
      }

      // Mouse attraction/swirl
      if (u_mouseSwirlMix > 0.001) {
        float dmx = u_mouseX - x;
        float dmy = u_mouseY - y;
        float d2 = dmx * dmx + dmy * dmy;
        if (d2 < 336400.0) {
          float mdist = sqrt(d2);
          float mprox = 1.0 - mdist / 580.0;
          float force = mprox * 0.00006 * u_mouseSwirlMix * 0.33;
          float swirl = mprox * 0.00008 * u_mouseSwirlMix * 0.33;
          vx += dmx * force + dmy * swirl;
          vy += dmy * force + (-dmx) * swirl;
        }
      }

      // Damping
      vx *= u_friction;
      vy *= u_friction;

      // Edge wrapping (horizontal wrap, vertical mirror-bounce)
      if (x < 0.0) x = u_resolution.x;
      else if (x > u_resolution.x) x = 0.0;
      if (y < 0.0) {
        y = 0.0;
        x = u_resolution.x - x;
        vy = abs(vy);
      } else if (y > u_resolution.y) {
        y = u_resolution.y;
        x = u_resolution.x - x;
        vy = -abs(vy);
      }

      // Output updated state
      v_posVel = vec4(x, y, vx, vy);
      v_visual = vec4(phase, alpha, r, age);
      v_lifecycle = vec4(fadeIn, life, decay, baseAlpha);
      v_behavior = vec2(reactivity, rippleSpeed);
      v_render = vec2(max(3.0, currentR * 6.0), currentAlpha);

      gl_Position = vec4(0.0);
      gl_PointSize = 1.0;
    }`;

  const TF_UPDATE_FS = `#version 300 es
    precision lowp float;
    out vec4 fragColor;
    void main() { fragColor = vec4(0.0); }`;

  // Render particle shaders (GLSL ES 3.0)
  const PARTICLE_VS = `#version 300 es
    in vec2 a_position;
    in float a_size;
    in float a_alpha;
    in float a_whiten;
    uniform vec2 u_resolution;
    out float v_alpha;
    out float v_whiten;
    void main() {
      vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
      clip.y = -clip.y;
      gl_Position = vec4(clip, 0.0, 1.0);
      gl_PointSize = a_size;
      v_alpha = a_alpha;
      v_whiten = a_whiten;
    }`;

  const PARTICLE_FS = `#version 300 es
    precision mediump float;
    in float v_alpha;
    in float v_whiten;
    uniform float u_glowAlpha;
    uniform vec3 u_whiteColor;
    out vec4 fragColor;
    void main() {
      vec2 center = gl_PointCoord - 0.5;
      float dist = length(center) * 2.0;
      if (dist > 1.0) discard;
      float coreFrac = 0.333;
      float coreAlpha = 1.0 - smoothstep(coreFrac - 0.06, coreFrac + 0.06, dist);
      float glowDist = max(0.0, dist - coreFrac) / (1.0 - coreFrac);
      float glowFade = (1.0 - glowDist * glowDist) * step(dist, 1.0);
      float hasGlow = step(0.15, v_alpha);
      float alpha = coreAlpha * v_alpha + glowFade * u_glowAlpha * v_alpha * hasGlow;
      if (alpha < 0.002) discard;
      vec3 gold = vec3(${HERO_GOLD_RGB.r.toFixed(3)}, ${HERO_GOLD_RGB.g.toFixed(3)}, ${HERO_GOLD_RGB.b.toFixed(3)});
      vec3 col = mix(gold, u_whiteColor, v_whiten);
      fragColor = vec4(col * alpha, alpha);
    }`;

  const LINE_VS = `#version 300 es
    in vec2 a_position;
    in float a_alpha;
    uniform vec2 u_resolution;
    out float v_alpha;
    void main() {
      vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
      clip.y = -clip.y;
      gl_Position = vec4(clip, 0.0, 1.0);
      v_alpha = a_alpha;
    }`;

  const LINE_FS = `#version 300 es
    precision mediump float;
    in float v_alpha;
    out vec4 fragColor;
    void main() {
      fragColor = vec4(0.831 * v_alpha, 0.659 * v_alpha, 0.263 * v_alpha, v_alpha);
    }`;

  // --- Shader helpers ---
  function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function linkProgram(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compileShader(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }
  function linkTFProgram(vs, fs, varyings) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compileShader(fs, gl.FRAGMENT_SHADER));
    gl.transformFeedbackVaryings(p, varyings, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('TF Link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  // --- Shared render programs ---
  const particleProg = linkProgram(PARTICLE_VS, PARTICLE_FS);
  const pLoc = {
    position:   gl.getAttribLocation(particleProg, 'a_position'),
    size:       gl.getAttribLocation(particleProg, 'a_size'),
    alpha:      gl.getAttribLocation(particleProg, 'a_alpha'),
    whiten:     gl.getAttribLocation(particleProg, 'a_whiten'),
    resolution: gl.getUniformLocation(particleProg, 'u_resolution'),
    glowAlpha:  gl.getUniformLocation(particleProg, 'u_glowAlpha'),
    whiteColor: gl.getUniformLocation(particleProg, 'u_whiteColor'),
  };

  const lineProg = linkProgram(LINE_VS, LINE_FS);
  const lLoc = {
    position:   gl.getAttribLocation(lineProg, 'a_position'),
    alpha:      gl.getAttribLocation(lineProg, 'a_alpha'),
    resolution: gl.getUniformLocation(lineProg, 'u_resolution'),
  };

  // --- GPU-only resources (transform feedback) ---
  const FPP = 16;           // floats per particle in TF buffer
  const STRIDE = FPP * 4;   // 64 bytes
  let tfUpdateProg, tfLoc, tfBuf, tfVAO, renderVAO, tfObj, rippleTex;
  let highWater = 0, tfCurrent = 0;
  const pids = new Int32Array(BUFFER_CAP);
  const isFree = new Uint8Array(BUFFER_CAP);
  const freeSlots = [];
  const spawnQueue = [];
  const cpuReadback = new Float32Array(BUFFER_CAP * FPP);
  const slotBuf = new Float32Array(FPP);
  let cpuParticles;

  if (GPU_PHYSICS) {
    // TF program + uniform/attrib locations
    tfUpdateProg = linkTFProgram(TF_UPDATE_VS, TF_UPDATE_FS,
      ['v_posVel', 'v_visual', 'v_lifecycle', 'v_behavior', 'v_render']);
    tfLoc = {
      posVel:    gl.getAttribLocation(tfUpdateProg, 'a_posVel'),
      visual:    gl.getAttribLocation(tfUpdateProg, 'a_visual'),
      lifecycle: gl.getAttribLocation(tfUpdateProg, 'a_lifecycle'),
      behavior:  gl.getAttribLocation(tfUpdateProg, 'a_behavior'),
      u_time:           gl.getUniformLocation(tfUpdateProg, 'u_time'),
      u_audioIntensity: gl.getUniformLocation(tfUpdateProg, 'u_audioIntensity'),
      u_audioTransient: gl.getUniformLocation(tfUpdateProg, 'u_audioTransient'),
      u_mouseX:         gl.getUniformLocation(tfUpdateProg, 'u_mouseX'),
      u_mouseY:         gl.getUniformLocation(tfUpdateProg, 'u_mouseY'),
      u_mouseSwirlMix:  gl.getUniformLocation(tfUpdateProg, 'u_mouseSwirlMix'),
      u_btnCenter:      gl.getUniformLocation(tfUpdateProg, 'u_btnCenter'),
      u_resolution:     gl.getUniformLocation(tfUpdateProg, 'u_resolution'),
      u_rippleHead:     gl.getUniformLocation(tfUpdateProg, 'u_rippleHead'),
      u_seed:           gl.getUniformLocation(tfUpdateProg, 'u_seed'),
      u_brightness:     gl.getUniformLocation(tfUpdateProg, 'u_brightness'),
      u_heroPlaying:    gl.getUniformLocation(tfUpdateProg, 'u_heroPlaying'),
      u_friction:       gl.getUniformLocation(tfUpdateProg, 'u_friction'),
      u_rippleInnerRadius: gl.getUniformLocation(tfUpdateProg, 'u_rippleInnerRadius'),
      u_rippleTex:      gl.getUniformLocation(tfUpdateProg, 'u_rippleTex'),
    };

    // Ping-pong transform feedback buffers
    const bufSize = BUFFER_CAP * STRIDE;
    tfBuf = [gl.createBuffer(), gl.createBuffer()];
    for (let i = 0; i < 2; i++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[i]);
      gl.bufferData(gl.ARRAY_BUFFER, bufSize, gl.DYNAMIC_DRAW);
    }

    // TF update VAOs — one per source buffer
    function createTFVAO(buf) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(tfLoc.posVel);
      gl.vertexAttribPointer(tfLoc.posVel, 4, gl.FLOAT, false, STRIDE, 0);
      gl.enableVertexAttribArray(tfLoc.visual);
      gl.vertexAttribPointer(tfLoc.visual, 4, gl.FLOAT, false, STRIDE, 16);
      gl.enableVertexAttribArray(tfLoc.lifecycle);
      gl.vertexAttribPointer(tfLoc.lifecycle, 4, gl.FLOAT, false, STRIDE, 32);
      gl.enableVertexAttribArray(tfLoc.behavior);
      gl.vertexAttribPointer(tfLoc.behavior, 2, gl.FLOAT, false, STRIDE, 48);
      gl.bindVertexArray(null);
      return vao;
    }
    tfVAO = [createTFVAO(tfBuf[0]), createTFVAO(tfBuf[1])];

    // Render VAOs — read position, renderSize, renderAlpha from TF output
    function createRenderVAO(buf) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(pLoc.position);
      gl.vertexAttribPointer(pLoc.position, 2, gl.FLOAT, false, STRIDE, 0);
      gl.enableVertexAttribArray(pLoc.size);
      gl.vertexAttribPointer(pLoc.size, 1, gl.FLOAT, false, STRIDE, 56);
      gl.enableVertexAttribArray(pLoc.alpha);
      gl.vertexAttribPointer(pLoc.alpha, 1, gl.FLOAT, false, STRIDE, 60);
      if (pLoc.whiten >= 0) gl.vertexAttrib1f(pLoc.whiten, 0.0);
      gl.bindVertexArray(null);
      return vao;
    }
    renderVAO = [createRenderVAO(tfBuf[0]), createRenderVAO(tfBuf[1])];

    // Transform feedback object
    tfObj = gl.createTransformFeedback();

    // Ripple texture (R32F, 512x1)
    rippleTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rippleTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 512, 1, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // CPU particle proxies for connection system
    cpuParticles = new Array(BUFFER_CAP);
    for (let i = 0; i < BUFFER_CAP; i++) {
      cpuParticles[i] = { x: 0, y: 0, pid: -1, life: -999, dead: true };
    }
  }

  // --- CPU-only resources ---
  let particles = [];
  const PFLOATS = 5; // x, y, size, alpha, whiten per particle
  let particleData, particleBuf, cpuRenderVAO;

  if (!GPU_PHYSICS) {
    particleData = new Float32Array(BUFFER_CAP * PFLOATS);
    particleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, particleData.byteLength, gl.DYNAMIC_DRAW);
    cpuRenderVAO = gl.createVertexArray();
    gl.bindVertexArray(cpuRenderVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
    gl.enableVertexAttribArray(pLoc.position);
    gl.vertexAttribPointer(pLoc.position, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(pLoc.size);
    gl.vertexAttribPointer(pLoc.size, 1, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(pLoc.alpha);
    gl.vertexAttribPointer(pLoc.alpha, 1, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(pLoc.whiten);
    gl.vertexAttribPointer(pLoc.whiten, 1, gl.FLOAT, false, 20, 16);
    gl.bindVertexArray(null);
  }

  // --- Line buffer + VAO (shared) ---
  const MAX_LINES = 65000;
  const LFLOATS = 6;
  const lineData = new Float32Array(MAX_LINES * LFLOATS);
  const lineBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, lineData.byteLength, gl.DYNAMIC_DRAW);

  const lineVAO = gl.createVertexArray();
  gl.bindVertexArray(lineVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.enableVertexAttribArray(lLoc.position);
  gl.vertexAttribPointer(lLoc.position, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(lLoc.alpha);
  gl.vertexAttribPointer(lLoc.alpha, 1, gl.FLOAT, false, 12, 8);
  gl.bindVertexArray(null);

  // --- Ripple buffers (brightness + spin share the same timing, but not the same envelope) ---
  const RIPPLE_BUF_LEN = 512;
  const brightnessRippleBuf = new Float32Array(RIPPLE_BUF_LEN);
  const spinRippleBuf = new Float32Array(RIPPLE_BUF_LEN);
  let rippleHead = 0;

  // CPU path reads ripple buffer directly
  function getDelayedIntensity(rippleBuf, dist, rippleSpeed) {
    const delayedDist = Math.max(0, dist - RIPPLE_INNER_RADIUS);
    const delayFrames = rippleSpeed <= 0
      ? 0
      : Math.min((delayedDist / rippleSpeed) | 0, RIPPLE_BUF_LEN - 1);
    const idx = (rippleHead - delayFrames + RIPPLE_BUF_LEN) % RIPPLE_BUF_LEN;
    return rippleBuf[idx];
  }

  // --- GL state ---
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(6/255, 6/255, 8/255, 1);
  gl.disable(gl.DEPTH_TEST);

  // --- Persistent connection data structures ---
  const connFade = new Map();
  const grid = new Map();
  const framePairs = new Set();
  let connSearchFrame = 0;
  let neighborCount = new Uint8Array(BUFFER_CAP);

  let nextPid = 0;
  const PID_MAX = 30000; // keep pid * 65536 + pid well within SMI range (2^30)

  // ── WebGPU compute shader + async init ──────────────────────────────
  const WGSL_PHYSICS = `
struct Particle {
  x: f32, y: f32, vx: f32, vy: f32,
  phase: f32, alpha: f32, r: f32, age: f32,
  fadeIn: f32, life: f32, decay: f32, baseAlpha: f32,
  reactivity: f32, rippleSpeed: f32, canWhiten: f32, pid: f32,
};

struct ParticleOut {
  x: f32, y: f32, vx: f32, vy: f32,
  size: f32, alpha_out: f32,
  pid: u32, flags: u32,
};

struct Uniforms {
  time: f32,
  w: f32, h: f32,
  btnCX: f32, btnCY: f32,
  friction: f32,
  swirlForce: f32, pullForce: f32,
  forceRadius: f32,
  heroAudioPlaying: f32,
  mouseX: f32, mouseY: f32,
  mouseSwirlMix: f32,
  mouseInteractionMult: f32,
  rippleHead: u32,
  rippleInnerRadius: f32,
  heroBrightness: f32,
  seed: f32,
  particleCount: u32,
  scaleX: f32, scaleY: f32, _pad3: u32, _pad4: u32, _pad5: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> output: array<ParticleOut>;
@group(0) @binding(2) var<uniform> u: Uniforms;
@group(0) @binding(3) var<storage, read> brightnessRipple: array<f32, 512>;
@group(0) @binding(4) var<storage, read> spinRipple: array<f32, 512>;

fn hash2d(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.particleCount) { return; }

  var p = particles[i];

  // Apply resize scale (1.0 normally, != 1.0 on the frame after a resize)
  if (u.scaleX != 1.0 || u.scaleY != 1.0) {
    p.x *= u.scaleX;
    p.y *= u.scaleY;
    particles[i].x = p.x;
    particles[i].y = p.y;
  }

  // Dead particle — pass through
  if (p.life < -900.0) {
    output[i] = ParticleOut(p.x, p.y, 0.0, 0.0, 0.0, 0.0, u32(p.pid), 1u);
    return;
  }

  // Age
  p.age += 1.0;

  // Burst lifecycle
  if (p.life > 0.0) {
    p.life -= p.decay;
    if (p.life <= 0.0) {
      p.life = -999.0;
      particles[i] = p;
      output[i] = ParticleOut(p.x, p.y, 0.0, 0.0, 0.0, 0.0, u32(p.pid), 1u);
      return;
    }
    p.alpha = p.baseAlpha * p.life;
  }

  // Distance from swirl center
  let dxB = p.x - u.btnCX;
  let dyB = p.y - u.btnCY;
  let distFromBtn = sqrt(dxB * dxB + dyB * dyB);

  // Ripple-delayed audio lookup
  let delayedDist = max(0.0, distFromBtn - u.rippleInnerRadius);
  var delayFrames: i32 = 0;
  if (p.rippleSpeed > 0.0) {
    delayFrames = min(i32(delayedDist / p.rippleSpeed), 511);
  }
  let bIdx = (i32(u.rippleHead) - delayFrames + 512) % 512;
  let sIdx = bIdx; // same delay for both
  let localBrightness = brightnessRipple[bIdx];
  let localSpin = spinRipple[sIdx];

  // Radial attenuation: pow(x, 1.5) = x * sqrt(x)
  let attenuationRadius = max(u.w, u.h) * u.forceRadius;
  let radialBase = max(0.0, 1.0 - distFromBtn / attenuationRadius);
  let radialAttenuation = radialBase * sqrt(radialBase);

  // Visual calculations
  let wave = sin(u.time * 2.0 + p.phase) * 0.5 + 0.5;
  let fadeIn = select(1.0, min(1.0, p.age / p.fadeIn), p.fadeIn > 0.0);
  let react = p.reactivity;
  let br = localBrightness * radialAttenuation * react;
  let audioBoost = select(0.0, br * (0.8 + sin(u.time * 3.7 + p.phase * 2.0) * 0.3), br > 0.001);
  let rng1 = hash2d(vec2f(p.x + u.seed, p.y + u.time));
  let tremble = select(0.0, (rng1 - 0.5) * 0.12 * br, br > 0.001);
  let currentAlpha = min(1.0, (p.alpha * (0.5 + wave * 0.5) + audioBoost * 1.5 + tremble) * fadeIn * u.heroBrightness);
  let currentR = p.r * (0.8 + wave * 0.4) * (1.0 + audioBoost * 0.5);
  let currentSize = max(3.0, currentR * 6.0);

  // Position update
  p.x += p.vx;
  p.y += p.vy;

  // Audio swirl forces
  let dist = max(distFromBtn, 1.0);
  let proximity = max(0.0, 1.0 - dist / attenuationRadius);

  if (localSpin > 0.01 && proximity > 0.0) {
    let nx = dxB / dist;
    let ny = dyB / dist;
    let swirlStr = localSpin * proximity * u.swirlForce;
    p.vx += -ny * swirlStr;
    p.vy += nx * swirlStr;
    let pull = localSpin * proximity * u.pullForce;
    p.vx -= nx * pull;
    p.vy -= ny * pull;
    let jit = react * 0.25 * localSpin;
    let rng2 = hash2d(vec2f(p.y + u.seed * 2.0, p.x + u.time));
    let rng3 = hash2d(vec2f(p.x * 1.3 + u.seed, p.y * 0.7 + u.time));
    p.vx += (rng2 - 0.5) * jit;
    p.vy += (rng3 - 0.5) * jit;
  }

  // Spread when quiet and not playing
  if (localSpin < 0.5 && localSpin > 0.001 && u.heroAudioPlaying < 0.5 && dist > 1.0) {
    let nx = dxB / dist;
    let ny = dyB / dist;
    let spread = (0.5 - localSpin) * 0.008;
    p.vx += nx * spread;
    p.vy += ny * spread;
  }

  // Mouse attraction/swirl
  if (u.mouseSwirlMix > 0.001) {
    let dmx = u.mouseX - p.x;
    let dmy = u.mouseY - p.y;
    let d2 = dmx * dmx + dmy * dmy;
    if (d2 < 336400.0) {
      let mdist = sqrt(d2);
      let mprox = 1.0 - mdist / 580.0;
      let force = mprox * 0.00006 * u.mouseSwirlMix * u.mouseInteractionMult;
      let swirl = mprox * 0.00008 * u.mouseSwirlMix * u.mouseInteractionMult;
      p.vx += dmx * force + dmy * swirl;
      p.vy += dmy * force + (-dmx) * swirl;
    }
  }

  // Friction
  p.vx *= u.friction;
  p.vy *= u.friction;

  // Edge wrapping
  var wrapped = false;
  if (p.x < 0.0) { p.x = u.w; wrapped = true; }
  else if (p.x > u.w) { p.x = 0.0; wrapped = true; }
  if (p.y < 0.0) { p.y = 0.0; p.x = u.w - p.x; p.vy = abs(p.vy); wrapped = true; }
  else if (p.y > u.h) { p.y = u.h; p.x = u.w - p.x; p.vy = -abs(p.vy); wrapped = true; }

  // Write back updated state
  particles[i] = p;

  // Build flags: bit 0 = dead, bit 1 = burst, bit 2 = canWhiten, bit 3 = wrapped
  var flags = 0u;
  if (p.life < -900.0) { flags |= 1u; }
  if (p.life > 0.0) { flags |= 2u; }
  if (p.canWhiten > 0.5) { flags |= 4u; }
  if (wrapped) { flags |= 8u; }

  output[i] = ParticleOut(p.x, p.y, p.vx, p.vy, currentSize, currentAlpha, u32(p.pid), flags);
}
`;

  // ── f16 variant of the compute shader (40-byte Particle, 24-byte ParticleOut) ─
  const WGSL_PHYSICS_F16 = `
enable f16;

struct Particle {
  x: f32, y: f32,
  pid_bits: u32,
  vx: f16, vy: f16,
  phase: f16, alpha: f16,
  r: f16, age: f16,
  fadeIn: f16, life: f16,
  decay: f16, baseAlpha: f16,
  reactivity: f16, rippleSpeed: f16,
  canWhiten: f16, _pad: f16,
};

struct ParticleOut {
  x: f32, y: f32,
  vx: f16, vy: f16,
  size: f16, alpha_out: f16,
  pid: u32, flags: u32,
};

struct Uniforms {
  time: f32,
  w: f32, h: f32,
  btnCX: f32, btnCY: f32,
  friction: f32,
  swirlForce: f32, pullForce: f32,
  forceRadius: f32,
  heroAudioPlaying: f32,
  mouseX: f32, mouseY: f32,
  mouseSwirlMix: f32,
  mouseInteractionMult: f32,
  rippleHead: u32,
  rippleInnerRadius: f32,
  heroBrightness: f32,
  seed: f32,
  particleCount: u32,
  scaleX: f32, scaleY: f32, _pad3: u32, _pad4: u32, _pad5: u32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> output: array<ParticleOut>;
@group(0) @binding(2) var<uniform> u: Uniforms;
@group(0) @binding(3) var<storage, read> brightnessRipple: array<f32, 512>;
@group(0) @binding(4) var<storage, read> spinRipple: array<f32, 512>;

fn hash2d(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.particleCount) { return; }

  var p = particles[i];

  // Apply resize scale (1.0 normally, != 1.0 on the frame after a resize)
  if (u.scaleX != 1.0 || u.scaleY != 1.0) {
    p.x *= u.scaleX;
    p.y *= u.scaleY;
    particles[i].x = p.x;
    particles[i].y = p.y;
  }

  // Promote f16 fields to f32 for math
  var vx = f32(p.vx);
  var vy = f32(p.vy);
  var phase = f32(p.phase);
  var alpha = f32(p.alpha);
  var r = f32(p.r);
  var age = f32(p.age);
  var fadeInVal = f32(p.fadeIn);
  var life = f32(p.life);
  var decay = f32(p.decay);
  var baseAlpha = f32(p.baseAlpha);
  var reactivity = f32(p.reactivity);
  var rippleSpeed = f32(p.rippleSpeed);
  var canWhiten = f32(p.canWhiten);
  var pid = f32(p.pid_bits);

  // Dead particle — pass through
  if (life < -900.0) {
    output[i] = ParticleOut(p.x, p.y, f16(0.0), f16(0.0), f16(0.0), f16(0.0), p.pid_bits, 1u);
    return;
  }

  // Age
  age += 1.0;

  // Burst lifecycle
  if (life > 0.0) {
    life -= decay;
    if (life <= 0.0) {
      life = -999.0;
      p.age = f16(age); p.life = f16(life);
      p.vx = f16(vx); p.vy = f16(vy);
      particles[i] = p;
      output[i] = ParticleOut(p.x, p.y, f16(0.0), f16(0.0), f16(0.0), f16(0.0), p.pid_bits, 1u);
      return;
    }
    alpha = baseAlpha * life;
  }

  // Distance from swirl center
  let dxB = p.x - u.btnCX;
  let dyB = p.y - u.btnCY;
  let distFromBtn = sqrt(dxB * dxB + dyB * dyB);

  // Ripple-delayed audio lookup
  let delayedDist = max(0.0, distFromBtn - u.rippleInnerRadius);
  var delayFrames: i32 = 0;
  if (rippleSpeed > 0.0) {
    delayFrames = min(i32(delayedDist / rippleSpeed), 511);
  }
  let bIdx = (i32(u.rippleHead) - delayFrames + 512) % 512;
  let sIdx = bIdx;
  let localBrightness = brightnessRipple[bIdx];
  let localSpin = spinRipple[sIdx];

  // Radial attenuation: pow(x, 1.5) = x * sqrt(x)
  let attenuationRadius = max(u.w, u.h) * u.forceRadius;
  let radialBase = max(0.0, 1.0 - distFromBtn / attenuationRadius);
  let radialAttenuation = radialBase * sqrt(radialBase);

  // Visual calculations
  let wave = sin(u.time * 2.0 + phase) * 0.5 + 0.5;
  let fadeIn = select(1.0, min(1.0, age / fadeInVal), fadeInVal > 0.0);
  let react = reactivity;
  let br = localBrightness * radialAttenuation * react;
  let audioBoost = select(0.0, br * (0.8 + sin(u.time * 3.7 + phase * 2.0) * 0.3), br > 0.001);
  let rng1 = hash2d(vec2f(p.x + u.seed, p.y + u.time));
  let tremble = select(0.0, (rng1 - 0.5) * 0.12 * br, br > 0.001);
  let currentAlpha = min(1.0, (alpha * (0.5 + wave * 0.5) + audioBoost * 1.5 + tremble) * fadeIn * u.heroBrightness);
  let currentR = r * (0.8 + wave * 0.4) * (1.0 + audioBoost * 0.5);
  let currentSize = max(3.0, currentR * 6.0);

  // Position update
  p.x += vx;
  p.y += vy;

  // Audio swirl forces
  let dist = max(distFromBtn, 1.0);
  let proximity = max(0.0, 1.0 - dist / attenuationRadius);

  if (localSpin > 0.01 && proximity > 0.0) {
    let nx = dxB / dist;
    let ny = dyB / dist;
    let swirlStr = localSpin * proximity * u.swirlForce;
    vx += -ny * swirlStr;
    vy += nx * swirlStr;
    let pull = localSpin * proximity * u.pullForce;
    vx -= nx * pull;
    vy -= ny * pull;
    let jit = react * 0.25 * localSpin;
    let rng2 = hash2d(vec2f(p.y + u.seed * 2.0, p.x + u.time));
    let rng3 = hash2d(vec2f(p.x * 1.3 + u.seed, p.y * 0.7 + u.time));
    vx += (rng2 - 0.5) * jit;
    vy += (rng3 - 0.5) * jit;
  }

  // Spread when quiet and not playing
  if (localSpin < 0.5 && localSpin > 0.001 && u.heroAudioPlaying < 0.5 && dist > 1.0) {
    let nx = dxB / dist;
    let ny = dyB / dist;
    let spread = (0.5 - localSpin) * 0.008;
    vx += nx * spread;
    vy += ny * spread;
  }

  // Mouse attraction/swirl
  if (u.mouseSwirlMix > 0.001) {
    let dmx = u.mouseX - p.x;
    let dmy = u.mouseY - p.y;
    let d2 = dmx * dmx + dmy * dmy;
    if (d2 < 336400.0) {
      let mdist = sqrt(d2);
      let mprox = 1.0 - mdist / 580.0;
      let force = mprox * 0.00006 * u.mouseSwirlMix * u.mouseInteractionMult;
      let swirl = mprox * 0.00008 * u.mouseSwirlMix * u.mouseInteractionMult;
      vx += dmx * force + dmy * swirl;
      vy += dmy * force + (-dmx) * swirl;
    }
  }

  // Friction
  vx *= u.friction;
  vy *= u.friction;

  // Edge wrapping
  var wrapped = false;
  if (p.x < 0.0) { p.x = u.w; wrapped = true; }
  else if (p.x > u.w) { p.x = 0.0; wrapped = true; }
  if (p.y < 0.0) { p.y = 0.0; p.x = u.w - p.x; vy = abs(vy); wrapped = true; }
  else if (p.y > u.h) { p.y = u.h; p.x = u.w - p.x; vy = -abs(vy); wrapped = true; }

  // Write back updated state
  p.vx = f16(vx); p.vy = f16(vy);
  p.phase = f16(phase); p.alpha = f16(alpha);
  p.r = f16(r); p.age = f16(age);
  p.fadeIn = f16(fadeInVal); p.life = f16(life);
  p.decay = f16(decay); p.baseAlpha = f16(baseAlpha);
  p.reactivity = f16(reactivity); p.rippleSpeed = f16(rippleSpeed);
  p.canWhiten = f16(canWhiten);
  particles[i] = p;

  // Build flags: bit 0 = dead, bit 1 = burst, bit 2 = canWhiten, bit 3 = wrapped
  var flags = 0u;
  if (life < -900.0) { flags |= 1u; }
  if (life > 0.0) { flags |= 2u; }
  if (canWhiten > 0.5) { flags |= 4u; }
  if (wrapped) { flags |= 8u; }

  output[i] = ParticleOut(p.x, p.y, f16(vx), f16(vy), f16(currentSize), f16(currentAlpha), p.pid_bits, flags);
}
`;

  // ── Connection compute shader (grid + search + fade) ─────────────────
  function makeConnWGSL(hasF16, packed) {
    const pOutStruct = hasF16 ? `
struct POut {
  x: f32, y: f32,
  vx: f16, vy: f16,
  size: f16, alpha_out: f16,
  pid: u32, flags: u32,
};` : `
struct POut {
  x: f32, y: f32, vx: f32, vy: f32,
  size: f32, alpha_out: f32,
  pid: u32, flags: u32,
};`;

    // ── Packed tier: 8 storage + 1 uniform in single bind group ──────
    // gridData = gridCounts[0..255] + gridOffsets[256..511]
    // auxCounters = connAtomics[0..1] + lineIndirect[2..5]
    // auxPool = connFreeList[0..MAX_CONN_SLOTS-1] + neighborCount[MAX_CONN_SLOTS..]
    if (packed) {
      return `${hasF16 ? 'enable f16;\n' : ''}
${pOutStruct}

struct Connection {
  pidA: u32, pidB: u32,
  alpha: f32, tgt: f32,
  idxA: u32, idxB: u32,
  state: u32, _pad: u32,
  frozenAx: f32, frozenAy: f32,
  frozenBx: f32, frozenBy: f32,
};

struct ConnUniforms {
  connReachSq: f32,
  connFadeStartSq: f32,
  connBucketDiv: f32,
  maxConn: u32,
  connFadeIn: f32,
  connFadeOut: f32,
  connKillAlpha: f32,
  doSearch: u32,
  lineIntensity: f32,
  heroBrightness: f32,
  gridCols: u32,
  gridRows: u32,
  cellSize: f32,
  particleCount: u32,
  maxConnSlots: u32,
  lineBase: f32,
  superConn: u32, _pad1: u32,
  _pad2: u32, _pad3: u32,
};

@group(0) @binding(0) var<storage, read> pOut: array<POut>;
@group(0) @binding(1) var<storage, read_write> connPool: array<Connection>;
@group(0) @binding(2) var<storage, read_write> hashTable: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> gridData: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> gridIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> renderLines: array<${hasF16 ? 'f16' : 'f32'}>;
@group(0) @binding(6) var<storage, read_write> auxCounters: array<atomic<u32>>;
@group(0) @binding(7) var<uniform> cu: ConnUniforms;
@group(0) @binding(8) var<storage, read_write> auxPool: array<atomic<u32>>;

const GRID_OFF: u32 = ${MAX_GRID_CELLS}u; // gridOffsets start at gridData[256]
const NCNT_OFF: u32 = ${MAX_CONN_SLOTS}u; // neighborCount starts at auxPool[30000]
const CCNT_OFF: u32 = ${MAX_CONN_SLOTS}u + ${BUFFER_CAP}u; // candCount starts after neighborCount
const COTHER_OFF: u32 = ${MAX_CONN_SLOTS}u + ${BUFFER_CAP * 2}u; // candOther[MAX_CAND per particle]
const CD2_OFF: u32 = ${MAX_CONN_SLOTS}u + ${BUFFER_CAP * 2}u + ${BUFFER_CAP * 8}u; // candD2
const CALPHA_OFF: u32 = ${MAX_CONN_SLOTS}u + ${BUFFER_CAP * 2}u + ${BUFFER_CAP * 16}u; // candAlpha
const MAX_CAND: u32 = 8u;
const HASH_SIZE: u32 = 65536u;
const HASH_MASK: u32 = 65535u;
const EMPTY: u32 = 0xFFFFFFFFu;
const TOMBSTONE: u32 = 0xFFFFFFFEu;
const MAX_PROBE: u32 = 32u;

fn hashKey(pidA: u32, pidB: u32) -> u32 {
  let lo = min(pidA, pidB);
  let hi = max(pidA, pidB);
  let key = lo * 65536u + hi;
  var h = key;
  h ^= h >> 16u;
  h *= 0x45d9f3bu;
  h ^= h >> 16u;
  return h & HASH_MASK;
}

fn canonKey(pidA: u32, pidB: u32) -> u32 {
  return min(pidA, pidB) * 65536u + max(pidA, pidB);
}

fn cellKey(x: f32, y: f32) -> u32 {
  let cx = u32(max(0.0, x) / cu.cellSize);
  let cy = u32(max(0.0, y) / cu.cellSize);
  let cxc = min(cx, cu.gridCols - 1u);
  let cyc = min(cy, cu.gridRows - 1u);
  return cxc + cyc * cu.gridCols;
}

@compute @workgroup_size(256)
fn gridClear(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i < ${MAX_GRID_CELLS}u) {
    atomicStore(&gridData[i], 0u);
    atomicStore(&gridData[i + GRID_OFF], 0u);
  }
  if (i < cu.particleCount) {
    atomicStore(&auxPool[i + NCNT_OFF], 0u);
    atomicStore(&auxPool[i + CCNT_OFF], 0u);
  }
}

@compute @workgroup_size(256)
fn gridCount(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flags = pOut[i].flags;
  if ((flags & 1u) != 0u) { return; }
  let ck = cellKey(pOut[i].x, pOut[i].y);
  atomicAdd(&gridData[ck], 1u);
}

var<workgroup> prefixShared: array<u32, 256>;

@compute @workgroup_size(256)
fn gridPrefixSum(@builtin(local_invocation_id) lid: vec3u) {
  let i = lid.x;
  prefixShared[i] = select(0u, atomicLoad(&gridData[i]), i < ${MAX_GRID_CELLS}u);
  workgroupBarrier();

  for (var stride = 1u; stride < 256u; stride <<= 1u) {
    var val = 0u;
    if (i >= stride) {
      val = prefixShared[i - stride];
    }
    workgroupBarrier();
    prefixShared[i] += val;
    workgroupBarrier();
  }

  if (i < ${MAX_GRID_CELLS}u) {
    atomicStore(&gridData[i + GRID_OFF], select(0u, prefixShared[i - 1u], i > 0u));
    atomicStore(&gridData[i], 0u);
  }
}

@compute @workgroup_size(256)
fn gridScatter(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flags = pOut[i].flags;
  if ((flags & 1u) != 0u) { return; }
  let ck = cellKey(pOut[i].x, pOut[i].y);
  let slot = atomicLoad(&gridData[ck + GRID_OFF]) + atomicAdd(&gridData[ck], 1u);
  gridIndices[slot] = i;
}

@compute @workgroup_size(256)
fn buildFreeList(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.maxConnSlots) { return; }
  if (connPool[i].state == 0u) {
    let idx = atomicAdd(&auxCounters[1], 1u);
    atomicStore(&auxPool[idx], i);
  }
}

@compute @workgroup_size(256)
fn connSearch(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flagsI = pOut[i].flags;
  if ((flagsI & 1u) != 0u) { return; }
  let xi = pOut[i].x;
  let yi = pOut[i].y;
  let pidI = pOut[i].pid;
  let isBurstI = (flagsI & 2u) != 0u;
  let cxi = u32(max(0.0, xi) / cu.cellSize);
  let cyi = u32(max(0.0, yi) / cu.cellSize);

  let aiBrightBoost = 1.0 + cu.lineIntensity * 2.0;
  // SuperConn: cache i's count once (like the old CPU bug that created super-connectors)
  let iCountCached = atomicLoad(&auxPool[i + NCNT_OFF]);

  for (var dy: i32 = -1; dy <= 1; dy++) {
    for (var dx: i32 = -1; dx <= 1; dx++) {
      let nx = i32(cxi) + dx;
      let ny = i32(cyi) + dy;
      if (nx < 0 || ny < 0 || u32(nx) >= cu.gridCols || u32(ny) >= cu.gridRows) { continue; }
      let nk = u32(nx) + u32(ny) * cu.gridCols;
      let cellStart = atomicLoad(&gridData[nk + GRID_OFF]);
      let cellEnd = cellStart + atomicLoad(&gridData[nk]);
      for (var jj = cellStart; jj < cellEnd; jj++) {
        let j = gridIndices[jj];
        if (j <= i) { continue; }
        let flagsJ = pOut[j].flags;
        if ((flagsJ & 1u) != 0u) { continue; }
        if (isBurstI && (flagsJ & 2u) != 0u) { continue; }
        let iCount = select(atomicLoad(&auxPool[i + NCNT_OFF]), iCountCached, cu.superConn == 1u);
        if (iCount >= cu.maxConn || atomicLoad(&auxPool[j + NCNT_OFF]) >= cu.maxConn) { continue; }
        let ddx = xi - pOut[j].x;
        let ddy = yi - pOut[j].y;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 >= cu.connReachSq) { continue; }

        let bucket = min(u32(d2 / cu.connBucketDiv), 4u);
        let bucketMult = array<f32, 5>(1.0, 0.8, 0.6, 0.4, 0.2);
        let edgeFade = select(1.0 - (d2 - cu.connFadeStartSq) / (cu.connReachSq - cu.connFadeStartSq), 1.0, d2 < cu.connFadeStartSq);
        let targetAlpha = cu.lineBase * bucketMult[bucket] * edgeFade * aiBrightBoost * cu.heroBrightness;

        let pidJ = pOut[j].pid;
        let ck = canonKey(pidI, pidJ);
        let h = hashKey(pidI, pidJ);

        var found = false;
        for (var probe = 0u; probe < MAX_PROBE; probe++) {
          let slot = (h + probe) & HASH_MASK;
          let stored = atomicLoad(&hashTable[slot * 2u]);
          if (stored == ck) {
            let poolIdx = atomicLoad(&hashTable[slot * 2u + 1u]);
            connPool[poolIdx].tgt = targetAlpha;
            connPool[poolIdx].idxA = select(j, i, pidI < pidJ);
            connPool[poolIdx].idxB = select(i, j, pidI < pidJ);
            connPool[poolIdx].state = 3u;
            found = true;
            break;
          }
          if (stored == EMPTY) { break; }
          // TOMBSTONE: keep probing (don't break)
        }

        if (!found) {
          let freeIdx = atomicSub(&auxCounters[1], 1u);
          if (freeIdx == 0u || freeIdx > cu.maxConnSlots) {
            atomicAdd(&auxCounters[1], 1u);
            continue;
          }
          let poolSlot = atomicLoad(&auxPool[freeIdx - 1u]);

          connPool[poolSlot].pidA = min(pidI, pidJ);
          connPool[poolSlot].pidB = max(pidI, pidJ);
          connPool[poolSlot].alpha = 0.0;
          connPool[poolSlot].tgt = targetAlpha;
          connPool[poolSlot].idxA = select(j, i, pidI < pidJ);
          connPool[poolSlot].idxB = select(i, j, pidI < pidJ);
          connPool[poolSlot].state = 3u;
          connPool[poolSlot]._pad = 0u;
          connPool[poolSlot].frozenAx = 0.0;
          connPool[poolSlot].frozenAy = 0.0;
          connPool[poolSlot].frozenBx = 0.0;
          connPool[poolSlot].frozenBy = 0.0;

          var inserted = false;
          for (var probe = 0u; probe < MAX_PROBE; probe++) {
            let slot = (h + probe) & HASH_MASK;
            // Try to claim EMPTY slot
            var old = atomicCompareExchangeWeak(&hashTable[slot * 2u], EMPTY, ck);
            if (!old.exchanged) {
              // Try to reclaim TOMBSTONE slot
              old = atomicCompareExchangeWeak(&hashTable[slot * 2u], TOMBSTONE, ck);
            }
            if (old.exchanged) {
              atomicStore(&hashTable[slot * 2u + 1u], poolSlot);
              inserted = true;
              break;
            }
            if (old.old_value == ck) {
              connPool[poolSlot].state = 0u;
              let existPoolIdx = atomicLoad(&hashTable[slot * 2u + 1u]);
              connPool[existPoolIdx].tgt = targetAlpha;
              connPool[existPoolIdx].state = 3u;
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            connPool[poolSlot].state = 0u;
          }
        }

        atomicAdd(&auxPool[i + NCNT_OFF], 1u);
        atomicAdd(&auxPool[j + NCNT_OFF], 1u);
      }
    }
  }
}

// ── Gather-then-select: two-pass connection search ──────────────────
// Pass 1: gather ALL candidate pairs per particle (no MAX_CONN check, no hash)
@compute @workgroup_size(256)
fn connGather(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flagsI = pOut[i].flags;
  if ((flagsI & 1u) != 0u) { return; }
  let xi = pOut[i].x;
  let yi = pOut[i].y;
  let pidI = pOut[i].pid;
  let isBurstI = (flagsI & 2u) != 0u;
  let cxi = u32(max(0.0, xi) / cu.cellSize);
  let cyi = u32(max(0.0, yi) / cu.cellSize);

  let aiBrightBoost = 1.0 + cu.lineIntensity * 2.0;

  for (var dy: i32 = -1; dy <= 1; dy++) {
    for (var dx: i32 = -1; dx <= 1; dx++) {
      let nx = i32(cxi) + dx;
      let ny = i32(cyi) + dy;
      if (nx < 0 || ny < 0 || u32(nx) >= cu.gridCols || u32(ny) >= cu.gridRows) { continue; }
      let nk = u32(nx) + u32(ny) * cu.gridCols;
      let cellStart = atomicLoad(&gridData[nk + GRID_OFF]);
      let cellEnd = cellStart + atomicLoad(&gridData[nk]);
      for (var jj = cellStart; jj < cellEnd; jj++) {
        let j = gridIndices[jj];
        if (j <= i) { continue; }
        let flagsJ = pOut[j].flags;
        if ((flagsJ & 1u) != 0u) { continue; }
        if (isBurstI && (flagsJ & 2u) != 0u) { continue; }
        let ddx = xi - pOut[j].x;
        let ddy = yi - pOut[j].y;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 >= cu.connReachSq) { continue; }

        let bucket = min(u32(d2 / cu.connBucketDiv), 4u);
        let bucketMult = array<f32, 5>(1.0, 0.8, 0.6, 0.4, 0.2);
        let edgeFade = select(1.0 - (d2 - cu.connFadeStartSq) / (cu.connReachSq - cu.connFadeStartSq), 1.0, d2 < cu.connFadeStartSq);
        let targetAlpha = cu.lineBase * bucketMult[bucket] * edgeFade * aiBrightBoost * cu.heroBrightness;

        // Write candidate to particle i's list
        let ci = atomicAdd(&auxPool[i + CCNT_OFF], 1u);
        if (ci < MAX_CAND) {
          atomicStore(&auxPool[i * MAX_CAND + ci + COTHER_OFF], j);
          atomicStore(&auxPool[i * MAX_CAND + ci + CD2_OFF], bitcast<u32>(d2));
          atomicStore(&auxPool[i * MAX_CAND + ci + CALPHA_OFF], bitcast<u32>(targetAlpha));
        }

        // Write candidate to particle j's list
        let cj = atomicAdd(&auxPool[j + CCNT_OFF], 1u);
        if (cj < MAX_CAND) {
          atomicStore(&auxPool[j * MAX_CAND + cj + COTHER_OFF], i);
          atomicStore(&auxPool[j * MAX_CAND + cj + CD2_OFF], bitcast<u32>(d2));
          atomicStore(&auxPool[j * MAX_CAND + cj + CALPHA_OFF], bitcast<u32>(targetAlpha));
        }
      }
    }
  }
}

// Pass 2: per-particle, sort candidates by distance, keep closest MAX_CONN
@compute @workgroup_size(256)
fn connSelect(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flagsI = pOut[i].flags;
  if ((flagsI & 1u) != 0u) { return; }
  let pidI = pOut[i].pid;

  let rawCount = atomicLoad(&auxPool[i + CCNT_OFF]);
  let count = min(rawCount, MAX_CAND);

  // Load candidates into local arrays
  var cOther: array<u32, 8>;
  var cD2: array<f32, 8>;
  var cAlpha: array<f32, 8>;
  for (var k = 0u; k < count; k++) {
    cOther[k] = atomicLoad(&auxPool[i * MAX_CAND + k + COTHER_OFF]);
    cD2[k] = bitcast<f32>(atomicLoad(&auxPool[i * MAX_CAND + k + CD2_OFF]));
    cAlpha[k] = bitcast<f32>(atomicLoad(&auxPool[i * MAX_CAND + k + CALPHA_OFF]));
  }

  // Insertion sort by d2 ascending
  for (var a = 1u; a < count; a++) {
    let tmpO = cOther[a]; let tmpD = cD2[a]; let tmpA = cAlpha[a];
    var b = a;
    while (b > 0u && cD2[b - 1u] > tmpD) {
      cOther[b] = cOther[b - 1u]; cD2[b] = cD2[b - 1u]; cAlpha[b] = cAlpha[b - 1u];
      b--;
    }
    cOther[b] = tmpO; cD2[b] = tmpD; cAlpha[b] = tmpA;
  }

  // Take closest MAX_CONN candidates
  let take = min(count, cu.maxConn);
  for (var k = 0u; k < take; k++) {
    let j = cOther[k];
    let targetAlpha = cAlpha[k];
    let pidJ = pOut[j].pid;
    let ck = canonKey(pidI, pidJ);
    let h = hashKey(pidI, pidJ);

    // Hash lookup: update existing or allocate new
    var found = false;
    for (var probe = 0u; probe < MAX_PROBE; probe++) {
      let slot = (h + probe) & HASH_MASK;
      let stored = atomicLoad(&hashTable[slot * 2u]);
      if (stored == ck) {
        let poolIdx = atomicLoad(&hashTable[slot * 2u + 1u]);
        connPool[poolIdx].tgt = targetAlpha;
        connPool[poolIdx].idxA = select(j, i, pidI < pidJ);
        connPool[poolIdx].idxB = select(i, j, pidI < pidJ);
        connPool[poolIdx].state = 3u;
        found = true;
        break;
      }
      if (stored == EMPTY) { break; }
    }

    if (!found) {
      let freeIdx = atomicSub(&auxCounters[1], 1u);
      if (freeIdx == 0u || freeIdx > cu.maxConnSlots) {
        atomicAdd(&auxCounters[1], 1u);
        continue;
      }
      let poolSlot = atomicLoad(&auxPool[freeIdx - 1u]);

      connPool[poolSlot].pidA = min(pidI, pidJ);
      connPool[poolSlot].pidB = max(pidI, pidJ);
      connPool[poolSlot].alpha = 0.0;
      connPool[poolSlot].tgt = targetAlpha;
      connPool[poolSlot].idxA = select(j, i, pidI < pidJ);
      connPool[poolSlot].idxB = select(i, j, pidI < pidJ);
      connPool[poolSlot].state = 3u;
      connPool[poolSlot]._pad = 0u;
      connPool[poolSlot].frozenAx = 0.0;
      connPool[poolSlot].frozenAy = 0.0;
      connPool[poolSlot].frozenBx = 0.0;
      connPool[poolSlot].frozenBy = 0.0;

      var inserted = false;
      for (var probe = 0u; probe < MAX_PROBE; probe++) {
        let slot = (h + probe) & HASH_MASK;
        var old = atomicCompareExchangeWeak(&hashTable[slot * 2u], EMPTY, ck);
        if (!old.exchanged) {
          old = atomicCompareExchangeWeak(&hashTable[slot * 2u], TOMBSTONE, ck);
        }
        if (old.exchanged) {
          atomicStore(&hashTable[slot * 2u + 1u], poolSlot);
          inserted = true;
          break;
        }
        if (old.old_value == ck) {
          // Race: another thread just inserted this pair — free our duplicate
          connPool[poolSlot].state = 0u;
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        connPool[poolSlot].state = 0u;
      }
    }

    atomicAdd(&auxPool[i + NCNT_OFF], 1u);
  }
}

@compute @workgroup_size(256)
fn connFade(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.maxConnSlots) { return; }
  var c = connPool[i];
  if (c.state == 0u) { return; }

  if (cu.doSearch == 1u && c.state == 1u) {
    c.tgt = 0.0;
  }
  if (c.state == 3u) {
    c.state = 1u;
  }

  if (c.state == 1u) {
    let flagsA = pOut[c.idxA].flags;
    let flagsB = pOut[c.idxB].flags;
    let deadA = (flagsA & 1u) != 0u;
    let deadB = (flagsB & 1u) != 0u;
    let wrappedA = (flagsA & 8u) != 0u;
    let wrappedB = (flagsB & 8u) != 0u;

    if (wrappedA || wrappedB) {
      let ck = canonKey(c.pidA, c.pidB);
      let h = hashKey(c.pidA, c.pidB);
      for (var probe = 0u; probe < MAX_PROBE; probe++) {
        let slot = (h + probe) & HASH_MASK;
        let stored = atomicLoad(&hashTable[slot * 2u]);
        if (stored == ck) {
          atomicStore(&hashTable[slot * 2u], TOMBSTONE);
          break;
        }
        if (stored == EMPTY) { break; }
        // TOMBSTONE: keep probing
      }
      c.state = 0u;
      connPool[i] = c;
      return;
    }

    if (deadA || deadB) {
      c.frozenAx = pOut[c.idxA].x;
      c.frozenAy = pOut[c.idxA].y;
      c.frozenBx = pOut[c.idxB].x;
      c.frozenBy = pOut[c.idxB].y;
      c.state = 2u;
      c.tgt = 0.0;
    }
  }

  let rate = select(cu.connFadeOut, cu.connFadeIn, c.tgt > c.alpha);
  c.alpha += (c.tgt - c.alpha) * rate;

  if (c.alpha < cu.connKillAlpha && c.tgt == 0.0) {
    let ck = canonKey(c.pidA, c.pidB);
    let h = hashKey(c.pidA, c.pidB);
    for (var probe = 0u; probe < MAX_PROBE; probe++) {
      let slot = (h + probe) & HASH_MASK;
      let stored = atomicLoad(&hashTable[slot * 2u]);
      if (stored == ck) {
        atomicStore(&hashTable[slot * 2u], TOMBSTONE);
        break;
      }
      if (stored == EMPTY) { break; }
      // TOMBSTONE: keep probing
    }
    c.state = 0u;
    connPool[i] = c;
    return;
  }

  var ax: f32; var ay: f32; var bx: f32; var by: f32;
  if (c.state == 2u) {
    ax = c.frozenAx; ay = c.frozenAy;
    bx = c.frozenBx; by = c.frozenBy;
  } else {
    ax = pOut[c.idxA].x; ay = pOut[c.idxA].y;
    bx = pOut[c.idxB].x; by = pOut[c.idxB].y;
  }

  let ldx = ax - bx;
  let ldy = ay - by;
  let curD2 = ldx * ldx + ldy * ldy;

  // Kill cross-screen lines (wrap artifact)
  if (curD2 > cu.connReachSq * 4.0) {
    c.state = 0u;
    connPool[i] = c;
    return;
  }

  let lineIdx = atomicAdd(&auxCounters[0], 1u);
  let off = lineIdx * 6u;
  renderLines[off + 0u] = ${hasF16 ? 'f16(ax)' : 'ax'};
  renderLines[off + 1u] = ${hasF16 ? 'f16(ay)' : 'ay'};
  renderLines[off + 2u] = ${hasF16 ? 'f16(c.alpha)' : 'c.alpha'};
  renderLines[off + 3u] = ${hasF16 ? 'f16(bx)' : 'bx'};
  renderLines[off + 4u] = ${hasF16 ? 'f16(by)' : 'by'};
  renderLines[off + 5u] = ${hasF16 ? 'f16(c.alpha)' : 'c.alpha'};

  connPool[i] = c;
}

@compute @workgroup_size(1)
fn writeIndirect() {
  let lineCount = atomicLoad(&auxCounters[0]);
  atomicStore(&auxCounters[2], lineCount * 2u); // vertex count
  atomicStore(&auxCounters[3], 1u);             // instance count
  atomicStore(&auxCounters[4], 0u);             // first vertex
  atomicStore(&auxCounters[5], 0u);             // first instance
}

`;
    }

    // ── Enhanced tier: unpacked, 11 storage + 1 uniform across 2 groups ──
    return `${hasF16 ? 'enable f16;\n' : ''}
${pOutStruct}

struct Connection {
  pidA: u32, pidB: u32,
  alpha: f32, tgt: f32,
  idxA: u32, idxB: u32,
  state: u32, _pad: u32,
  frozenAx: f32, frozenAy: f32,
  frozenBx: f32, frozenBy: f32,
};

struct ConnUniforms {
  connReachSq: f32,
  connFadeStartSq: f32,
  connBucketDiv: f32,
  maxConn: u32,
  connFadeIn: f32,
  connFadeOut: f32,
  connKillAlpha: f32,
  doSearch: u32,
  lineIntensity: f32,
  heroBrightness: f32,
  gridCols: u32,
  gridRows: u32,
  cellSize: f32,
  particleCount: u32,
  maxConnSlots: u32,
  lineBase: f32,
  superConn: u32, _pad1: u32,
  _pad2: u32, _pad3: u32,
};

@group(0) @binding(0) var<storage, read> pOut: array<POut>;
@group(0) @binding(1) var<storage, read_write> connPool: array<Connection>;
@group(0) @binding(2) var<storage, read_write> hashTable: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> gridCounts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> gridOffsets: array<u32>;
@group(0) @binding(5) var<storage, read_write> gridIndices: array<u32>;
@group(0) @binding(6) var<storage, read_write> connAtomics: array<atomic<u32>>;
@group(0) @binding(7) var<uniform> cu: ConnUniforms;
@group(1) @binding(0) var<storage, read_write> renderLines: array<${hasF16 ? 'f16' : 'f32'}>;
@group(1) @binding(1) var<storage, read_write> neighborCount: array<atomic<u32>>;
@group(1) @binding(2) var<storage, read_write> lineIndirect: array<u32>;
@group(1) @binding(3) var<storage, read_write> connFreeList: array<u32>;
@group(1) @binding(4) var<storage, read_write> candidateData: array<atomic<u32>>;

const CCNT_OFF: u32 = 0u;
const COTHER_OFF: u32 = ${BUFFER_CAP}u;
const CD2_OFF: u32 = ${BUFFER_CAP}u + ${BUFFER_CAP * 8}u;
const CALPHA_OFF: u32 = ${BUFFER_CAP}u + ${BUFFER_CAP * 16}u;
const MAX_CAND: u32 = 8u;
const HASH_SIZE: u32 = 65536u;
const HASH_MASK: u32 = 65535u;
const EMPTY: u32 = 0xFFFFFFFFu;
const TOMBSTONE: u32 = 0xFFFFFFFEu;
const MAX_PROBE: u32 = 32u;

fn hashKey(pidA: u32, pidB: u32) -> u32 {
  let lo = min(pidA, pidB);
  let hi = max(pidA, pidB);
  let key = lo * 65536u + hi;
  var h = key;
  h ^= h >> 16u;
  h *= 0x45d9f3bu;
  h ^= h >> 16u;
  return h & HASH_MASK;
}

fn canonKey(pidA: u32, pidB: u32) -> u32 {
  return min(pidA, pidB) * 65536u + max(pidA, pidB);
}

fn cellKey(x: f32, y: f32) -> u32 {
  let cx = u32(max(0.0, x) / cu.cellSize);
  let cy = u32(max(0.0, y) / cu.cellSize);
  let cxc = min(cx, cu.gridCols - 1u);
  let cyc = min(cy, cu.gridRows - 1u);
  return cxc + cyc * cu.gridCols;
}

@compute @workgroup_size(256)
fn gridClear(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i < ${MAX_GRID_CELLS}u) {
    atomicStore(&gridCounts[i], 0u);
    gridOffsets[i] = 0u;
  }
  if (i < cu.particleCount) {
    atomicStore(&neighborCount[i], 0u);
    atomicStore(&candidateData[i + CCNT_OFF], 0u);
  }
}

@compute @workgroup_size(256)
fn gridCount(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flags = pOut[i].flags;
  if ((flags & 1u) != 0u) { return; }
  let ck = cellKey(pOut[i].x, pOut[i].y);
  atomicAdd(&gridCounts[ck], 1u);
}

var<workgroup> prefixShared: array<u32, 256>;

@compute @workgroup_size(256)
fn gridPrefixSum(@builtin(local_invocation_id) lid: vec3u) {
  let i = lid.x;
  prefixShared[i] = select(0u, atomicLoad(&gridCounts[i]), i < ${MAX_GRID_CELLS}u);
  workgroupBarrier();

  for (var stride = 1u; stride < 256u; stride <<= 1u) {
    var val = 0u;
    if (i >= stride) {
      val = prefixShared[i - stride];
    }
    workgroupBarrier();
    prefixShared[i] += val;
    workgroupBarrier();
  }

  if (i < ${MAX_GRID_CELLS}u) {
    gridOffsets[i] = select(0u, prefixShared[i - 1u], i > 0u);
    atomicStore(&gridCounts[i], 0u);
  }
}

@compute @workgroup_size(256)
fn gridScatter(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flags = pOut[i].flags;
  if ((flags & 1u) != 0u) { return; }
  let ck = cellKey(pOut[i].x, pOut[i].y);
  let slot = gridOffsets[ck] + atomicAdd(&gridCounts[ck], 1u);
  gridIndices[slot] = i;
}

@compute @workgroup_size(256)
fn buildFreeList(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.maxConnSlots) { return; }
  if (connPool[i].state == 0u) {
    let idx = atomicAdd(&connAtomics[1], 1u);
    connFreeList[idx] = i;
  }
}

@compute @workgroup_size(256)
fn connSearch(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flagsI = pOut[i].flags;
  if ((flagsI & 1u) != 0u) { return; }
  let xi = pOut[i].x;
  let yi = pOut[i].y;
  let pidI = pOut[i].pid;
  let isBurstI = (flagsI & 2u) != 0u;
  let cxi = u32(max(0.0, xi) / cu.cellSize);
  let cyi = u32(max(0.0, yi) / cu.cellSize);

  let aiBrightBoost = 1.0 + cu.lineIntensity * 2.0;
  let iCountCached = atomicLoad(&neighborCount[i]);

  for (var dy: i32 = -1; dy <= 1; dy++) {
    for (var dx: i32 = -1; dx <= 1; dx++) {
      let nx = i32(cxi) + dx;
      let ny = i32(cyi) + dy;
      if (nx < 0 || ny < 0 || u32(nx) >= cu.gridCols || u32(ny) >= cu.gridRows) { continue; }
      let nk = u32(nx) + u32(ny) * cu.gridCols;
      let cellStart = gridOffsets[nk];
      let cellEnd = cellStart + atomicLoad(&gridCounts[nk]);
      for (var jj = cellStart; jj < cellEnd; jj++) {
        let j = gridIndices[jj];
        if (j <= i) { continue; }
        let flagsJ = pOut[j].flags;
        if ((flagsJ & 1u) != 0u) { continue; }
        if (isBurstI && (flagsJ & 2u) != 0u) { continue; }
        let iCount = select(atomicLoad(&neighborCount[i]), iCountCached, cu.superConn == 1u);
        if (iCount >= cu.maxConn || atomicLoad(&neighborCount[j]) >= cu.maxConn) { continue; }
        let ddx = xi - pOut[j].x;
        let ddy = yi - pOut[j].y;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 >= cu.connReachSq) { continue; }

        let bucket = min(u32(d2 / cu.connBucketDiv), 4u);
        let bucketMult = array<f32, 5>(1.0, 0.8, 0.6, 0.4, 0.2);
        let edgeFade = select(1.0 - (d2 - cu.connFadeStartSq) / (cu.connReachSq - cu.connFadeStartSq), 1.0, d2 < cu.connFadeStartSq);
        let targetAlpha = cu.lineBase * bucketMult[bucket] * edgeFade * aiBrightBoost * cu.heroBrightness;

        let pidJ = pOut[j].pid;
        let ck = canonKey(pidI, pidJ);
        let h = hashKey(pidI, pidJ);

        var found = false;
        for (var probe = 0u; probe < MAX_PROBE; probe++) {
          let slot = (h + probe) & HASH_MASK;
          let stored = atomicLoad(&hashTable[slot * 2u]);
          if (stored == ck) {
            let poolIdx = atomicLoad(&hashTable[slot * 2u + 1u]);
            connPool[poolIdx].tgt = targetAlpha;
            connPool[poolIdx].idxA = select(j, i, pidI < pidJ);
            connPool[poolIdx].idxB = select(i, j, pidI < pidJ);
            connPool[poolIdx].state = 3u;
            found = true;
            break;
          }
          if (stored == EMPTY) { break; }
          // TOMBSTONE: keep probing
        }

        if (!found) {
          let freeIdx = atomicSub(&connAtomics[1], 1u);
          if (freeIdx == 0u || freeIdx > cu.maxConnSlots) {
            atomicAdd(&connAtomics[1], 1u);
            continue;
          }
          let poolSlot = connFreeList[freeIdx - 1u];

          connPool[poolSlot].pidA = min(pidI, pidJ);
          connPool[poolSlot].pidB = max(pidI, pidJ);
          connPool[poolSlot].alpha = 0.0;
          connPool[poolSlot].tgt = targetAlpha;
          connPool[poolSlot].idxA = select(j, i, pidI < pidJ);
          connPool[poolSlot].idxB = select(i, j, pidI < pidJ);
          connPool[poolSlot].state = 3u;
          connPool[poolSlot]._pad = 0u;
          connPool[poolSlot].frozenAx = 0.0;
          connPool[poolSlot].frozenAy = 0.0;
          connPool[poolSlot].frozenBx = 0.0;
          connPool[poolSlot].frozenBy = 0.0;

          var inserted = false;
          for (var probe = 0u; probe < MAX_PROBE; probe++) {
            let slot = (h + probe) & HASH_MASK;
            // Try to claim EMPTY slot
            var old = atomicCompareExchangeWeak(&hashTable[slot * 2u], EMPTY, ck);
            if (!old.exchanged) {
              // Try to reclaim TOMBSTONE slot
              old = atomicCompareExchangeWeak(&hashTable[slot * 2u], TOMBSTONE, ck);
            }
            if (old.exchanged) {
              atomicStore(&hashTable[slot * 2u + 1u], poolSlot);
              inserted = true;
              break;
            }
            if (old.old_value == ck) {
              connPool[poolSlot].state = 0u;
              let existPoolIdx = atomicLoad(&hashTable[slot * 2u + 1u]);
              connPool[existPoolIdx].tgt = targetAlpha;
              connPool[existPoolIdx].state = 3u;
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            connPool[poolSlot].state = 0u;
          }
        }

        atomicAdd(&neighborCount[i], 1u);
        atomicAdd(&neighborCount[j], 1u);
      }
    }
  }
}

// ── Gather-then-select: two-pass connection search ──────────────────
@compute @workgroup_size(256)
fn connGather(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flagsI = pOut[i].flags;
  if ((flagsI & 1u) != 0u) { return; }
  let xi = pOut[i].x;
  let yi = pOut[i].y;
  let pidI = pOut[i].pid;
  let isBurstI = (flagsI & 2u) != 0u;
  let cxi = u32(max(0.0, xi) / cu.cellSize);
  let cyi = u32(max(0.0, yi) / cu.cellSize);

  let aiBrightBoost = 1.0 + cu.lineIntensity * 2.0;

  for (var dy: i32 = -1; dy <= 1; dy++) {
    for (var dx: i32 = -1; dx <= 1; dx++) {
      let nx = i32(cxi) + dx;
      let ny = i32(cyi) + dy;
      if (nx < 0 || ny < 0 || u32(nx) >= cu.gridCols || u32(ny) >= cu.gridRows) { continue; }
      let nk = u32(nx) + u32(ny) * cu.gridCols;
      let cellStart = gridOffsets[nk];
      let cellEnd = cellStart + atomicLoad(&gridCounts[nk]);
      for (var jj = cellStart; jj < cellEnd; jj++) {
        let j = gridIndices[jj];
        if (j <= i) { continue; }
        let flagsJ = pOut[j].flags;
        if ((flagsJ & 1u) != 0u) { continue; }
        if (isBurstI && (flagsJ & 2u) != 0u) { continue; }
        let ddx = xi - pOut[j].x;
        let ddy = yi - pOut[j].y;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 >= cu.connReachSq) { continue; }

        let bucket = min(u32(d2 / cu.connBucketDiv), 4u);
        let bucketMult = array<f32, 5>(1.0, 0.8, 0.6, 0.4, 0.2);
        let edgeFade = select(1.0 - (d2 - cu.connFadeStartSq) / (cu.connReachSq - cu.connFadeStartSq), 1.0, d2 < cu.connFadeStartSq);
        let targetAlpha = cu.lineBase * bucketMult[bucket] * edgeFade * aiBrightBoost * cu.heroBrightness;

        let ci = atomicAdd(&candidateData[i + CCNT_OFF], 1u);
        if (ci < MAX_CAND) {
          atomicStore(&candidateData[i * MAX_CAND + ci + COTHER_OFF], j);
          atomicStore(&candidateData[i * MAX_CAND + ci + CD2_OFF], bitcast<u32>(d2));
          atomicStore(&candidateData[i * MAX_CAND + ci + CALPHA_OFF], bitcast<u32>(targetAlpha));
        }

        let cj = atomicAdd(&candidateData[j + CCNT_OFF], 1u);
        if (cj < MAX_CAND) {
          atomicStore(&candidateData[j * MAX_CAND + cj + COTHER_OFF], i);
          atomicStore(&candidateData[j * MAX_CAND + cj + CD2_OFF], bitcast<u32>(d2));
          atomicStore(&candidateData[j * MAX_CAND + cj + CALPHA_OFF], bitcast<u32>(targetAlpha));
        }
      }
    }
  }
}

@compute @workgroup_size(256)
fn connSelect(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.particleCount) { return; }
  let flagsI = pOut[i].flags;
  if ((flagsI & 1u) != 0u) { return; }
  let pidI = pOut[i].pid;

  let rawCount = atomicLoad(&candidateData[i + CCNT_OFF]);
  let count = min(rawCount, MAX_CAND);

  var cOther: array<u32, 8>;
  var cD2: array<f32, 8>;
  var cAlpha: array<f32, 8>;
  for (var k = 0u; k < count; k++) {
    cOther[k] = atomicLoad(&candidateData[i * MAX_CAND + k + COTHER_OFF]);
    cD2[k] = bitcast<f32>(atomicLoad(&candidateData[i * MAX_CAND + k + CD2_OFF]));
    cAlpha[k] = bitcast<f32>(atomicLoad(&candidateData[i * MAX_CAND + k + CALPHA_OFF]));
  }

  for (var a = 1u; a < count; a++) {
    let tmpO = cOther[a]; let tmpD = cD2[a]; let tmpA = cAlpha[a];
    var b = a;
    while (b > 0u && cD2[b - 1u] > tmpD) {
      cOther[b] = cOther[b - 1u]; cD2[b] = cD2[b - 1u]; cAlpha[b] = cAlpha[b - 1u];
      b--;
    }
    cOther[b] = tmpO; cD2[b] = tmpD; cAlpha[b] = tmpA;
  }

  let take = min(count, cu.maxConn);
  for (var k = 0u; k < take; k++) {
    let j = cOther[k];
    let targetAlpha = cAlpha[k];
    let pidJ = pOut[j].pid;
    let ck = canonKey(pidI, pidJ);
    let h = hashKey(pidI, pidJ);

    var found = false;
    for (var probe = 0u; probe < MAX_PROBE; probe++) {
      let slot = (h + probe) & HASH_MASK;
      let stored = atomicLoad(&hashTable[slot * 2u]);
      if (stored == ck) {
        let poolIdx = atomicLoad(&hashTable[slot * 2u + 1u]);
        connPool[poolIdx].tgt = targetAlpha;
        connPool[poolIdx].idxA = select(j, i, pidI < pidJ);
        connPool[poolIdx].idxB = select(i, j, pidI < pidJ);
        connPool[poolIdx].state = 3u;
        found = true;
        break;
      }
      if (stored == EMPTY) { break; }
    }

    if (!found) {
      let freeIdx = atomicSub(&connAtomics[1], 1u);
      if (freeIdx == 0u || freeIdx > cu.maxConnSlots) {
        atomicAdd(&connAtomics[1], 1u);
        continue;
      }
      let poolSlot = connFreeList[freeIdx - 1u];

      connPool[poolSlot].pidA = min(pidI, pidJ);
      connPool[poolSlot].pidB = max(pidI, pidJ);
      connPool[poolSlot].alpha = 0.0;
      connPool[poolSlot].tgt = targetAlpha;
      connPool[poolSlot].idxA = select(j, i, pidI < pidJ);
      connPool[poolSlot].idxB = select(i, j, pidI < pidJ);
      connPool[poolSlot].state = 3u;
      connPool[poolSlot]._pad = 0u;
      connPool[poolSlot].frozenAx = 0.0;
      connPool[poolSlot].frozenAy = 0.0;
      connPool[poolSlot].frozenBx = 0.0;
      connPool[poolSlot].frozenBy = 0.0;

      var inserted = false;
      for (var probe = 0u; probe < MAX_PROBE; probe++) {
        let slot = (h + probe) & HASH_MASK;
        var old = atomicCompareExchangeWeak(&hashTable[slot * 2u], EMPTY, ck);
        if (!old.exchanged) {
          old = atomicCompareExchangeWeak(&hashTable[slot * 2u], TOMBSTONE, ck);
        }
        if (old.exchanged) {
          atomicStore(&hashTable[slot * 2u + 1u], poolSlot);
          inserted = true;
          break;
        }
        if (old.old_value == ck) {
          // Race: another thread just inserted this pair — free our duplicate
          connPool[poolSlot].state = 0u;
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        connPool[poolSlot].state = 0u;
      }
    }

    atomicAdd(&neighborCount[i], 1u);
  }
}

@compute @workgroup_size(256)
fn connFade(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= cu.maxConnSlots) { return; }
  var c = connPool[i];
  if (c.state == 0u) { return; }

  if (cu.doSearch == 1u && c.state == 1u) {
    c.tgt = 0.0;
  }
  if (c.state == 3u) {
    c.state = 1u;
  }

  if (c.state == 1u) {
    let flagsA = pOut[c.idxA].flags;
    let flagsB = pOut[c.idxB].flags;
    let deadA = (flagsA & 1u) != 0u;
    let deadB = (flagsB & 1u) != 0u;
    let wrappedA = (flagsA & 8u) != 0u;
    let wrappedB = (flagsB & 8u) != 0u;

    if (wrappedA || wrappedB) {
      let ck = canonKey(c.pidA, c.pidB);
      let h = hashKey(c.pidA, c.pidB);
      for (var probe = 0u; probe < MAX_PROBE; probe++) {
        let slot = (h + probe) & HASH_MASK;
        let stored = atomicLoad(&hashTable[slot * 2u]);
        if (stored == ck) {
          atomicStore(&hashTable[slot * 2u], TOMBSTONE);
          break;
        }
        if (stored == EMPTY) { break; }
        // TOMBSTONE: keep probing
      }
      c.state = 0u;
      connPool[i] = c;
      return;
    }

    if (deadA || deadB) {
      c.frozenAx = pOut[c.idxA].x;
      c.frozenAy = pOut[c.idxA].y;
      c.frozenBx = pOut[c.idxB].x;
      c.frozenBy = pOut[c.idxB].y;
      c.state = 2u;
      c.tgt = 0.0;
    }
  }

  let rate = select(cu.connFadeOut, cu.connFadeIn, c.tgt > c.alpha);
  c.alpha += (c.tgt - c.alpha) * rate;

  if (c.alpha < cu.connKillAlpha && c.tgt == 0.0) {
    let ck = canonKey(c.pidA, c.pidB);
    let h = hashKey(c.pidA, c.pidB);
    for (var probe = 0u; probe < MAX_PROBE; probe++) {
      let slot = (h + probe) & HASH_MASK;
      let stored = atomicLoad(&hashTable[slot * 2u]);
      if (stored == ck) {
        atomicStore(&hashTable[slot * 2u], TOMBSTONE);
        break;
      }
      if (stored == EMPTY) { break; }
      // TOMBSTONE: keep probing
    }
    c.state = 0u;
    connPool[i] = c;
    return;
  }

  var ax: f32; var ay: f32; var bx: f32; var by: f32;
  if (c.state == 2u) {
    ax = c.frozenAx; ay = c.frozenAy;
    bx = c.frozenBx; by = c.frozenBy;
  } else {
    ax = pOut[c.idxA].x; ay = pOut[c.idxA].y;
    bx = pOut[c.idxB].x; by = pOut[c.idxB].y;
  }

  let ldx = ax - bx;
  let ldy = ay - by;
  let curD2 = ldx * ldx + ldy * ldy;

  // Kill cross-screen lines (wrap artifact)
  if (curD2 > cu.connReachSq * 4.0) {
    c.state = 0u;
    connPool[i] = c;
    return;
  }

  let lineIdx = atomicAdd(&connAtomics[0], 1u);
  let off = lineIdx * 6u;
  renderLines[off + 0u] = ${hasF16 ? 'f16(ax)' : 'ax'};
  renderLines[off + 1u] = ${hasF16 ? 'f16(ay)' : 'ay'};
  renderLines[off + 2u] = ${hasF16 ? 'f16(c.alpha)' : 'c.alpha'};
  renderLines[off + 3u] = ${hasF16 ? 'f16(bx)' : 'bx'};
  renderLines[off + 4u] = ${hasF16 ? 'f16(by)' : 'by'};
  renderLines[off + 5u] = ${hasF16 ? 'f16(c.alpha)' : 'c.alpha'};

  connPool[i] = c;
}

@compute @workgroup_size(1)
fn writeIndirect() {
  let lineCount = atomicLoad(&connAtomics[0]);
  lineIndirect[0] = lineCount * 2u;
  lineIndirect[1] = 1u;
  lineIndirect[2] = 0u;
  lineIndirect[3] = 0u;
}

`;
  }

  // ── Flags extract shader (separate module for minimal readback) ──────
  function makeFlagsExtractWGSL(hasF16) {
    const pOutStruct = hasF16 ? `
struct POut {
  x: f32, y: f32,
  vx: f16, vy: f16,
  size: f16, alpha_out: f16,
  pid: u32, flags: u32,
};` : `
struct POut {
  x: f32, y: f32, vx: f32, vy: f32,
  size: f32, alpha_out: f32,
  pid: u32, flags: u32,
};`;
    return `${hasF16 ? 'enable f16;\n' : ''}
${pOutStruct}

struct ExtractUniforms { particleCount: u32, };

@group(0) @binding(0) var<storage, read> pOutSrc: array<POut>;
@group(0) @binding(1) var<storage, read_write> flagsDst: array<u32>;
@group(0) @binding(2) var<uniform> eu: ExtractUniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= eu.particleCount) { return; }
  flagsDst[i] = pOutSrc[i].flags;
}
`;
  }

  // ── WebGPU particle render shader ────────────────────────────────────
  function makeParticleRenderWGSL(hasF16, packed) {
    const pOutStruct = hasF16 ? `
struct POut {
  x: f32, y: f32,
  vx: f16, vy: f16,
  size: f16, alpha_out: f16,
  pid: u32, flags: u32,
};` : `
struct POut {
  x: f32, y: f32, vx: f32, vy: f32,
  size: f32, alpha_out: f32,
  pid: u32, flags: u32,
};`;
    return `${hasF16 ? 'enable f16;\n' : ''}
${pOutStruct}

struct RenderUniforms {
  resX: f32, resY: f32,
  glowAlpha: f32,
  maxConn: f32,
  goldR: f32, goldG: f32, goldB: f32,
  whiteR: f32, whiteG: f32, whiteB: f32,
  _pad0: f32, _pad1: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<POut>;
@group(0) @binding(1) var<storage, read> nCount: array<u32>;
@group(0) @binding(2) var<uniform> ru: RenderUniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) alpha: f32,
  @location(2) whiten: f32,
};

// Quad corners for 2 triangles (6 vertices per particle)
const QUAD_UV = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
  vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  let pIdx = vid / 6u;
  let vIdx = vid % 6u;
  let p = particles[pIdx];

  var out: VSOut;
  let flags = p.flags;
  let dead = (flags & 1u) != 0u;

  if (dead) {
    out.pos = vec4f(0.0, 0.0, 0.0, 1.0);
    out.alpha = 0.0;
    out.whiten = 0.0;
    out.uv = vec2f(0.0);
    return out;
  }

  let size = f32(p.size);
  let alpha = f32(p.alpha_out);
  let vx = f32(p.vx);
  let vy = f32(p.vy);

  // Whiten calculation (same as CPU line 2516-2521)
  var wt = 0.0;
  let canWhiten = (flags & 4u) != 0u;
  if (canWhiten) {
    let spd = sqrt(vx * vx + vy * vy);
    let density = f32(nCount[pIdx${packed ? ` + ${MAX_CONN_SLOTS}u` : ''}]) / ru.maxConn;
    wt = min(1.0, max(0.0, (spd - 0.3) * 0.9) + density * 0.7);
  }

  // Expand quad corner
  let corner = QUAD_UV[vIdx];
  let halfSize = size * 0.5;
  let px = p.x + (corner.x - 0.5) * size;
  let py = p.y + (corner.y - 0.5) * size;

  // Pixel → clip space
  let clipX = (px / ru.resX) * 2.0 - 1.0;
  let clipY = -((py / ru.resY) * 2.0 - 1.0);

  out.pos = vec4f(clipX, clipY, 0.0, 1.0);
  out.uv = corner;
  out.alpha = alpha;
  out.whiten = wt;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let center = in.uv - 0.5;
  let dist = length(center) * 2.0;
  if (dist > 1.0) { discard; }

  let coreFrac = 0.333;
  let coreAlpha = 1.0 - smoothstep(coreFrac - 0.06, coreFrac + 0.06, dist);
  let glowDist = max(0.0, dist - coreFrac) / (1.0 - coreFrac);
  let glowFade = (1.0 - glowDist * glowDist) * step(dist, 1.0);
  let hasGlow = step(0.15, in.alpha);
  let alpha = coreAlpha * in.alpha + glowFade * ru.glowAlpha * in.alpha * hasGlow;
  if (alpha < 0.002) { discard; }

  let gold = vec3f(ru.goldR, ru.goldG, ru.goldB);
  let white = vec3f(ru.whiteR, ru.whiteG, ru.whiteB);
  let col = mix(gold, white, in.whiten);
  return vec4f(col * alpha, alpha);
}
`;
  }

  // ── WebGPU line render shader ────────────────────────────────────────
  function makeLineRenderWGSL(hasF16) {
    const elType = hasF16 ? 'f16' : 'f32';
    return `${hasF16 ? 'enable f16;\n' : ''}
struct LineUniforms {
  resX: f32, resY: f32,
};

@group(0) @binding(0) var<storage, read> lines: array<${elType}>;
@group(0) @binding(1) var<uniform> lu: LineUniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) alpha: f32,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  // Each line = 6 values: [ax, ay, alphaA, bx, by, alphaB]
  let lineIdx = vid / 2u;
  let isB = vid % 2u;
  let off = lineIdx * 6u + isB * 3u;
  let px = f32(lines[off + 0u]);
  let py = f32(lines[off + 1u]);
  let alpha = f32(lines[off + 2u]);

  let clipX = (px / lu.resX) * 2.0 - 1.0;
  let clipY = -((py / lu.resY) * 2.0 - 1.0);

  var out: VSOut;
  out.pos = vec4f(clipX, clipY, 0.0, 1.0);
  out.alpha = alpha;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let a = in.alpha;
  return vec4f(0.831 * a, 0.659 * a, 0.263 * a, a);
}
`;
  }

  // Uniform buffer layout: 22 fields, padded to 96 bytes (24 x f32)
  const GPU_UNIFORM_SIZE = 96;
  const gpuUniformData = new ArrayBuffer(GPU_UNIFORM_SIZE);
  const gpuUniformF32 = new Float32Array(gpuUniformData);
  const gpuUniformU32 = new Uint32Array(gpuUniformData);

  // CPU-side mirror of GPU particle buffer for spawning/init
  let gpuParticleCPU = null; // Float32Array, allocated on init

  // Readback staging
  let gpuOutputCPU = null;   // Float32Array for readback results
  let gpuReadbackPending = false;

  async function initWebGPU() {
    if (!navigator.gpu) return;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return;
      const hasF16 = adapter.features.has('shader-f16') && localStorage.getItem('sonara_f16') !== '0';
      const maxStorage = adapter.limits.maxStorageBuffersPerShaderStage;
      const usePackedConn = maxStorage < 12;
      const device = await adapter.requestDevice({
        requiredFeatures: hasF16 ? ['shader-f16'] : [],
        requiredLimits: {
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxBufferSize: adapter.limits.maxBufferSize,
          ...(!usePackedConn ? { maxStorageBuffersPerShaderStage: 12 } : {}),
        }
      });
      if (!device) return;

      if (hasF16) {
        gpuHasF16 = true;
        GPU_PARTICLE_STRIDE = 40;
        GPU_OUTPUT_STRIDE = 24;
        console.log('shader-f16 supported: particle 40B, output 24B');
      }
      console.log(`Storage buffers per stage: ${maxStorage}, using ${usePackedConn ? 'packed' : 'unpacked'} connections`);

      const shaderModule = device.createShaderModule({ code: hasF16 ? WGSL_PHYSICS_F16 : WGSL_PHYSICS });
      const compilationInfo = await shaderModule.getCompilationInfo();
      for (const msg of compilationInfo.messages) {
        if (msg.type === 'error') {
          console.error('WGSL compile error:', msg.message, 'line', msg.lineNum);
          return;
        }
      }

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        ],
      });

      const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module: shaderModule, entryPoint: 'main' },
      });

      // ── Connection compute pipelines ──────────────────────────────────
      const connShaderModule = device.createShaderModule({ code: makeConnWGSL(hasF16, usePackedConn) });
      const connInfo = await connShaderModule.getCompilationInfo();
      for (const msg of connInfo.messages) {
        if (msg.type === 'error') {
          console.error('Connection WGSL compile error:', msg.message, 'line', msg.lineNum);
          return;
        }
      }

      let connPipelineLayout;
      if (usePackedConn) {
        // Packed: single bind group, 8 storage + 1 uniform
        const connBindGroupLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // pOut
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // connPool
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // hashTable
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // gridData (packed)
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // gridIndices
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // renderLines
            { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // auxCounters (packed)
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // connUniforms
            { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // auxPool (packed)
          ],
        });
        device._connBindGroupLayout0 = connBindGroupLayout;
        device._connBindGroupLayout1 = null;
        connPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [connBindGroupLayout] });
      } else {
        // Unpacked: 2 bind groups, 11 storage + 1 uniform
        const connBindGroupLayout0 = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // pOut
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // connPool
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // hashTable
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // gridCounts
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // gridOffsets
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // gridIndices
            { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // connAtomics
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // connUniforms
          ],
        });
        const connBindGroupLayout1 = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // renderLines
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // neighborCount
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // lineIndirect
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // connFreeList
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // candidateData
          ],
        });
        device._connBindGroupLayout0 = connBindGroupLayout0;
        device._connBindGroupLayout1 = connBindGroupLayout1;
        connPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [connBindGroupLayout0, connBindGroupLayout1] });
      }

      const makeConnPipeline = (entryPoint) => device.createComputePipeline({
        layout: connPipelineLayout,
        compute: { module: connShaderModule, entryPoint },
      });
      const connPipelines = {
        gridClear: makeConnPipeline('gridClear'),
        gridCount: makeConnPipeline('gridCount'),
        gridPrefixSum: makeConnPipeline('gridPrefixSum'),
        gridScatter: makeConnPipeline('gridScatter'),
        buildFreeList: makeConnPipeline('buildFreeList'),
        connSearch: makeConnPipeline('connSearch'),
        connGather: makeConnPipeline('connGather'),
        connSelect: makeConnPipeline('connSelect'),
        connFade: makeConnPipeline('connFade'),
        writeIndirect: makeConnPipeline('writeIndirect'),
      };

      // ── Flags extract pipeline ──────────────────────────────────────
      const flagsShaderModule = device.createShaderModule({ code: makeFlagsExtractWGSL(hasF16) });
      const flagsBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
      });
      const flagsExtractPipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [flagsBindGroupLayout] }),
        compute: { module: flagsShaderModule, entryPoint: 'main' },
      });

      // ── WebGPU render pipelines ─────────────────────────────────────
      const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      const blendState = {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      };

      // Particle render pipeline
      const particleRenderModule = device.createShaderModule({ code: makeParticleRenderWGSL(hasF16, usePackedConn) });
      const particleRenderInfo = await particleRenderModule.getCompilationInfo();
      for (const msg of particleRenderInfo.messages) {
        if (msg.type === 'error') {
          console.error('Particle render WGSL error:', msg.message, 'line', msg.lineNum);
          return;
        }
      }

      const particleRenderBGL = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },  // particles
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },  // neighborCount
          { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, // uniforms
        ],
      });

      const particleRenderPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [particleRenderBGL] }),
        vertex: { module: particleRenderModule, entryPoint: 'vs' },
        fragment: {
          module: particleRenderModule,
          entryPoint: 'fs',
          targets: [{ format: canvasFormat, blend: blendState }],
        },
        primitive: { topology: 'triangle-list' },
      });

      // Line render pipeline
      const lineRenderModule = device.createShaderModule({ code: makeLineRenderWGSL(hasF16) });
      const lineRenderInfo = await lineRenderModule.getCompilationInfo();
      for (const msg of lineRenderInfo.messages) {
        if (msg.type === 'error') {
          console.error('Line render WGSL error:', msg.message, 'line', msg.lineNum);
          return;
        }
      }

      const lineRenderBGL = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },  // lines
          { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, // uniforms
        ],
      });

      const lineRenderPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [lineRenderBGL] }),
        vertex: { module: lineRenderModule, entryPoint: 'vs' },
        fragment: {
          module: lineRenderModule,
          entryPoint: 'fs',
          targets: [{ format: canvasFormat, blend: blendState }],
        },
        primitive: { topology: 'line-list' },
      });

      // Store references — buffers created on init() when we know particle count
      gpuDevice = device;
      gpuPhysicsPipeline = pipeline;
      gpuDevice._bindGroupLayout = bindGroupLayout;
      // connBindGroupLayout0/1 already stored on device._ in the packed/unpacked branches above
      gpuDevice._usePackedConn = usePackedConn;
      gpuDevice._flagsBindGroupLayout = flagsBindGroupLayout;
      gpuDevice._flagsExtractPipeline = flagsExtractPipeline;
      gpuDevice._particleRenderBGL = particleRenderBGL;
      gpuDevice._lineRenderBGL = lineRenderBGL;
      gpuConnPipelines = connPipelines;
      gpuParticleRenderPipeline = particleRenderPipeline;
      gpuLineRenderPipeline = lineRenderPipeline;
      gpuCanvasFormat = canvasFormat;

      console.log('WebGPU compute + render pipelines ready');
      // Hot-swap: re-run init() now that gpuDevice is available
      if (w && h) init();
    } catch (e) {
      console.warn('WebGPU init failed, staying on CPU:', e);
    }
  }

  function createGPUBuffers(count) {
    if (!gpuDevice) return;
    const device = gpuDevice;

    // Destroy old buffers if they exist
    if (gpuParticleBuf) gpuParticleBuf.destroy();
    if (gpuOutputBuf) gpuOutputBuf.destroy();
    if (gpuOutputReadBuf) gpuOutputReadBuf.destroy();
    if (gpuUniformBuf) gpuUniformBuf.destroy();
    if (gpuBrightnessRippleBuf) gpuBrightnessRippleBuf.destroy();
    if (gpuSpinRippleBuf) gpuSpinRippleBuf.destroy();

    const particleBufSize = count * GPU_PARTICLE_STRIDE;
    const outputBufSize = count * GPU_OUTPUT_STRIDE;

    gpuParticleBuf = device.createBuffer({
      size: particleBufSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    gpuOutputBuf = device.createBuffer({
      size: outputBufSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    gpuOutputReadBuf = device.createBuffer({
      size: outputBufSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    gpuUniformBuf = device.createBuffer({
      size: GPU_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    gpuBrightnessRippleBuf = device.createBuffer({
      size: 512 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    gpuSpinRippleBuf = device.createBuffer({
      size: 512 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    gpuBindGroup = device.createBindGroup({
      layout: gpuDevice._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: gpuParticleBuf } },
        { binding: 1, resource: { buffer: gpuOutputBuf } },
        { binding: 2, resource: { buffer: gpuUniformBuf } },
        { binding: 3, resource: { buffer: gpuBrightnessRippleBuf } },
        { binding: 4, resource: { buffer: gpuSpinRippleBuf } },
      ],
    });

    if (gpuHasF16) {
      // f16 path: CPU-side buffers are raw byte arrays (mixed f32/f16 via DataView)
      gpuParticleCPU = new Uint8Array(count * GPU_PARTICLE_STRIDE);
      gpuOutputCPU = null; // will be a Uint8Array from readback
    } else {
      gpuParticleCPU = new Float32Array(count * 16);
      gpuOutputCPU = new Float32Array(count * 8);
    }
    gpuParticleCount = count;

    // ── Connection compute buffers ──────────────────────────────────
    if (gpuConnPool) gpuConnPool.destroy();
    if (gpuConnHashTable) gpuConnHashTable.destroy();
    // Destroy old connection buffers
    const connBufs = [gpuGridCounts, gpuGridOffsets, gpuGridIndices, gpuRenderLines,
      gpuConnAtomics, gpuConnUniformBuf, gpuNeighborCount, gpuLineIndirectBuf,
      gpuConnFreeList, gpuGridData, gpuAuxCounters, gpuAuxPool, gpuCandidateData,
      gpuFlagsExtractBuf, gpuFlagsReadBuf, gpuRenderUniformBuf];
    for (const b of connBufs) { if (b) b.destroy(); }

    const packed = gpuDevice._usePackedConn;

    // Shared buffers (both tiers)
    gpuConnPool = device.createBuffer({
      size: MAX_CONN_SLOTS * 48,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    gpuConnHashTable = device.createBuffer({
      size: CONN_HASH_SIZE * 2 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    gpuGridIndices = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    gpuRenderLines = device.createBuffer({
      size: MAX_CONN_SLOTS * 6 * (gpuHasF16 ? 2 : 4),
      usage: GPUBufferUsage.STORAGE,
    });
    const CONN_UNIFORM_SIZE = 80;
    gpuConnUniformBuf = device.createBuffer({
      size: CONN_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    if (packed) {
      // Packed tier: 3 merged buffers
      // gridData = gridCounts[0..255] + gridOffsets[256..511]
      gpuGridData = device.createBuffer({
        size: MAX_GRID_CELLS * 2 * 4, // 512 u32s
        usage: GPUBufferUsage.STORAGE,
      });
      // auxCounters = connAtomics[0..1] + lineIndirect[2..5]
      gpuAuxCounters = device.createBuffer({
        size: 6 * 4, // 6 u32s (2 atomics + 4 indirect draw params)
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.INDIRECT,
      });
      // auxPool = connFreeList[0..MAX_CONN_SLOTS-1] + neighborCount[MAX_CONN_SLOTS..] + candidate data
      // Layout: freeList[30000] + neighborCount[P] + candCount[P] + candOther[8P] + candD2[8P] + candAlpha[8P]
      gpuAuxPool = device.createBuffer({
        size: (MAX_CONN_SLOTS + count * 26) * 4,
        usage: GPUBufferUsage.STORAGE,
      });
      // Null out unpacked-only refs
      gpuGridCounts = null; gpuGridOffsets = null;
      gpuConnAtomics = null; gpuNeighborCount = null;
      gpuLineIndirectBuf = null; gpuConnFreeList = null; gpuCandidateData = null;
    } else {
      // Enhanced tier: individual buffers
      gpuGridCounts = device.createBuffer({
        size: MAX_GRID_CELLS * 4,
        usage: GPUBufferUsage.STORAGE,
      });
      gpuGridOffsets = device.createBuffer({
        size: MAX_GRID_CELLS * 4,
        usage: GPUBufferUsage.STORAGE,
      });
      gpuConnAtomics = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      gpuNeighborCount = device.createBuffer({
        size: count * 4,
        usage: GPUBufferUsage.STORAGE,
      });
      gpuLineIndirectBuf = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
      });
      gpuConnFreeList = device.createBuffer({
        size: MAX_CONN_SLOTS * 4,
        usage: GPUBufferUsage.STORAGE,
      });
      // candidateData: candCount[P] + candOther[8P] + candD2[8P] + candAlpha[8P] = 25P u32s
      gpuCandidateData = device.createBuffer({
        size: count * 25 * 4,
        usage: GPUBufferUsage.STORAGE,
      });
      // Null out packed-only refs
      gpuGridData = null; gpuAuxCounters = null; gpuAuxPool = null;
    }

    // Flags extract + readback (both tiers)
    gpuFlagsExtractBuf = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    gpuFlagsReadBuf = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    // Line count readback for debug HUD (4 bytes = 1 u32)
    if (gpuLineCountReadBuf) gpuLineCountReadBuf.destroy();
    gpuLineCountReadBuf = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    gpuRenderUniformBuf = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Initialize hash table to EMPTY (0xFFFFFFFF)
    const hashInit = new Uint32Array(CONN_HASH_SIZE * 2);
    hashInit.fill(0xFFFFFFFF);
    device.queue.writeBuffer(gpuConnHashTable, 0, hashInit);

    // Connection compute bind groups
    if (packed) {
      gpuConnBindGroup = device.createBindGroup({
        layout: gpuDevice._connBindGroupLayout0,
        entries: [
          { binding: 0, resource: { buffer: gpuOutputBuf } },
          { binding: 1, resource: { buffer: gpuConnPool } },
          { binding: 2, resource: { buffer: gpuConnHashTable } },
          { binding: 3, resource: { buffer: gpuGridData } },
          { binding: 4, resource: { buffer: gpuGridIndices } },
          { binding: 5, resource: { buffer: gpuRenderLines } },
          { binding: 6, resource: { buffer: gpuAuxCounters } },
          { binding: 7, resource: { buffer: gpuConnUniformBuf } },
          { binding: 8, resource: { buffer: gpuAuxPool } },
        ],
      });
      gpuConnBindGroup1 = null;
    } else {
      gpuConnBindGroup = device.createBindGroup({
        layout: gpuDevice._connBindGroupLayout0,
        entries: [
          { binding: 0, resource: { buffer: gpuOutputBuf } },
          { binding: 1, resource: { buffer: gpuConnPool } },
          { binding: 2, resource: { buffer: gpuConnHashTable } },
          { binding: 3, resource: { buffer: gpuGridCounts } },
          { binding: 4, resource: { buffer: gpuGridOffsets } },
          { binding: 5, resource: { buffer: gpuGridIndices } },
          { binding: 6, resource: { buffer: gpuConnAtomics } },
          { binding: 7, resource: { buffer: gpuConnUniformBuf } },
        ],
      });
      gpuConnBindGroup1 = device.createBindGroup({
        layout: gpuDevice._connBindGroupLayout1,
        entries: [
          { binding: 0, resource: { buffer: gpuRenderLines } },
          { binding: 1, resource: { buffer: gpuNeighborCount } },
          { binding: 2, resource: { buffer: gpuLineIndirectBuf } },
          { binding: 3, resource: { buffer: gpuConnFreeList } },
          { binding: 4, resource: { buffer: gpuCandidateData } },
        ],
      });
    }

    // ── WebGPU canvas context + render bind groups ──────────────────
    const gpuRenderEnabled = !isLocal || localStorage.getItem('sonara_gpu_render') !== '0';
    if (gpuParticleRenderPipeline && !WEBGPU_RENDER && gpuRenderEnabled) {
      const gpuCanvas = document.createElement('canvas');
      gpuCanvas.width = canvas.width;
      gpuCanvas.height = canvas.height;
      gpuCanvas.style.cssText = canvas.style.cssText;
      if (canvas.id) gpuCanvas.id = canvas.id;
      if (canvas.className) gpuCanvas.className = canvas.className;
      gpuRenderContext = gpuCanvas.getContext('webgpu');
      gpuRenderContext.configure({
        device: device,
        format: gpuCanvasFormat,
        alphaMode: 'premultiplied',
      });
      canvas.parentNode.replaceChild(gpuCanvas, canvas);
      canvas = gpuCanvas;
      WEBGPU_RENDER = true;
      console.log('WebGPU render canvas activated');
    }

    // Particle render bind group — neighborCount source differs by tier
    if (gpuParticleRenderPipeline) {
      const nCountBuf = packed ? gpuAuxPool : gpuNeighborCount;
      gpuParticleRenderBindGroup = device.createBindGroup({
        layout: gpuDevice._particleRenderBGL,
        entries: [
          { binding: 0, resource: { buffer: gpuOutputBuf } },
          { binding: 1, resource: { buffer: nCountBuf } },
          { binding: 2, resource: { buffer: gpuRenderUniformBuf } },
        ],
      });
    }

    // Line render bind group
    if (gpuLineRenderPipeline) {
      gpuLineRenderBindGroup = device.createBindGroup({
        layout: gpuDevice._lineRenderBGL,
        entries: [
          { binding: 0, resource: { buffer: gpuRenderLines } },
          { binding: 1, resource: { buffer: gpuRenderUniformBuf } },
        ],
      });
    }
  }

  // f16 write helper: packs one particle into a 40-byte ArrayBuffer via DataView
  // Layout: [x:f32 @0, y:f32 @4, pid:u32 @8, vx:f16 @12, vy:f16 @14,
  //          phase:f16 @16, alpha:f16 @18, r:f16 @20, age:f16 @22,
  //          fadeIn:f16 @24, life:f16 @26, decay:f16 @28, baseAlpha:f16 @30,
  //          reactivity:f16 @32, rippleSpeed:f16 @34, canWhiten:f16 @36, _pad:f16 @38]
  const gpuF16Tmp = new ArrayBuffer(40);
  const gpuF16View = new DataView(gpuF16Tmp);
  function writeParticleF16(x, y, pid, vx, vy, phase, alpha, r, age, fadeIn, life, decay, baseAlpha, reactivity, rippleSpeed, canWhiten) {
    const v = gpuF16View;
    v.setFloat32(0, x, true);
    v.setFloat32(4, y, true);
    v.setUint32(8, pid, true);
    v.setFloat16(12, vx, true);
    v.setFloat16(14, vy, true);
    v.setFloat16(16, phase, true);
    v.setFloat16(18, alpha, true);
    v.setFloat16(20, r, true);
    v.setFloat16(22, age, true);
    v.setFloat16(24, fadeIn, true);
    v.setFloat16(26, life, true);
    v.setFloat16(28, decay, true);
    v.setFloat16(30, baseAlpha, true);
    v.setFloat16(32, reactivity, true);
    v.setFloat16(34, rippleSpeed, true);
    v.setFloat16(36, canWhiten, true);
    v.setFloat16(38, 0, true); // _pad
    return gpuF16Tmp;
  }

  // Kick off WebGPU init immediately (non-blocking)
  initWebGPU();

  function resize() {
    const dpr = window.devicePixelRatio > 1 ? 1.5 : 1;
    // Clear inline styles so CSS (width/height: 100%) drives layout
    canvas.style.width = '';
    canvas.style.height = '';
    w = canvas.width = canvas.offsetWidth * dpr;
    h = canvas.height = canvas.offsetHeight * dpr;
    canvas.style.width = canvas.offsetWidth + 'px';
    canvas.style.height = canvas.offsetHeight + 'px';
    if (WEBGPU_RENDER && gpuRenderContext) {
      gpuRenderContext.configure({
        device: gpuDevice,
        format: gpuCanvasFormat,
        alphaMode: 'premultiplied',
      });
    } else {
      gl.viewport(0, 0, w, h);
    }
    grid.clear();
  }

  // --- GPU slot management ---
  function getSlot() {
    if (freeSlots.length > 0) {
      const slot = freeSlots.pop();
      isFree[slot] = 0;
      return slot;
    }
    if (highWater < BUFFER_CAP) return highWater++;
    return -1;
  }

  function writeParticleToGPU(slot, data) {
    slotBuf[0]  = data.x;
    slotBuf[1]  = data.y;
    slotBuf[2]  = data.vx;
    slotBuf[3]  = data.vy;
    slotBuf[4]  = data.phase;
    slotBuf[5]  = data.alpha;
    slotBuf[6]  = data.r;
    slotBuf[7]  = data.age;
    slotBuf[8]  = data.fadeIn;
    slotBuf[9]  = data.life;
    slotBuf[10] = data.decay;
    slotBuf[11] = data.baseAlpha;
    slotBuf[12] = data.reactivity;
    slotBuf[13] = data.rippleSpeed;
    slotBuf[14] = 0;
    slotBuf[15] = 0;
    const byteOff = slot * STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[tfCurrent]);
    gl.bufferSubData(gl.ARRAY_BUFFER, byteOff, slotBuf);
    pids[slot] = nextPid = (nextPid + 1) % PID_MAX;
  }

  // ─── init ────────────────────────────────────────────────────────────
  function init() {
    connFade.clear();
    grid.clear();
    framePairs.clear();
    gpuConnSearchFrame = 0;
    const initialParticleCount = getSeedCount();

    // WebGPU compute path
    if (gpuDevice && !GPU_PHYSICS) {
      createGPUBuffers(BUFFER_CAP);
      const initData = gpuParticleCPU;
      initData.fill(0);
      gpuWatermark = initialParticleCount;
      gpuFreeSlots.length = 0;

      if (gpuHasF16) {
        // f16 path: write mixed f32/f16 via DataView into Uint8Array
        const dv = new DataView(initData.buffer);
        for (let i = 0; i < initialParticleCount; i++) {
          const off = i * 40; // GPU_PARTICLE_STRIDE = 40
          const pid = nextPid = (nextPid + 1) % PID_MAX;
          const cw = Math.random() < getWhiteParticleChance();
          const x = Math.random() * w, y = Math.random() * h;
          const vx = (Math.random() - 0.5) * 0.4, vy = (Math.random() - 0.5) * 0.4;
          const alpha = Math.random() * 0.4 + 0.1;
          dv.setFloat32(off + 0, x, true);
          dv.setFloat32(off + 4, y, true);
          dv.setUint32(off + 8, pid, true);
          dv.setFloat16(off + 12, vx, true);
          dv.setFloat16(off + 14, vy, true);
          dv.setFloat16(off + 16, Math.random() * Math.PI * 2, true); // phase
          dv.setFloat16(off + 18, alpha, true);
          dv.setFloat16(off + 20, Math.random() * 2 + 0.5, true); // r
          dv.setFloat16(off + 22, 0, true); // age
          dv.setFloat16(off + 24, FADE_FRAMES, true); // fadeIn
          dv.setFloat16(off + 26, 0, true); // life
          dv.setFloat16(off + 28, 0, true); // decay
          dv.setFloat16(off + 30, 0, true); // baseAlpha
          dv.setFloat16(off + 32, 0.3 + Math.random() * 0.7, true); // reactivity
          dv.setFloat16(off + 34, RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR, true);
          dv.setFloat16(off + 36, cw ? 1 : 0, true); // canWhiten
          dv.setFloat16(off + 38, 0, true); // _pad
          const s = gpuSlots[i];
          s.dead = false; s.pid = pid;
          s.x = x; s.y = y; s.vx = vx; s.vy = vy;
          s.canWhiten = cw; s.life = undefined; s.alpha = alpha;
        }
        // Mark unused GPU slots as dead (life @ offset 26 = -999)
        for (let i = initialParticleCount; i < BUFFER_CAP; i++) {
          const off = i * 40;
          dv.setFloat16(off + 26, -999, true); // life = -999
          gpuSlots[i].dead = true;
          gpuSlots[i].pid = -1;
        }
      } else {
        // f32 path (unchanged)
        for (let i = 0; i < initialParticleCount; i++) {
          const off = i * 16;
          const pid = nextPid = (nextPid + 1) % PID_MAX;
          const cw = Math.random() < getWhiteParticleChance();
          const x = Math.random() * w, y = Math.random() * h;
          const vx = (Math.random() - 0.5) * 0.4, vy = (Math.random() - 0.5) * 0.4;
          const alpha = Math.random() * 0.4 + 0.1;
          initData[off + 0]  = x;
          initData[off + 1]  = y;
          initData[off + 2]  = vx;
          initData[off + 3]  = vy;
          initData[off + 4]  = Math.random() * Math.PI * 2;
          initData[off + 5]  = alpha;
          initData[off + 6]  = Math.random() * 2 + 0.5;
          initData[off + 7]  = 0;
          initData[off + 8]  = FADE_FRAMES;
          initData[off + 9]  = 0;
          initData[off + 10] = 0;
          initData[off + 11] = 0;
          initData[off + 12] = 0.3 + Math.random() * 0.7;
          initData[off + 13] = RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR;
          initData[off + 14] = cw ? 1 : 0;
          initData[off + 15] = pid;
          const s = gpuSlots[i];
          s.dead = false; s.pid = pid;
          s.x = x; s.y = y; s.vx = vx; s.vy = vy;
          s.canWhiten = cw; s.life = undefined; s.alpha = alpha;
        }
        for (let i = initialParticleCount; i < BUFFER_CAP; i++) {
          initData[i * 16 + 9] = -999;
          gpuSlots[i].dead = true;
          gpuSlots[i].pid = -1;
        }
      }
      gpuDevice.queue.writeBuffer(gpuParticleBuf, 0, initData);
      gpuParticleCount = BUFFER_CAP;

      WEBGPU_ACTIVE = true;
      gpuReadbackPending = false;
      console.log('WebGPU compute activated with', initialParticleCount, 'particles');
    } else if (GPU_PHYSICS) {
      highWater = initialParticleCount;
      freeSlots.length = 0;
      isFree.fill(0);

      const initData = new Float32Array(BUFFER_CAP * FPP);
      for (let i = 0; i < initialParticleCount; i++) {
        const off = i * FPP;
        initData[off + 0]  = Math.random() * w;
        initData[off + 1]  = Math.random() * h;
        initData[off + 2]  = (Math.random() - 0.5) * 0.4;
        initData[off + 3]  = (Math.random() - 0.5) * 0.4;
        initData[off + 4]  = Math.random() * Math.PI * 2;
        initData[off + 5]  = Math.random() * 0.4 + 0.1;
        initData[off + 6]  = Math.random() * 2 + 0.5;
        initData[off + 7]  = 0;
        initData[off + 8]  = 0;
        initData[off + 9]  = 0;
        initData[off + 10] = 0;
        initData[off + 11] = 0;
        initData[off + 12] = 0.3 + Math.random() * 0.7;
        initData[off + 13] = RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR;
        initData[off + 14] = 0;
        initData[off + 15] = 0;
        pids[i] = nextPid = (nextPid + 1) % PID_MAX;
      }
      for (let i = initialParticleCount; i < BUFFER_CAP; i++) {
        initData[i * FPP + 9] = -999;
        pids[i] = -1;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[0]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, initData);
      gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[1]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, initData);
      tfCurrent = 0;
    } else {
      particles = [];
      for (let i = 0; i < initialParticleCount; i++) {
        particles.push({
          pid: nextPid = (nextPid + 1) % PID_MAX,
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          r: Math.random() * 2 + 0.5,
          alpha: Math.random() * 0.4 + 0.1,
          phase: Math.random() * Math.PI * 2,
          reactivity: 0.3 + Math.random() * 0.7,
          rippleSpeed: RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR,
          canWhiten: Math.random() < getWhiteParticleChance()
        });
      }
    }
  }

  // ─── draw ────────────────────────────────────────────────────────────
  function draw() {
    if (!heroVis.visible) return;
    time += 0.005;
    const now = performance.now();

    const isPlaying = !!(listenBtn && listenBtn.classList.contains('playing'));
    if (isPlaying && !wasPlayingLastFrame) playStartTime = now;
    if (!isPlaying && wasPlayingLastFrame) stopTime = now;
    wasPlayingLastFrame = isPlaying;

    if (isPlaying) {
      const t = Math.min(1, (now - playStartTime) / MOUSE_SWIRL_FADE_MS);
      mouseSwirlMix = 1 - t;
    } else {
      const t = Math.min(1, (now - stopTime) / MOUSE_SWIRL_RETURN_MS);
      mouseSwirlMix = t;
    }

    // --- Audio RMS (or synthetic mobile intensity) ---
    if (isMobileView) {
      const t = now * 0.001;
      const breath = Math.sin(t * 0.52) * 0.5 + 0.5;
      const swell  = Math.sin(t * 1.26 + 1.7) * 0.5 + 0.5;
      const shimmer = Math.sin(t * 3.5 + 0.3) * 0.5 + 0.5;
      const synthetic = breath * 0.55 + swell * 0.3 + shimmer * 0.15;
      const target = synthetic * 0.55 + 0.05;
      const transientTarget = synthetic * 0.7 + 0.05;
      const brightnessRate = target > brightnessIntensity ? BRIGHTNESS_ATTACK : BRIGHTNESS_RELEASE;
      const brightnessTransientRate = transientTarget > brightnessTransient ? BRIGHTNESS_ATTACK : BRIGHTNESS_RELEASE;
      brightnessIntensity += (target - brightnessIntensity) * brightnessRate;
      brightnessTransient += (transientTarget - brightnessTransient) * brightnessTransientRate;
      const spinRate = target > audioIntensity ? SPIN_ATTACK : SPIN_RELEASE;
      const spinTransientRate = transientTarget > audioTransient ? SPIN_ATTACK : SPIN_RELEASE;
      audioIntensity += (target - audioIntensity) * spinRate;
      audioTransient += (transientTarget - audioTransient) * spinTransientRate;
      rmsSmooth += (target - rmsSmooth) * 0.018;
      mouseSwirlMix = 0;
    } else {
    const heroAn = getHeroAnalyser();
    if (heroAn) {
      heroAn.getByteTimeDomainData(heroRmsData);
      let sum = 0;
      for (let i = 0; i < heroRmsData.length; i++) {
        const v = (heroRmsData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / heroRmsData.length);
      const target = Math.min(1, rms * 10);
      const transientTarget = Math.min(1, rms * 16);
      const brightnessRate = target > brightnessIntensity ? BRIGHTNESS_ATTACK : BRIGHTNESS_RELEASE;
      const brightnessTransientRate = transientTarget > brightnessTransient ? BRIGHTNESS_ATTACK : BRIGHTNESS_RELEASE;
      brightnessIntensity += (target - brightnessIntensity) * brightnessRate;
      brightnessTransient += (transientTarget - brightnessTransient) * brightnessTransientRate;
      const spinRate = target > audioIntensity ? SPIN_ATTACK : SPIN_RELEASE;
      const spinTransientRate = transientTarget > audioTransient ? SPIN_ATTACK : SPIN_RELEASE;
      audioIntensity += (target - audioIntensity) * spinRate;
      audioTransient += (transientTarget - audioTransient) * spinTransientRate;
      rmsSmooth += (target - rmsSmooth) * 0.018;
      const rippleAge = now - rippleClickTime;
      if (rippleFirstPlay && rippleClickTime > 0 && rippleAge < RIPPLE_BURST_DURATION) {
        const decay = 1 - rippleAge / RIPPLE_BURST_DURATION;
        const interval = 800 + (1 - decay) * 3200;
        if (target > rmsSmooth + 0.35 && now - lastRippleTime > interval) {
          spawnRipple();
          lastRippleTime = now;
        }
      }
    } else {
      brightnessIntensity += (0 - brightnessIntensity) * BRIGHTNESS_RELEASE;
      brightnessTransient += (0 - brightnessTransient) * BRIGHTNESS_RELEASE;
      audioIntensity += (0 - audioIntensity) * SPIN_RELEASE;
      audioTransient += (0 - audioTransient) * SPIN_RELEASE;
      rmsSmooth = 0;
    }
    } // end desktop audio block

    // Ripple buffer update
    const brightnessLevel = Math.min(1, brightnessIntensity * 0.68 + brightnessTransient * 0.68);
    const spinLevel = Math.min(1, audioIntensity * 0.68 + audioTransient * 0.68);
    const activityLevel = Math.max(brightnessLevel, spinLevel);
    rippleHead = (rippleHead + 1) % RIPPLE_BUF_LEN;
    brightnessRippleBuf[rippleHead] = brightnessLevel;
    spinRippleBuf[rippleHead] = spinLevel;

    // Swirl center (based on selected target element)
    let btnCX = w * 0.5, btnCY = h * 0.5;
    const centerEl = swirlCenterEls[swirlCenterTarget] || listenBtn;
    if (!isMobileView && centerEl) {
      const center = getElementCanvasCenter(centerEl);
      if (center) {
        btnCX = center.x;
        btnCY = center.y;
      }
    }

    const scaleX = w / window.innerWidth;
    const scaleY = h / window.innerHeight;
    const mx = mouseX * scaleX, my = mouseY * scaleY;

    // --- Playback speed oscillation ---
    let speedScale = 1.0;
    const heroSrc = getHeroSourceNode();
    if (VARIABLE_SPEED) {
      const rawSpeed = LOW_SPEED + (HIGH_SPEED - LOW_SPEED) * (Math.sin(now * 0.001 * (2 * Math.PI / SPEED_PERIOD)) * 0.5 + 0.5);
      const heroSpeed = Math.min(rawSpeed, SPEED_CLAMP);
      speedScale = heroSpeed;
      if (heroSrc) heroSrc.playbackRate.value = heroSpeed;
    } else if (heroSrc) {
      heroSrc.playbackRate.value = 1.0;
    }

    let autoCount = 0;
    let aliveCount = WEBGPU_RENDER ? (gpuWatermark - gpuFreeSlots.length) : 0;
    let gpuRenderCount = 0;

    // ==================================================================
    // WEBGPU COMPUTE PATH
    // ==================================================================
    if (WEBGPU_ACTIVE) {
      const gpuTmpSlot = gpuHasF16 ? null : new Float32Array(16); // reused scratch for f32 writes

      // --- Spawning ---
      let gpuAlive = 0;
      for (let i = 0; i < gpuWatermark; i++) {
        if (!gpuSlots[i].dead) gpuAlive++;
      }
      const fillRatio = Math.min(1, gpuAlive / MAX_PARTICLES);
      const audioRate = 0.15 + 0.4 * (1 - fillRatio);
      const spawnRate = activityLevel > 0.01 ? audioRate * 2 : 0.15;
      if (gpuAlive < MAX_PARTICLES && Math.random() < spawnRate) {
        const slot = gpuGetSlot();
        if (slot >= 0) {
          const pid = nextPid = (nextPid + 1) % PID_MAX;
          const s = gpuSlots[slot];
          s.dead = false; s.pid = pid;
          s.x = Math.random() * w; s.y = Math.random() * h;
          s.vx = (Math.random() - 0.5) * 0.4; s.vy = (Math.random() - 0.5) * 0.4;
          s.canWhiten = Math.random() < getWhiteParticleChance();
          s.life = undefined; // auto-particle
          if (gpuHasF16) {
            const buf = writeParticleF16(
              s.x, s.y, pid, s.vx, s.vy,
              Math.random() * Math.PI * 2, Math.random() * 0.4 + 0.1,
              Math.random() * 2 + 0.5, 0, FADE_FRAMES, 0, 0, 0,
              0.3 + Math.random() * 0.7, RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR,
              s.canWhiten ? 1 : 0
            );
            gpuDevice.queue.writeBuffer(gpuParticleBuf, slot * GPU_PARTICLE_STRIDE, buf);
          } else {
            const tmp = gpuTmpSlot;
            tmp[0] = s.x; tmp[1] = s.y; tmp[2] = s.vx; tmp[3] = s.vy;
            tmp[4] = Math.random() * Math.PI * 2;
            tmp[5] = Math.random() * 0.4 + 0.1;
            tmp[6] = Math.random() * 2 + 0.5;
            tmp[7] = 0;
            tmp[8] = FADE_FRAMES; tmp[9] = 0; tmp[10] = 0; tmp[11] = 0;
            tmp[12] = 0.3 + Math.random() * 0.7;
            tmp[13] = RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR;
            tmp[14] = s.canWhiten ? 1 : 0;
            tmp[15] = pid;
            gpuDevice.queue.writeBuffer(gpuParticleBuf, slot * GPU_PARTICLE_STRIDE, tmp);
          }
        }
      }

      // --- Culling ---
      autoCount = 0;
      for (let i = 0; i < gpuWatermark; i++) {
        if (!gpuSlots[i].dead && gpuSlots[i].life === undefined) autoCount++;
      }
      if (autoCount > THROTTLE_START) {
        const range = MAX_PARTICLES - THROTTLE_START;
        const pressure = (autoCount - THROTTLE_START) / range;
        if (Math.random() < pressure * pressure * pressure * 0.15) {
          const autoIndices = [];
          for (let i = 0; i < gpuWatermark; i++) {
            if (!gpuSlots[i].dead && gpuSlots[i].life === undefined) autoIndices.push(i);
          }
          if (autoIndices.length > 0) {
            const idx = autoIndices[(Math.random() * autoIndices.length) | 0];
            const s = gpuSlots[idx];
            s.life = 1;
            const decay = 0.008 + Math.random() * 0.008;
            if (gpuHasF16) {
              // f16: lifecycle fields at offsets 24-30 (fadeIn, life, decay, baseAlpha)
              const buf = new ArrayBuffer(8);
              const dv = new DataView(buf);
              dv.setFloat16(0, 0, true);           // fadeIn = 0
              dv.setFloat16(2, 1, true);            // life = 1
              dv.setFloat16(4, decay, true);        // decay
              dv.setFloat16(6, s.alpha || 0.2, true); // baseAlpha
              gpuDevice.queue.writeBuffer(gpuParticleBuf, idx * GPU_PARTICLE_STRIDE + 24, buf);
            } else {
              const tmp = new Float32Array([0, 1, decay, s.alpha || 0.2]);
              gpuDevice.queue.writeBuffer(gpuParticleBuf, idx * GPU_PARTICLE_STRIDE + 32, tmp);
            }
          }
        }
      }

      // --- Upload uniforms ---
      gpuUniformF32[0] = time;
      gpuUniformF32[1] = w;
      gpuUniformF32[2] = h;
      gpuUniformF32[3] = btnCX;
      gpuUniformF32[4] = btnCY;
      gpuUniformF32[5] = FRICTION;
      gpuUniformF32[6] = SWIRL_FORCE * speedScale;
      gpuUniformF32[7] = PULL_FORCE * speedScale * speedScale;
      gpuUniformF32[8] = FORCE_RADIUS;
      gpuUniformF32[9] = heroAudioPlaying ? 1.0 : 0.0;
      gpuUniformF32[10] = mouseActive ? mx : 0;
      gpuUniformF32[11] = mouseActive ? my : 0;
      gpuUniformF32[12] = mouseActive ? mouseSwirlMix : 0;
      gpuUniformF32[13] = MOUSE_INTERACTION_MULT;
      gpuUniformU32[14] = rippleHead;
      gpuUniformF32[15] = RIPPLE_INNER_RADIUS;
      gpuUniformF32[16] = HERO_PARTICLE_BRIGHTNESS;
      gpuUniformF32[17] = Math.random() * 1000;
      gpuUniformU32[18] = gpuWatermark;
      gpuUniformF32[19] = gpuResizeScaleX;
      gpuUniformF32[20] = gpuResizeScaleY;
      gpuResizeScaleX = 1.0;
      gpuResizeScaleY = 1.0;

      gpuDevice.queue.writeBuffer(gpuUniformBuf, 0, gpuUniformData);
      gpuDevice.queue.writeBuffer(gpuBrightnessRippleBuf, 0, brightnessRippleBuf);
      gpuDevice.queue.writeBuffer(gpuSpinRippleBuf, 0, spinRippleBuf);

      // --- Process PREVIOUS frame's readback (skip when GPU renders directly) ---
      if (!WEBGPU_RENDER && gpuOutputCPU && gpuFirstReadback) {
        const out = gpuOutputCPU;
        const outDV = gpuHasF16 ? new DataView(out.buffer, out.byteOffset) : null;
        const outU32 = gpuHasF16 ? null : new Uint32Array(out.buffer, out.byteOffset, out.length);
        let pIdx = 0;

        for (let i = 0; i < gpuWatermark; i++) {
          let px, py, pvx, pvy, size, alphaOut, flags;
          if (gpuHasF16) {
            // f16 output: 24 bytes per particle [x:f32, y:f32, vx:f16, vy:f16, size:f16, alpha:f16, pid:u32, flags:u32]
            const byteOff = i * 24;
            if (byteOff + 23 >= out.byteLength) break;
            const dv = outDV;
            px = dv.getFloat32(byteOff, true);
            py = dv.getFloat32(byteOff + 4, true);
            pvx = dv.getFloat16(byteOff + 8, true);
            pvy = dv.getFloat16(byteOff + 10, true);
            size = dv.getFloat16(byteOff + 12, true);
            alphaOut = dv.getFloat16(byteOff + 14, true);
            flags = dv.getUint32(byteOff + 20, true);
          } else {
            // f32 output: 32 bytes per particle (8 floats)
            const off = i * 8;
            if (off + 7 >= out.length) break;
            px = out[off]; py = out[off + 1];
            pvx = out[off + 2]; pvy = out[off + 3];
            size = out[off + 4]; alphaOut = out[off + 5];
            flags = outU32[off + 7];
          }
          const dead = (flags & 1) !== 0;
          const wrapped = (flags & 8) !== 0;

          const s = gpuSlots[i];
          s.prevX = s.x; s.prevY = s.y;
          s.x = px; s.y = py; s.vx = pvx; s.vy = pvy;

          if (dead) {
            if (!s.dead) {
              // Fade out all connections — snapshot positions so slot reuse can't corrupt them
              const pid = s.pid;
              for (const [ck, entry] of connFade) {
                if ((ck / 65536 | 0) === pid || (ck % 65536) === pid) {
                  entry.target = 0;
                  entry.ax = entry.a.x; entry.ay = entry.a.y;
                  entry.bx = entry.b.x; entry.by = entry.b.y;
                  entry.frozen = true;
                }
              }
              s.dead = true;
              gpuFreeSlots.push(i);
            }
            continue;
          }

          // Mark burst particles that just died
          if (s.life !== undefined && s.life > 0) {
            // life is managed on GPU, detect death via dead flag above
          }

          // Wrap cleanup — instant delete (particle teleported, fade would draw cross-screen)
          // Also detect wraps by position jump in case GPU flag was overwritten between readbacks
          const posJumped = !s.dead && (Math.abs(px - s.prevX) > w * 0.25 || Math.abs(py - s.prevY) > h * 0.25);
          if (wrapped || posJumped) {
            const pid = s.pid;
            for (const [ck] of connFade) {
              if ((ck / 65536 | 0) === pid || (ck % 65536) === pid) {
                connFade.delete(ck);
              }
            }
          }

          // Fill render buffer
          let wt = 0;
          if (s.canWhiten) {
            const spd = Math.sqrt(pvx * pvx + pvy * pvy);
            const density = neighborCount[i] / MAX_CONN;
            wt = Math.min(1, Math.max(0, (spd - 0.3) * 0.9) + density * 0.7);
          }
          particleData[pIdx++] = px;
          particleData[pIdx++] = py;
          particleData[pIdx++] = size;
          particleData[pIdx++] = alphaOut;
          particleData[pIdx++] = wt;
          gpuRenderCount++;
        }
        aliveCount = gpuRenderCount;
      }

      // --- Dispatch compute ---
      const commandEncoder = gpuDevice.createCommandEncoder();
      const physicsPass = commandEncoder.beginComputePass();
      physicsPass.setPipeline(gpuPhysicsPipeline);
      physicsPass.setBindGroup(0, gpuBindGroup);
      physicsPass.dispatchWorkgroups(Math.ceil(gpuWatermark / 256));
      physicsPass.end();

      if (WEBGPU_RENDER && gpuConnBindGroup) {
        // ── Connection compute dispatches ──────────────────────────────
        gpuConnSearchFrame++;
        const doSearch = gpuConnSearchFrame >= CONN_SEARCH_INTERVAL;
        if (doSearch) gpuConnSearchFrame = 0;

        // Upload connection uniforms
        const CELL = CONN_REACH;
        const gridCols = Math.ceil(w / CELL) + 1;
        const gridRows = Math.ceil(h / CELL) + 1;
        const connUniformData = new Float32Array(20);
        const connUniformU32 = new Uint32Array(connUniformData.buffer);
        connUniformData[0] = CONN_REACH_SQ;
        connUniformData[1] = CONN_FADE_START_SQ;
        connUniformData[2] = CONN_BUCKET_DIV;
        connUniformU32[3] = MAX_CONN;
        connUniformData[4] = CONN_FADE_IN;
        connUniformData[5] = CONN_FADE_OUT;
        connUniformData[6] = CONN_KILL_ALPHA;
        connUniformU32[7] = doSearch ? 1 : 0;
        connUniformData[8] = lineIntensity;
        connUniformData[9] = HERO_PARTICLE_BRIGHTNESS;
        connUniformU32[10] = gridCols;
        connUniformU32[11] = gridRows;
        connUniformData[12] = CELL;
        connUniformU32[13] = gpuWatermark;
        connUniformU32[14] = MAX_CONN_SLOTS;
        connUniformData[15] = LINE_BASE;
        connUniformU32[16] = SUPER_CONN ? 1 : 0;
        gpuDevice.queue.writeBuffer(gpuConnUniformBuf, 0, connUniformData);

        // Reset atomic counters: [0]=line count, [1]=free list count
        const atomicReset = new Uint32Array([0, 0]);
        const atomicBuf = gpuDevice._usePackedConn ? gpuAuxCounters : gpuConnAtomics;
        gpuDevice.queue.writeBuffer(atomicBuf, 0, atomicReset);

        const wgParticles = Math.ceil(gpuWatermark / 256);
        const wgConns = Math.ceil(MAX_CONN_SLOTS / 256);
        const setConnBindGroups = (pass) => {
          pass.setBindGroup(0, gpuConnBindGroup);
          if (gpuConnBindGroup1) pass.setBindGroup(1, gpuConnBindGroup1);
        };

        if (doSearch) {
          const p1 = commandEncoder.beginComputePass();
          p1.setPipeline(gpuConnPipelines.gridClear);
          setConnBindGroups(p1);
          p1.dispatchWorkgroups(Math.max(wgParticles, 1));
          p1.end();

          const p2 = commandEncoder.beginComputePass();
          p2.setPipeline(gpuConnPipelines.gridCount);
          setConnBindGroups(p2);
          p2.dispatchWorkgroups(wgParticles);
          p2.end();

          const p3 = commandEncoder.beginComputePass();
          p3.setPipeline(gpuConnPipelines.gridPrefixSum);
          setConnBindGroups(p3);
          p3.dispatchWorkgroups(1);
          p3.end();

          const p4 = commandEncoder.beginComputePass();
          p4.setPipeline(gpuConnPipelines.gridScatter);
          setConnBindGroups(p4);
          p4.dispatchWorkgroups(wgParticles);
          p4.end();

          const p5 = commandEncoder.beginComputePass();
          p5.setPipeline(gpuConnPipelines.buildFreeList);
          setConnBindGroups(p5);
          p5.dispatchWorkgroups(wgConns);
          p5.end();

          if (GATHER_SELECT) {
            // Two-pass: gather all candidates, then select closest
            const gatherPass = commandEncoder.beginComputePass();
            gatherPass.setPipeline(gpuConnPipelines.connGather);
            setConnBindGroups(gatherPass);
            gatherPass.dispatchWorkgroups(wgParticles);
            gatherPass.end();

            const selectPass = commandEncoder.beginComputePass();
            selectPass.setPipeline(gpuConnPipelines.connSelect);
            setConnBindGroups(selectPass);
            selectPass.dispatchWorkgroups(wgParticles);
            selectPass.end();
          } else {
            // Single-pass: old connSearch
            const p6 = commandEncoder.beginComputePass();
            p6.setPipeline(gpuConnPipelines.connSearch);
            setConnBindGroups(p6);
            p6.dispatchWorkgroups(wgParticles);
            p6.end();
          }
        }

        const fadePass = commandEncoder.beginComputePass();
        fadePass.setPipeline(gpuConnPipelines.connFade);
        setConnBindGroups(fadePass);
        fadePass.dispatchWorkgroups(Math.ceil(MAX_CONN_SLOTS / 256));
        fadePass.end();

        const indirectPass = commandEncoder.beginComputePass();
        indirectPass.setPipeline(gpuConnPipelines.writeIndirect);
        setConnBindGroups(indirectPass);
        indirectPass.dispatchWorkgroups(1);
        indirectPass.end();

        // ── WebGPU render pass ──────────────────────────────────────────
        // Upload render uniforms
        const whiteCol = getWhiteParticleColor();
        const renderUniformData = new Float32Array([
          w, h,
          (0.06 + brightnessLevel * 0.08) * HERO_PARTICLE_BRIGHTNESS,
          MAX_CONN,
          HERO_GOLD_RGB.r, HERO_GOLD_RGB.g, HERO_GOLD_RGB.b,
          whiteCol.r, whiteCol.g, whiteCol.b,
          0, 0,
        ]);
        gpuDevice.queue.writeBuffer(gpuRenderUniformBuf, 0, renderUniformData);

        const textureView = gpuRenderContext.getCurrentTexture().createView();
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: textureView,
            clearValue: { r: 6/255, g: 6/255, b: 8/255, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });

        // Draw lines (behind particles)
        renderPass.setPipeline(gpuLineRenderPipeline);
        renderPass.setBindGroup(0, gpuLineRenderBindGroup);
        if (gpuDevice._usePackedConn) {
          renderPass.drawIndirect(gpuAuxCounters, 8); // offset 8: skip 2 atomic counter u32s
        } else {
          renderPass.drawIndirect(gpuLineIndirectBuf, 0);
        }

        // Draw particles (quads: 6 vertices per particle)
        renderPass.setPipeline(gpuParticleRenderPipeline);
        renderPass.setBindGroup(0, gpuParticleRenderBindGroup);
        renderPass.draw(6 * gpuWatermark);

        renderPass.end();

        // ── Minimal flags readback for slot recycling ───────────────────
        // Extract flags into compact buffer, then async copy to CPU
        if (!gpuReadbackPending && gpuDevice._flagsExtractPipeline) {
          // We need a bind group for the flags extract shader
          if (!gpuDevice._flagsBindGroup) {
            const flagsExtractUniformBuf = gpuDevice.createBuffer({
              size: 4,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            gpuDevice._flagsExtractUniformBuf = flagsExtractUniformBuf;
            gpuDevice._flagsBindGroup = gpuDevice.createBindGroup({
              layout: gpuDevice._flagsBindGroupLayout,
              entries: [
                { binding: 0, resource: { buffer: gpuOutputBuf } },
                { binding: 1, resource: { buffer: gpuFlagsExtractBuf } },
                { binding: 2, resource: { buffer: flagsExtractUniformBuf } },
              ],
            });
          }
          // Upload particle count uniform
          gpuDevice.queue.writeBuffer(gpuDevice._flagsExtractUniformBuf, 0, new Uint32Array([gpuWatermark]));

          const fxPass = commandEncoder.beginComputePass();
          fxPass.setPipeline(gpuDevice._flagsExtractPipeline);
          fxPass.setBindGroup(0, gpuDevice._flagsBindGroup);
          fxPass.dispatchWorkgroups(Math.ceil(gpuWatermark / 256));
          fxPass.end();

          commandEncoder.copyBufferToBuffer(gpuFlagsExtractBuf, 0, gpuFlagsReadBuf, 0, gpuWatermark * 4);
          // Copy line count (1 u32) for debug HUD
          const lineCountSrc = gpuDevice._usePackedConn ? gpuAuxCounters : gpuConnAtomics;
          commandEncoder.copyBufferToBuffer(lineCountSrc, 0, gpuLineCountReadBuf, 0, 4);
        }

        gpuDevice.queue.submit([commandEncoder.finish()]);

        // Async flags readback for slot recycling + line count
        if (!gpuReadbackPending) {
          gpuReadbackPending = true;
          // Map both readback buffers in parallel
          const flagsPromise = gpuFlagsReadBuf.mapAsync(GPUMapMode.READ);
          const lineCountPromise = gpuLineCountReadBuf.mapAsync(GPUMapMode.READ);
          Promise.all([flagsPromise, lineCountPromise]).then(() => {
            const range = gpuFlagsReadBuf.getMappedRange();
            const flags = new Uint32Array(range);
            for (let i = 0; i < gpuWatermark; i++) {
              const f = flags[i];
              const dead = (f & 1) !== 0;
              const s = gpuSlots[i];
              if (dead && !s.dead) {
                s.dead = true;
                gpuFreeSlots.push(i);
              }
            }
            gpuFlagsReadBuf.unmap();
            gpuLineCount = new Uint32Array(gpuLineCountReadBuf.getMappedRange())[0] || 0;
            gpuLineCountReadBuf.unmap();
            gpuReadbackPending = false;
            gpuFirstReadback = true;
            aliveCount = gpuWatermark - gpuFreeSlots.length;
          }).catch(() => { gpuReadbackPending = false; });
        }

      } else {
        // ── Legacy readback path (WebGL2 render) ──────────────────────
        // Copy output to readback buffer only if it's not currently mapped/pending
        if (!gpuReadbackPending) {
          const readbackBytes = gpuWatermark * GPU_OUTPUT_STRIDE;
          commandEncoder.copyBufferToBuffer(gpuOutputBuf, 0, gpuOutputReadBuf, 0, readbackBytes);
        }
        gpuDevice.queue.submit([commandEncoder.finish()]);

        // Start async readback for NEXT frame (skip if previous still pending)
        if (!gpuReadbackPending) {
          gpuReadbackPending = true;
          gpuOutputReadBuf.mapAsync(GPUMapMode.READ).then(() => {
            const range = gpuOutputReadBuf.getMappedRange();
            if (gpuHasF16) {
              const mapped = new Uint8Array(range);
              if (!gpuOutputCPU || gpuOutputCPU.byteLength < mapped.byteLength) {
                gpuOutputCPU = new Uint8Array(mapped.byteLength);
              }
              gpuOutputCPU.set(mapped);
            } else {
              const mapped = new Float32Array(range);
              if (!gpuOutputCPU || gpuOutputCPU.length < mapped.length) {
                gpuOutputCPU = new Float32Array(mapped.length);
              }
              gpuOutputCPU.set(mapped);
            }
            gpuOutputReadBuf.unmap();
            gpuReadbackPending = false;
            gpuFirstReadback = true;
          }).catch(() => { gpuReadbackPending = false; });
        }
      }

    // ==================================================================
    // GPU PHYSICS PATH (Transform Feedback)
    // ==================================================================
    } else if (GPU_PHYSICS) {
      // Upload ripple texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rippleTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RIPPLE_BUF_LEN, 1, gl.RED, gl.FLOAT, spinRippleBuf);

      // --- Spawning ---
      const aliveApprox = highWater - freeSlots.length;
      const fillRatio = Math.min(1, aliveApprox / MAX_PARTICLES);
      const audioRate = 0.15 + 0.4 * (1 - fillRatio);
      const spawnRate = activityLevel > 0.01 ? audioRate * 2 : 0.15;
      if (aliveApprox < MAX_PARTICLES && Math.random() < spawnRate) {
        spawnQueue.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
          phase: Math.random() * Math.PI * 2,
          alpha: Math.random() * 0.4 + 0.1,
          r: Math.random() * 2 + 0.5,
          age: 0, fadeIn: FADE_FRAMES,
          life: 0, decay: 0, baseAlpha: 0,
          reactivity: 0,
          rippleSpeed: RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR
        });
      }
      while (spawnQueue.length > 0) {
        const slot = getSlot();
        if (slot < 0) { spawnQueue.length = 0; break; }
        writeParticleToGPU(slot, spawnQueue.pop());
      }

      // --- Transform feedback pass ---
      gl.useProgram(tfUpdateProg);
      gl.uniform1f(tfLoc.u_time, time);
      gl.uniform1f(tfLoc.u_audioIntensity, audioIntensity);
      gl.uniform1f(tfLoc.u_audioTransient, audioTransient);
      gl.uniform1f(tfLoc.u_mouseX, mx);
      gl.uniform1f(tfLoc.u_mouseY, my);
      gl.uniform1f(tfLoc.u_mouseSwirlMix, mouseActive ? mouseSwirlMix : 0);
      gl.uniform2f(tfLoc.u_btnCenter, btnCX, btnCY);
      gl.uniform2f(tfLoc.u_resolution, w, h);
      gl.uniform1i(tfLoc.u_rippleHead, rippleHead);
      gl.uniform1f(tfLoc.u_seed, Math.random() * 1000);
      gl.uniform1f(tfLoc.u_brightness, HERO_PARTICLE_BRIGHTNESS);
      gl.uniform1f(tfLoc.u_heroPlaying, heroAudioPlaying ? 1.0 : 0.0);
      gl.uniform1f(tfLoc.u_friction, FRICTION);
      gl.uniform1f(tfLoc.u_rippleInnerRadius, RIPPLE_INNER_RADIUS);
      gl.uniform1i(tfLoc.u_rippleTex, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindVertexArray(tfVAO[tfCurrent]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfObj);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tfBuf[1 - tfCurrent]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, highWater);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.bindVertexArray(null);

      tfCurrent = 1 - tfCurrent;

      // --- CPU readback ---
      gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[tfCurrent]);
      gl.getBufferSubData(gl.ARRAY_BUFFER, 0, cpuReadback, 0, highWater * FPP);

      // Update proxies, detect dead, detect wraps
      const halfW = w * 0.5, halfH = h * 0.5;
      for (let i = 0; i < highWater; i++) {
        const off = i * FPP;
        const life = cpuReadback[off + 9];
        const p = cpuParticles[i];
        const newX = cpuReadback[off];
        const newY = cpuReadback[off + 1];
        if (!p.dead && (Math.abs(newX - p.x) > halfW || Math.abs(newY - p.y) > halfH)) {
          const pid = p.pid;
          for (const [ck] of connFade) {
            if ((ck / 65536 | 0) === pid || (ck % 65536) === pid) {
              connFade.delete(ck);
            }
          }
        }
        p.x = newX;
        p.y = newY;
        p.pid = pids[i];
        p.life = life;
        if (life < -900) {
          if (!p.dead) {
            const pid = p.pid;
            for (const [ck, entry] of connFade) {
              if ((ck / 65536 | 0) === pid || (ck % 65536) === pid) {
                entry.target = 0;
                entry.ax = entry.a.x; entry.ay = entry.a.y;
                entry.bx = entry.b.x; entry.by = entry.b.y;
                entry.frozen = true;
              }
            }
          }
          p.dead = true;
          if (!isFree[i]) { freeSlots.push(i); isFree[i] = 1; }
        } else {
          p.dead = false;
          aliveCount++;
          if (life === 0 || (life <= 0 && life > -900)) autoCount++;
        }
      }

      // --- Culling ---
      if (autoCount > THROTTLE_START) {
        const range = MAX_PARTICLES - THROTTLE_START;
        const pressure = (autoCount - THROTTLE_START) / range;
        if (Math.random() < pressure * pressure * pressure * 0.15) {
          const autoIndices = [];
          for (let i = 0; i < highWater; i++) {
            if (!cpuParticles[i].dead && cpuReadback[i * FPP + 9] === 0) autoIndices.push(i);
          }
          if (autoIndices.length > 0) {
            const ci = autoIndices[(Math.random() * autoIndices.length) | 0];
            const off = ci * FPP;
            const cullDecay = 0.008 + Math.random() * 0.008;
            const cullAlpha = cpuReadback[off + 5];
            const cullBuf = new Float32Array([cpuReadback[off + 8], 1.0, cullDecay, cullAlpha]);
            gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[tfCurrent]);
            gl.bufferSubData(gl.ARRAY_BUFFER, ci * STRIDE + 32, cullBuf);
          }
        }
      }

    // ==================================================================
    // CPU PHYSICS PATH
    // ==================================================================
    } else {
      // --- Particle lifecycle ---
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.age !== undefined) p.age++;
        if (p.life !== undefined) {
          p.life -= p.decay;
          if (p.life <= 0) { p.dead = true; particles.splice(i, 1); continue; }
          p.alpha = p.baseAlpha * p.life;
        }
      }

      // --- Auto-spawn ---
      const fillRatio = Math.min(1, particles.length / MAX_PARTICLES);
      const audioRate = 0.15 + 0.4 * (1 - fillRatio);
      const spawnRate = activityLevel > 0.01 ? audioRate * 2 : 0.15;
      if (particles.length < MAX_PARTICLES && Math.random() < spawnRate) {
        particles.push({
          pid: nextPid = (nextPid + 1) % PID_MAX,
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
          r: Math.random() * 2 + 0.5, alpha: Math.random() * 0.4 + 0.1,
          phase: Math.random() * Math.PI * 2, age: 0, fadeIn: FADE_FRAMES,
          rippleSpeed: RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR,
          canWhiten: Math.random() < getWhiteParticleChance()
        });
      }

      // --- Culling ---
      if (particles.length > THROTTLE_START || (isLocal && debugHudVisible)) {
        autoCount = particles.reduce((n, p) => n + (p.life === undefined ? 1 : 0), 0);
      }
      if (autoCount > THROTTLE_START) {
        const range = MAX_PARTICLES - THROTTLE_START;
        const pressure = (autoCount - THROTTLE_START) / range;
        if (Math.random() < pressure * pressure * pressure * 0.15) {
          const autoIndices = [];
          for (let i = 0; i < particles.length; i++) {
            if (particles[i].life === undefined) autoIndices.push(i);
          }
          if (autoIndices.length > 0) {
            const idx = autoIndices[(Math.random() * autoIndices.length) | 0];
            const p = particles[idx];
            p.life = 1;
            p.culled = true;
            p.baseAlpha = p.alpha;
            p.decay = 0.008 + Math.random() * 0.008;
          }
        }
      }

      if (isLocal && debugHudVisible) aliveCount = particles.length;
    }

    // ==================================================================
    // SPATIAL GRID + CONNECTION LINES (CPU — skipped when GPU handles it)
    // ==================================================================
    let lineVertCount = 0;
    let lineIdx = 0;
    lineIntensity += (brightnessLevel - lineIntensity) * 0.05;
    if (!WEBGPU_RENDER) {
    const pSource = WEBGPU_ACTIVE ? gpuSlots : (GPU_PHYSICS ? cpuParticles : particles);
    const pCount  = WEBGPU_ACTIVE ? gpuWatermark : (GPU_PHYSICS ? highWater : particles.length);

    // Connection search runs every CONN_SEARCH_INTERVAL frames (1 = every frame, 2 = every other, etc.)
    connSearchFrame = (connSearchFrame + 1) % CONN_SEARCH_INTERVAL;
    const doConnSearch = connSearchFrame === 0;

    if (doConnSearch) {
      // Build grid
      const CELL = CONN_REACH;
      const cols = Math.ceil(w / CELL) + 1;
      grid.clear();
      for (let i = 0; i < pCount; i++) {
        if ((GPU_PHYSICS || WEBGPU_ACTIVE) && pSource[i].dead) continue;
        const p = pSource[i];
        const key = ((p.x / CELL) | 0) + ((p.y / CELL) | 0) * cols;
        const cell = grid.get(key);
        if (cell) { cell.push(i); } else { grid.set(key, [i]); }
      }

      neighborCount.fill(0);
      const connCount = neighborCount;
      const aiBrightBoost = 1 + lineIntensity * 2;
      const lineAlphas = [
        LINE_BASE * aiBrightBoost * HERO_PARTICLE_BRIGHTNESS,
        LINE_BASE * 0.8 * aiBrightBoost * HERO_PARTICLE_BRIGHTNESS,
        LINE_BASE * 0.6 * aiBrightBoost * HERO_PARTICLE_BRIGHTNESS,
        LINE_BASE * 0.4 * aiBrightBoost * HERO_PARTICLE_BRIGHTNESS,
        LINE_BASE * 0.2 * aiBrightBoost * HERO_PARTICLE_BRIGHTNESS
      ];

      framePairs.clear();

    for (const [key, cell] of grid) {
      const gx = key % cols, gy = (key / cols) | 0;
      for (let nx = gx; nx <= gx + 1; nx++) {
        for (let ny = gy - 1; ny <= gy + 1; ny++) {
          if (nx === gx && ny < gy) continue;
          const nk = nx + ny * cols;
          const neighbor = nk === key ? cell : grid.get(nk);
          if (!neighbor) continue;
          for (let ii = 0; ii < cell.length; ii++) {
            const ai = cell[ii];
            const a = pSource[ai];
            if (connCount[ai] >= MAX_CONN) continue;
            const aBurst = GPU_PHYSICS ? a.life > 0 : a.life !== undefined;
            const jStart = nk === key ? ii + 1 : 0;
            for (let jj = jStart; jj < neighbor.length; jj++) {
              const bi = neighbor[jj];
              const b = pSource[bi];
              if (connCount[bi] >= MAX_CONN) continue;
              if (aBurst && (GPU_PHYSICS ? b.life > 0 : b.life !== undefined)) continue;
              const dx = a.x - b.x, dy = a.y - b.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < CONN_REACH_SQ) {
                const bucket = Math.min((d2 / CONN_BUCKET_DIV) | 0, 4);
                const edgeFade = d2 < CONN_FADE_START_SQ ? 1 : 1 - (d2 - CONN_FADE_START_SQ) / (CONN_REACH_SQ - CONN_FADE_START_SQ);
                const targetAlpha = lineAlphas[bucket] * edgeFade;
                const pidA = a.pid, pidB = b.pid;
                const ck = pidA < pidB ? pidA * 65536 + pidB : pidB * 65536 + pidA;
                framePairs.add(ck);
                let entry = connFade.get(ck);
                if (!entry) {
                  entry = { alpha: 0, target: targetAlpha, a, b };
                  connFade.set(ck, entry);
                } else {
                  entry.target = targetAlpha;
                  entry.a = a;
                  entry.b = b;
                  entry.frozen = false;
                }
                connCount[ai]++;
                connCount[bi]++;
              }
            }
          }
        }
      }
    }
    } // end if (doConnSearch)

    // --- Update fade map (runs EVERY frame for smooth animation) ---
    lineIdx = 0;
    const toDelete = [];
    for (const [ck, entry] of connFade) {
      if (!entry.frozen && (entry.a.dead || entry.b.dead)) {
        entry.target = 0;
        entry.ax = entry.a.x; entry.ay = entry.a.y;
        entry.bx = entry.b.x; entry.by = entry.b.y;
        entry.frozen = true;
      }
      if (doConnSearch && !framePairs.has(ck)) {
        entry.target = 0;
      }
      const rate = entry.target > entry.alpha ? CONN_FADE_IN : CONN_FADE_OUT;
      entry.alpha += (entry.target - entry.alpha) * rate;
      if (entry.alpha < CONN_KILL_ALPHA && entry.target === 0) {
        toDelete.push(ck);
        continue;
      }
      if (lineIdx < MAX_LINES * LFLOATS) {
        const ax = entry.frozen ? entry.ax : entry.a.x;
        const ay = entry.frozen ? entry.ay : entry.a.y;
        const bx = entry.frozen ? entry.bx : entry.b.x;
        const by = entry.frozen ? entry.by : entry.b.y;
        // const cdx = ax - bx, cdy = ay - by;
        // const cDist2 = cdx * cdx + cdy * cdy;
        // if (!entry.frozen && cDist2 > w * w * 0.25) {
        //   const pidA = ck / 65536 | 0, pidB = ck % 65536;
        //   console.warn('cross-screen conn', { dist: Math.sqrt(cDist2).toFixed(0), pidA, pidB, ax: ax.toFixed(0), ay: ay.toFixed(0), bx: bx.toFixed(0), by: by.toFixed(0), alpha: entry.alpha.toFixed(3), target: entry.target });
        //   toDelete.push(ck);
        //   continue;
        // }
        lineData[lineIdx++] = ax;
        lineData[lineIdx++] = ay;
        lineData[lineIdx++] = entry.alpha;
        lineData[lineIdx++] = bx;
        lineData[lineIdx++] = by;
        lineData[lineIdx++] = entry.alpha;
      }
    }
    for (const ck of toDelete) connFade.delete(ck);
    lineVertCount = lineIdx / 3;
    } // end if (!WEBGPU_RENDER) — CPU connection code

    // ==================================================================
    // CPU PHYSICS LOOP (only when !GPU_PHYSICS and !WEBGPU_ACTIVE)
    // ==================================================================
    let activeCount = 0;
    if (WEBGPU_RENDER) {
      activeCount = aliveCount || (gpuWatermark - gpuFreeSlots.length);
    } else if (WEBGPU_ACTIVE) {
      activeCount = gpuRenderCount || 0;
    } else if (!GPU_PHYSICS) {
      let pIdx = 0;
      const attenuationRadius = Math.max(w, h) * FORCE_RADIUS;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const wave = fastSin(time * 2 + p.phase) * 0.5 + 0.5;
        const fadeIn = p.fadeIn !== undefined ? Math.min(1, p.age / p.fadeIn) : 1;
        const react = p.reactivity || 0;
        const dxB = p.x - btnCX, dyB = p.y - btnCY;
        const distFromBtn = Math.sqrt(dxB * dxB + dyB * dyB);
        const localBrightnessIntensity = getDelayedIntensity(brightnessRippleBuf, distFromBtn, p.rippleSpeed || RIPPLE_SPEED_BASE);
        const localSpinIntensity = getDelayedIntensity(spinRippleBuf, distFromBtn, p.rippleSpeed || RIPPLE_SPEED_BASE);
        const radialBase = Math.max(0, 1 - distFromBtn / attenuationRadius);
        const radialAttenuation = fastPow15(radialBase);
        const brightnessLocal = localBrightnessIntensity * radialAttenuation;
        const br = brightnessLocal * react;
        const audioBoost = br > 0.001 ? br * (0.8 + fastSin(time * 3.7 + p.phase * 2) * 0.3) : 0;
        const tremble = br > 0.001 ? (Math.random() - 0.5) * 0.12 * br : 0;
        const currentAlpha = Math.min(1, (p.alpha * (0.5 + wave * 0.5) + audioBoost * 1.5 + tremble) * fadeIn * HERO_PARTICLE_BRIGHTNESS);
        const currentR = p.r * (0.8 + wave * 0.4) * (1 + audioBoost * 0.5);

        // Fill GPU buffer — color shift from speed + local density
        let wt = 0;
        if (p.canWhiten) {
          const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          const density = neighborCount[i] / MAX_CONN;
          wt = Math.min(1, Math.max(0, (spd - 0.3) * 0.9) + density * 0.7);
        }
        particleData[pIdx++] = p.x;
        particleData[pIdx++] = p.y;
        particleData[pIdx++] = Math.max(3, currentR * 6);
        particleData[pIdx++] = currentAlpha;
        particleData[pIdx++] = wt;

        // Physics: position update
        p.x += p.vx;
        p.y += p.vy;

        // Audio swirl
        {
          const dist = distFromBtn || 1;
          const proximity = Math.max(0, 1 - dist / attenuationRadius);
          if (localSpinIntensity > 0.01 && proximity > 0) {
            const nx = dxB / dist, ny = dyB / dist;
            const swirlStr = localSpinIntensity * proximity * SWIRL_FORCE * speedScale;
            p.vx += -ny * swirlStr;
            p.vy += nx * swirlStr;
            const pull = localSpinIntensity * proximity * PULL_FORCE * speedScale * speedScale;
            p.vx -= nx * pull;
            p.vy -= ny * pull;
            const jit = react * 0.25 * localSpinIntensity;
            p.vx += (Math.random() - 0.5) * jit;
            p.vy += (Math.random() - 0.5) * jit;
          }
          if (localSpinIntensity < 0.5 && localSpinIntensity > 0.001 && !heroAudioPlaying && dist > 1) {
            const nx = dxB / dist, ny = dyB / dist;
            const spread = (0.5 - localSpinIntensity) * 0.008;
            p.vx += nx * spread;
            p.vy += ny * spread;
          }
        }

        // Mouse attraction/swirl (only after first real mouse movement)
        if (mouseActive && mouseSwirlMix > 0.001) {
          const dmx = mx - p.x, dmy = my - p.y;
          const d2 = dmx * dmx + dmy * dmy;
          if (d2 < 336400) {
            const mdist = Math.sqrt(d2);
            const proximity = 1 - mdist / 580;
            const force = proximity * 0.00006 * mouseSwirlMix * MOUSE_INTERACTION_MULT;
            const swirl = proximity * 0.00008 * mouseSwirlMix * MOUSE_INTERACTION_MULT;
            p.vx += dmx * force + dmy * swirl;
            p.vy += dmy * force + (-dmx) * swirl;
          }
        }

        p.vx *= FRICTION;
        p.vy *= FRICTION;

        // Edge wrapping
        let wrapped = false;
        if (p.x < 0) { p.x = w; wrapped = true; }
        else if (p.x > w) { p.x = 0; wrapped = true; }
        if (p.y < 0) { p.y = 0; p.x = w - p.x; p.vy = Math.abs(p.vy); wrapped = true; }
        else if (p.y > h) { p.y = h; p.x = w - p.x; p.vy = -Math.abs(p.vy); wrapped = true; }
        if (wrapped) {
          const pid = p.pid;
          for (const [ck] of connFade) {
            if ((ck / 65536 | 0) === pid || (ck % 65536) === pid) {
              connFade.delete(ck);
            }
          }
        }
      }
      activeCount = particles.length;
    }

    // ==================================================================
    // RENDER (WebGL2 — skipped when WebGPU renders directly)
    // ==================================================================
    if (!WEBGPU_RENDER) {
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw lines (behind particles)
    if (lineVertCount > 0) {
      gl.useProgram(lineProg);
      gl.uniform2f(lLoc.resolution, w, h);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData.subarray(0, lineIdx));
      gl.bindVertexArray(lineVAO);
      gl.drawArrays(gl.LINES, 0, lineVertCount);
    }

    // Draw particles
    const whiteParticleColor = getWhiteParticleColor();
    if (GPU_PHYSICS) {
      if (highWater > 0) {
        gl.useProgram(particleProg);
        gl.uniform2f(pLoc.resolution, w, h);
        gl.uniform1f(pLoc.glowAlpha, (0.06 + brightnessLevel * 0.08) * HERO_PARTICLE_BRIGHTNESS);
        gl.uniform3f(pLoc.whiteColor, whiteParticleColor.r, whiteParticleColor.g, whiteParticleColor.b);
        gl.bindVertexArray(renderVAO[tfCurrent]);
        gl.drawArrays(gl.POINTS, 0, highWater);
      }
    } else {
      if (activeCount > 0) {
        gl.useProgram(particleProg);
        gl.uniform2f(pLoc.resolution, w, h);
        gl.uniform1f(pLoc.glowAlpha, (0.06 + brightnessLevel * 0.08) * HERO_PARTICLE_BRIGHTNESS);
        gl.uniform3f(pLoc.whiteColor, whiteParticleColor.r, whiteParticleColor.g, whiteParticleColor.b);
        gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, particleData.subarray(0, activeCount * PFLOATS));
        gl.bindVertexArray(cpuRenderVAO);
        gl.drawArrays(gl.POINTS, 0, activeCount);
      }
    }

    gl.bindVertexArray(null);
    } // end if (!WEBGPU_RENDER) — WebGL2 render

    if (SHOW_RIPPLE_RADIUS && RIPPLE_INNER_RADIUS > 0) {
      if (!radiusLocked) {
        const elapsed = rippleClickTime > 0 ? (now - rippleClickTime) / 1000 : 0;
        radiusFadeOpacity = rippleClickTime > 0 ? Math.min(1, Math.max(0, (elapsed - 7) / 5)) : 0;
        if (radiusFadeOpacity >= 1) radiusLocked = true;
      }
      if (radiusFadeOpacity > 0) {
        const canRect = canvas.getBoundingClientRect();
        const scalePx = canRect.width / w;
        const radiusPx = RIPPLE_INNER_RADIUS * scalePx;
        rippleRadiusOverlay.style.display = 'block';
        rippleRadiusOverlay.style.opacity = `${radiusFadeOpacity}`;
        rippleRadiusOverlay.style.width = `${radiusPx * 2}px`;
        rippleRadiusOverlay.style.height = `${radiusPx * 2}px`;
        rippleRadiusOverlay.style.left = `${(btnCX / w) * canRect.width}px`;
        rippleRadiusOverlay.style.top = `${(btnCY / h) * canRect.height}px`;
      } else {
        rippleRadiusOverlay.style.display = 'none';
        rippleRadiusOverlay.style.opacity = '0';
      }
    } else {
      rippleRadiusOverlay.style.display = 'none';
      rippleRadiusOverlay.style.opacity = '0';
    }

    if (isLocal && debugHudVisible) {
      fpsFrames++;
      const frameTime = performance.now() - now;
      ftSmooth += (frameTime - ftSmooth) * 0.1;
      const hudElapsed = now - debugHudLastUpdate;
      if (hudElapsed >= DEBUG_HUD_UPDATE_MS) {
        fpsValue = Math.round(fpsFrames * (1000 / hudElapsed));
        fpsFrames = 0;
        debugHudLastUpdate = now;
        fpsEl.textContent = `${fpsValue} fps`;
        const budget = 1000 / (fpsValue || 60);
        const pct = Math.round(ftSmooth / budget * 100);
        ftEl.textContent = `${pct}%`;
        ftEl.style.color = pct < 50 ? '#4caf50' : pct < 75 ? '#f0c040' : '#f44336';
        ftAvgBuf[ftAvgIdx] = pct;
        ftAvgIdx = (ftAvgIdx + 1) % FT_AVG_SAMPLES;
        if (ftAvgCount < FT_AVG_SAMPLES) ftAvgCount++;
        let ftAvgSum = 0;
        for (let i = 0; i < ftAvgCount; i++) ftAvgSum += ftAvgBuf[i];
        ftAvgEl.textContent = `${Math.round(ftAvgSum / ftAvgCount)}%`;
        const burstCount = aliveCount - autoCount;
        debugConnCountEl.textContent = `Active conn: ${WEBGPU_RENDER ? gpuLineCount : Math.round(lineVertCount / 2)}`;
        autoStat.statValueEl.textContent = `${autoCount}`;
        burstStat.statValueEl.textContent = `${burstCount}`;
        totalStat.statValueEl.textContent = `${aliveCount}`;
        highWaterEl.textContent = WEBGPU_ACTIVE ? `WebGPU HW:${gpuWatermark}` : (GPU_PHYSICS ? `HW:${highWater}` : '');
        // console.log(`grid:${grid.size} conn:${connFade.size} particles:${WEBGPU_ACTIVE ? gpuWatermark : (GPU_PHYSICS ? highWater : particles.length)} pid:${nextPid}${WEBGPU_ACTIVE ? ' [WebGPU]' : ''}`);
      }
    }
  }

  // ─── Click + drag to spawn bursts ────────────────────────────────────
  let heroDragging = false;
  const heroEl = document.getElementById('hero');

  function spawnBurst(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = w / rect.width;
    const scaleY = h / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const count = heroDragging ? 1 : 1 + Math.floor(Math.random() * 2);

    if (WEBGPU_ACTIVE) {
      for (let i = 0; i < count; i++) {
        const slot = gpuGetSlot();
        if (slot < 0) break;
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.3 + Math.random() * 0.6;
        const baseAlpha = 0.3 + Math.random() * 0.4;
        const pid = nextPid = (nextPid + 1) % PID_MAX;
        const decay = 0.0003 + Math.random() * 0.0007;
        const fadeIn = 15 + Math.floor(Math.random() * 15);
        const s = gpuSlots[slot];
        s.dead = false; s.pid = pid;
        s.x = cx + (Math.random() - 0.5) * 50;
        s.y = cy + (Math.random() - 0.5) * 50;
        s.vx = Math.cos(angle) * speed;
        s.vy = Math.sin(angle) * speed;
        s.canWhiten = Math.random() < getWhiteParticleChance();
        s.life = 1; s.alpha = baseAlpha;
        if (gpuHasF16) {
          const buf = writeParticleF16(
            s.x, s.y, pid, s.vx, s.vy,
            Math.random() * Math.PI * 2, baseAlpha,
            Math.random() * 2 + 0.5, 0, fadeIn, 1, decay, baseAlpha,
            0, RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR,
            s.canWhiten ? 1 : 0
          );
          gpuDevice.queue.writeBuffer(gpuParticleBuf, slot * GPU_PARTICLE_STRIDE, buf);
        } else {
          const tmp = new Float32Array(16);
          tmp[0] = s.x; tmp[1] = s.y; tmp[2] = s.vx; tmp[3] = s.vy;
          tmp[4] = Math.random() * Math.PI * 2; tmp[5] = baseAlpha;
          tmp[6] = Math.random() * 2 + 0.5; tmp[7] = 0;
          tmp[8] = fadeIn; tmp[9] = 1; tmp[10] = decay; tmp[11] = baseAlpha;
          tmp[12] = 0; tmp[13] = RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR;
          tmp[14] = s.canWhiten ? 1 : 0; tmp[15] = pid;
          gpuDevice.queue.writeBuffer(gpuParticleBuf, slot * GPU_PARTICLE_STRIDE, tmp);
        }
      }
    } else if (GPU_PHYSICS) {
      if (highWater >= BUFFER_CAP && freeSlots.length === 0) return;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.3 + Math.random() * 0.6;
        const baseAlpha = 0.3 + Math.random() * 0.4;
        spawnQueue.push({
          x: cx + (Math.random() - 0.5) * 50,
          y: cy + (Math.random() - 0.5) * 50,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          phase: Math.random() * Math.PI * 2,
          alpha: baseAlpha,
          r: Math.random() * 2 + 0.5,
          age: 0, fadeIn: 15 + Math.floor(Math.random() * 15),
          life: 1, decay: 0.0003 + Math.random() * 0.0007,
          baseAlpha,
          reactivity: 0,
          rippleSpeed: RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR
        });
      }
    } else {
      if (particles.length >= BUFFER_CAP) return;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.3 + Math.random() * 0.6;
        const baseAlpha = 0.3 + Math.random() * 0.4;
        particles.push({
          pid: nextPid = (nextPid + 1) % PID_MAX,
          x: cx + (Math.random() - 0.5) * 50,
          y: cy + (Math.random() - 0.5) * 50,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: Math.random() * 2 + 0.5,
          alpha: baseAlpha,
          baseAlpha,
          phase: Math.random() * Math.PI * 2,
          life: 1,
          decay: 0.0003 + Math.random() * 0.0007,
          age: 0, fadeIn: 15 + Math.floor(Math.random() * 15),
          rippleSpeed: RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR,
          canWhiten: Math.random() < getWhiteParticleChance()
        });
      }
    }
  }

  heroEl.addEventListener('mousedown', (e) => { heroDragging = true; spawnBurst(e); });
  heroEl.addEventListener('mousemove', (e) => { if (heroDragging) spawnBurst(e); });
  window.addEventListener('mouseup', () => { heroDragging = false; });

  window.addEventListener('resize', () => {
    const oldW = w, oldH = h;
    resize();
    if (oldW && oldH) {
      const sx = w / oldW, sy = h / oldH;
      if (GPU_PHYSICS && highWater > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[tfCurrent]);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, cpuReadback, 0, highWater * FPP);
        for (let i = 0; i < highWater; i++) {
          const off = i * FPP;
          cpuReadback[off] *= sx;
          cpuReadback[off + 1] *= sy;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[0]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpuReadback.subarray(0, highWater * FPP));
        gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf[1]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpuReadback.subarray(0, highWater * FPP));
      } else if (WEBGPU_RENDER) {
        // Let the GPU physics shader handle rescaling on next frame
        gpuResizeScaleX = sx;
        gpuResizeScaleY = sy;
      } else if (WEBGPU_ACTIVE) {
        for (let i = 0; i < gpuWatermark; i++) {
          if (gpuSlots[i].dead) continue;
          gpuSlots[i].x *= sx; gpuSlots[i].y *= sy;
          const posData = new Float32Array([gpuSlots[i].x, gpuSlots[i].y]);
          gpuDevice.queue.writeBuffer(gpuParticleBuf, i * GPU_PARTICLE_STRIDE, posData);
        }
      } else if (!GPU_PHYSICS) {
        for (const p of particles) { p.x *= sx; p.y *= sy; }
      }
    }
  });
  resize();
  // If WebGPU is expected, skip CPU init — initWebGPU() will call init() when ready
  if (!navigator.gpu) init();
  registerDraw(draw);
}


// ===== Hero: Canvas 2D fallback =====
function initHeroCanvas2D() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  const savedSeed = localStorage.getItem('sonara_seedParticles');
  const savedMax = localStorage.getItem('sonara_maxParticles');
  const maxParticles = savedMax ? +savedMax : (isMobileView ? HERO_DEBUG_DEFAULTS.maxParticles.mobile : HERO_DEBUG_DEFAULTS.maxParticles.desktop);
  const seedParticles = savedSeed ? +savedSeed : (isMobileView ? HERO_DEBUG_DEFAULTS.seedParticles.mobile : HERO_DEBUG_DEFAULTS.seedParticles.desktop);
  const PARTICLE_COUNT = Math.min(seedParticles, maxParticles);
  let particles = [];
  let time = 0;
  const heroVis = trackVisibility('hero');
  let heroAudioPlaying = false;
  let brightnessIntensity = 0;
  let brightnessTransient = 0;
  let audioIntensity = 0;
  let audioTransient = 0;
  const heroRmsData = new Uint8Array(128);
  let rmsSmooth = 0;
  let lastRippleTime = 0;
  const listenBtn = document.querySelector('#hero .listen-btn');

  function spawnRipple() {
    if (!listenBtn) return;
    const ring = document.createElement('span');
    ring.className = 'listen-ring';
    const dur = 4 + Math.random() * 3; // 4–7s, variable
    ring.style.animation = `ripple ${dur}s ease-out forwards`;
    listenBtn.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove());
  }
  if (listenBtn) {
    const mo = new MutationObserver(() => {
      heroAudioPlaying = listenBtn.classList.contains('playing');
    });
    mo.observe(listenBtn, { attributes: true, attributeFilter: ['class'] });
  }

  function resize() {
    w = canvas.width = canvas.offsetWidth * (window.devicePixelRatio > 1 ? 1.5 : 1);
    h = canvas.height = canvas.offsetHeight * (window.devicePixelRatio > 1 ? 1.5 : 1);
    canvas.style.width = canvas.offsetWidth + 'px';
    canvas.style.height = canvas.offsetHeight + 'px';
  }

  function init() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5, alpha: Math.random() * 0.4 + 0.1,
        phase: Math.random() * Math.PI * 2, reactivity: 0.3 + Math.random() * 0.7,
        canWhiten: Math.random() < getWhiteParticleChance()
      });
    }
  }

  function draw() {
    if (!heroVis.visible) return;
    c.clearRect(0, 0, w, h);
    time += 0.005;
    const whiteParticleColor = getWhiteParticleColor();
    if (isMobileView) {
      const t = performance.now() * 0.001;
      const breath = Math.sin(t * 0.52) * 0.5 + 0.5;
      const swell  = Math.sin(t * 1.26 + 1.7) * 0.5 + 0.5;
      const shimmer = Math.sin(t * 3.5 + 0.3) * 0.5 + 0.5;
      const synthetic = breath * 0.55 + swell * 0.3 + shimmer * 0.15;
      const target = synthetic * 0.55 + 0.05;
      brightnessIntensity += ((target > brightnessIntensity ? BRIGHTNESS_ATTACK : BRIGHTNESS_RELEASE) * (target - brightnessIntensity));
      brightnessTransient += ((target > brightnessTransient ? BRIGHTNESS_ATTACK : BRIGHTNESS_RELEASE) * (target - brightnessTransient));
      audioIntensity += ((target > audioIntensity ? SPIN_ATTACK : SPIN_RELEASE) * (target - audioIntensity));
      audioTransient += ((target > audioTransient ? SPIN_ATTACK : SPIN_RELEASE) * (target - audioTransient));
      rmsSmooth += (target - rmsSmooth) * 0.018;
    } else {
    const heroAn = getHeroAnalyser();
    if (heroAn) {
      heroAn.getByteTimeDomainData(heroRmsData);
      let sum = 0;
      for (let i = 0; i < heroRmsData.length; i++) { const v = (heroRmsData[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / heroRmsData.length);
      const target = Math.min(1, rms * 10);
      brightnessIntensity += ((target > brightnessIntensity ? BRIGHTNESS_ATTACK : BRIGHTNESS_RELEASE) * (target - brightnessIntensity));
      brightnessTransient += ((target > brightnessTransient ? BRIGHTNESS_ATTACK : BRIGHTNESS_RELEASE) * (target - brightnessTransient));
      audioIntensity += ((target > audioIntensity ? SPIN_ATTACK : SPIN_RELEASE) * (target - audioIntensity));
      audioTransient += ((target > audioTransient ? SPIN_ATTACK : SPIN_RELEASE) * (target - audioTransient));
      rmsSmooth += (target - rmsSmooth) * 0.018;
      const now = performance.now();
      if (rippleFirstPlay && target > rmsSmooth + 0.35 && now - lastRippleTime > 1200) { spawnRipple(); lastRippleTime = now; }
    } else {
      brightnessIntensity += (0 - brightnessIntensity) * BRIGHTNESS_RELEASE;
      brightnessTransient += (0 - brightnessTransient) * BRIGHTNESS_RELEASE;
      audioIntensity += (0 - audioIntensity) * SPIN_RELEASE;
      audioTransient += (0 - audioTransient) * SPIN_RELEASE;
      rmsSmooth = 0;
    }
    }
    const brightnessLevel = Math.min(1, brightnessIntensity * 0.68 + brightnessTransient * 0.68);
    const spinLevel = Math.min(1, audioIntensity * 0.68 + audioTransient * 0.68);
    const activityLevel = Math.max(brightnessLevel, spinLevel);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.age !== undefined) p.age++;
      if (p.life !== undefined) { p.life -= p.decay; if (p.life <= 0) { particles.splice(i, 1); continue; } p.alpha = p.baseAlpha * p.life; }
    }
    const fillRatio2d = Math.min(1, particles.length / 2000);
    const audioRate2d = 0.15 + 0.4 * (1 - fillRatio2d);
    const spawnRate = activityLevel > 0.01 ? audioRate2d * 2 : 0.15;
    if (particles.length < 2000 && Math.random() < spawnRate) {
      particles.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, r: Math.random() * 2 + 0.5, alpha: Math.random() * 0.4 + 0.1, phase: Math.random() * Math.PI * 2, age: 0, fadeIn: FADE_FRAMES, canWhiten: Math.random() < getWhiteParticleChance() });
    }
    const CELL = CONN_REACH, cols = Math.ceil(w / CELL) + 1, grid = new Map();
    for (let i = 0; i < particles.length; i++) { const p = particles[i]; const key = ((p.x / CELL) | 0) + ((p.y / CELL) | 0) * cols; const cell = grid.get(key); if (cell) cell.push(i); else grid.set(key, [i]); }
    const buckets = [[], [], [], [], []], connCount = new Uint8Array(particles.length);
    for (const [key, cell] of grid) { const gx = key % cols, gy = (key / cols) | 0; for (let nx = gx; nx <= gx + 1; nx++) { for (let ny = gy - 1; ny <= gy + 1; ny++) { if (nx === gx && ny < gy) continue; const nk = nx + ny * cols, neighbor = nk === key ? cell : grid.get(nk); if (!neighbor) continue; for (let ii = 0; ii < cell.length; ii++) { const ai = cell[ii]; if (connCount[ai] >= MAX_CONN) continue; const a = particles[ai], jStart = nk === key ? ii + 1 : 0; for (let jj = jStart; jj < neighbor.length; jj++) { const bi = neighbor[jj]; if (connCount[bi] >= MAX_CONN) continue; const b = particles[bi], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy; if (d2 < CONN_REACH_SQ) { buckets[Math.min((d2 / CONN_BUCKET_DIV) | 0, 4)].push(a.x, a.y, b.x, b.y); connCount[ai]++; connCount[bi]++; } } } } } }
    c.lineWidth = 0.5 + brightnessLevel * 0.5;
    const aiBB = 1 + brightnessLevel * 2, als = [0.06 * aiBB, 0.048 * aiBB, 0.036 * aiBB, 0.024 * aiBB, 0.012 * aiBB];
    for (let b = 0; b < 5; b++) { const lines = buckets[b]; if (!lines.length) continue; c.strokeStyle = `rgba(212,168,67,${als[b]})`; c.beginPath(); for (let k = 0; k < lines.length; k += 4) { c.moveTo(lines[k], lines[k + 1]); c.lineTo(lines[k + 2], lines[k + 3]); } c.stroke(); }
    let btnCX = w * 0.5, btnCY = h * 0.5;
    if (!isMobileView && listenBtn) {
      const center = getElementCanvasCenter(listenBtn);
      if (center) {
        btnCX = center.x;
        btnCY = center.y;
      }
    }
    const scaleX = w / window.innerWidth, scaleY = h / window.innerHeight, mx = mouseX * scaleX, my = mouseY * scaleY;
    const glowList = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i], wave = fastSin(time * 2 + p.phase) * 0.5 + 0.5, fadeIn = p.fadeIn !== undefined ? Math.min(1, p.age / p.fadeIn) : 1, react = p.reactivity || 0;
      const audioBoost = brightnessLevel * react * (0.8 + fastSin(time * 3.7 + p.phase * 2) * 0.3);
      const currentAlpha = Math.min(1, (p.alpha * (0.5 + wave * 0.5) + audioBoost * 1.5) * fadeIn);
      const currentR = p.r * (0.8 + wave * 0.4) * (1 + audioBoost * 0.5);
      let pr = HERO_GOLD_RGB.r * 255, pg = HERO_GOLD_RGB.g * 255, pb = HERO_GOLD_RGB.b * 255;
      if (p.canWhiten) {
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const density = connCount[i] / MAX_CONN;
        const t = Math.min(1, Math.max(0, (spd - 0.3) * 0.9) + density * 0.4);
        pr += (whiteParticleColor.r * 255 - pr) * t;
        pg += (whiteParticleColor.g * 255 - pg) * t;
        pb += (whiteParticleColor.b * 255 - pb) * t;
      }
      c.fillStyle = `rgba(${pr|0},${pg|0},${pb|0},${currentAlpha})`;
      if (currentR < 1.5) { const s = currentR * 2; c.fillRect(p.x - currentR, p.y - currentR, s, s); } else { c.beginPath(); c.arc(p.x, p.y, currentR, 0, Math.PI * 2); c.fill(); }
      if (currentAlpha > 0.35) glowList.push(p.x, p.y, currentR * 3);
      p.x += p.vx; p.y += p.vy;
      { const dcx = p.x - btnCX, dcy = p.y - btnCY, dist = Math.sqrt(dcx * dcx + dcy * dcy) || 1, swirlRadius = Math.max(w, h) * FORCE_RADIUS, proximity = Math.max(0, 1 - dist / swirlRadius);
        if (spinLevel > 0.01 && proximity > 0) { const nx = dcx / dist, ny = dcy / dist; p.vx += -ny * spinLevel * proximity * 0.04; p.vy += nx * spinLevel * proximity * 0.04; const pull = spinLevel * proximity * 0.012; p.vx -= nx * pull; p.vy -= ny * pull; const jit = react * 0.25 * spinLevel; p.vx += (Math.random() - 0.5) * jit; p.vy += (Math.random() - 0.5) * jit; }
        if (spinLevel < 0.5 && spinLevel > 0.001 && !heroAudioPlaying && dist > 1) { const nx = dcx / dist, ny = dcy / dist; p.vx += nx * (0.5 - spinLevel) * 0.008; p.vy += ny * (0.5 - spinLevel) * 0.008; } }
      if (!listenBtn || !listenBtn.classList.contains('playing')) { const dmx = mx - p.x, dmy = my - p.y, d2 = dmx * dmx + dmy * dmy; if (d2 < 122500) { const mdist = Math.sqrt(d2), proximity = 1 - mdist / 350; p.vx += dmx * proximity * 0.00012 * MOUSE_INTERACTION_MULT + dmy * proximity * 0.00015 * MOUSE_INTERACTION_MULT; p.vy += dmy * proximity * 0.00012 * MOUSE_INTERACTION_MULT + (-dmx) * proximity * 0.00015 * MOUSE_INTERACTION_MULT; } }
      p.vx *= FRICTION; p.vy *= FRICTION;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0; if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
    }
    if (glowList.length > 0) { c.fillStyle = `rgba(212,168,67,${0.06 + brightnessLevel * 0.08})`; c.beginPath(); for (let g = 0; g < glowList.length; g += 3) { c.moveTo(glowList[g] + glowList[g + 2], glowList[g + 1]); c.arc(glowList[g], glowList[g + 1], glowList[g + 2], 0, Math.PI * 2); } c.fill(); }
  }

  let heroDragging = false;
  const heroEl = document.getElementById('hero');
  function spawnBurst(e) {
    if (particles.length > 2000) return;
    const rect = canvas.getBoundingClientRect(), scaleX = w / rect.width, scaleY = h / rect.height;
    const cx = (e.clientX - rect.left) * scaleX, cy = (e.clientY - rect.top) * scaleY;
    const count = heroDragging ? 1 : 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) { const angle = Math.random() * Math.PI * 2, speed = 0.3 + Math.random() * 0.6, baseAlpha = 0.3 + Math.random() * 0.2;
      particles.push({ x: cx + (Math.random() - 0.5) * 20, y: cy + (Math.random() - 0.5) * 20, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: Math.random() * 2 + 0.5, alpha: baseAlpha, baseAlpha, phase: Math.random() * Math.PI * 2, life: 1, decay: 0.0003 + Math.random() * 0.0007, age: 0, fadeIn: 80 + Math.floor(Math.random() * 80), canWhiten: Math.random() < getWhiteParticleChance() }); }
  }
  heroEl.addEventListener('mousedown', (e) => { heroDragging = true; spawnBurst(e); });
  heroEl.addEventListener('mousemove', (e) => { if (heroDragging) spawnBurst(e); });
  window.addEventListener('mouseup', () => { heroDragging = false; });
  window.addEventListener('resize', () => { resize(); init(); });
  resize(); init(); registerDraw(draw);
}

// ===== Vision: Drifting luminous nebula orbs =====
function initVisionCanvas() {
  const canvas = document.getElementById('vision-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  let time = 5 + Math.random() * 10; // start mid-animation
  const vis = trackVisibility('vision');
  const ORB_MOTION_MULT = 0.75; // Slightly slower overall orb motion

  const ORB_COUNT = 55;
  let orbs = [];
  let mxV = 0, myV = 0; // mouse position in canvas coords

  function resize() {
    const oldW = w, oldH = h;
    const dpr = window.devicePixelRatio > 1 ? 1.5 : 1;
    w = canvas.width = canvas.offsetWidth * dpr;
    h = canvas.height = canvas.offsetHeight * dpr;
    canvas.style.width = canvas.offsetWidth + 'px';
    canvas.style.height = canvas.offsetHeight + 'px';
    if (!orbs.length) {
      initOrbs();
    } else if (oldW && oldH) {
      const sx = w / oldW, sy = h / oldH;
      for (const orb of orbs) {
        orb.x *= sx;
        orb.y *= sy;
      }
    }
  }

  function initOrbs() {
    orbs = [];
    // Subdivide into a grid, place one orb per cell with jitter
    const cols = Math.ceil(Math.sqrt(ORB_COUNT * (w / h)));
    const rows = Math.ceil(ORB_COUNT / cols);
    const cellW = w / cols;
    const cellH = h / rows;
    let count = 0;
    for (let row = 0; row < rows && count < ORB_COUNT; row++) {
      for (let col = 0; col < cols && count < ORB_COUNT; col++) {
        count++;
      const depth = Math.random(); // 0 = far, 1 = near
      const px = (col + 0.15 + Math.random() * 0.7) * cellW;
      const py = (row + 0.15 + Math.random() * 0.7) * cellH;
      orbs.push({
        x: px,
        y: py,
        baseRadius: 80 + depth * 180,
        depth,
        driftX: (Math.random() - 0.5) * 0.2 * (0.3 + depth * 0.7) * ORB_MOTION_MULT,
        driftY: (Math.random() - 0.5) * 0.15 * (0.3 + depth * 0.7) * ORB_MOTION_MULT,
        wanderPhaseX: Math.random() * Math.PI * 2,
        wanderPhaseY: Math.random() * Math.PI * 2,
        wanderSpeed: (0.1 + Math.random() * 0.15) * ORB_MOTION_MULT,
        wanderAmp: 5 + depth * 10,
        phase: Math.random() * Math.PI * 2,
        breatheSpeed: (0.15 + Math.random() * 0.3) * ORB_MOTION_MULT,
        life: Math.random() * Math.PI * 2, // start at random point in lifecycle
        lifeSpeed: 0.0004 + Math.random() * 0.003, // 2x slower than original
        hue: Math.random() < 0.6
          ? 40 + Math.random() * 10   // warm gold
          : 210 + Math.random() * 20,  // cool blue
        sat: 30 + Math.random() * 40,
        hoverBoost: 0,
      });
      }
    }
    // Sort by depth so far orbs draw first
    orbs.sort((a, b) => a.depth - b.depth);
  }

  // mxV/myV updated from global mouseX/mouseY in draw loop

  function draw() {
    if (!vis.visible) return;
    c.clearRect(0, 0, w, h);
    time += 0.003 * ORB_MOTION_MULT;

    // Convert global mouse to canvas-local coords (DPR-scaled)
    const rect = canvas.getBoundingClientRect();
    mxV = (mouseX - rect.left) * (w / rect.width);
    myV = (mouseY - rect.top) * (h / rect.height);

    orbs.forEach(orb => {
      // Lifecycle: smooth fade in and out
      orb.life += orb.lifeSpeed;
      const lifecycle = Math.max(0, Math.sin(orb.life)); // 0 → 1 → 0, clamped

      // Mouse proximity → hover boost (lerped)
      const dx = orb.x - mxV, dy = orb.y - myV;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hoverRadius = Math.max(w, h) * 0.3;
      const hoverTarget = dist < hoverRadius ? Math.max(0, 1 - dist / hoverRadius) : 0;
      orb.hoverBoost += (hoverTarget - orb.hoverBoost) * 0.04;

      const breathe = Math.sin(time * orb.breatheSpeed + orb.phase) * 0.2 + 0.8;
      const radius = orb.baseRadius * breathe;
      const alpha = (0.08 + orb.depth * 0.14) * breathe * lifecycle * (1 + orb.hoverBoost * 2.5);

      const grad = c.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, radius);
      grad.addColorStop(0, `hsla(${orb.hue}, ${orb.sat}%, 65%, ${alpha})`);
      grad.addColorStop(0.35, `hsla(${orb.hue}, ${orb.sat}%, 50%, ${alpha * 0.5})`);
      grad.addColorStop(0.7, `hsla(${orb.hue}, ${orb.sat}%, 40%, ${alpha * 0.15})`);
      grad.addColorStop(1, 'transparent');

      c.fillStyle = grad;
      c.beginPath();
      c.arc(orb.x, orb.y, radius, 0, Math.PI * 2);
      c.fill();

      // Drift + organic wander
      const wx = Math.sin(time * orb.wanderSpeed + orb.wanderPhaseX) * orb.wanderAmp * 0.01;
      const wy = Math.cos(time * orb.wanderSpeed * 0.7 + orb.wanderPhaseY) * orb.wanderAmp * 0.01;
      orb.x += orb.driftX + wx;
      orb.y += orb.driftY + wy;

      // Wrap with padding
      const pad = radius;
      if (orb.x < -pad) orb.x = w + pad;
      if (orb.x > w + pad) orb.x = -pad;
      if (orb.y < -pad) orb.y = h + pad;
      if (orb.y > h + pad) orb.y = -pad;
    });

  }

  window.addEventListener('resize', resize);
  resize();
  registerDraw(draw);
}

// ===== Citizen Science: Waveform with discovery markers =====
function initCSCanvas() {
  const canvas = document.getElementById('cs-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  let waveTime = 5 + Math.random() * 10;
  let orbTime = 5 + Math.random() * 10;
  const baseSpeed = 0.0042;
  let csSpeedBoost = 0;
  const csRmsData = new Uint8Array(128);
  const CS_SPEED_MULT_MAX = 52; // louder moments should rip much faster
  const CS_FREQ_MULT = 1.75; // stable higher-frequency waveform shape
  const vis = trackVisibility('citizen-science');

  // Living discovery orbs — drift, fade in/out, respawn
  const MAX_ORBS = 6;
  function spawnOrb() {
    return {
      x: 0.15 + Math.random() * 0.7,
      y: 0.4 + Math.random() * 0.2,  // near center
      vx: (Math.random() - 0.5) * 0.000015,
      vy: (Math.random() - 0.5) * 0.000008,
      phase: Math.random() * Math.PI * 2,
      freq: 0.3 + Math.random() * 0.4,
      age: 0,
      lifespan: 1500 + Math.random() * 2000,  // frames
    };
  }
  const discoveries = Array.from({ length: MAX_ORBS }, () => {
    const orb = spawnOrb();
    orb.age = Math.random() * orb.lifespan * 0.8; // stagger births
    return orb;
  });

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }

  function draw() {
    if (!vis.visible) return;
    c.clearRect(0, 0, w, h);

    // Drive waveform speed from live audio amplitude for "Hear a discovery".
    const csAn = getCitizenAnalyser();
    if (csAn) {
      csAn.getByteTimeDomainData(csRmsData);
      let sum = 0;
      for (let i = 0; i < csRmsData.length; i++) {
        const v = (csRmsData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / csRmsData.length);
      const targetBoost = Math.min(1, rms * 60);
      const rate = targetBoost > csSpeedBoost ? 0.38 : 0.09;
      csSpeedBoost += (targetBoost - csSpeedBoost) * rate;
    } else {
      csSpeedBoost += (0 - csSpeedBoost) * 0.08;
    }
    const speedMult = 1 + csSpeedBoost * CS_SPEED_MULT_MAX;
    waveTime += baseSpeed * speedMult;
    orbTime += baseSpeed;
    const waveThicknessBoost = csSpeedBoost * 3.2;

    const centerY = h / 2;
    const amplitude = h * 0.15;

    // Draw main waveform
    c.strokeStyle = 'rgba(58, 181, 160, 0.3)';
    c.lineWidth = 1.5 + waveThicknessBoost;
    c.beginPath();
    for (let x = 0; x < w; x++) {
      const t = x / w;
      const y = centerY +
        Math.sin(t * 12 * CS_FREQ_MULT + waveTime) * amplitude * 0.6 +
        Math.sin(t * 5.3 * CS_FREQ_MULT + waveTime * 0.7) * amplitude * 0.3 +
        Math.sin(t * 20 * CS_FREQ_MULT + waveTime * 1.5) * amplitude * 0.1;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // Second waveform layer
    c.strokeStyle = 'rgba(58, 181, 160, 0.15)';
    c.lineWidth = 1 + waveThicknessBoost * 0.45;
    c.beginPath();
    for (let x = 0; x < w; x++) {
      const t = x / w;
      const y = centerY +
        Math.sin(t * 8 * CS_FREQ_MULT + waveTime * 0.5 + 1) * amplitude * 0.5 +
        Math.sin(t * 15 * CS_FREQ_MULT + waveTime * 1.2) * amplitude * 0.15;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // Discovery orbs — drift, pulse, fade in/out
    for (let i = 0; i < discoveries.length; i++) {
      const d = discoveries[i];
      d.age++;
      d.x += d.vx;
      d.y += d.vy;

      // Respawn if dead or drifted off
      if (d.age > d.lifespan || d.x < 0.05 || d.x > 0.95) {
        discoveries[i] = spawnOrb();
        continue;
      }

      // Lifecycle fade: smooth in over 15%, smooth out over 15%
      const life = d.age / d.lifespan;
      const envelope = life < 0.15 ? life / 0.15
        : life > 0.85 ? (1 - life) / 0.15
        : 1;

      const px = d.x * w;
      const py = d.y * h;
      const pulse = Math.sin(orbTime * d.freq + d.phase) * 0.5 + 0.5;
      const radius = 3 + pulse * 6;
      const alpha = (0.25 + pulse * 0.3) * envelope;

      c.fillStyle = `rgba(58, 181, 160, ${alpha})`;
      c.beginPath();
      c.arc(px, py, radius, 0, Math.PI * 2);
      c.fill();

      // Outer ring
      c.strokeStyle = `rgba(58, 181, 160, ${alpha * 0.4})`;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(px, py, radius + 8 + pulse * 5, 0, Math.PI * 2);
      c.stroke();
    }

    // Edge fade — erase edges with destination-out gradient
    const fadeW = w * 0.15;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    // Left edge
    const leftGrad = c.createLinearGradient(0, 0, fadeW, 0);
    leftGrad.addColorStop(0, 'rgba(0,0,0,1)');
    leftGrad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = leftGrad;
    c.fillRect(0, 0, fadeW, h);
    // Right edge
    const rightGrad = c.createLinearGradient(w - fadeW, 0, w, 0);
    rightGrad.addColorStop(0, 'rgba(0,0,0,0)');
    rightGrad.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = rightGrad;
    c.fillRect(w - fadeW, 0, fadeW, h);
    c.restore();

  }

  window.addEventListener('resize', resize);
  resize();
  registerDraw(draw);
}

// ===== Education: Dome starfield =====
function initEduCanvas() {
  const canvas = document.getElementById('edu-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  let time = 5 + Math.random() * 10;
  const vis = trackVisibility('education');
  const STARS = 300;
  let stars = [];
  const AUTO_EMITTER_SPEED = 0.33; // ~1/3 of click-spawn particle rise speed
  const AUTO_WANDER_SPEED = 0.42;  // subtler meandering draw path
  let autoSpawnAccum = 0;
  const autoEmitter = {
    phaseX1: Math.random() * Math.PI * 2,
    phaseX2: Math.random() * Math.PI * 2,
    phaseX3: Math.random() * Math.PI * 2,
    phaseY1: Math.random() * Math.PI * 2,
    phaseY2: Math.random() * Math.PI * 2,
    phaseY3: Math.random() * Math.PI * 2,
  };

  function resize() {
    const oldW = w, oldH = h;
    const dpr = window.devicePixelRatio > 1 ? 1.5 : 1;
    w = canvas.width = canvas.offsetWidth * dpr;
    h = canvas.height = canvas.offsetHeight * dpr;
    canvas.style.width = canvas.offsetWidth + 'px';
    canvas.style.height = canvas.offsetHeight + 'px';
    if (!stars.length) {
      initStars();
    } else if (oldW && oldH) {
      const sx = w / oldW, sy = h / oldH;
      for (const s of stars) {
        s.x *= sx;
        s.y *= sy;
      }
    }
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < STARS; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.35,
        alpha: Math.random() * 0.55 + 0.18,
        speed: Math.random() * 0.2 + 0.05,
        twinkleSpeed: 0.5 + Math.random() * 2,
        twinklePhase: Math.random() * Math.PI * 2
      });
    }
  }

  function spawnStarsAt(cx, cy, opts = {}) {
    if (stars.length > 5000) return;
    const count = opts.count ?? 1;
    const spread = opts.spread ?? 24;
    const speedMul = opts.speedMul ?? 1;
    const auto = opts.auto ?? false;
    for (let i = 0; i < count; i++) {
      stars.push({
        x: cx + (Math.random() - 0.5) * spread,
        y: cy + (Math.random() - 0.5) * spread,
        r: Math.random() * 1.7 + 0.35,
        alpha: 0,
        targetAlpha: auto
          ? 0.18 + Math.random() * 0.16
          : 0.36 + Math.random() * 0.28,
        age: 0,
        fadeIn: 60 + Math.floor(Math.random() * 60),
        speed: (Math.random() * 0.2 + 0.05) * speedMul,
        twinkleSpeed: 0.5 + Math.random() * 2,
        twinklePhase: Math.random() * Math.PI * 2
      });
    }
  }

  function draw() {
    if (!vis.visible) return;
    c.clearRect(0, 0, w, h);
    time += 0.01;

    // Dome gradient
    const grad = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
    grad.addColorStop(0, 'rgba(74, 143, 212, 0.03)');
    grad.addColorStop(0.5, 'rgba(74, 143, 212, 0.015)');
    grad.addColorStop(1, 'transparent');
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);

    // Dome ring
    c.strokeStyle = 'rgba(74, 143, 212, 0.06)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(w / 2, h / 2, Math.min(w, h) * 0.38, 0, Math.PI * 2);
    c.stroke();

    // Stars
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      if (s.age !== undefined) {
        s.age++;
        const fadeIn = Math.min(1, s.age / s.fadeIn);
        s.alpha = s.targetAlpha * fadeIn;
      }
      const twinkle = Math.sin(time * s.twinkleSpeed + s.twinklePhase) * 0.5 + 0.5;
      const a = s.alpha * (0.3 + twinkle * 0.7);

      c.fillStyle = `rgba(215, 222, 238, ${Math.min(1, a * 1.18)})`;
      c.beginPath();
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      c.fill();

      // Subtle drift
      s.y -= s.speed;
      if (s.y < -2) {
        if (s.age !== undefined) {
          // User-spawned: kill it
          stars.splice(i, 1);
        } else {
          // Original: wrap to bottom
          s.y = h + 5;
          s.x = Math.random() * w;
        }
      }
    }

    // Autonomous emitter: layered sinusoids in X/Y create a complex meandering signal path.
    const ex =
      w * 0.5 +
      Math.sin(time * (0.27 * AUTO_WANDER_SPEED) + autoEmitter.phaseX1) * w * 0.14 +
      Math.sin(time * (0.11 * AUTO_WANDER_SPEED) + autoEmitter.phaseX2) * w * 0.07 +
      Math.sin(time * (0.56 * AUTO_WANDER_SPEED) + autoEmitter.phaseX3) * w * 0.025;
    const ey =
      h * 0.58 +
      Math.sin(time * (0.19 * AUTO_WANDER_SPEED) + autoEmitter.phaseY1) * h * 0.12 +
      Math.sin(time * (0.33 * AUTO_WANDER_SPEED) + autoEmitter.phaseY2) * h * 0.06 +
      Math.sin(time * (0.71 * AUTO_WANDER_SPEED) + autoEmitter.phaseY3) * h * 0.022;
    const emitX = Math.max(24, Math.min(w - 24, ex));
    const emitY = Math.max(24, Math.min(h - 24, ey));

    // Spawn at a gentle continuous cadence, slower than manual click-spawn behavior.
    autoSpawnAccum += 0.11;
    while (autoSpawnAccum >= 1) {
      autoSpawnAccum -= 1;
      const spawnCount = Math.random() < 0.08 ? 2 : 1;
      spawnStarsAt(emitX, emitY, { count: spawnCount, spread: 24, speedMul: AUTO_EMITTER_SPEED, auto: true });
    }

  }

  // Click + drag to add stars
  let domeDragging = false;
  const domeEl = document.getElementById('education');

  function spawnStars(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = w / rect.width, scaleY = h / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const count = domeDragging ? 2 + Math.floor(Math.random() * 2) : 5 + Math.floor(Math.random() * 4);
    spawnStarsAt(cx, cy, { count, spread: 40, speedMul: 1 });
  }

  domeEl.addEventListener('mousedown', (e) => { domeDragging = true; spawnStars(e); });
  domeEl.addEventListener('mousemove', (e) => { if (domeDragging) spawnStars(e); });
  window.addEventListener('mouseup', () => { domeDragging = false; });

  window.addEventListener('resize', resize);
  resize();
  registerDraw(draw);
}

// ===== Synth Wave Canvas (in the instrument card) =====
function initSynthWave() {
  const canvas = document.getElementById('synth-wave-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  let time = 5 + Math.random() * 10;
  const vis = trackVisibility('stem-music');

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    w = canvas.width = rect.width;
    h = canvas.height = rect.height;
  }

  let waveData = null;
  let liveBlend = 0; // 0 = idle sine, 1 = full oscilloscope

  function draw() {
    if (!vis.visible) return;
    c.clearRect(0, 0, w, h);
    time += 0.00616;

    const centerY = h * 0.6;
    const amp = h * 0.42;
    const analyser = getStemAnalyser();

    // Smooth morph between idle and live
    const target = analyser ? 1 : 0;
    liveBlend += (target - liveBlend) * 0.06;

    // Get live data if available
    let liveY = null;
    if (analyser) {
      const bufLen = analyser.frequencyBinCount;
      if (!waveData || waveData.length !== bufLen) waveData = new Uint8Array(bufLen);
      analyser.getByteTimeDomainData(waveData);
      liveY = new Float32Array(w);
      // Compute DC offset from raw data
      let dcSum = 0;
      for (let i = 0; i < bufLen; i++) dcSum += waveData[i] - 128;
      const dcOffset = dcSum / bufLen / 128;
      for (let x = 0; x < w; x++) {
        const i = (x / w) * bufLen;
        const i0 = Math.floor(i), i1 = Math.min(i0 + 1, bufLen - 1);
        const frac = i - i0;
        const v0 = (waveData[i0] - 128) / 128;
        const v1 = (waveData[i1] - 128) / 128;
        liveY[x] = (v0 + (v1 - v0) * frac) - dcOffset;
      }
    }

    // Compute blended waveform
    function getY(x) {
      const t = x / w;
      const idleVal =
        Math.sin(t * Math.PI * 4 + time) * 0.5 +
        Math.sin(t * Math.PI * 7 + time * 0.6) * 0.25 +
        Math.sin(t * Math.PI * 13 + time * 1.3) * 0.12;
      const live = liveY ? liveY[x] * 12 : 0;
      const blended = idleVal * (1 - liveBlend) + live * liveBlend;
      return centerY + blended * amp;
    }

    // Glow layer
    const glowAlpha = 0.06 + liveBlend * 0.14;
    c.strokeStyle = `rgba(139, 110, 192, ${glowAlpha})`;
    c.lineWidth = 5 + liveBlend * 3;
    c.beginPath();
    for (let x = 0; x < w; x++) {
      const y = getY(x);
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // Sharp line
    c.strokeStyle = `rgba(139, 110, 192, ${0.28 + liveBlend * 0.62})`;
    c.lineWidth = 1.5 + liveBlend * 0.5;
    c.beginPath();
    for (let x = 0; x < w; x++) {
      const y = getY(x);
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // Fill underneath
    c.lineTo(w, centerY);
    c.lineTo(0, centerY);
    c.closePath();
    c.fillStyle = `rgba(139, 110, 192, ${0.025 + liveBlend * 0.055})`;
    c.fill();

  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas.parentElement);
  resize();
  registerDraw(draw);
}

// ===== Spectrum: Animated EQ bars for STEM + Music =====
function initSpectrumCanvas() {
  const canvas = document.getElementById('spectrum-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  let time = 5 + Math.random() * 10;
  const vis2 = trackVisibility('stem-music');

  const BAR_COUNT = 48;
  const bars = [];

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }

  // Each bar has its own frequency and phase for organic motion
  for (let i = 0; i < BAR_COUNT; i++) {
    bars.push({
      freq: 0.3 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      freq2: 0.1 + Math.random() * 0.3,
      phase2: Math.random() * Math.PI * 2,
      currentHeight: 0,
    });
  }

  let eqBlend = 0; // 0 = idle, 1 = live EQ
  let freqData = null;
  const smoothedBars = new Float32Array(BAR_COUNT); // smoothed EQ values per bar

  function draw() {
    if (!vis2.visible) return;
    c.clearRect(0, 0, w, h);
    const stemPlaying = !!getStemAnalyser();
    time += stemPlaying ? 0.0008 : 0.0004;

    const barWidth = w / BAR_COUNT;
    const maxHeight = h * 0.45;
    const centerY = h * 0.71;

    // Live EQ FFT feed — commented out, one layer too much
    // const analyser = getStemAnalyser();
    // const eqTarget = analyser ? 1 : 0;
    // eqBlend += (eqTarget - eqBlend) * 0.04;
    // if (analyser) {
    //   if (!freqData || freqData.length !== analyser.frequencyBinCount) {
    //     freqData = new Uint8Array(analyser.frequencyBinCount);
    //   }
    //   analyser.getByteFrequencyData(freqData);
    //   const binCount = freqData.length;
    //   const rawBars = new Float32Array(BAR_COUNT);
    //   for (let b = 0; b < BAR_COUNT; b++) {
    //     const startBin = Math.floor((b / BAR_COUNT) * binCount * 0.5);
    //     const endBin = Math.floor(((b + 1) / BAR_COUNT) * binCount * 0.5);
    //     let peak = 0;
    //     for (let j = startBin; j < endBin; j++) { if (freqData[j] > peak) peak = freqData[j]; }
    //     rawBars[b] = peak / 255;
    //   }
    //   for (let b = 0; b < BAR_COUNT; b++) {
    //     const prev = b > 0 ? rawBars[b - 1] : rawBars[b];
    //     const next = b < BAR_COUNT - 1 ? rawBars[b + 1] : rawBars[b];
    //     const smoothed = prev * 0.25 + rawBars[b] * 0.5 + next * 0.25;
    //     const target = Math.min(1, smoothed * 4);
    //     const rate = target > smoothedBars[b] ? 0.35 : 0.08;
    //     smoothedBars[b] += (target - smoothedBars[b]) * rate;
    //   }
    // } else {
    //   for (let b = 0; b < BAR_COUNT; b++) smoothedBars[b] *= 0.95;
    // }

    // Mouse influence: map mouse to canvas coords
    const rect = canvas.getBoundingClientRect();
    const mx = (mouseX - rect.left) / rect.width * w;

    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = bars[i];

      // --- Idle animation (commented out original sine behavior) ---
      // const wave1 = Math.sin(time * bar.freq + bar.phase) * 0.5 + 0.5;
      // const wave2 = Math.sin(time * bar.freq2 + bar.phase2) * 0.3 + 0.5;
      // const idleCombined = wave1 * 0.7 + wave2 * 0.3;

      // Idle: gentle ambient sine waves
      const wave1 = Math.sin(time * bar.freq + bar.phase) * 0.5 + 0.5;
      const wave2 = Math.sin(time * bar.freq2 + bar.phase2) * 0.3 + 0.5;
      const idleVal = wave1 * 0.7 + wave2 * 0.3;

      // Live: use pre-computed smoothed bar values
      const liveVal = smoothedBars[i];

      const combined = idleVal * (1 - eqBlend) + liveVal * eqBlend;

      // Shape: louder in the middle, quieter at edges
      const shape = 1 - Math.pow((i / BAR_COUNT - 0.5) * 2, 2);

      // Mouse wave: bars near cursor get a smooth height boost
      const barCenterX = (i + 0.5) * barWidth;
      const mouseDist = Math.abs(barCenterX - mx);
      const mouseRadius = w * 0.25;
      const mouseBoost = Math.max(0, 1 - mouseDist / mouseRadius);
      const smoothBoost = mouseBoost * mouseBoost * mouseBoost; // cubic falloff

      const idleShape = combined * maxHeight * (0.15 + shape * 0.85);
      const liveShape = combined * maxHeight * (0.3 + shape * 0.7); // less edge falloff when live
      const targetHeight = (idleShape * (1 - eqBlend) + liveShape * eqBlend) + smoothBoost * maxHeight * 0.12;
      const rising = targetHeight > bar.currentHeight;
      bar.currentHeight += (targetHeight - bar.currentHeight) * (rising ? 0.15 : 0.08);
      const barHeight = bar.currentHeight;

      const x = i * barWidth;
      const alpha = 0.12 + combined * 0.2;

      // Main bar
      const grad = c.createLinearGradient(x, centerY, x, centerY - barHeight);
      grad.addColorStop(0, `rgba(139, 110, 192, ${alpha * 0.3})`);
      grad.addColorStop(0.5, `rgba(139, 110, 192, ${alpha})`);
      grad.addColorStop(1, `rgba(180, 150, 220, ${alpha * 0.6})`);

      c.fillStyle = grad;
      c.fillRect(x + 1, centerY - barHeight, barWidth - 2, barHeight);

      // Mirror reflection below (fainter)
      const mirrorGrad = c.createLinearGradient(x, centerY, x, centerY + barHeight * 0.4);
      mirrorGrad.addColorStop(0, `rgba(139, 110, 192, ${alpha * 0.2})`);
      mirrorGrad.addColorStop(1, 'transparent');
      c.fillStyle = mirrorGrad;
      c.fillRect(x + 1, centerY, barWidth - 2, barHeight * 0.4);
    }

  }

  window.addEventListener('resize', resize);
  resize();
  registerDraw(draw);
}

// ===== Globe: Spinning dot globe for Get Involved =====
function initGlobeCanvas() {
  const canvas = document.getElementById('globe-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  let time = 5 + Math.random() * 10;
  const vis = trackVisibility('contact');
  let smoothMX = 0.5, smoothMY = 0.5;

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }

  // Generate points on a sphere using fibonacci spiral
  const POINT_COUNT = 180;
  const points = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < POINT_COUNT; i++) {
    const y = 1 - (i / (POINT_COUNT - 1)) * 2; // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    points.push({
      x: Math.cos(theta) * radiusAtY,
      y: y,
      z: Math.sin(theta) * radiusAtY,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.3 + Math.random() * 0.8,
      active: Math.random() < 0.15,
      glow: Math.random() < 0.15 ? 1 : 0,
    });
  }

  const packets = [];
  const ripples = [];

  // Store current rotation for click handler
  let curRotY = 0, curRotX = 0, curCX = 0, curCY = 0, curRadius = 0;

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Inverse project click onto sphere surface
    const x1 = (clickX - curCX) / curRadius;
    const y1 = (clickY - curCY) / curRadius;
    if (x1 * x1 + y1 * y1 > 1) return; // outside globe

    const z2 = Math.sqrt(1 - x1 * x1 - y1 * y1);

    // Inverse rotX
    const cosRX = Math.cos(curRotX), sinRX = Math.sin(curRotX);
    const py = y1 * cosRX + z2 * sinRX;
    const z1 = -y1 * sinRX + z2 * cosRX;

    // Inverse rotY
    const cosRY = Math.cos(curRotY), sinRY = Math.sin(curRotY);
    const px = x1 * cosRY + z1 * sinRY;
    const pz = -x1 * sinRY + z1 * cosRY;

    // Add new active point
    const newPt = {
      x: px, y: py, z: pz,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.3 + Math.random() * 0.8,
      active: true,
      glow: 1,
    };
    points.push(newPt);

    // Ripple at click
    ripples.push({ x: px, y: py, z: pz, age: 0 });

    // Send 1-3 packets to nearby active dots
    const activeList = points.filter(p => p !== newPt && p.active);
    if (activeList.length === 0) return;

    const sorted = activeList.map(p => {
      const dx = p.x - px, dy = p.y - py, dz = p.z - pz;
      return { pt: p, dist: dx * dx + dy * dy + dz * dz };
    }).sort((a, b) => a.dist - b.dist);

    const count = 1 + Math.floor(Math.random() * 3); // 1-3
    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      const target = sorted[i].pt;
      packets.push({
        from: { x: px, y: py, z: pz },
        to: { x: target.x, y: target.y, z: target.z },
        t: 0,
        speed: 0.0015 + Math.random() * 0.002,
      });
    }
  });

  // Latitude rings
  const RING_SEGMENTS = 64;

  function draw() {
    if (!vis.visible) return;
    c.clearRect(0, 0, w, h);
    time += 0.003;

    // Mouse influence: smooth follow
    const rect = canvas.getBoundingClientRect();
    const rawMX = (mouseX - rect.left) / rect.width;
    const rawMY = (mouseY - rect.top) / rect.height;
    smoothMX += (rawMX - smoothMX) * 0.02;
    smoothMY += (rawMY - smoothMY) * 0.02;

    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = Math.min(w, h) * 0.6;

    // Rotation: slow spin + mouse tilt
    const rotY = time * 0.072;
    const rotX = -0.3 + (smoothMY - 0.5) * 0.08;

    // Update stored values for click handler
    curRotY = rotY; curRotX = rotX; curCX = cx; curCY = cy; curRadius = radius;

    const cosRY = Math.cos(rotY), sinRY = Math.sin(rotY);
    const cosRX = Math.cos(rotX), sinRX = Math.sin(rotX);

    function project(px, py, pz) {
      // Rotate Y
      const x1 = px * cosRY - pz * sinRY;
      const z1 = px * sinRY + pz * cosRY;
      // Rotate X
      const y1 = py * cosRX - z1 * sinRX;
      const z2 = py * sinRX + z1 * cosRX;
      return {
        sx: cx + x1 * radius,
        sy: cy + y1 * radius,
        z: z2,
      };
    }

    // Draw latitude rings
    c.lineWidth = 1.2;
    for (let lat = -5; lat <= 5; lat++) {
      const latY = lat / 6;
      const ringR = Math.sqrt(1 - latY * latY);
      let drawing = false;
      c.beginPath();
      for (let s = 0; s <= RING_SEGMENTS; s++) {
        const a = (s / RING_SEGMENTS) * Math.PI * 2;
        const p = project(Math.cos(a) * ringR, latY, Math.sin(a) * ringR);
        if (p.z < 0) { drawing = false; continue; }
        if (!drawing) { c.moveTo(p.sx, p.sy); drawing = true; }
        else c.lineTo(p.sx, p.sy);
      }
      c.strokeStyle = 'rgba(212, 168, 67, 0.3)';
      c.stroke();
    }

    // Draw longitude rings
    c.lineWidth = 1.2;
    for (let lon = 0; lon < 8; lon++) {
      const lonA = (lon / 8) * Math.PI;
      let drawing = false;
      c.beginPath();
      for (let s = 0; s <= RING_SEGMENTS; s++) {
        const a = (s / RING_SEGMENTS) * Math.PI * 2;
        const px = Math.cos(a) * Math.cos(lonA);
        const py = Math.sin(a);
        const pz = Math.cos(a) * Math.sin(lonA);
        const p = project(px, py, pz);
        if (p.z < 0) { drawing = false; continue; }
        if (!drawing) { c.moveTo(p.sx, p.sy); drawing = true; }
        else c.lineTo(p.sx, p.sy);
      }
      c.strokeStyle = 'rgba(212, 168, 67, 0.22)';
      c.stroke();
    }

    // Randomly toggle active dots — but not if a packet is in flight to/from them
    if (Math.random() < 0.02) {
      const idx = Math.floor(Math.random() * points.length);
      const pt = points[idx];
      const busy = packets.some(pkt => {
        const f = pkt.from, t = pkt.to;
        return (Math.abs(f.x - pt.x) < 0.001 && Math.abs(f.y - pt.y) < 0.001 && Math.abs(f.z - pt.z) < 0.001)
            || (Math.abs(t.x - pt.x) < 0.001 && Math.abs(t.y - pt.y) < 0.001 && Math.abs(t.z - pt.z) < 0.001);
      });
      if (!busy) {
        pt.active = !pt.active;
        pt.pulse = Math.random() * Math.PI * 2;
      }
    }

    // Spawn data packets between active nodes
    if (Math.random() < 0.015) {
      const activeList = points.filter(p => p.active);
      if (activeList.length >= 2) {
        const a = activeList[Math.floor(Math.random() * activeList.length)];
        // Pick from 3 nearest active neighbors (with some randomness)
        const others = activeList.filter(p => p !== a).map(p => {
          const dx = p.x - a.x, dy = p.y - a.y, dz = p.z - a.z;
          return { pt: p, dist: dx*dx + dy*dy + dz*dz };
        }).sort((x, y) => x.dist - y.dist);
        const pick = Math.min(Math.floor(Math.random() * 3), others.length - 1);
        const b = others[pick].pt;
        packets.push({
          from: { x: a.x, y: a.y, z: a.z },
          to: { x: b.x, y: b.y, z: b.z },
          t: 0,
          speed: 0.0015 + Math.random() * 0.002,
        });
        // Ripple on departure
        ripples.push({ x: a.x, y: a.y, z: a.z, age: 0 });
      }
    }

    // Update packets
    for (let i = packets.length - 1; i >= 0; i--) {
      const pkt = packets[i];
      if (pkt.arrived) {
        // Hold phase then fade
        if (pkt.hold > 0) {
          pkt.hold--;
        } else if (pkt.fadeRate > 0) {
          pkt.fade -= pkt.fadeRate;
          if (pkt.fade <= 0) { packets.splice(i, 1); }
        }
      } else {
        pkt.t += pkt.speed;
        if (pkt.t >= 1) {
          pkt.t = 1;
          pkt.arrived = true;
          pkt.fade = 1;
          pkt.hold = 120 + Math.floor(Math.random() * 120); // 2-4s hold
          // 30% chance to persist, rest fade at varied rates
          const r = Math.random();
          pkt.fadeRate = r < 0.3 ? 0 : 0.001 + r * r * 0.011;
          // Ripple on arrival
          ripples.push({ x: pkt.to.x, y: pkt.to.y, z: pkt.to.z, age: 0 });
        }
      }
    }

    // Update + draw ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age++;
      if (ripples[i].age > 80) { ripples.splice(i, 1); continue; }
      const rp = project(ripples[i].x, ripples[i].y, ripples[i].z);
      if (rp.z < 0) continue;
      const progress = ripples[i].age / 80;
      const alpha = rp.z * 0.5 * (1 - progress);
      const r = 3 + progress * 20;
      c.strokeStyle = `rgba(212, 168, 67, ${alpha})`;
      c.lineWidth = 0.8 * (1 - progress);
      c.beginPath();
      c.arc(rp.sx, rp.sy, r, 0, Math.PI * 2);
      c.stroke();
    }

    // Project points
    const projected = points.map(pt => {
      const p = project(pt.x, pt.y, pt.z);
      return { ...pt, ...p };
    });

    // Draw arcs + traveling dots for packets
    for (const pkt of packets) {
      const dot = pkt.from.x * pkt.to.x + pkt.from.y * pkt.to.y + pkt.from.z * pkt.to.z;
      const omega = Math.acos(Math.max(-1, Math.min(1, dot)));
      const sinO = Math.sin(omega);
      if (sinO < 0.001) continue;

      // Arc path
      const arcSteps = 24;
      let drawing = false;
      c.beginPath();
      for (let s = 0; s <= arcSteps; s++) {
        const st = s / arcSteps;
        const a = Math.sin((1 - st) * omega) / sinO;
        const b = Math.sin(st * omega) / sinO;
        const p = project(
          pkt.from.x * a + pkt.to.x * b,
          pkt.from.y * a + pkt.to.y * b,
          pkt.from.z * a + pkt.to.z * b
        );
        if (p.z < 0) { drawing = false; continue; }
        if (!drawing) { c.moveTo(p.sx, p.sy); drawing = true; }
        else c.lineTo(p.sx, p.sy);
      }
      const fadeMul = pkt.arrived ? pkt.fade : 1;
      const arcAlpha = Math.min(pkt.t * 5, 1) * 0.25 * fadeMul;
      c.strokeStyle = `rgba(212, 168, 67, ${arcAlpha})`;
      c.lineWidth = 0.6;
      c.stroke();

      // Traveling dot (only while in transit)
      if (!pkt.arrived) {
        const ta = Math.sin((1 - pkt.t) * omega) / sinO;
        const tb = Math.sin(pkt.t * omega) / sinO;
        const tp = project(
          pkt.from.x * ta + pkt.to.x * tb,
          pkt.from.y * ta + pkt.to.y * tb,
          pkt.from.z * ta + pkt.to.z * tb
        );
        if (tp.z > 0) {
          const dotAlpha = tp.z * 0.7 * Math.min(pkt.t * 5, 1) * Math.min((1 - pkt.t) * 5, 1);
          c.fillStyle = `rgba(212, 168, 67, ${dotAlpha})`;
          c.beginPath();
          c.arc(tp.sx, tp.sy, 2, 0, Math.PI * 2);
          c.fill();
        }
      }
    }

    // Draw dots with smooth fade
    for (const pt of projected) {
      // Lerp glow toward active state
      const target = pt.active ? 1 : 0;
      pt.glow += (target - pt.glow) * (target > pt.glow ? 0.08 : 0.015);

      if (pt.z < -0.05) continue;
      const depthAlpha = Math.max(0, pt.z);
      const pulse = Math.sin(time * pt.pulseSpeed + pt.pulse) * 0.5 + 0.5;
      const g = pt.glow;

      if (g > 0.01) {
        const a = depthAlpha * (0.3 + pulse * 0.45) * g;
        const r = (1.5 + pulse * 2) * g;
        c.fillStyle = `rgba(212, 168, 67, ${a})`;
        c.beginPath();
        c.arc(pt.sx, pt.sy, Math.max(0.8, r), 0, Math.PI * 2);
        c.fill();

        if (g > 0.3) {
          c.strokeStyle = `rgba(212, 168, 67, ${a * 0.4})`;
          c.lineWidth = 0.5;
          c.beginPath();
          c.arc(pt.sx, pt.sy, r + 3 + pulse * 3, 0, Math.PI * 2);
          c.stroke();
        }
      } else {
        const a = depthAlpha * 0.2;
        c.fillStyle = `rgba(200, 200, 210, ${a})`;
        c.beginPath();
        c.arc(pt.sx, pt.sy, 0.8, 0, Math.PI * 2);
        c.fill();
      }
    }

  }

  window.addEventListener('resize', resize);
  resize();
  registerDraw(draw);
}

// Init all
export function initVisuals() {
  initHeroCanvas();
  initVisionCanvas();
  initCSCanvas();
  initEduCanvas();
  initSynthWave();
  initSpectrumCanvas();
  initGlobeCanvas();
  requestAnimationFrame(rafLoop);
}
