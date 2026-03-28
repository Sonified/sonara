/**
 * Volumetric light rays projecting FORWARD from letter edges.
 * Canvas sits on top with screen blend mode.
 * Rays radially zoom-blur outward from a moving light source.
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

  function draw() {
    time += 0.004;
    ctx.clearRect(0, 0, w, h);

    const span = document.querySelector('.hero-title .glow-wrap');
    if (!span) { requestAnimationFrame(draw); return; }

    const canvasRect = canvas.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const style = getComputedStyle(span);

    // Text position relative to canvas
    const textCX = (spanRect.left - canvasRect.left) + spanRect.width / 2;
    const textCY = (spanRect.top - canvasRect.top) + spanRect.height * 0.55;
    const textW = spanRect.width;

    // Tight light source sweeps left to right across letters
    const lightProgress = (Math.sin(time * 0.4) + 1) / 2;
    const textLeft = spanRect.left - canvasRect.left;
    const lightX = textLeft + lightProgress * textW;
    const lightY = textCY;

    // Subtle breathing
    const breath = 0.6 + 0.15 * Math.sin(time * 1.5);

    // Step 1: Draw bright text on offscreen, scaled to match CSS span exactly
    oc.clearRect(0, 0, w, h);
    const fontSize = parseFloat(style.fontSize);
    oc.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    oc.textBaseline = 'middle';
    oc.letterSpacing = style.letterSpacing;
    // Use a narrow gradient so only letters near the light source glow
    const grad = oc.createLinearGradient(lightX - textW * 0.15, 0, lightX + textW * 0.15, 0);
    grad.addColorStop(0, 'rgba(255, 225, 150, 0)');
    grad.addColorStop(0.3, `rgba(255, 225, 150, ${breath * 0.8})`);
    grad.addColorStop(0.5, `rgba(255, 235, 180, ${breath})`);
    grad.addColorStop(0.7, `rgba(255, 225, 150, ${breath * 0.8})`);
    grad.addColorStop(1, 'rgba(255, 225, 150, 0)');
    oc.fillStyle = grad;
    
    // Measure what canvas thinks the width is
    const measured = oc.measureText('SONARA');
    const canvasTextWidth = measured.width;
    const cssTextWidth = spanRect.width;
    
    // Scale horizontally to match CSS exactly
    const scaleX = cssTextWidth / canvasTextWidth;
    const textLeft = spanRect.left - canvasRect.left;
    
    oc.save();
    oc.translate(textLeft, textCY);
    oc.scale(scaleX, 1);
    oc.textAlign = 'left';
    oc.fillText('SONARA', 0, 0);
    oc.restore();

    // Step 2: Radial zoom blur from light position — many small passes for smooth rays
    const numPasses = 60;
    const maxScale = 0.12;

    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < numPasses; i++) {
      const t = i / numPasses;
      const scale = 1 + t * maxScale;
      const alpha = (1 - t * t) * (1 / numPasses) * 2.5 * breath;

      ctx.globalAlpha = alpha;

      // Scale outward from the light source
      ctx.save();
      ctx.translate(lightX, lightY);
      ctx.scale(scale, scale);
      ctx.translate(-lightX, -lightY);
      ctx.drawImage(offscreen, 0, 0, w, h);
      ctx.restore();
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
    }, 800);
  });
})();
