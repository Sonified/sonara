# Known Issues

## Multi-window GPU contention causes brief connection flashes

When multiple Sonara tabs/windows are open simultaneously, they compete for GPU time. This can cause WebGPU `mapAsync` readbacks to arrive late, meaning the CPU-side particle positions are stale for several frames. During that window:

- The GPU-side wrap flag (set when a particle bounces off top/bottom edges via `p.x = w - p.x` mirror) can be overwritten by subsequent compute dispatches before the CPU reads it
- A CPU-side position-jump fallback (`posJumped` threshold at 25% screen width) catches most missed wraps, but some mirror jumps fall under the threshold
- Frozen connFade entries from dead particles can get reactivated with stale snapshot positions if pids are reused before the entry is cleaned up

The result is occasional brief connection line flashes across the screen, most noticeable at slow playback speeds when particles bounce off the top/bottom edges.

**Severity**: Cosmetic only. Lines are killed within 1-2 frames by the distance guard or fade-out.

**Workaround**: Close other Sonara tabs/windows.

## Switching to a broken/phantom audio device kills audio playback

macOS audio device switching is handled at the OS level by `coreaudiod`. When you switch to an audio output device that doesn't actually have working output (phantom Bluetooth devices, disconnected DACs, etc.):

- Chrome's `AudioContext` silently stops advancing its clock while still reporting `state: "running"`
- `onstatechange` and `navigator.mediaDevices.ondevicechange` do NOT fire
- Creating a new `AudioContext` while the OS audio routing is broken can synchronously freeze the browser's main thread
- Calling `.close()` on a dead context can wedge `coreaudiod` system-wide (requires `killall coreaudiod` to recover)

This is not specific to Sonara - Spotify and other Web Audio apps exhibit the same ~20s recovery delay.

**What Sonara does**: A watchdog polls `ctx.currentTime` every second. If the clock stalls for 3 seconds while the context claims to be "running", Sonara abandons the dead context (without closing it), resets the UI, and waits for the user to click play again. On the next play attempt, it verifies the new context's clock is actually advancing before proceeding.

**Severity**: Audio stops. UI recovers gracefully. Not fixable from JS - this is a Chrome + macOS interaction.

**Workaround**: Switch to an audio device that has actual output, then click play again.

## Brief click/pop when switching audio output devices

macOS produces a small hardware click when engaging or disengaging an audio output (most noticeable with headphones). This happens at the DAC/amplifier level before any audio data flows - even switching to headphones at zero volume with no apps running will produce it.

**Severity**: Cosmetic. Hardware-level - not caused by Sonara or any software.

**Workaround**: None. This is baked into macOS audio routing. Every app on the system is subject to it.
