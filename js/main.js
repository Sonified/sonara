/**
 * SONARA Main
 * Scroll reveals, dot nav, sound triggers, cursor glow, animated counters.
 */

import { play, stop, killNow, seqRestart, getEndTime, now as audioNow, getStemPattern, generateStemPattern, setStemPattern, setSeqLoop, getSeqLoop, setSeqDelay, getSeqDelay, setSeqReverb, getSeqReverb } from './audio.js?v=7';
import { initVisuals } from './visuals.js?v=7';

(function() {
  'use strict';

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

  const dotNav = document.createElement('nav');
  dotNav.className = 'dot-nav';
  dotNav.setAttribute('aria-label', 'Section navigation');

  allSections.forEach((section, i) => {
    const dot = document.createElement('button');
    dot.setAttribute('aria-label', sectionNames[i] || section.id);
    if (i === 0) dot.classList.add('active');

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

        // Fade out sound when scrolling away from a section
        const sectionSound = entry.target.dataset?.sound;
        if (sectionSound) {
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
  const fadingButtons = new Set();

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
      btn.classList.remove('playing', 'fading');
      fadingButtons.delete(btn);
      if (soundId === 'citizen-science' && paperTitle) paperTitle.classList.remove('pulsing');
    };
    if (p && typeof p.then === 'function') p.then(cleanup);
    else setTimeout(cleanup, 2000);
  }

  function autoEnd(btn, soundId) {
    btn.classList.remove('playing', 'fading');
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

  document.querySelectorAll('.sound-trigger').forEach(btn => {
    btn.addEventListener('click', async () => {
      const soundId = getSoundId(btn);
      if (!soundId) return;
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
        const result = await play(soundId);
        if (result === false) return; // already playing somehow
        btn.classList.add('playing');
        if (soundId === 'citizen-science' && paperTitle) paperTitle.classList.add('pulsing');
        // Finite-duration sound: poll audio clock for precise end
        if (typeof result === 'number') {
          watchForEnd(btn, soundId);
        }
      }
    });
  });

  // ===== Scroll Hint Fade =====
  const scrollHint = document.querySelector('.scroll-hint');
  if (scrollHint) {
    const hintObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        scrollHint.style.opacity = entry.isIntersecting ? '1' : '0';
        scrollHint.style.transition = 'opacity 0.5s ease';
      });
    }, { threshold: 0.8 });
    const hero = document.getElementById('hero');
    if (hero) hintObs.observe(hero);
  }

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
    if (pattern && seqCells.length) {
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
