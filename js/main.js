/**
 * SONARA Main
 * Scroll reveals, dot nav, sound triggers, cursor glow, animated counters.
 */

import { play, stop, killNow, seqRestart, seqSilence, getEndTime, now as audioNow, getStemPattern, generateStemPattern, setStemPattern, setSeqLoop, getSeqLoop, setSeqDelay, getSeqDelay, setSeqReverb, getSeqReverb, getHeroAnalyser } from './audio.js?v=8';
import { initVisuals } from './visuals.js?v=8';

(function() {
  'use strict';

  let pointerFocusLock = null;

  function restoreScrollPosition(x, y) {
    const root = document.documentElement;
    const prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(x, y);
    requestAnimationFrame(() => {
      root.style.scrollBehavior = prevBehavior || 'smooth';
    });
  }

  document.addEventListener('mousedown', (e) => {
    const control = e.target && e.target.closest
      ? e.target.closest('button, a, input, select, textarea, [tabindex]')
      : null;
    if (!control || e.button !== 0) return;
    pointerFocusLock = {
      el: control,
      x: window.scrollX,
      y: window.scrollY,
      ts: performance.now(),
    };
  }, true);
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (
      pointerFocusLock &&
      t === pointerFocusLock.el &&
      performance.now() - pointerFocusLock.ts < 400
    ) {
      const { x, y } = pointerFocusLock;
      requestAnimationFrame(() => {
        restoreScrollPosition(x, y);
      });
      pointerFocusLock = null;
    }
  });

  // Enable smooth scrolling after initial load so reload doesn't animate to restored position
  requestAnimationFrame(() => {
    document.documentElement.style.scrollBehavior = 'smooth';
  });

  // ===== Cursor Glow =====
  const cursorGlow = document.getElementById('cursor-glow');
  let mouseX = 0, mouseY = 0, glowX = 0, glowY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function animateGlow() {
    glowX += (mouseX - glowX) * 0.06;
    glowY += (mouseY - glowY) * 0.06;
    cursorGlow.style.left = glowX + 'px';
    cursorGlow.style.top = glowY + 'px';
    requestAnimationFrame(animateGlow);
  }
  animateGlow();

  if ('ontouchstart' in window) {
    cursorGlow.style.display = 'none';
  }

  // ===== Sections + Dot Nav =====
  const allSections = Array.from(document.querySelectorAll('.section')).filter(s => getComputedStyle(s).display !== 'none');
  const sectionNames = ['SONARA', 'The Vision', 'Education & Communication', 'Citizen Science', 'STEM + Music', 'Get Involved'];
  const preloadTimers = new WeakMap();

  function scheduleNeighborPreload(section, idx) {
    const nextSection = allSections[idx + 1];
    if (!nextSection || preloadTimers.has(section)) return;

    const timer = setTimeout(() => {
      preloadTimers.delete(section);
      if (!section.classList.contains('in-view')) return;
      nextSection.querySelectorAll('img[loading="lazy"]').forEach(img => {
        img.loading = 'eager';
      });
    }, 450);

    preloadTimers.set(section, timer);
  }

  function cancelNeighborPreload(section) {
    if (!preloadTimers.has(section)) return;
    clearTimeout(preloadTimers.get(section));
    preloadTimers.delete(section);
  }

  let lastScrollY = window.scrollY;

  const dotNav = document.createElement('nav');
  dotNav.className = 'dot-nav';
  dotNav.setAttribute('aria-label', 'Section navigation');

  function getClosestSectionIdx() {
    const viewportMid = window.innerHeight * 0.5;
    let activeIdx = 0;
    let bestDistance = Infinity;

    allSections.forEach((section, i) => {
      const rect = section.getBoundingClientRect();
      const sectionMid = rect.top + rect.height * 0.5;
      const distance = Math.abs(sectionMid - viewportMid);
      if (distance < bestDistance) {
        bestDistance = distance;
        activeIdx = i;
      }
    });

    return activeIdx;
  }

  const initialActiveIdx = getClosestSectionIdx();

  allSections.forEach((section, i) => {
    const dot = document.createElement('button');
    dot.setAttribute('aria-label', sectionNames[i] || section.id);
    dot.classList.toggle('active', i === initialActiveIdx);

    const tooltip = document.createElement('span');
    tooltip.className = 'dot-tooltip';
    tooltip.textContent = sectionNames[i] || section.id;
    dot.appendChild(tooltip);

    dot.addEventListener('click', () => {
      section.scrollIntoView({ behavior: 'smooth' });
    });
    dotNav.appendChild(dot);
  });
  document.body.appendChild(dotNav);

  function updateActiveDotFromScroll() {
    const activeIdx = getClosestSectionIdx();

    dotNav.querySelectorAll('button').forEach((d, i) => {
      d.classList.toggle('active', i === activeIdx);
    });
  }

  updateActiveDotFromScroll();

  // ===== Intersection Observer =====
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');

        const idx = allSections.indexOf(entry.target);
        if (idx >= 0) {
          dotNav.querySelectorAll('button').forEach((d, i) => {
            d.classList.toggle('active', i === idx);
          });
          // Let the current snap settle, then preload only the next section.
          scheduleNeighborPreload(entry.target, idx);
        }

        // Trigger counter animation
        if (entry.target.id === 'citizen-science') {
          animateCounters(entry.target);
        }

        // Hide cursor glow on sections with their own mouse interaction
        if (entry.target.id === 'vision' || entry.target.id === 'stem-music' || entry.target.id === 'contact') {
          cursorGlow.style.opacity = '0';
        } else {
          cursorGlow.style.opacity = '1';
        }

      } else {
        entry.target.classList.remove('in-view');
        cancelNeighborPreload(entry.target);

        // Fade out sound when scrolling away from a section
        const sectionSound = entry.target.dataset?.sound;
        if (sectionSound) {
          // Sequencer: stop notes + visual, reverb/delay ring out, delayed cleanup
          if (entry.target.id === 'stem-music' && seqPlaying) {
            seqSilence();
            setPlayState(false);
            lastPlayheadCol = -1;
            seqCells.forEach(row => {
              row.cells.forEach(cell => cell.classList.remove('playhead', 'lit'));
            });
          }
          const playingBtn = entry.target.querySelector('.sound-trigger.playing');
          if (playingBtn && !fadingButtons.has(playingBtn)) {
            fadeStop(playingBtn, getSoundId(playingBtn));
          }
        }

      }
    });
  }, { threshold: 0.4 });

  allSections.forEach(s => observer.observe(s));

  // ===== Animated Counters =====
  const countersAnimated = new Set();

  function animateCounters(section) {
    if (countersAnimated.has(section.id)) return;
    countersAnimated.add(section.id);

    section.querySelectorAll('[data-count]').forEach(el => {
      const target = parseInt(el.dataset.count);
      const duration = 2000;
      const start = performance.now();

      function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(target * eased);
        el.textContent = current.toLocaleString();
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // ===== Sound Triggers =====
  function getSoundId(btn) {
    // Check data-target attribute first
    const target = btn.dataset?.target;
    if (target) return target;
    // Fall back to closest section's data-sound
    const section = btn.closest('.section');
    return section?.dataset?.sound;
  }

  const paperTitle = document.querySelector('.cs-paper-title');
  const heroBtn = document.querySelector('.listen-btn');
  const fadingButtons = new Set();

  // When the entrance fadeUp finishes, switch to pulse mode
  if (heroBtn) {
    heroBtn.addEventListener('animationend', (e) => {
      if (e.animationName === 'fadeUp') {
        heroBtn.classList.add('entrance-done');
      }
    }, { once: true });
  }

  // Track auto-end timers so we can cancel them on manual stop
  const autoEndTimers = new Map();

  function fadeStop(btn, soundId) {
    if (fadingButtons.has(btn)) return;
    console.log(`[MAIN v3] fadeStop("${soundId}")`);
    fadingButtons.add(btn);
    btn.classList.add('fading');
    // Cancel any auto-end timer for this button
    if (autoEndTimers.has(btn)) {
      clearTimeout(autoEndTimers.get(btn));
      autoEndTimers.delete(btn);
    }
    const p = stop(soundId);
    const cleanup = () => {
      btn.classList.remove('playing', 'fading', 'freeze-pulse');
      btn.style.borderColor = '';
      btn.style.backgroundColor = '';
      btn.style.boxShadow = '';
      fadingButtons.delete(btn);
      if (soundId === 'citizen-science' && paperTitle) paperTitle.classList.remove('pulsing');
    };
    if (p && typeof p.then === 'function') p.then(cleanup);
    else setTimeout(cleanup, 2000);
  }

  function autoEnd(btn, soundId) {
    btn.classList.remove('playing', 'fading', 'freeze-pulse');
    btn.style.borderColor = '';
    btn.style.backgroundColor = '';
    btn.style.boxShadow = '';
    fadingButtons.delete(btn);
    autoEndTimers.delete(btn);
    if (soundId === 'citizen-science' && paperTitle) paperTitle.classList.remove('pulsing');
    stop(soundId);
  }

  // Poll audio clock via rAF for frame-accurate end detection
  function watchForEnd(btn, soundId) {
    function check() {
      if (!btn.classList.contains('playing')) return; // manually stopped
      const endTime = getEndTime(soundId);
      if (!endTime) { autoEnd(btn, soundId); return; } // already cleaned up
      if (audioNow() >= endTime) {
        autoEnd(btn, soundId);
      } else {
        requestAnimationFrame(check);
      }
    }
    requestAnimationFrame(check);
  }

  const scrollHint = document.querySelector('.scroll-hint');
  let heroHintRevealTimer = null;
  let heroHintPulseTimer = null;
  let heroHintCopyTimer = null;

  function clearHeroHintReveal(removeVisible = false) {
    if (heroHintRevealTimer) {
      clearTimeout(heroHintRevealTimer);
      heroHintRevealTimer = null;
    }
    if (heroHintPulseTimer) {
      clearTimeout(heroHintPulseTimer);
      heroHintPulseTimer = null;
    }
    if (removeVisible && scrollHint) scrollHint.classList.remove('visible');
    if (scrollHint) delete scrollHint.dataset.pendingReveal;
  }

  function clearHeroHintCopy(removeVisible = false) {
    if (heroHintCopyTimer) {
      clearTimeout(heroHintCopyTimer);
      heroHintCopyTimer = null;
    }
    if (removeVisible && scrollHint) scrollHint.classList.remove('show-copy');
  }

  function dismissHeroHint() {
    if (!scrollHint) return;
    clearHeroHintReveal(true);
    clearHeroHintCopy(true);
    scrollHint.classList.remove('pulsing');
    scrollHint.style.opacity = '0';
    scrollHint.dataset.dismissed = '1';
  }

  function heroHintIsArmed() {
    return Boolean(
      scrollHint &&
      (
        scrollHint.dataset.pendingReveal === '1' ||
        heroHintRevealTimer ||
        heroHintPulseTimer ||
        heroHintCopyTimer ||
        scrollHint.classList.contains('visible') ||
        scrollHint.classList.contains('pulsing') ||
        scrollHint.classList.contains('show-copy')
      )
    );
  }

  document.querySelectorAll('.sound-trigger').forEach(btn => {
    btn.addEventListener('click', async () => {
      const soundId = getSoundId(btn);
      if (!soundId) return;
      if (btn.classList.contains('listen-btn')) {
        btn.classList.add('settled');
      }
      // Show scroll hint after 4s on first listen click, then pulse later
      if (btn.classList.contains('listen-btn')) {
        if (scrollHint && scrollHint.dataset.dismissed !== '1' && !scrollHint.classList.contains('visible') && !scrollHint.dataset.pendingReveal) {
          scrollHint.dataset.pendingReveal = '1';
          heroHintRevealTimer = setTimeout(() => {
            heroHintRevealTimer = null;
            if (scrollHint.dataset.dismissed === '1') return;
            scrollHint.classList.add('visible');
            delete scrollHint.dataset.pendingReveal;
            heroHintPulseTimer = setTimeout(() => {
              heroHintPulseTimer = null;
              if (scrollHint.dataset.dismissed === '1') return;
              scrollHint.classList.add('pulsing');
            }, 3000);
          }, 4000);
        }
      }
      if (fadingButtons.has(btn)) {
        console.log(`[MAIN v3] click ignored — "${soundId}" is fading`);
        return;
      }

      // Stop other playing sounds (with fade)
      document.querySelectorAll('.sound-trigger.playing').forEach(b => {
        if (b !== btn && !fadingButtons.has(b)) {
          const otherId = getSoundId(b);
          if (otherId) fadeStop(b, otherId);
        }
      });

      if (btn.classList.contains('playing')) {
        console.log(`[MAIN v3] click → stop "${soundId}"`);
        fadeStop(btn, soundId);
      } else {
        // Add playing class IMMEDIATELY so visuals transition from current
        // state — don't wait for audio to load/start
        btn.classList.add('playing');
        const result = await play(soundId);
        if (result === false) {
          btn.classList.remove('playing');
          return;
        }
        if (soundId === 'hero') scheduleHeroHintCopy();
        if (soundId === 'citizen-science' && paperTitle) paperTitle.classList.add('pulsing');
        // Finite-duration sound: poll audio clock for precise end
        if (typeof result === 'number') {
          watchForEnd(btn, soundId);
        }
      }
    });
  });

  // ===== Hero "Listen to the solar wind" button RMS shimmer =====
  if (heroBtn) {
    const heroRmsData = new Uint8Array(128);
    let smoothAlpha = 0;
    (function heroShimmer() {
      const analyser = getHeroAnalyser();
      if (analyser && heroBtn.classList.contains('playing')) {
        analyser.getByteTimeDomainData(heroRmsData);
        let sum = 0;
        for (let i = 0; i < heroRmsData.length; i++) {
          const v = (heroRmsData[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / heroRmsData.length);
        const intensity = Math.min(1, rms * 5);
        const target = 0.07 + intensity * 0.35;
        smoothAlpha += (target - smoothAlpha) * 0.15;
        heroBtn.style.background = `rgba(212, 168, 67, ${smoothAlpha})`;
      } else {
        smoothAlpha = 0;
        heroBtn.style.background = '';
      }
      requestAnimationFrame(heroShimmer);
    })();
  }

  // ===== Scroll Hint Fade =====
  // Only show/hide based on hero visibility AFTER the hint has been revealed by listen click
  function scheduleHeroHintCopy() {
    if (!scrollHint || heroHintCopyTimer || scrollHint.dataset.dismissed === '1') return;
    heroHintCopyTimer = setTimeout(() => {
      heroHintCopyTimer = null;
      if (scrollHint.classList.contains('visible')) {
        scrollHint.classList.add('show-copy');
      }
    }, 7000);
  }

  if (scrollHint) {
    const hintObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (scrollHint.dataset.dismissed === '1') return;
        if (entry.isIntersecting) {
          scrollHint.style.opacity = '';
        } else {
          if (!heroHintIsArmed()) return;
          // One-time hint: once user leaves hero after the cue is armed, never show again.
          dismissHeroHint();
          hintObs.disconnect();
        }
      });
    }, { threshold: 0.8 });
    const hero = document.getElementById('hero');
    if (hero) hintObs.observe(hero);
  }

  // ===== Section Down Cues =====
  const cueEligibleSections = allSections.slice(1, -1);
  const cueTimers = new Map();
  const cueFadeRafs = new WeakMap();
  const cueShown = new WeakSet();
  let touchStartY = null;

  function stopCueFadeParallax(section) {
    if (!cueFadeRafs.has(section)) return;
    cancelAnimationFrame(cueFadeRafs.get(section));
    cueFadeRafs.delete(section);
  }

  function runCueFadeParallax(section) {
    const cue = section.querySelector('.section-down-cue');
    if (!cue) return;

    stopCueFadeParallax(section);
    const startScrollY = window.scrollY;
    const fadeStart = performance.now();
    const fadeMs = 250;

    function tick() {
      if (!section.classList.contains('cue-fading-out')) {
        cue.style.setProperty('--cue-scroll-y', '0px');
        cueFadeRafs.delete(section);
        return;
      }

      const deltaY = (window.scrollY - startScrollY) * 0.5;
      cue.style.setProperty('--cue-scroll-y', `${deltaY.toFixed(1)}px`);

      if (performance.now() - fadeStart < fadeMs + 50) {
        cueFadeRafs.set(section, requestAnimationFrame(tick));
      } else {
        cue.style.setProperty('--cue-scroll-y', '0px');
        cueFadeRafs.delete(section);
      }
    }

    cueFadeRafs.set(section, requestAnimationFrame(tick));
  }

  function startCueFade(direction = 'down') {
    cueEligibleSections.forEach(section => {
      if (!section.classList.contains('show-down-cue')) return;
      section.classList.toggle('cue-page-tied', direction === 'up');
      section.classList.add('cue-fading-out');
      section.classList.remove('show-down-cue');
      if (direction === 'down') {
        runCueFadeParallax(section);
      } else {
        stopCueFadeParallax(section);
        section.querySelector('.section-down-cue')?.style.setProperty('--cue-scroll-y', '0px');
      }
    });
  }

  cueEligibleSections.forEach(section => {
    section.classList.add('has-down-cue');
    if (!section.querySelector('.section-down-cue')) {
      const cue = document.createElement('div');
      cue.className = 'section-down-cue';
      cue.setAttribute('aria-hidden', 'true');
      cue.innerHTML = '<span class="section-down-chevron">⌄</span>';
      section.appendChild(cue);
    }
  });

  if (cueEligibleSections.length) {
    const cueObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const section = entry.target;

        if (entry.isIntersecting && entry.intersectionRatio >= 0.72) {
          if (cueShown.has(section) || cueTimers.has(section)) return;
          const timer = setTimeout(() => {
            cueTimers.delete(section);
            cueShown.add(section);
            section.classList.remove('cue-page-tied');
            section.classList.remove('cue-fading-out');
            stopCueFadeParallax(section);
            section.querySelector('.section-down-cue')?.style.setProperty('--cue-scroll-y', '0px');
            section.classList.add('show-down-cue');
          }, 10000);
          cueTimers.set(section, timer);
        } else {
          if (cueTimers.has(section)) {
            clearTimeout(cueTimers.get(section));
            cueTimers.delete(section);
          }
          section.classList.remove('cue-page-tied');
          stopCueFadeParallax(section);
          section.querySelector('.section-down-cue')?.style.setProperty('--cue-scroll-y', '0px');
          section.classList.remove('cue-fading-out');
          section.classList.remove('show-down-cue');
        }
      });
    }, { threshold: [0, 0.72, 0.9] });

    cueEligibleSections.forEach(section => cueObserver.observe(section));
  }

  window.addEventListener('scroll', () => {
    const currentScrollY = window.scrollY;
    if (currentScrollY === lastScrollY) return;
    startCueFade(currentScrollY > lastScrollY ? 'down' : 'up');
    lastScrollY = currentScrollY;
  }, { passive: true });

  window.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > 0) startCueFade(e.deltaY > 0 ? 'down' : 'up');
  }, { passive: true });

  window.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0]?.clientY ?? null;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    const y = e.touches[0]?.clientY;
    if (touchStartY === null || y === undefined) return;
    if (Math.abs(y - touchStartY) > 8) startCueFade(y < touchStartY ? 'down' : 'up');
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }
    if (['ArrowDown', 'PageDown', ' ', 'Spacebar'].includes(e.key)) {
      startCueFade('down');
    } else if (['ArrowUp', 'PageUp'].includes(e.key)) {
      startCueFade('up');
    }
  });

  // ===== Live Sequencer Grid =====
  const seqGrid = document.getElementById('seq-grid');
  let seqCells = []; // array of { cells: [...16 DOM elements] } per row
  let lastPlayheadCol = -1;

  function buildGrid(pattern) {
    seqGrid.innerHTML = '';
    seqCells = [];

    // Melody rows (always 5, high pitch to low)
    const melodyRows = pattern.melodyRows || [];
    melodyRows.forEach((rowData, r) => {
      addRow('SYN', rowData, 'syn');
    });

    // Hat + Kick
    addRow('HAT', pattern.hat, 'hat');
    addRow('KCK', pattern.kick, 'kck');
  }

  function addRow(label, data, type) {
    // Wrapper with display:contents so grid layout flows through
    const wrapper = document.createElement('div');
    wrapper.className = `seq-row-${type}`;
    wrapper.style.display = 'contents';

    const lbl = document.createElement('div');
    lbl.className = 'seq-label';
    lbl.textContent = label;
    wrapper.appendChild(lbl);

    const cells = [];
    for (let i = 0; i < 16; i++) {
      const cell = document.createElement('div');
      cell.className = 'seq-cell' + (data[i] ? ' active' : '');
      const col = i;
      cell.addEventListener('click', () => {
        data[col] = data[col] ? 0 : 1;
        cell.classList.toggle('active');
        // Update melodyFreqs when toggling synth cells
        if (type === 'syn') updateMelodyFreqs();
        setStemPattern(currentDisplayPattern);
        savePattern();
      });
      wrapper.appendChild(cell);
      cells.push(cell);
    }
    seqGrid.appendChild(wrapper);
    seqCells.push({ cells });
  }

  function updateMelodyFreqs() {
    if (!currentDisplayPattern) return;
    const { melodyRows, pitches, melodyFreqs } = currentDisplayPattern;
    for (let step = 0; step < 16; step++) {
      melodyFreqs[step] = [];
      for (let r = 0; r < melodyRows.length; r++) {
        if (melodyRows[r][step]) melodyFreqs[step].push(pitches[r]);
      }
    }
  }

  // Persist pattern across refreshes
  function savePattern() {
    try {
      const { kick, hat, melodyRows, melodyFreqs, pitches, waveType, bpm, step, steps } = currentDisplayPattern;
      localStorage.setItem('sonara-seq-pattern', JSON.stringify({ kick, hat, melodyRows, melodyFreqs, pitches, waveType, bpm, step, steps }));
    } catch(e) {}
  }
  function loadPattern() {
    try {
      const saved = localStorage.getItem('sonara-seq-pattern');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return null;
  }

  // Restore saved pattern or generate fresh on first visit
  let currentDisplayPattern = loadPattern() || generateStemPattern();
  setStemPattern(currentDisplayPattern);
  buildGrid(currentDisplayPattern);
  savePattern();

  // Match synth & catalog visual heights to sequencer
  function matchVisualHeights() {
    const seqVis = document.querySelector('.sequencer-visual');
    if (seqVis) {
      const h = seqVis.offsetHeight;
      document.querySelectorAll('.synth-visual, .catalog-visual').forEach(el => {
        el.style.height = h + 'px';
      });
    }
  }
  // Run after layout settles, and on resize
  setTimeout(matchVisualHeights, 100);
  window.addEventListener('resize', matchVisualHeights);

  // Toolbar buttons
  const randomizeBtn = document.getElementById('seq-randomize');
  if (randomizeBtn) {
    randomizeBtn.addEventListener('click', () => {
      currentDisplayPattern = generateStemPattern();
      setStemPattern(currentDisplayPattern);
      buildGrid(currentDisplayPattern);
      savePattern();
    });
  }

  const seqPlayBtn = document.getElementById('seq-play');
  let seqPlaying = false;
  function setPlayState(playing) {
    seqPlaying = playing;
    if (seqPlayBtn) {
      seqPlayBtn.innerHTML = playing
        ? '<span style="vertical-align: 2px; font-size: 0.9em;">&#9646;&#9646;</span> Pause'
        : '<span style="vertical-align: 2px;">&#9654;</span> Play';
      seqPlayBtn.classList.toggle('clicked', playing);
    }
  }
  if (seqPlayBtn) {
    seqPlayBtn.addEventListener('click', () => {
      if (seqPlaying) {
        stop('stem-music');
        setPlayState(false);
      } else {
        setStemPattern(currentDisplayPattern);
        play('stem-music');
        lastPlayheadCol = -1;
        setPlayState(true);
      }
    });
  }

  const seqLoopBtn = document.getElementById('seq-loop');
  if (seqLoopBtn) {
    if (getSeqLoop()) seqLoopBtn.classList.add('active');
    seqLoopBtn.addEventListener('click', () => {
      const newVal = !getSeqLoop();
      setSeqLoop(newVal);
      seqLoopBtn.classList.toggle('active', newVal);
    });
  }

  const synthReverbBtn = document.getElementById('synth-reverb');
  if (synthReverbBtn) {
    if (getSeqReverb()) synthReverbBtn.classList.add('active');
    synthReverbBtn.addEventListener('click', () => {
      const newVal = !getSeqReverb();
      setSeqReverb(newVal);
      synthReverbBtn.classList.toggle('active', newVal);
    });
  }

  const synthDelayBtn = document.getElementById('synth-delay');
  if (synthDelayBtn) {
    if (getSeqDelay()) synthDelayBtn.classList.add('active');
    synthDelayBtn.addEventListener('click', () => {
      const newVal = !getSeqDelay();
      setSeqDelay(newVal);
      synthDelayBtn.classList.toggle('active', newVal);
    });
  }

  function animateSequencer() {
    const pattern = getStemPattern();
    if (pattern && seqPlaying && seqCells.length) {
      const elapsed = audioNow() - pattern.startTime;
      let col = Math.floor(elapsed / pattern.step);
      if (getSeqLoop()) col = ((col % 16) + 16) % 16;



      if (col !== lastPlayheadCol) {
        lastPlayheadCol = col;
        seqCells.forEach(row => {
          row.cells.forEach((cell, i) => {
            cell.classList.toggle('playhead', i === col && col >= 0 && col < 16);
            cell.classList.toggle('lit', i === col && col >= 0 && col < 16 && cell.classList.contains('active'));
          });
        });
        // Flash loop button on downbeat when looping
        if (getSeqLoop() && col === 0 && seqLoopBtn) {
          seqLoopBtn.classList.add('flash');
          setTimeout(() => seqLoopBtn.classList.remove('flash'), 150);
        }
      }
    } else if (lastPlayheadCol !== -1) {
      lastPlayheadCol = -1;
      seqCells.forEach(row => {
        row.cells.forEach(cell => {
          cell.classList.remove('playhead', 'lit');
        });
      });
      if (seqPlaying) setPlayState(false);
    }
    requestAnimationFrame(animateSequencer);
  }
  animateSequencer();

  // ===== Init Visuals =====
  initVisuals();

})();
