/**
 * SONARA Canvas Visuals
 * Hero particle field, citizen science waveform, dome starfield, synth wave.
 */

import * as audio from './audio.js?v=8';
const getStemAnalyser = audio.getStemAnalyser;
const getHeroAnalyser = audio.getHeroAnalyser;
const getCitizenAnalyser = typeof audio.getCitizenAnalyser === 'function'
  ? audio.getCitizenAnalyser
  : () => null;

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
  }, { threshold: 0 });
  obs.observe(el);
  document.addEventListener('visibilitychange', () => {
    state.visible = state._intersecting && !document.hidden;
  });
  return state;
}


// ===== Shared tuning constants =====
const HERO_DEBUG_DEFAULTS = {
  maxParticles: {
    mobile: 2000,
    desktop: 10500,
  },
  rippleBase: 2,
  rippleVariance: 4,
  rmsAttack: 0.42,
  rmsRelease: 0.16,
  connDist: 200,
  maxConn: 5,
  connSkip: 2,
  swirlForce: 0.04,
  pullForce: 0.012,
  friction: 0.985,
  swirlCenter: 'listen',
};

const FORCE_RADIUS = 0.64; // default: 0.6 — fraction of canvas size for audio/swirl force reach
let RIPPLE_SPEED_BASE = +(localStorage.getItem('sonara_rippleBase') || HERO_DEBUG_DEFAULTS.rippleBase);
let RIPPLE_SPEED_VAR = +(localStorage.getItem('sonara_rippleVariance') || HERO_DEBUG_DEFAULTS.rippleVariance);
let RMS_ATTACK = +(localStorage.getItem('sonara_rmsAttack') || HERO_DEBUG_DEFAULTS.rmsAttack);
let RMS_RELEASE = +(localStorage.getItem('sonara_rmsRelease') || HERO_DEBUG_DEFAULTS.rmsRelease);
let SWIRL_FORCE = +(localStorage.getItem('sonara_swirlForce') || HERO_DEBUG_DEFAULTS.swirlForce);
let PULL_FORCE = +(localStorage.getItem('sonara_pullForce') || HERO_DEBUG_DEFAULTS.pullForce);
let FRICTION = +(localStorage.getItem('sonara_friction') || HERO_DEBUG_DEFAULTS.friction);

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
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  // ── Physics engine switch ────────────────────────────────────────────
  // false = CPU physics (faster at current particle counts)
  // true  = GPU physics via WebGL2 transform feedback
  const GPU_PHYSICS = false;

  // WebGL2 for rendering (both paths) + transform feedback (GPU path)
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return initHeroCanvas2D();

  // --- Shared state ---
  let w, h;
  const _savedMax = localStorage.getItem('sonara_maxParticles');
  let MAX_PARTICLES = _savedMax ? +_savedMax : (isMobileView ? HERO_DEBUG_DEFAULTS.maxParticles.mobile : HERO_DEBUG_DEFAULTS.maxParticles.desktop);
  let THROTTLE_START = Math.round(MAX_PARTICLES * 0.8);
  const PARTICLE_COUNT = Math.min(isMobileView ? 1000 : 6000, MAX_PARTICLES);
  const BUFFER_CAP = 12000; // sized for max dropdown value (11000) + headroom for burst spawns
  let time = 0;
  let lineIntensity = 0;
  let fpsFrames = 0, fpsLastTime = performance.now(), fpsValue = 0;
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
    maxParticles: {
      mobile: isMobileView ? MAX_PARTICLES : HERO_DEBUG_DEFAULTS.maxParticles.mobile,
      desktop: isMobileView ? HERO_DEBUG_DEFAULTS.maxParticles.desktop : MAX_PARTICLES,
    },
    rippleBase: Number(RIPPLE_SPEED_BASE.toFixed(1)),
    rippleVariance: Number(RIPPLE_SPEED_VAR.toFixed(1)),
    rmsAttack: Number(RMS_ATTACK.toFixed(2)),
    rmsRelease: Number(RMS_RELEASE.toFixed(2)),
    connDist: CONN_REACH,
    maxConn: MAX_CONN,
    connSkip: CONN_SEARCH_INTERVAL,
    swirlForce: Number(SWIRL_FORCE.toFixed(3)),
    pullForce: Number(PULL_FORCE.toFixed(3)),
    friction: Number(FRICTION.toFixed(3)),
    swirlCenter: swirlCenterTarget,
  });
  const heroVis = trackVisibility('hero');

  // Debug HUD (localhost only)
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const debugBar = document.createElement('div');
  debugBar.style.cssText = 'position:fixed;top:12px;left:12px;z-index:9999;color:#00ccff;font:bold 18px/1 monospace;display:flex;flex-direction:column;align-items:flex-start;gap:8px';
  const debugTopRow = document.createElement('div');
  debugTopRow.style.cssText = 'display:flex;align-items:center;gap:14px';
  const debugSecondRow = document.createElement('div');
  debugSecondRow.style.cssText = 'display:flex;align-items:center;gap:14px';
  debugBar.appendChild(debugTopRow);
  debugBar.appendChild(debugSecondRow);
  if (isLocal) {
    debugBar.addEventListener('change', (e) => {
      if (e.target instanceof HTMLSelectElement) {
        e.target.blur();
      }
    });
    debugBar.addEventListener('click', (e) => {
      if (e.target instanceof HTMLButtonElement) {
        window.setTimeout(() => e.target.blur(), 0);
      }
    });
  }
  // Connection search interval dropdown (left of FPS)
  if (isLocal) {
    const rbLabel = document.createElement('span');
    rbLabel.textContent = 'Ripple base:';
    const rbSel = document.createElement('select');
    rbSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
    for (let i = 0; i <= 10; i++) {
      const v = i * 0.5;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.rippleBase) < 0.001;
      opt.textContent = v.toFixed(1) + (isDefault ? ' ★' : '');
      if (Math.abs(v - RIPPLE_SPEED_BASE) < 0.001) opt.selected = true;
      rbSel.appendChild(opt);
    }
    rbSel.addEventListener('change', () => { RIPPLE_SPEED_BASE = +rbSel.value; localStorage.setItem('sonara_rippleBase', RIPPLE_SPEED_BASE); });
    debugSecondRow.appendChild(rbLabel);
    debugSecondRow.appendChild(rbSel);

    const rvLabel = document.createElement('span');
    rvLabel.textContent = 'Ripple var:';
    const rvSel = document.createElement('select');
    rvSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
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
    debugSecondRow.appendChild(rvLabel);
    debugSecondRow.appendChild(rvSel);

    const raLabel = document.createElement('span');
    raLabel.textContent = 'RMS atk:';
    const raSel = document.createElement('select');
    raSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
    for (let i = 0; i <= 50; i++) {
      const v = i * 0.02;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.rmsAttack) < 0.001;
      opt.textContent = v.toFixed(2) + (isDefault ? ' ★' : '');
      if (Math.abs(v - RMS_ATTACK) < 0.001) opt.selected = true;
      raSel.appendChild(opt);
    }
    raSel.addEventListener('change', () => { RMS_ATTACK = +raSel.value; localStorage.setItem('sonara_rmsAttack', RMS_ATTACK); });
    debugSecondRow.appendChild(raLabel);
    debugSecondRow.appendChild(raSel);

    const rrLabel = document.createElement('span');
    rrLabel.textContent = 'RMS rel:';
    const rrSel = document.createElement('select');
    rrSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
    for (let i = 0; i <= 50; i++) {
      const v = i * 0.02;
      const opt = document.createElement('option');
      opt.value = v;
      const isDefault = Math.abs(v - HERO_DEBUG_DEFAULTS.rmsRelease) < 0.001;
      opt.textContent = v.toFixed(2) + (isDefault ? ' ★' : '');
      if (Math.abs(v - RMS_RELEASE) < 0.001) opt.selected = true;
      rrSel.appendChild(opt);
    }
    rrSel.addEventListener('change', () => { RMS_RELEASE = +rrSel.value; localStorage.setItem('sonara_rmsRelease', RMS_RELEASE); });
    debugSecondRow.appendChild(rrLabel);
    debugSecondRow.appendChild(rrSel);

    const label = document.createElement('span');
    label.textContent = 'Conn skip:';
    const sel = document.createElement('select');
    sel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
    for (let i = 1; i <= 30; i++) {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i;
      if (i === CONN_SEARCH_INTERVAL) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => { CONN_SEARCH_INTERVAL = +sel.value; connSearchFrame = 0; localStorage.setItem('sonara_connSkip', CONN_SEARCH_INTERVAL); });
    debugTopRow.appendChild(label);
    debugTopRow.appendChild(sel);

  }

  // FPS display (fixed width so it doesn't jump)
  const fpsEl = document.createElement('span');
  fpsEl.style.cssText = 'pointer-events:none;display:inline-block;flex:0 0 8ch;width:8ch;text-align:right;white-space:nowrap;color:#f0c040';
  debugTopRow.appendChild(fpsEl);

  // Max particles dropdown (between FPS and particle counts)
  if (isLocal) {
    const pLabel = document.createElement('span');
    pLabel.textContent = 'Max:';
    const pSel = document.createElement('select');
    pSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
    for (let i = 500; i <= 11000; i += 500) {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i;
      if (i === MAX_PARTICLES) opt.selected = true;
      pSel.appendChild(opt);
    }
    pSel.addEventListener('change', () => {
      MAX_PARTICLES = +pSel.value;
      THROTTLE_START = Math.round(MAX_PARTICLES * 0.8);
      localStorage.setItem('sonara_maxParticles', MAX_PARTICLES);
    });
    debugTopRow.appendChild(pLabel);
    debugTopRow.appendChild(pSel);
  }

  // Particle stats
  const counterEl = document.createElement('span');
  counterEl.style.cssText = 'pointer-events:none;display:inline-flex;align-items:center;gap:1ch;white-space:nowrap';
  const createLockedStat = (label) => {
    const statEl = document.createElement('span');
    statEl.style.cssText = 'display:inline-flex;align-items:center';

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
  highWaterEl.style.cssText = 'display:inline-block';
  counterEl.appendChild(autoStat.statEl);
  counterEl.appendChild(burstStat.statEl);
  counterEl.appendChild(totalStat.statEl);
  counterEl.appendChild(highWaterEl);
  debugTopRow.appendChild(counterEl);

  // Connection tuning dropdowns (right of T)
  if (isLocal) {
    const cLabel = document.createElement('span');
    cLabel.textContent = 'Conn:';
    const cSel = document.createElement('select');
    cSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
    for (let i = 1; i <= 5; i++) {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i;
      if (i === MAX_CONN) opt.selected = true;
      cSel.appendChild(opt);
    }
    cSel.addEventListener('change', () => { MAX_CONN = +cSel.value; localStorage.setItem('sonara_maxConn', MAX_CONN); });
    debugTopRow.appendChild(cLabel);
    debugTopRow.appendChild(cSel);

    const dLabel = document.createElement('span');
    dLabel.textContent = 'Dist:';
    const dSel = document.createElement('select');
    dSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
    for (let i = 100; i <= 200; i += 10) {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i + 'px';
      if (i === CONN_REACH) opt.selected = true;
      dSel.appendChild(opt);
    }
    dSel.addEventListener('change', () => { updateConnReach(+dSel.value); localStorage.setItem('sonara_connDist', CONN_REACH); });
    debugTopRow.appendChild(dLabel);
    debugTopRow.appendChild(dSel);

    const sLabel = document.createElement('span');
    sLabel.textContent = 'Swirl:';
    const sSel = document.createElement('select');
    sSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
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
    debugTopRow.appendChild(sLabel);
    debugTopRow.appendChild(sSel);

    const plLabel = document.createElement('span');
    plLabel.textContent = 'Pull:';
    const plSel = document.createElement('select');
    plSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
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
    debugTopRow.appendChild(plLabel);
    debugTopRow.appendChild(plSel);

    const frLabel = document.createElement('span');
    frLabel.textContent = 'Friction:';
    const frSel = document.createElement('select');
    frSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
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
    debugTopRow.appendChild(frLabel);
    debugTopRow.appendChild(frSel);

    const scLabel = document.createElement('span');
    scLabel.textContent = 'Center:';
    const scSel = document.createElement('select');
    scSel.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 4px';
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
    debugTopRow.appendChild(scLabel);
    debugTopRow.appendChild(scSel);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy JSON';
    copyBtn.style.cssText = 'background:#111;color:#00ccff;border:1px solid #00ccff44;font:bold 16px monospace;padding:2px 8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:0 0 11ch;width:11ch;text-align:center;white-space:nowrap';
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
    debugTopRow.appendChild(copyBtn);
  }
  if (isLocal) {
    canvas.parentElement.appendChild(debugBar);
  }

  // Swirl center target element
  let swirlCenterTarget = localStorage.getItem('sonara_swirlCenter') || HERO_DEBUG_DEFAULTS.swirlCenter;
  const swirlCenterEls = {
    listen: listenBtn,
    turning: document.querySelector('.hero-tagline'),
    sounds: document.querySelector('.hero-expansion'),
    sonara: document.querySelector('.hero-title'),
  };

  let heroAudioPlaying = false;
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
  const RIPPLE_BURST_DURATION = 10000;

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
      heroAudioPlaying = listenBtn.classList.contains('playing');
    });
    mo.observe(listenBtn, { attributes: true, attributeFilter: ['class'] });
    listenBtn.addEventListener('click', () => {
      rippleClickTime = performance.now();
      spawnRipple();
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
      int delayFrames = min(int(distFromBtn / rippleSpeed), 511);
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
    uniform vec2 u_resolution;
    out float v_alpha;
    void main() {
      vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
      clip.y = -clip.y;
      gl_Position = vec4(clip, 0.0, 1.0);
      gl_PointSize = a_size;
      v_alpha = a_alpha;
    }`;

  const PARTICLE_FS = `#version 300 es
    precision mediump float;
    in float v_alpha;
    uniform float u_glowAlpha;
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
      fragColor = vec4(0.831 * alpha, 0.659 * alpha, 0.263 * alpha, alpha);
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
    resolution: gl.getUniformLocation(particleProg, 'u_resolution'),
    glowAlpha:  gl.getUniformLocation(particleProg, 'u_glowAlpha'),
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
  const PFLOATS = 4; // x, y, size, alpha per particle
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
    gl.vertexAttribPointer(pLoc.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(pLoc.size);
    gl.vertexAttribPointer(pLoc.size, 1, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(pLoc.alpha);
    gl.vertexAttribPointer(pLoc.alpha, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);
  }

  // --- Line buffer + VAO (shared) ---
  const MAX_LINES = 1000000; // TEMP: uncapped to debug connection islands
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

  // --- Ripple buffer (shared JS array; GPU path also uploads to texture) ---
  const RIPPLE_BUF_LEN = 512;
  const rippleBuf = new Float32Array(RIPPLE_BUF_LEN);
  let rippleHead = 0;

  // CPU path reads ripple buffer directly
  function getDelayedIntensity(dist, rippleSpeed) {
    const delayFrames = Math.min((dist / rippleSpeed) | 0, RIPPLE_BUF_LEN - 1);
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
  const CONN_FADE_IN = 0.04;
  const CONN_FADE_OUT = 0.025;
  let connSearchFrame = 0;

  let nextPid = 0;

  function resize() {
    const dpr = window.devicePixelRatio > 1 ? 1.5 : 1;
    w = canvas.width = canvas.offsetWidth * dpr;
    h = canvas.height = canvas.offsetHeight * dpr;
    canvas.style.width = canvas.offsetWidth + 'px';
    canvas.style.height = canvas.offsetHeight + 'px';
    gl.viewport(0, 0, w, h);
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
    pids[slot] = nextPid++;
  }

  // ─── init ────────────────────────────────────────────────────────────
  function init() {
    connFade.clear();
    grid.clear();
    framePairs.clear();

    if (GPU_PHYSICS) {
      highWater = PARTICLE_COUNT;
      freeSlots.length = 0;
      isFree.fill(0);

      const initData = new Float32Array(BUFFER_CAP * FPP);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
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
        pids[i] = nextPid++;
      }
      for (let i = PARTICLE_COUNT; i < BUFFER_CAP; i++) {
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
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          pid: nextPid++,
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          r: Math.random() * 2 + 0.5,
          alpha: Math.random() * 0.4 + 0.1,
          phase: Math.random() * Math.PI * 2,
          reactivity: 0.3 + Math.random() * 0.7,
          rippleSpeed: RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR
        });
      }
    }
  }

  // ─── draw ────────────────────────────────────────────────────────────
  function draw() {
    if (!heroVis.visible) { requestAnimationFrame(draw); return; }
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
      const rate = target > audioIntensity ? RMS_ATTACK : RMS_RELEASE;
      audioIntensity += (target - audioIntensity) * rate;
      audioTransient += (transientTarget - audioTransient) * 0.45;
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
      const rate = target > audioIntensity ? RMS_ATTACK : RMS_RELEASE;
      audioIntensity += (target - audioIntensity) * rate;
      audioTransient += (transientTarget - audioTransient) * 0.68;
      rmsSmooth += (target - rmsSmooth) * 0.018;
      const rippleAge = now - rippleClickTime;
      if (rippleClickTime > 0 && rippleAge < RIPPLE_BURST_DURATION) {
        const decay = 1 - rippleAge / RIPPLE_BURST_DURATION;
        const interval = 800 + (1 - decay) * 3200;
        if (target > rmsSmooth + 0.35 && now - lastRippleTime > interval) {
          spawnRipple();
          lastRippleTime = now;
        }
      }
    } else {
      audioIntensity += (0 - audioIntensity) * 0.08;
      audioTransient += (0 - audioTransient) * 0.34;
      rmsSmooth = 0;
    }
    } // end desktop audio block

    // Ripple buffer update (shared)
    rippleHead = (rippleHead + 1) % RIPPLE_BUF_LEN;
    rippleBuf[rippleHead] = Math.min(1, audioIntensity * 0.68 + audioTransient * 0.68);

    // Swirl center (based on selected target element)
    let btnCX = w * 0.5, btnCY = h * 0.5;
    const centerEl = swirlCenterEls[swirlCenterTarget] || listenBtn;
    if (!isMobileView && centerEl) {
      const elRect = centerEl.getBoundingClientRect();
      if (elRect.width > 0) {
        const canRect = canvas.getBoundingClientRect();
        btnCX = (elRect.left + elRect.width * 0.5 - canRect.left) * (w / canRect.width);
        btnCY = (elRect.top + elRect.height * 0.5 - canRect.top) * (h / canRect.height);
      }
    }

    const scaleX = w / window.innerWidth;
    const scaleY = h / window.innerHeight;
    const mx = mouseX * scaleX, my = mouseY * scaleY;

    let autoCount = 0, aliveCount = 0;

    // ==================================================================
    // GPU PHYSICS PATH
    // ==================================================================
    if (GPU_PHYSICS) {
      // Upload ripple texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rippleTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RIPPLE_BUF_LEN, 1, gl.RED, gl.FLOAT, rippleBuf);

      // --- Spawning ---
      const aliveApprox = highWater - freeSlots.length;
      const fillRatio = Math.min(1, aliveApprox / MAX_PARTICLES);
      const audioRate = 0.15 + 0.4 * (1 - fillRatio);
      const spawnRate = audioIntensity > 0.01 ? audioRate * 2 : 0.15;
      if (aliveApprox < MAX_PARTICLES && Math.random() < spawnRate) {
        spawnQueue.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
          phase: Math.random() * Math.PI * 2,
          alpha: Math.random() * 0.4 + 0.1,
          r: Math.random() * 2 + 0.5,
          age: 0, fadeIn: 120,
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
      const spawnRate = audioIntensity > 0.01 ? audioRate * 2 : 0.15;
      if (particles.length < MAX_PARTICLES && Math.random() < spawnRate) {
        particles.push({
          pid: nextPid++,
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
          r: Math.random() * 2 + 0.5, alpha: Math.random() * 0.4 + 0.1,
          phase: Math.random() * Math.PI * 2, age: 0, fadeIn: 120,
          rippleSpeed: RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR
        });
      }

      // --- Culling ---
      autoCount = particles.reduce((n, p) => n + (p.life === undefined ? 1 : 0), 0);
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

      aliveCount = particles.length;
    }

    // ==================================================================
    // SPATIAL GRID + CONNECTION LINES (shared, source differs by path)
    // ==================================================================
    const pSource = GPU_PHYSICS ? cpuParticles : particles;
    const pCount  = GPU_PHYSICS ? highWater : particles.length;

    // Connection search runs every CONN_SEARCH_INTERVAL frames (1 = every frame, 2 = every other, etc.)
    connSearchFrame = (connSearchFrame + 1) % CONN_SEARCH_INTERVAL;
    const doConnSearch = connSearchFrame === 0;

    if (doConnSearch) {
      // Build grid
      const CELL = CONN_REACH;
      const cols = Math.ceil(w / CELL) + 1;
      for (const cell of grid.values()) cell.length = 0;
      for (let i = 0; i < pCount; i++) {
        if (GPU_PHYSICS && pSource[i].dead) continue;
        const p = pSource[i];
        const key = ((p.x / CELL) | 0) + ((p.y / CELL) | 0) * cols;
        const cell = grid.get(key);
        if (cell) { cell.push(i); } else { grid.set(key, [i]); }
      }

      const connCount = new Uint8Array(pCount);
      const aiBrightBoost = 1 + lineIntensity * 2;
      const LINE_BASE = 0.08;
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
    lineIntensity += (audioIntensity - lineIntensity) * 0.05;
    let lineIdx = 0;
    const toDelete = [];
    for (const [ck, entry] of connFade) {
      if (entry.a.dead || entry.b.dead) {
        entry.target = 0;
      }
      if (doConnSearch && !framePairs.has(ck)) {
        entry.target = 0;
      }
      const rate = entry.target > entry.alpha ? CONN_FADE_IN : CONN_FADE_OUT;
      entry.alpha += (entry.target - entry.alpha) * rate;
      if (entry.alpha < 0.001 && entry.target === 0) {
        toDelete.push(ck);
        continue;
      }
      if (lineIdx < MAX_LINES * LFLOATS) {
        const a = entry.a, b = entry.b;
        lineData[lineIdx++] = a.x;
        lineData[lineIdx++] = a.y;
        lineData[lineIdx++] = entry.alpha;
        lineData[lineIdx++] = b.x;
        lineData[lineIdx++] = b.y;
        lineData[lineIdx++] = entry.alpha;
      }
    }
    for (const ck of toDelete) connFade.delete(ck);
    const lineVertCount = lineIdx / 3;

    // ==================================================================
    // CPU PHYSICS LOOP (only when !GPU_PHYSICS — runs AFTER connections)
    // ==================================================================
    let activeCount = 0;
    if (!GPU_PHYSICS) {
      let pIdx = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const wave = Math.sin(time * 2 + p.phase) * 0.5 + 0.5;
        const fadeIn = p.fadeIn !== undefined ? Math.min(1, p.age / p.fadeIn) : 1;
        const react = p.reactivity || 0;
        const dxB = p.x - btnCX, dyB = p.y - btnCY;
        const distFromBtn = Math.sqrt(dxB * dxB + dyB * dyB);
        const localIntensity = getDelayedIntensity(distFromBtn, p.rippleSpeed || RIPPLE_SPEED_BASE);
        const attenuationRadius = Math.max(w, h) * FORCE_RADIUS;
        const radialAttenuation = Math.pow(Math.max(0, 1 - distFromBtn / attenuationRadius), 1.5);
        const audioBoost = localIntensity * radialAttenuation * react * (0.8 + Math.sin(time * 3.7 + p.phase * 2) * 0.3);
        const tremble = (Math.random() - 0.5) * 0.12 * localIntensity * react;
        const currentAlpha = Math.min(1, (p.alpha * (0.5 + wave * 0.5) * fadeIn + audioBoost * 1.5 + tremble) * HERO_PARTICLE_BRIGHTNESS);
        const currentR = p.r * (0.8 + wave * 0.4) * (1 + audioBoost * 0.5);

        // Fill GPU buffer
        particleData[pIdx++] = p.x;
        particleData[pIdx++] = p.y;
        particleData[pIdx++] = Math.max(3, currentR * 6);
        particleData[pIdx++] = currentAlpha;

        // Physics: position update
        p.x += p.vx;
        p.y += p.vy;

        // Audio swirl
        {
          const dist = distFromBtn || 1;
          const swirlRadius = Math.max(w, h) * FORCE_RADIUS;
          const proximity = Math.max(0, 1 - dist / swirlRadius);
          if (localIntensity > 0.01 && proximity > 0) {
            const nx = dxB / dist, ny = dyB / dist;
            const swirlStr = localIntensity * proximity * SWIRL_FORCE;
            p.vx += -ny * swirlStr;
            p.vy += nx * swirlStr;
            const pull = localIntensity * proximity * PULL_FORCE;
            p.vx -= nx * pull;
            p.vy -= ny * pull;
            const jit = react * 0.25 * localIntensity;
            p.vx += (Math.random() - 0.5) * jit;
            p.vy += (Math.random() - 0.5) * jit;
          }
          if (localIntensity < 0.5 && localIntensity > 0.001 && !heroAudioPlaying && dist > 1) {
            const nx = dxB / dist, ny = dyB / dist;
            const spread = (0.5 - localIntensity) * 0.008;
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
    // RENDER
    // ==================================================================
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
    if (GPU_PHYSICS) {
      if (highWater > 0) {
        gl.useProgram(particleProg);
        gl.uniform2f(pLoc.resolution, w, h);
        gl.uniform1f(pLoc.glowAlpha, (0.06 + audioIntensity * 0.08) * HERO_PARTICLE_BRIGHTNESS);
        gl.bindVertexArray(renderVAO[tfCurrent]);
        gl.drawArrays(gl.POINTS, 0, highWater);
      }
    } else {
      if (activeCount > 0) {
        gl.useProgram(particleProg);
        gl.uniform2f(pLoc.resolution, w, h);
        gl.uniform1f(pLoc.glowAlpha, (0.06 + audioIntensity * 0.08) * HERO_PARTICLE_BRIGHTNESS);
        gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, particleData.subarray(0, activeCount * PFLOATS));
        gl.bindVertexArray(cpuRenderVAO);
        gl.drawArrays(gl.POINTS, 0, activeCount);
      }
    }

    gl.bindVertexArray(null);

    // FPS counter
    fpsFrames++;
    if (now - fpsLastTime >= 1000) {
      fpsValue = fpsFrames;
      fpsFrames = 0;
      fpsLastTime = now;
    }

    const burstCount = aliveCount - autoCount;
    if (isLocal) {
      fpsEl.textContent = `${fpsValue} fps`;
      autoStat.statValueEl.textContent = `${autoCount}`;
      burstStat.statValueEl.textContent = `${burstCount}`;
      totalStat.statValueEl.textContent = `${aliveCount}`;
      highWaterEl.textContent = GPU_PHYSICS ? `HW:${highWater}` : '';
    }
    requestAnimationFrame(draw);
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

    if (GPU_PHYSICS) {
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
          pid: nextPid++,
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
          rippleSpeed: RIPPLE_SPEED_BASE + Math.random() * RIPPLE_SPEED_VAR
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
      } else if (!GPU_PHYSICS) {
        for (const p of particles) { p.x *= sx; p.y *= sy; }
      }
    }
  });
  resize();
  init();
  draw();
}


// ===== Hero: Canvas 2D fallback =====
function initHeroCanvas2D() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  const PARTICLE_COUNT = isMobileView ? 1000 : 2000;
  let particles = [];
  let time = 0;
  const heroVis = trackVisibility('hero');
  let heroAudioPlaying = false;
  let audioIntensity = 0;
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
        phase: Math.random() * Math.PI * 2, reactivity: 0.3 + Math.random() * 0.7
      });
    }
  }

  function draw() {
    if (!heroVis.visible) { requestAnimationFrame(draw); return; }
    c.clearRect(0, 0, w, h);
    time += 0.005;
    if (isMobileView) {
      const t = performance.now() * 0.001;
      const breath = Math.sin(t * 0.52) * 0.5 + 0.5;
      const swell  = Math.sin(t * 1.26 + 1.7) * 0.5 + 0.5;
      const shimmer = Math.sin(t * 3.5 + 0.3) * 0.5 + 0.5;
      const synthetic = breath * 0.55 + swell * 0.3 + shimmer * 0.15;
      const target = synthetic * 0.55 + 0.05;
      audioIntensity += ((target > audioIntensity ? RMS_ATTACK : RMS_RELEASE) * (target - audioIntensity));
      rmsSmooth += (target - rmsSmooth) * 0.018;
    } else {
    const heroAn = getHeroAnalyser();
    if (heroAn) {
      heroAn.getByteTimeDomainData(heroRmsData);
      let sum = 0;
      for (let i = 0; i < heroRmsData.length; i++) { const v = (heroRmsData[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / heroRmsData.length);
      const target = Math.min(1, rms * 10);
      audioIntensity += ((target > audioIntensity ? RMS_ATTACK : RMS_RELEASE) * (target - audioIntensity));
      rmsSmooth += (target - rmsSmooth) * 0.018;
      const now = performance.now();
      if (target > rmsSmooth + 0.35 && now - lastRippleTime > 1200) { spawnRipple(); lastRippleTime = now; }
    } else { audioIntensity += (0 - audioIntensity) * 0.08; rmsSmooth = 0; }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.age !== undefined) p.age++;
      if (p.life !== undefined) { p.life -= p.decay; if (p.life <= 0) { particles.splice(i, 1); continue; } p.alpha = p.baseAlpha * p.life; }
    }
    const fillRatio2d = Math.min(1, particles.length / 2000);
    const audioRate2d = 0.15 + 0.4 * (1 - fillRatio2d);
    const spawnRate = audioIntensity > 0.01 ? audioRate2d * 2 : 0.15;
    if (particles.length < 2000 && Math.random() < spawnRate) {
      particles.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, r: Math.random() * 2 + 0.5, alpha: Math.random() * 0.4 + 0.1, phase: Math.random() * Math.PI * 2, age: 0, fadeIn: 120 });
    }
    const CELL = 140, cols = Math.ceil(w / CELL) + 1, grid = new Map();
    for (let i = 0; i < particles.length; i++) { const p = particles[i]; const key = ((p.x / CELL) | 0) + ((p.y / CELL) | 0) * cols; const cell = grid.get(key); if (cell) cell.push(i); else grid.set(key, [i]); }
    const buckets = [[], [], [], [], []], MAX_CONN = 3, connCount = new Uint8Array(particles.length);
    for (const [key, cell] of grid) { const gx = key % cols, gy = (key / cols) | 0; for (let nx = gx; nx <= gx + 1; nx++) { for (let ny = gy - 1; ny <= gy + 1; ny++) { if (nx === gx && ny < gy) continue; const nk = nx + ny * cols, neighbor = nk === key ? cell : grid.get(nk); if (!neighbor) continue; for (let ii = 0; ii < cell.length; ii++) { const ai = cell[ii]; if (connCount[ai] >= MAX_CONN) continue; const a = particles[ai], jStart = nk === key ? ii + 1 : 0; for (let jj = jStart; jj < neighbor.length; jj++) { const bi = neighbor[jj]; if (connCount[bi] >= MAX_CONN) continue; const b = particles[bi], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy; if (d2 < 19600) { buckets[Math.min((d2 / 3920) | 0, 4)].push(a.x, a.y, b.x, b.y); connCount[ai]++; connCount[bi]++; } } } } } }
    c.lineWidth = 0.5 + audioIntensity * 0.5;
    const aiBB = 1 + audioIntensity * 2, als = [0.06 * aiBB, 0.048 * aiBB, 0.036 * aiBB, 0.024 * aiBB, 0.012 * aiBB];
    for (let b = 0; b < 5; b++) { const lines = buckets[b]; if (!lines.length) continue; c.strokeStyle = `rgba(212,168,67,${als[b]})`; c.beginPath(); for (let k = 0; k < lines.length; k += 4) { c.moveTo(lines[k], lines[k + 1]); c.lineTo(lines[k + 2], lines[k + 3]); } c.stroke(); }
    let btnCX = w * 0.5, btnCY = h * 0.5;
    if (!isMobileView && listenBtn) { const br = listenBtn.getBoundingClientRect(); if (br.width > 0) { const cr = canvas.getBoundingClientRect(); btnCX = (br.left + br.width * 0.5 - cr.left) * (w / cr.width); btnCY = (br.top + br.height * 0.5 - cr.top) * (h / cr.height); } }
    const scaleX = w / window.innerWidth, scaleY = h / window.innerHeight, mx = mouseX * scaleX, my = mouseY * scaleY;
    const glowList = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i], wave = Math.sin(time * 2 + p.phase) * 0.5 + 0.5, fadeIn = p.fadeIn !== undefined ? Math.min(1, p.age / p.fadeIn) : 1, react = p.reactivity || 0;
      const audioBoost = audioIntensity * react * (0.8 + Math.sin(time * 3.7 + p.phase * 2) * 0.3);
      const currentAlpha = Math.min(1, p.alpha * (0.5 + wave * 0.5) * fadeIn + audioBoost * 1.5);
      const currentR = p.r * (0.8 + wave * 0.4) * (1 + audioBoost * 0.5);
      c.fillStyle = `rgba(212,168,67,${currentAlpha})`;
      if (currentR < 1.5) { const s = currentR * 2; c.fillRect(p.x - currentR, p.y - currentR, s, s); } else { c.beginPath(); c.arc(p.x, p.y, currentR, 0, Math.PI * 2); c.fill(); }
      if (currentAlpha > 0.35) glowList.push(p.x, p.y, currentR * 3);
      p.x += p.vx; p.y += p.vy;
      { const dcx = p.x - btnCX, dcy = p.y - btnCY, dist = Math.sqrt(dcx * dcx + dcy * dcy) || 1, swirlRadius = Math.max(w, h) * FORCE_RADIUS, proximity = Math.max(0, 1 - dist / swirlRadius);
        if (audioIntensity > 0.01 && proximity > 0) { const nx = dcx / dist, ny = dcy / dist; p.vx += -ny * audioIntensity * proximity * 0.04; p.vy += nx * audioIntensity * proximity * 0.04; const pull = audioIntensity * proximity * 0.012; p.vx -= nx * pull; p.vy -= ny * pull; const jit = react * 0.25 * audioIntensity; p.vx += (Math.random() - 0.5) * jit; p.vy += (Math.random() - 0.5) * jit; }
        if (audioIntensity < 0.5 && audioIntensity > 0.001 && !heroAudioPlaying && dist > 1) { const nx = dcx / dist, ny = dcy / dist; p.vx += nx * (0.5 - audioIntensity) * 0.008; p.vy += ny * (0.5 - audioIntensity) * 0.008; } }
      if (!listenBtn || !listenBtn.classList.contains('playing')) { const dmx = mx - p.x, dmy = my - p.y, d2 = dmx * dmx + dmy * dmy; if (d2 < 122500) { const mdist = Math.sqrt(d2), proximity = 1 - mdist / 350; p.vx += dmx * proximity * 0.00012 * MOUSE_INTERACTION_MULT + dmy * proximity * 0.00015 * MOUSE_INTERACTION_MULT; p.vy += dmy * proximity * 0.00012 * MOUSE_INTERACTION_MULT + (-dmx) * proximity * 0.00015 * MOUSE_INTERACTION_MULT; } }
      p.vx *= FRICTION; p.vy *= FRICTION;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0; if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
    }
    if (glowList.length > 0) { c.fillStyle = `rgba(212,168,67,${0.06 + audioIntensity * 0.08})`; c.beginPath(); for (let g = 0; g < glowList.length; g += 3) { c.moveTo(glowList[g] + glowList[g + 2], glowList[g + 1]); c.arc(glowList[g], glowList[g + 1], glowList[g + 2], 0, Math.PI * 2); } c.fill(); }
    requestAnimationFrame(draw);
  }

  let heroDragging = false;
  const heroEl = document.getElementById('hero');
  function spawnBurst(e) {
    if (particles.length > 2000) return;
    const rect = canvas.getBoundingClientRect(), scaleX = w / rect.width, scaleY = h / rect.height;
    const cx = (e.clientX - rect.left) * scaleX, cy = (e.clientY - rect.top) * scaleY;
    const count = heroDragging ? 1 : 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) { const angle = Math.random() * Math.PI * 2, speed = 0.3 + Math.random() * 0.6, baseAlpha = 0.3 + Math.random() * 0.2;
      particles.push({ x: cx + (Math.random() - 0.5) * 20, y: cy + (Math.random() - 0.5) * 20, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: Math.random() * 2 + 0.5, alpha: baseAlpha, baseAlpha, phase: Math.random() * Math.PI * 2, life: 1, decay: 0.0003 + Math.random() * 0.0007, age: 0, fadeIn: 80 + Math.floor(Math.random() * 80) }); }
  }
  heroEl.addEventListener('mousedown', (e) => { heroDragging = true; spawnBurst(e); });
  heroEl.addEventListener('mousemove', (e) => { if (heroDragging) spawnBurst(e); });
  window.addEventListener('mouseup', () => { heroDragging = false; });
  window.addEventListener('resize', () => { resize(); init(); });
  resize(); init(); draw();
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
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
    initOrbs();
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
    if (!vis.visible) { requestAnimationFrame(draw); return; }
    c.clearRect(0, 0, w, h);
    time += 0.003 * ORB_MOTION_MULT;

    // Convert global mouse to canvas-local coords
    const rect = canvas.getBoundingClientRect();
    mxV = mouseX - rect.left;
    myV = mouseY - rect.top;

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

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
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
    if (!vis.visible) { requestAnimationFrame(draw); return; }
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

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
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
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
    initStars();
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
    if (!vis.visible) { requestAnimationFrame(draw); return; }
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
      if (s.y < -5) {
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

    requestAnimationFrame(draw);
  }

  // Click + drag to add stars
  let domeDragging = false;
  const domeEl = document.getElementById('education');

  function spawnStars(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const count = domeDragging ? 2 + Math.floor(Math.random() * 2) : 5 + Math.floor(Math.random() * 4);
    spawnStarsAt(cx, cy, { count, spread: 40, speedMul: 1 });
  }

  domeEl.addEventListener('mousedown', (e) => { domeDragging = true; spawnStars(e); });
  domeEl.addEventListener('mousemove', (e) => { if (domeDragging) spawnStars(e); });
  window.addEventListener('mouseup', () => { domeDragging = false; });

  window.addEventListener('resize', resize);
  resize();
  draw();
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
    if (!vis.visible) { requestAnimationFrame(draw); return; }
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

    requestAnimationFrame(draw);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas.parentElement);
  resize();
  draw();
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
    if (!vis2.visible) { requestAnimationFrame(draw); return; }
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

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
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
    if (!vis.visible) { requestAnimationFrame(draw); return; }
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

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
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
}
