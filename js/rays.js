/**
 * Volumetric light rays from behind SONARA text.
 * A tight light source moves L-R. Rays bloom outward from letters near the light.
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

    const textCY = (spanRect.top - canvasRect.top) + spanRect.height * 0.55;
    const textW = spanRect.width;
    const textL = spanRect.left - canvasRect.left;

    // Light sweeps fully left to right across all letters
    const lightProgress = (time * 0.4) % 1;
    const lightX = textL - textW * 0.6 + lightProgress * textW * 2.2;
    const lightY = textCY;
    // Fade in/out at edges so light builds as it approaches letters
    const edgeFade = lightProgress < 0.2 ? lightProgress / 0.2 
                   : lightProgress > 0.8 ? (1 - lightProgress) / 0.2 
                   : 1;
    const breath = (0.7 + 0.2 * Math.sin(time * 1.5)) * edgeFade;

    // Draw text on offscreen
    oc.clearRect(0, 0, w, h);
    const fontSize = parseFloat(style.fontSize);
    oc.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    oc.textBaseline = 'middle';
    oc.letterSpacing = style.letterSpacing;
    oc.fillStyle = `rgba(255, 230, 170, 1)`;

    const measured = oc.measureText('SONARA');
    const scaleX = spanRect.width / measured.width;

    oc.save();
    oc.translate(textL, textCY);
    oc.scale(scaleX, 1);
    oc.textAlign = 'left';
    oc.fillText('SONARA', 0, 0);
    oc.restore();

    // Mask to tight spotlight around light position
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

    // Radial zoom blur: 40 passes, visible alpha
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < 40; i++) {
      const t = i / 40;
      const scale = 1 + t * 0.2;
      const alpha = (1 - t) * 0.085 * breath;

      ctx.globalAlpha = alpha;
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
    setTimeout(() => { resize(); draw(); }, 800);
  });
})();
