/**
 * SONARA Main
 * Scroll reveals, dot nav, sound triggers, cursor glow, animated counters.
 */

import { play, stop } from './audio.js';
import { initVisuals } from './visuals.js';

(function() {
  'use strict';

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
      } else {
        entry.target.classList.remove('in-view');
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

  document.querySelectorAll('.sound-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const soundId = getSoundId(btn);
      if (!soundId) return;

      // Stop other playing sounds
      document.querySelectorAll('.sound-trigger.playing').forEach(b => {
        if (b !== btn) {
          b.classList.remove('playing');
          const otherId = getSoundId(b);
          if (otherId) stop(otherId);
        }
      });

      const isPlaying = play(soundId);
      btn.classList.toggle('playing', isPlaying);
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

  // ===== Sequencer Animation =====
  function animateSequencer() {
    const cells = document.querySelectorAll('.seq-cell');
    if (cells.length === 0) return;

    let step = 0;
    setInterval(() => {
      cells.forEach((cell, i) => {
        const col = i % 4;
        if (col === step % 4) {
          cell.style.borderColor = cell.classList.contains('active')
            ? 'rgba(139, 110, 192, 0.8)'
            : 'rgba(255, 255, 255, 0.12)';
        } else {
          cell.style.borderColor = cell.classList.contains('active')
            ? 'rgba(139, 110, 192, 0.5)'
            : 'rgba(255, 255, 255, 0.06)';
        }
      });
      step++;
    }, 400);
  }
  animateSequencer();

  // ===== Init Visuals =====
  initVisuals();

})();
