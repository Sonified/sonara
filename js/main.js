/**
 * SONARA Main
 * Scroll reveals, dot nav, sound triggers, cursor glow, animated counters.
 */

import { play, stop, killNow, seqRestart, seqSilence, getEndTime, now as audioNow, getStemPattern, generateStemPattern, setStemPattern, setSeqLoop, getSeqLoop, setSeqDelay, getSeqDelay, setSeqReverb, getSeqReverb, getHeroAnalyser, getHeroProgress } from './audio.js?v=8';
import { initVisuals } from './visuals.js?v=10';

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

  // Goal 3 controls should release pointer focus after activation so the
  // buttons and wavetable dropdown do not keep a sticky clicked state.
  document.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    const btn = e.target && e.target.closest
      ? e.target.closest('#stem-music button')
      : null;
    if (!btn) return;
    requestAnimationFrame(() => {
      if (document.activeElement === btn) btn.blur();
    });
  }, true);

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
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

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
  const heroSection = document.getElementById('hero');
  const heroListenBtn = document.querySelector('#hero .listen-btn');
  let heroHintRevealTimer = null;
  let heroHintPulseTimer = null;
  let heroHintCopyTimer = null;
  const HERO_HINT_GAP_FRACTION = 0.15;

  function updateHeroHintPosition() {
    if (!scrollHint || !heroSection || !heroListenBtn) return;
    const heroRect = heroSection.getBoundingClientRect();
    const btnRect = heroListenBtn.getBoundingClientRect();
    if (heroRect.height <= 0 || btnRect.height <= 0) return;

    const viewportBottom = window.innerHeight;
    const btnBottomViewport = Math.max(0, Math.min(viewportBottom, btnRect.bottom));
    const btnBottomLocal = btnRect.bottom - heroRect.top;
    const remaining = Math.max(0, viewportBottom - btnBottomViewport);
    const hintHeight = scrollHint.offsetHeight || 48;
    const minTop = btnBottomLocal + 20;
    const targetCenter = btnBottomLocal + remaining * HERO_HINT_GAP_FRACTION;
    const unclampedTop = targetCenter - hintHeight * 0.5;
    const maxTop = Math.max(minTop, heroRect.height - hintHeight - 20);
    const top = Math.max(minTop, Math.min(maxTop, unclampedTop));

    scrollHint.style.setProperty('--hero-scroll-hint-top', `${Math.round(top)}px`);
  }

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
        updateHeroHintPosition();
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
            // Show chevron 5s after text appears
            heroHintPulseTimer = setTimeout(() => {
              heroHintPulseTimer = null;
              if (scrollHint.dataset.dismissed === '1') return;
              scrollHint.classList.add('show-chevron');
              // Start chevron pulse after it fades in
              setTimeout(() => {
                if (scrollHint.dataset.dismissed === '1') return;
                scrollHint.classList.add('pulsing');
              }, 3000);
            }, 5000);
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
    let lastPPct = '0';
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
        const target = 0.07 + intensity * 0.55;
        const rate = target > smoothAlpha ? 0.025 : 0.025;
        smoothAlpha += (target - smoothAlpha) * rate;
        const progress = getHeroProgress();
        const endFade = progress > 0.97 ? (1 - progress) / 0.03 : 1;
        const alpha = smoothAlpha * endFade;
        lastPPct = (progress * 100).toFixed(1);
        heroBtn.style.background = `linear-gradient(to right, rgba(212,168,67,${alpha}) ${lastPPct}%, transparent ${lastPPct}%), rgba(6,6,8,0.5)`;
      } else {
        smoothAlpha *= 0.85;
        if (smoothAlpha < 0.005) {
          smoothAlpha = 0;
          heroBtn.style.background = '';
        } else {
          heroBtn.style.background = `linear-gradient(to right, rgba(212,168,67,${smoothAlpha}) ${lastPPct}%, transparent ${lastPPct}%), rgba(6,6,8,0.5)`;
        }
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
    updateHeroHintPosition();
    window.addEventListener('resize', updateHeroHintPosition);
    if (typeof ResizeObserver !== 'undefined') {
      const heroHintPositionObserver = new ResizeObserver(() => updateHeroHintPosition());
      if (heroSection) heroHintPositionObserver.observe(heroSection);
      if (heroListenBtn) heroHintPositionObserver.observe(heroListenBtn);
      heroHintPositionObserver.observe(scrollHint);
    }

    const hintObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (scrollHint.dataset.dismissed === '1') return;
        if (entry.isIntersecting) {
          updateHeroHintPosition();
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

  // ===== Now-playing: fade based on scroll + playing state =====
  const nowPlaying = document.querySelector('.now-playing');
  if (nowPlaying) {
    const heroListenBtnNP = document.querySelector('#hero .listen-btn');
    let heroRatio = 1;
    let isPlaying = false;
    let introProgress = 0; // 0→1 over ~3s after 2.5s delay
    let introRaf = null;
    let introStart = 0;
    const INTRO_DELAY = 2500;
    const INTRO_DURATION = 3000;

    function runIntro(ts) {
      if (!introStart) introStart = ts;
      const elapsed = ts - introStart;
      if (elapsed < INTRO_DELAY) {
        introProgress = 0;
      } else {
        introProgress = Math.min(1, (elapsed - INTRO_DELAY) / INTRO_DURATION);
      }
      updateNowPlaying();
      if (introProgress < 1 && isPlaying) introRaf = requestAnimationFrame(runIntro);
    }

    function updateNowPlaying() {
      if (!isPlaying) {
        nowPlaying.classList.remove('visible');
        nowPlaying.style.opacity = '0';
        introProgress = 0;
        introStart = 0;
        if (introRaf) { cancelAnimationFrame(introRaf); introRaf = null; }
        return;
      }
      nowPlaying.classList.add('visible');
      const scrollFade = Math.max(0, Math.min(1, (heroRatio - 0.8) / 0.2));
      nowPlaying.style.opacity = Math.min(introProgress, scrollFade);
    }

    // Fire at many thresholds for smooth fading
    const thresholds = [];
    for (let i = 0; i <= 20; i++) thresholds.push(i / 20);
    const npObs = new IntersectionObserver((entries) => {
      entries.forEach(e => { heroRatio = e.intersectionRatio; });
      updateNowPlaying();
    }, { threshold: thresholds });
    const heroEl = document.getElementById('hero');
    if (heroEl) npObs.observe(heroEl);

    if (heroListenBtnNP) {
      const btnObs = new MutationObserver(() => {
        const wasPlaying = isPlaying;
        isPlaying = heroListenBtnNP.classList.contains('playing');
        if (isPlaying && !wasPlaying) {
          introProgress = 0;
          introStart = 0;
          introRaf = requestAnimationFrame(runIntro);
        }
        updateNowPlaying();
      });
      btnObs.observe(heroListenBtnNP, { attributes: true, attributeFilter: ['class'] });
    }
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
    const targetTag = e.target?.tagName;
    const isEditableTarget = ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag) || e.target?.isContentEditable;
    const isButtonTarget = targetTag === 'BUTTON';
    const isFormTarget = isEditableTarget || isButtonTarget;
    const isSpaceKey = e.key === ' ' || e.key === 'Spacebar';
    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }
    if (isLocal && !isFormTarget && e.key === 'Enter' && heroBtn) {
      e.preventDefault();
      heroBtn.click();
      return;
    }
    if (isSpaceKey) {
      if (isEditableTarget || isButtonTarget) return;
      e.preventDefault();
      const activeSection = allSections[getClosestSectionIdx()];
      if (activeSection?.id === 'hero' && heroBtn) {
        heroBtn.click();
        return;
      }
      if (activeSection?.id === 'citizen-science') {
        const citizenListenBtn = activeSection.querySelector('.cs-listen');
        if (citizenListenBtn) citizenListenBtn.click();
        return;
      }
      if (activeSection?.id === 'stem-music' && seqPlayBtn) {
        seqPlayBtn.click();
        return;
      }
      return;
    }
    if (['ArrowDown', 'PageDown'].includes(e.key)) {
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
