/**
 * SONARA Canvas Visuals
 * Hero particle field, citizen science waveform, dome starfield, synth wave.
 */

let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

// ===== Hero: Audio-reactive particle constellation =====
function initHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  const PARTICLE_COUNT = 120;
  let particles = [];
  let time = 0;

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
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.4 + 0.1,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function draw() {
    c.clearRect(0, 0, w, h);
    time += 0.005;

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 140) {
          const alpha = (1 - dist / 140) * 0.06;
          c.strokeStyle = `rgba(212, 168, 67, ${alpha})`;
          c.lineWidth = 0.5;
          c.beginPath();
          c.moveTo(particles[i].x, particles[i].y);
          c.lineTo(particles[j].x, particles[j].y);
          c.stroke();
        }
      }
    }

    // Draw + move particles
    particles.forEach(p => {
      // Simulated "audio reactivity" via sine
      const wave = Math.sin(time * 2 + p.phase) * 0.5 + 0.5;
      const currentAlpha = p.alpha * (0.5 + wave * 0.5);
      const currentR = p.r * (0.8 + wave * 0.4);

      c.fillStyle = `rgba(212, 168, 67, ${currentAlpha})`;
      c.beginPath();
      c.arc(p.x, p.y, currentR, 0, Math.PI * 2);
      c.fill();

      // Glow on brighter particles
      if (currentAlpha > 0.25) {
        c.fillStyle = `rgba(212, 168, 67, ${currentAlpha * 0.2})`;
        c.beginPath();
        c.arc(p.x, p.y, currentR * 3, 0, Math.PI * 2);
        c.fill();
      }

      p.x += p.vx;
      p.y += p.vy;

      // Mouse attraction
      const scaleX = w / window.innerWidth;
      const scaleY = h / window.innerHeight;
      const dmx = mouseX * scaleX - p.x;
      const dmy = mouseY * scaleY - p.y;
      const mdist = Math.sqrt(dmx * dmx + dmy * dmy);
      if (mdist < 300) {
        const force = (1 - mdist / 300) * 0.00015;
        // Tangential component for swirl
        const tx = -dmy;
        const ty = dmx;
        const swirl = (1 - mdist / 300) * 0.00012;
        p.vx += dmx * force + tx * swirl;
        p.vy += dmy * force + ty * swirl;
      }

      p.vx *= 0.985;
      p.vy *= 0.985;

      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
    });

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); init(); });
  resize();
  init();
  draw();
}

// ===== Vision: Drifting luminous nebula orbs =====
function initVisionCanvas() {
  const canvas = document.getElementById('vision-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  let time = 0;

  const ORB_COUNT = 35;
  let orbs = [];

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
    initOrbs();
  }

  function initOrbs() {
    orbs = [];
    for (let i = 0; i < ORB_COUNT; i++) {
      const depth = Math.random(); // 0 = far, 1 = near
      orbs.push({
        x: Math.random() * w,
        y: Math.random() * h,
        baseRadius: 80 + depth * 180,
        depth,
        driftX: (Math.random() - 0.5) * 0.2 * (0.3 + depth * 0.7),
        driftY: (Math.random() - 0.5) * 0.15 * (0.3 + depth * 0.7),
        wanderPhaseX: Math.random() * Math.PI * 2,
        wanderPhaseY: Math.random() * Math.PI * 2,
        wanderSpeed: 0.1 + Math.random() * 0.15,
        wanderAmp: 5 + depth * 10,
        phase: Math.random() * Math.PI * 2,
        breatheSpeed: 0.15 + Math.random() * 0.3,
        life: Math.random() * Math.PI * 2, // start at random point in lifecycle
        lifeSpeed: 0.0015 + Math.random() * 0.0025, // how fast they fade in/out
        hue: Math.random() < 0.6
          ? 40 + Math.random() * 10   // warm gold
          : 210 + Math.random() * 20,  // cool blue
        sat: 30 + Math.random() * 40,
      });
    }
    // Sort by depth so far orbs draw first
    orbs.sort((a, b) => a.depth - b.depth);
  }

  function draw() {
    c.clearRect(0, 0, w, h);
    time += 0.003;

    orbs.forEach(orb => {
      // Lifecycle: smooth fade in and out
      orb.life += orb.lifeSpeed;
      const lifecycle = Math.max(0, Math.sin(orb.life)); // 0 → 1 → 0, clamped

      const breathe = Math.sin(time * orb.breatheSpeed + orb.phase) * 0.2 + 0.8;
      const radius = orb.baseRadius * breathe;
      const alpha = (0.04 + orb.depth * 0.08) * breathe * lifecycle;

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
  let time = 0;

  // Pre-generate some "discovery" positions
  const discoveries = Array.from({ length: 6 }, () => ({
    x: 0.15 + Math.random() * 0.7,
    phase: Math.random() * Math.PI * 2,
    freq: 0.3 + Math.random() * 0.4
  }));

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }

  function draw() {
    c.clearRect(0, 0, w, h);
    time += 0.008;

    const centerY = h / 2;
    const amplitude = h * 0.15;

    // Draw main waveform
    c.strokeStyle = 'rgba(58, 181, 160, 0.12)';
    c.lineWidth = 1.5;
    c.beginPath();
    for (let x = 0; x < w; x++) {
      const t = x / w;
      const y = centerY +
        Math.sin(t * 12 + time) * amplitude * 0.6 +
        Math.sin(t * 5.3 + time * 0.7) * amplitude * 0.3 +
        Math.sin(t * 20 + time * 1.5) * amplitude * 0.1;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // Second waveform layer
    c.strokeStyle = 'rgba(58, 181, 160, 0.06)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x < w; x++) {
      const t = x / w;
      const y = centerY +
        Math.sin(t * 8 + time * 0.5 + 1) * amplitude * 0.5 +
        Math.sin(t * 15 + time * 1.2) * amplitude * 0.15;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // Discovery markers (pulsing circles)
    discoveries.forEach(d => {
      const px = d.x * w;
      const pulse = Math.sin(time * d.freq + d.phase) * 0.5 + 0.5;
      const radius = 3 + pulse * 6;
      const alpha = 0.1 + pulse * 0.15;

      c.fillStyle = `rgba(58, 181, 160, ${alpha})`;
      c.beginPath();
      c.arc(px, centerY, radius, 0, Math.PI * 2);
      c.fill();

      // Outer ring
      c.strokeStyle = `rgba(58, 181, 160, ${alpha * 0.4})`;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(px, centerY, radius + 8 + pulse * 5, 0, Math.PI * 2);
      c.stroke();
    });

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
}

// ===== Planetarium: Dome starfield =====
function initDomeCanvas() {
  const canvas = document.getElementById('dome-canvas');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  let w, h;
  let time = 0;
  const STARS = 200;
  let stars = [];

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
        r: Math.random() * 1.5 + 0.3,
        alpha: Math.random() * 0.5 + 0.1,
        speed: Math.random() * 0.2 + 0.05,
        twinkleSpeed: 0.5 + Math.random() * 2,
        twinklePhase: Math.random() * Math.PI * 2
      });
    }
  }

  function draw() {
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
    stars.forEach(s => {
      const twinkle = Math.sin(time * s.twinkleSpeed + s.twinklePhase) * 0.5 + 0.5;
      const a = s.alpha * (0.3 + twinkle * 0.7);

      c.fillStyle = `rgba(200, 210, 230, ${a})`;
      c.beginPath();
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      c.fill();

      // Subtle drift
      s.y -= s.speed;
      if (s.y < -5) {
        s.y = h + 5;
        s.x = Math.random() * w;
      }
    });

    requestAnimationFrame(draw);
  }

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
  let time = 0;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    w = canvas.width = rect.width;
    h = canvas.height = rect.height;
  }

  function draw() {
    c.clearRect(0, 0, w, h);
    time += 0.015;

    const centerY = h / 2;
    const amp = h * 0.25;

    // Wavetable waveform (complex shape = "satellite data oscillator")
    c.strokeStyle = 'rgba(139, 110, 192, 0.5)';
    c.lineWidth = 2;
    c.beginPath();
    for (let x = 0; x < w; x++) {
      const t = x / w;
      const y = centerY +
        Math.sin(t * Math.PI * 4 + time) * amp * 0.5 +
        Math.sin(t * Math.PI * 7 + time * 0.6) * amp * 0.25 +
        Math.sin(t * Math.PI * 13 + time * 1.3) * amp * 0.12;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    // Filled underneath
    c.lineTo(w, centerY);
    c.lineTo(0, centerY);
    c.closePath();
    c.fillStyle = 'rgba(139, 110, 192, 0.04)';
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
  let time = 0;

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

  function draw() {
    c.clearRect(0, 0, w, h);
    time += 0.0008;

    const barWidth = w / BAR_COUNT;
    const maxHeight = h * 0.45;
    const centerY = h * 0.65;

    // Mouse influence: map mouse to canvas coords
    const rect = canvas.getBoundingClientRect();
    const mx = (mouseX - rect.left) / rect.width * w;

    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = bars[i];
      // Two layered sine waves for organic pulsing
      const wave1 = Math.sin(time * bar.freq + bar.phase) * 0.5 + 0.5;
      const wave2 = Math.sin(time * bar.freq2 + bar.phase2) * 0.3 + 0.5;
      const combined = wave1 * 0.7 + wave2 * 0.3;

      // Shape: louder in the middle, quieter at edges
      const shape = 1 - Math.pow((i / BAR_COUNT - 0.5) * 2, 2);

      // Mouse wave: bars near cursor get a smooth height boost
      const barCenterX = (i + 0.5) * barWidth;
      const mouseDist = Math.abs(barCenterX - mx);
      const mouseRadius = w * 0.25;
      const mouseBoost = Math.max(0, 1 - mouseDist / mouseRadius);
      const smoothBoost = mouseBoost * mouseBoost * mouseBoost; // cubic falloff

      const targetHeight = combined * maxHeight * (0.15 + shape * 0.85) + smoothBoost * maxHeight * 0.12;
      const rising = targetHeight > bar.currentHeight;
      bar.currentHeight += (targetHeight - bar.currentHeight) * (rising ? 0.015 : 0.04);
      const barHeight = bar.currentHeight;

      const x = i * barWidth;
      const alpha = 0.04 + combined * 0.08;

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
  let time = 0;
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
    c.lineWidth = 0.8;
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
      c.strokeStyle = 'rgba(212, 168, 67, 0.12)';
      c.stroke();
    }

    // Draw longitude rings
    c.lineWidth = 0.8;
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
      c.strokeStyle = 'rgba(212, 168, 67, 0.09)';
      c.stroke();
    }

    // Randomly toggle active dots
    if (Math.random() < 0.02) {
      const idx = Math.floor(Math.random() * points.length);
      points[idx].active = !points[idx].active;
      points[idx].pulse = Math.random() * Math.PI * 2;
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
      packets[i].t += packets[i].speed;
      if (packets[i].t >= 1) {
        // Ripple on arrival
        ripples.push({ x: packets[i].to.x, y: packets[i].to.y, z: packets[i].to.z, age: 0 });
        packets.splice(i, 1);
      }
    }

    // Update + draw ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age++;
      if (ripples[i].age > 80) { ripples.splice(i, 1); continue; }
      const rp = project(ripples[i].x, ripples[i].y, ripples[i].z);
      if (rp.z < 0) continue;
      const progress = ripples[i].age / 80;
      const alpha = rp.z * 0.25 * (1 - progress);
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
      const arcAlpha = Math.min(pkt.t * 5, 1) * Math.min((1 - pkt.t) * 5, 1) * 0.1;
      c.strokeStyle = `rgba(212, 168, 67, ${arcAlpha})`;
      c.lineWidth = 0.6;
      c.stroke();

      // Traveling dot
      const ta = Math.sin((1 - pkt.t) * omega) / sinO;
      const tb = Math.sin(pkt.t * omega) / sinO;
      const tp = project(
        pkt.from.x * ta + pkt.to.x * tb,
        pkt.from.y * ta + pkt.to.y * tb,
        pkt.from.z * ta + pkt.to.z * tb
      );
      if (tp.z > 0) {
        const dotAlpha = tp.z * 0.4 * Math.min(pkt.t * 5, 1) * Math.min((1 - pkt.t) * 5, 1);
        c.fillStyle = `rgba(212, 168, 67, ${dotAlpha})`;
        c.beginPath();
        c.arc(tp.sx, tp.sy, 2, 0, Math.PI * 2);
        c.fill();
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
        const a = depthAlpha * (0.15 + pulse * 0.25) * g;
        const r = (1.5 + pulse * 2) * g;
        c.fillStyle = `rgba(212, 168, 67, ${a})`;
        c.beginPath();
        c.arc(pt.sx, pt.sy, Math.max(0.8, r), 0, Math.PI * 2);
        c.fill();

        if (g > 0.3) {
          c.strokeStyle = `rgba(212, 168, 67, ${a * 0.3})`;
          c.lineWidth = 0.5;
          c.beginPath();
          c.arc(pt.sx, pt.sy, r + 3 + pulse * 3, 0, Math.PI * 2);
          c.stroke();
        }
      } else {
        const a = depthAlpha * 0.08;
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
  initDomeCanvas();
  initSynthWave();
  initSpectrumCanvas();
  initGlobeCanvas();
}
