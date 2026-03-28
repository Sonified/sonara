/**
 * SONARA Canvas Visuals
 * Hero particle field, citizen science waveform, dome starfield, synth wave.
 */

let mouseX = 0, mouseY = 0;
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
      if (mdist < 250) {
        p.vx += dmx * 0.00004;
        p.vy += dmy * 0.00004;
      }

      p.vx *= 0.998;
      p.vy *= 0.998;

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

// Init all
export function initVisuals() {
  initHeroCanvas();
  initCSCanvas();
  initDomeCanvas();
  initSynthWave();
}
