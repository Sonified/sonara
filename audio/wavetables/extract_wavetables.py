"""
Wavetable snippet extractor for SONARA.

Finds moments with the richest spectral power in each source WAV,
then extracts clean short clips (2-4 seconds) that can be loaded
directly into a wavetable synth (Serum, Vital, etc.).

No mangling, no frame slicing, no fading — just the best-sounding
moments from NASA data, trimmed clean.
"""

import os
import numpy as np
import scipy.io.wavfile as wav
from scipy.signal import resample
from scipy.fft import rfft

WINDOW = 4096           # analysis window
HOP = 2048              # analysis hop
TARGET_SR = 44100
CLIP_DURATION = 3.0     # seconds per clip
MIN_SPACING = 2.0       # seconds between clips

SRC_DIR = os.path.join(os.path.dirname(__file__), '..', 'wav')
OUT_DIR = os.path.dirname(__file__)


def load_mono(path):
    sr, data = wav.read(path)
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float64)
    peak = np.abs(data).max()
    if peak > 0:
        data /= peak
    if sr != TARGET_SR:
        num_samples = int(len(data) * TARGET_SR / sr)
        data = resample(data, num_samples)
    return data


def spectral_power_score(frame):
    """Score a frame by how spectrally rich it is (energy spread across frequencies)."""
    mag = np.abs(rfft(frame * np.hanning(len(frame))))
    mag = mag / (mag.sum() + 1e-10)
    # Spectral flatness: geometric mean / arithmetic mean
    # Higher = more spread = richer
    log_mag = np.log(mag + 1e-10)
    geo_mean = np.exp(log_mag.mean())
    arith_mean = mag.mean()
    flatness = geo_mean / (arith_mean + 1e-10)
    # Weight by overall energy so silent sections don't win
    rms = np.sqrt(np.mean(frame ** 2))
    return flatness * rms


def find_best_moments(data, n_clips=2):
    """Find the N moments with highest spectral richness."""
    clip_samples = int(CLIP_DURATION * TARGET_SR)
    spacing_samples = int(MIN_SPACING * TARGET_SR)

    # Score every hop position
    scores = []
    n_frames = (len(data) - WINDOW) // HOP
    for i in range(n_frames):
        start = i * HOP
        frame = data[start:start + WINDOW]
        score = spectral_power_score(frame)
        scores.append((start, score))

    scores.sort(key=lambda x: x[1], reverse=True)

    # Pick top moments with minimum spacing
    picks = []
    for pos, score in scores:
        if len(picks) >= n_clips:
            break
        # Center the clip on the high-scoring moment
        clip_start = max(0, pos - clip_samples // 2)
        clip_start = min(clip_start, len(data) - clip_samples)
        if clip_start < 0:
            continue
        # Check spacing from existing picks
        if all(abs(clip_start - p) >= spacing_samples for p in picks):
            picks.append(clip_start)

    picks.sort()
    return picks


def save_clip(data, start, name):
    clip_samples = int(CLIP_DURATION * TARGET_SR)
    clip = data[start:start + clip_samples].copy()

    # Normalize to -1..1
    peak = np.abs(clip).max()
    if peak > 0:
        clip /= peak
    clip *= 0.95

    out_path = os.path.join(OUT_DIR, f'{name}.wav')
    wav.write(out_path, TARGET_SR, (clip * 32767).astype(np.int16))
    t_start = start / TARGET_SR
    print(f"  {name}.wav  |  {t_start:.1f}s - {t_start + CLIP_DURATION:.1f}s  |  {CLIP_DURATION}s clip")
    return out_path


def main():
    print("=== SONARA Wavetable Snippet Extractor ===\n")

    sources = [
        ('Proton_Beam_Raw_WI_H2_MFI_181819_000_002.wav', 'WT_Proton_Beam', 2),
        ('Solar_Hum_Loop_More_Filtered_Short.wav', 'WT_Solar_Hum', 3),
        ('THE_20120302_Cleaned_MAX.wav', 'WT_CME_Impact', 2),
        ('TRIMMED_SHORTER_MMS1_SCM_BRST_L2_Dawn_Chorus.wav', 'WT_Dawn_Chorus', 3),
    ]

    for src_file, base_name, n_clips in sources:
        src_path = os.path.join(SRC_DIR, src_file)
        if not os.path.exists(src_path):
            print(f"  SKIP: {src_file}")
            continue

        print(f"{src_file}")
        data = load_mono(src_path)
        duration = len(data) / TARGET_SR

        if duration < CLIP_DURATION + 0.5:
            # File is short — just save the whole thing
            print(f"  Short file ({duration:.1f}s), saving as single clip")
            save_clip(data, 0, base_name)
        else:
            picks = find_best_moments(data, n_clips)
            for i, start in enumerate(picks):
                suffix = f"_{i+1}" if len(picks) > 1 else ""
                save_clip(data, start, f"{base_name}{suffix}")
        print()

    # Short percussive files — save as-is (no trimming needed)
    short_sources = [
        ('Kick_Processed_Final__WIND_BGSE_z_2007_08_13_LFEvent_CLEANED_ISOLATED_SHORT.wav', 'WT_Solar_Kick'),
        ('Solar_Shaker_1.wav', 'WT_Solar_Shaker'),
    ]
    for src_file, name in short_sources:
        src_path = os.path.join(SRC_DIR, src_file)
        if not os.path.exists(src_path):
            continue
        print(f"{src_file}")
        data = load_mono(src_path)
        peak = np.abs(data).max()
        if peak > 0:
            data = data / peak * 0.95
        out_path = os.path.join(OUT_DIR, f'{name}.wav')
        wav.write(out_path, TARGET_SR, (data * 32767).astype(np.int16))
        print(f"  {name}.wav  |  full file  |  {len(data)/TARGET_SR:.2f}s")
        print()

    print("Done!", OUT_DIR)


if __name__ == '__main__':
    main()
