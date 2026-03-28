/**
 * Volumetric light rays + sparkle particles for SONARA title.
 * 
 * SIMPLE RULES:
 * - Light sweeps L-R, pauses, repeats
 * - Glow = radial zoom blur of text from light position
 * - Particles spawn ONLY where glow is visible (breath > 0), AT the glow position
 * - Particles die fast
 */

(function() {
  const canvas = document.getElementById('rays-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let w, h;
  let time = 0;

  const offscreen = document.createElement('canvas');
  const oc = offscreen.getContext('2d');

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    offscreen.width = w * dpr;
    offscreen.height = h * dpr;
    oc.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- Particles: dead simple ---
  const particles = [];

  function spawnParticle(x, y) {
    if (particles.length > 25) return;
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.3 + Math.random() * 0.8;
    particles.push({
      x: x + (Math.random() - 0.5) * 60,
      y: y + (Math.random() - 0.5) * 100,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.02 + Math.random() * 0.03,
      size: 1.5 + Math.random() * 2.5
    });
  }

  function tickParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    ctx.globalCompositeOperation = 'screen';
    for (const p of particles) {
      ctx.globalAlpha = p.life * 0.25;
      ctx.fillStyle = 'rgba(255, 230, 170, 1)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function draw() {
    time += 0.004;
    ctx.clearRect(0, 0, w, h);

    const span = document.querySelector('.hero-title .glow-wrap');
    if (!span) { requestAnimationFrame(draw); return; }

    const canvasRect = canvas.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const style = getComputedStyle(span);

    const textCY = (spanRect.top - canvasRect.top) + spanRect.height * 0.55;
    const textW = spanRect.width;
    const textL = spanRect.left - canvasRect.left;
    const textR = textL + textW;

    // --- Timing: sweep 60%, pause 40% ---
    const cycle = (time * 0.3) % 1;
    const sweeping = cycle < 0.6;
    const lightProgress = sweeping ? cycle / 0.6 : 1;

    // Light position: starts off-left, ends off-right
    const lightX = textL - textW * 0.6 + lightProgress * textW * 2.2;
    const lightY = textCY;

    // --- Breath: fade in at start, fade out at end + during pause ---
    let breath = 0.8;
    if (lightProgress < 0.15) breath *= lightProgress / 0.15;
    if (lightProgress > 0.85) breath *= (1 - lightProgress) / 0.15;
    if (!sweeping) breath *= Math.max(0, 1 - (cycle - 0.6) / 0.1);

    // --- Draw glow text on offscreen ---
    oc.clearRect(0, 0, w, h);
    const fontSize = parseFloat(style.fontSize);
    oc.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    oc.textBaseline = 'middle';
    oc.letterSpacing = style.letterSpacing;
    oc.fillStyle = 'rgba(255, 230, 170, 1)';

    const measured = oc.measureText('SONARA');
    const scaleX = spanRect.width / measured.width;
    oc.save();
    oc.translate(textL, textCY);
    oc.scale(scaleX, 1);
    oc.textAlign = 'left';
    oc.fillText('SONARA', 0, 0);
    oc.restore();

    // Mask to spotlight
    oc.globalCompositeOperation = 'destination-in';
    const mask = oc.createRadialGradient(lightX, lightY, 0, lightX, lightY, textW * 1.0);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(0.15, 'rgba(255,255,255,0.8)');
    mask.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    mask.addColorStop(0.6, 'rgba(255,255,255,0.1)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    oc.fillStyle = mask;
    oc.fillRect(0, 0, w, h);
    oc.globalCompositeOperation = 'source-over';

    // --- Zoom blur rays ---
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 40; i++) {
      const t = i / 40;
      ctx.globalAlpha = (1 - t) * 0.085 * breath;
      ctx.save();
      ctx.translate(lightX, lightY);
      ctx.scale(1 + t * 0.16, 1 + t * 0.16);
      ctx.translate(-lightX, -lightY);
      ctx.drawImage(offscreen, 0, 0, w, h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // --- Particles: spawn where the GLOW is visible, which is where ---
    // --- the radial mask overlaps the text area ---
    // The glow is brightest at lightX. It hits the text when lightX is within
    // [textL - glowRadius, textR + glowRadius]. The visible spot ON the text
    // is clamped to [textL, textR].
    const glowRadius = textW * 0.6; // effective visible radius (inner bright part)
    const lightOverText = sweeping && breath > 0.1 &&
      lightX >= textL && lightX <= textR;

    if (lightOverText && Math.random() < 0.5) {
      spawnParticle(lightX, lightY);
    }

    tickParticles();
    drawParticles();

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  document.fonts.ready.then(() => {
    setTimeout(() => { resize(); draw(); }, 800);
  });
})();
