/**
 * Volumetric light rays projecting FORWARD from letter edges.
 * 
 * Technique:
 * 1. Draw the text filled with bright light color on offscreen canvas
 * 2. Apply directional radial blur OUTWARD from a moving light center
 * 3. Composite the blurred rays ON TOP of the text (they project forward)
 * 4. The letters themselves are rendered by CSS — this canvas only adds the rays
 */

(function() {
  const canvas = document.getElementById('rays-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let w, h;
  let time = 0;

  // Offscreen for generating the ray source
  const offscreen = document.createElement('canvas');
  const oc = offscreen.getContext('2d');

  function resize() {
    const title = canvas.parentElement;
    const rect = title.getBoundingClientRect();
    w = Math.ceil(rect.width * 1.4);
    h = Math.ceil(rect.height * 3);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    offscreen.width = w * dpr;
    offscreen.height = h * dpr;
    oc.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getTextInfo() {
    const title = canvas.parentElement;
    const span = title.querySelector('.glow-wrap');
    if (!span) return null;
    const titleRect = title.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const style = getComputedStyle(span);
    
    // Center of text relative to canvas
    const canvasOffsetX = (w - titleRect.width * 1.4) / 2;
    const cx = (spanRect.left - titleRect.left) + spanRect.width / 2 + w * 0.1;
    const cy = h / 2;
    
    return {
      text: 'SONARA',
      font: `${style.fontWeight} ${parseFloat(style.fontSize)}px ${style.fontFamily}`,
      letterSpacing: parseFloat(style.letterSpacing) || 0,
      cx: cx,
      cy: cy,
      width: spanRect.width
    };
  }

  function draw() {
    time += 0.004;
    ctx.clearRect(0, 0, w, h);

    const info = getTextInfo();
    if (!info) { requestAnimationFrame(draw); return; }

    // Light source position: moves left to right behind the text
    const lightProgress = (Math.sin(time * 0.5) + 1) / 2;
    const lightX = info.cx - info.width * 0.4 + lightProgress * info.width * 0.8;
    const lightY = info.cy;

    // Intensity breathes gently
    const breath = 0.5 + 0.3 * Math.sin(time * 1.2);

    // --- Step 1: Draw bright text on offscreen as the "ray source" ---
    oc.clearRect(0, 0, w, h);
    oc.font = info.font;
    oc.letterSpacing = info.letterSpacing + 'px';
    oc.textAlign = 'center';
    oc.textBaseline = 'middle';
    oc.fillStyle = `rgba(255, 225, 150, ${breath * 0.8})`;
    oc.fillText(info.text, info.cx, info.cy);

    // --- Step 2: Radial zoom blur outward from light position ---
    // This stretches the text outward from the light point, creating rays
    const numPasses = 30;
    const maxScale = 0.25; // how far rays extend

    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < numPasses; i++) {
      const t = i / numPasses;
      const scale = 1 + t * maxScale;
      const alpha = (1 - t) * (1 / numPasses) * 3 * breath;

      ctx.globalAlpha = alpha;

      // Scale from the light source position
      const sw = w * scale;
      const sh = h * scale;
      const dx = lightX - lightX * scale;
      const dy = lightY - lightY * scale;

      ctx.drawImage(offscreen, dx, dy, sw, sh);
    }

    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  document.fonts.ready.then(() => {
    setTimeout(() => {
      resize();
      draw();
    }, 500);
  });
})();
