/**
 * WebGL light rays + sparkle particles for the SONARA title.
 */

(function() {
  const isMobileView = ('ontouchstart' in window) && window.innerWidth <= 768;
  if (isMobileView) return; // skip light rays on mobile

  const canvas = document.getElementById('rays-canvas');
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  let w, h;
  const START_DELAY = 2.0;
  const SWEEP_DURATION = 3.0;
  const PAUSE_MIN = 5.0;
  const PAUSE_MAX = 9.0;
  const SWEEP_TRAVEL = 1.4;
  let phase = 'delay';
  let phaseTime = 0;
  let currentPauseDuration = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
  let lastFrameTime = null;
  let raysReady = false;
  let spawnCarry = 0;
  let visible = false;
  let rafId = null;

  canvas.style.opacity = '0';

  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
  if (!gl) return;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const particleCanvas = document.createElement('canvas');
  particleCanvas.style.cssText = canvas.style.cssText;
  particleCanvas.style.position = 'absolute';
  particleCanvas.style.top = '0';
  particleCanvas.style.left = '0';
  particleCanvas.style.width = '100%';
  particleCanvas.style.height = '100%';
  particleCanvas.style.pointerEvents = 'none';
  particleCanvas.style.opacity = '0';
  canvas.parentNode.appendChild(particleCanvas);
  const pCtx = particleCanvas.getContext('2d');

  function hideRaysImmediately() {
    canvas.style.opacity = '0';
    particleCanvas.style.opacity = '0';
  }

  const textCanvas = document.createElement('canvas');
  const tc = textCanvas.getContext('2d');

  const vertSrc = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const fragSrc = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_text;
    uniform vec2 u_origin;
    uniform float u_strength;
    uniform float u_breath;

    const int SAMPLES = 40;

    void main() {
      vec2 uv = v_uv;
      vec2 toPixel = uv - u_origin;
      vec3 color = vec3(0.0);

      for (int i = 0; i < SAMPLES; i++) {
        float t = float(i) / float(SAMPLES);
        float scale = 1.0 - t * u_strength;
        vec2 sampleUV = u_origin + toPixel * scale;
        float weight = 1.0 - t * 0.5;
        vec4 s = texture2D(u_text, sampleUV);
        color += s.rgb * s.a * weight;
      }

      color *= u_breath * 0.165;
      color = color / (1.0 + color);
      float alpha = (color.r + color.g + color.b) / 3.0;

      gl_FragColor = vec4(color, alpha);
    }
  `;

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compileShader(gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uOrigin = gl.getUniformLocation(prog, 'u_origin');
  const uStrength = gl.getUniformLocation(prog, 'u_strength');
  const uBreath = gl.getUniformLocation(prog, 'u_breath');

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0])
  );

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    textCanvas.width = w * dpr;
    textCanvas.height = h * dpr;
    tc.setTransform(dpr, 0, 0, dpr, 0, 0);
    particleCanvas.width = w * dpr;
    particleCanvas.height = h * dpr;
    pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const particles = [];
  const MAX_PARTICLES = 140;

  function spawnParticle(lx, ly, tw) {
    if (particles.length > MAX_PARTICLES) return;
    const angle = (Math.random() - 0.5) * 1.6;
    const speed = 0.12 + Math.random() * 0.38;
    const baseAlpha = 0.2 + Math.random() * 0.2;
    const centerWeighted = Math.random() < 0.5;
    const xSpread = centerWeighted ? tw * 0.08 : tw * 0.18;
    const ySpread = centerWeighted ? 220 : 520;
    particles.push({
      x: lx + tw * 0.08 + (Math.random() - 0.5) * xSpread,
      y: ly + (Math.random() - 0.5) * ySpread,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: baseAlpha,
      baseAlpha,
      life: 1,
      decay: 0.0038 + Math.random() * 0.0048,
      size: 1.8 + Math.random() * 3.4
    });
  }

  function tickParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      p.alpha = p.baseAlpha * p.life;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles(textR, fadeZone) {
    pCtx.clearRect(0, 0, w, h);
    pCtx.globalCompositeOperation = 'screen';

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 200) {
          const lineAlpha = (1 - dist / 200) * Math.min(a.life, b.life) * 0.24;
          pCtx.globalAlpha = lineAlpha;
          pCtx.strokeStyle = 'rgba(255, 230, 170, 1)';
          pCtx.lineWidth = 0.8;
          pCtx.beginPath();
          pCtx.moveTo(a.x, a.y);
          pCtx.lineTo(b.x, b.y);
          pCtx.stroke();
        }
      }
    }

    for (const p of particles) {
      let alpha = p.alpha;
      if (p.x > textR - fadeZone) {
        alpha *= Math.max(0, (textR - p.x) / fadeZone);
      }
      pCtx.globalAlpha = alpha;
      pCtx.fillStyle = 'rgba(255, 230, 170, 1)';
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      pCtx.fill();
    }
    pCtx.globalAlpha = 1;
    pCtx.globalCompositeOperation = 'source-over';
  }

  function draw(now = performance.now()) {
    if (lastFrameTime === null) lastFrameTime = now;
    const dt = Math.min(50, now - lastFrameTime) / 1000;
    lastFrameTime = now;
    phaseTime += dt;

    while (true) {
      if (phase === 'delay' && phaseTime >= START_DELAY) {
        phase = 'sweep';
        phaseTime -= START_DELAY;
        continue;
      }
      if (phase === 'sweep' && phaseTime >= SWEEP_DURATION) {
        phase = 'pause';
        phaseTime -= SWEEP_DURATION;
        currentPauseDuration = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
        spawnCarry = 0;
        continue;
      }
      if (phase === 'pause' && phaseTime >= currentPauseDuration) {
        phase = 'sweep';
        phaseTime -= currentPauseDuration;
        spawnCarry = 0;
        continue;
      }
      break;
    }

    const span = document.querySelector('.hero-title .glow-wrap');
    if (!span) { requestAnimationFrame(draw); return; }

    const canvasRect = canvas.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const style = getComputedStyle(span);

    const textCY = (spanRect.top - canvasRect.top) + spanRect.height * 0.58;
    const textW = spanRect.width;
    const textL = spanRect.left - canvasRect.left;
    const textR = textL + textW;

    const sweeping = phase === 'sweep';
    const sweepT = sweeping ? Math.min(1, phaseTime / SWEEP_DURATION) : 1;
    const lightProgress = sweeping ? sweepT * SWEEP_TRAVEL : SWEEP_TRAVEL;

    const lightX = textL - textW * 0.4 + lightProgress * textW * 1.6;
    const lightY = textCY;

    const smooth = t => Math.sin(t * Math.PI * 0.5);
    let breath = sweeping ? 0.55 : 0;
    if (sweeping && lightX < textL) {
      const t = Math.max(0, Math.min(1, 1 - (textL - lightX) / (textW * 0.6)));
      breath *= smooth(t);
    } else if (sweeping && lightX > textR) {
      const t = Math.max(0, Math.min(1, 1 - (lightX - textR) / (textW * 0.22)));
      breath *= smooth(t);
    }
    if (breath < 0.08) breath = 0;

    const maskX = lightX;

    tc.clearRect(0, 0, w, h);
    const fontSize = parseFloat(style.fontSize);
    tc.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    tc.textBaseline = 'middle';
    tc.letterSpacing = style.letterSpacing;
    const rootStyle = getComputedStyle(document.documentElement);
    const textColor = rootStyle.getPropertyValue('--text').trim() || '#e8e6e3';
    const accentColor = rootStyle.getPropertyValue('--accent').trim() || '#d4a843';
    const textGradient = tc.createLinearGradient(textL, textCY, textR, textCY);
    textGradient.addColorStop(0, textColor);
    textGradient.addColorStop(0.72, accentColor);
    textGradient.addColorStop(1, accentColor);
    tc.fillStyle = textGradient;

    const measured = tc.measureText('SONARA');
    const scaleX = spanRect.width / measured.width;
    tc.save();
    tc.translate(textL, textCY);
    tc.scale(scaleX, 1);
    tc.textAlign = 'left';
    tc.fillText('SONARA', 0, 0);
    tc.restore();

    tc.globalCompositeOperation = 'destination-in';
    const mask = tc.createRadialGradient(maskX, lightY, 0, maskX, lightY, textW * 1.05);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(0.3, 'rgba(255,255,255,0.8)');
    mask.addColorStop(0.58, 'rgba(255,255,255,0.4)');
    mask.addColorStop(0.82, 'rgba(255,255,255,0.1)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    tc.fillStyle = mask;
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = 'source-over';

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);

    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(prog);
    const originU = maskX / w;
    const originV = lightY / h;
    gl.uniform2f(uOrigin, originU, originV);
    gl.uniform1f(uStrength, 0.12);
    gl.uniform1f(uBreath, breath);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!raysReady && breath > 0.01) {
      raysReady = true;
      canvas.style.opacity = '1';
      particleCanvas.style.opacity = '1';
    }

    const glowRadius = textW * 0.6;
    const glowHitsText = sweeping && breath > 0.01 &&
      lightX + glowRadius > textL && lightX - glowRadius < textR;

    if (glowHitsText) {
      const particleLeadX = lightX + textW * 0.22;
      const spawnRate = 82 * breath;
      spawnCarry += spawnRate * dt;
      while (spawnCarry >= 1 && particles.length < MAX_PARTICLES) {
        spawnParticle(particleLeadX, lightY, textW);
        spawnCarry -= 1;
      }
    } else {
      spawnCarry = 0;
    }

    tickParticles();
    drawParticles(textR, textW * 0.35);

    rafId = requestAnimationFrame(draw);
  }

  function startLoop() {
    if (rafId) return;
    lastFrameTime = null;
    rafId = requestAnimationFrame(draw);
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !document.hidden) startLoop(); else stopLoop();
  }, { threshold: 0 });
  observer.observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else if (visible) startLoop();
  });

  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', hideRaysImmediately);
  window.addEventListener('pagehide', hideRaysImmediately);
  document.fonts.ready.then(() => {
    resize();
    startLoop();
  });
})();
