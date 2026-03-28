/**
 * Volumetric god rays from behind text.
 * Renders text as a stencil mask, places a moving light source behind it,
 * then radially blurs outward from the light position to create rays
 * that appear to shine through and around the letter edges.
 */

(function() {
  const canvas = document.getElementById('rays-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let w, h;
  let lightX = 0; // 0-1, traveling left to right
  let time = 0;

  function resize() {
    const title = canvas.parentElement;
    const rect = title.getBoundingClientRect();
    w = rect.width * 1.2;
    h = rect.height * 2;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getTextMetrics() {
    const title = canvas.parentElement;
    const span = title.querySelector('.glow-wrap');
    const titleRect = title.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const style = getComputedStyle(span);
    return {
      text: 'SONARA',
      fontSize: parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      fontFamily: style.fontFamily,
      letterSpacing: parseFloat(style.letterSpacing) || 0,
      // Position of text relative to canvas
      x: (spanRect.left - titleRect.left) + (w - titleRect.width * 1.2) / 2 + w * 0.05,
      y: h * 0.5,
      width: spanRect.width,
      height: spanRect.height
    };
  }

  function drawRays() {
    time += 0.003;
    // Light moves left to right over ~10 seconds, pauses, returns
    lightX = (Math.sin(time * 0.7) + 1) / 2;

    ctx.clearRect(0, 0, w, h);

    const metrics = getTextMetrics();

    // Light source position (behind the text, moving L-R)
    const lx = metrics.x + lightX * metrics.width;
    const ly = metrics.y;

    // 1. Draw the light/glow source
    const offscreen = document.createElement('canvas');
    offscreen.width = w * dpr;
    offscreen.height = h * dpr;
    const oc = offscreen.getContext('2d');
    oc.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Draw text as black silhouette on the offscreen canvas
    oc.font = `${metrics.fontWeight} ${metrics.fontSize}px ${metrics.fontFamily}`;
    oc.letterSpacing = metrics.letterSpacing + 'px';
    oc.textAlign = 'center';
    oc.textBaseline = 'middle';

    // Fill entire canvas with radial light from source
    const grad = oc.createRadialGradient(lx, ly, 0, lx, ly, metrics.width * 0.6);
    const intensity = 0.4 + 0.2 * Math.sin(time * 1.5);
    grad.addColorStop(0, `rgba(196, 163, 90, ${intensity})`);
    grad.addColorStop(0.3, `rgba(196, 163, 90, ${intensity * 0.5})`);
    grad.addColorStop(0.7, `rgba(196, 163, 90, ${intensity * 0.15})`);
    grad.addColorStop(1, 'rgba(196, 163, 90, 0)');
    oc.fillStyle = grad;
    oc.fillRect(0, 0, w, h);

    // Cut out the text shape — this creates the "light blocked by letters" effect
    oc.globalCompositeOperation = 'destination-out';
    oc.fillStyle = 'black';
    oc.fillText(metrics.text, metrics.x + metrics.width / 2, ly);

    // 2. Radial blur (god rays) — sample outward from light source
    // Draw the masked light source multiple times, slightly scaled outward from light pos
    const passes = 20;
    ctx.globalAlpha = 1.0 / passes;
    for (let i = 0; i < passes; i++) {
      const scale = 1 + (i / passes) * 0.15;
      const dx = lx - lx * scale;
      const dy = ly - ly * scale;
      ctx.drawImage(offscreen,
        dx, dy,
        w * scale, h * scale
      );
    }
    ctx.globalAlpha = 1.0;

    // 3. Also draw a subtle direct glow around the light source (not blocked)
    const directGrad = ctx.createRadialGradient(lx, ly, 0, lx, ly, metrics.fontSize * 0.8);
    directGrad.addColorStop(0, `rgba(255, 235, 180, ${intensity * 0.15})`);
    directGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = directGrad;
    ctx.fillRect(0, 0, w, h);

    requestAnimationFrame(drawRays);
  }

  window.addEventListener('resize', resize);
  // Wait for fonts to load
  document.fonts.ready.then(() => {
    resize();
    drawRays();
  });
})();
