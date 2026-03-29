"""
Pre-compute PeriodicWave data (real/imag harmonic arrays) from wavetable WAVs.
Outputs JSON files that can be loaded directly by the Web Audio API.
"""

import os
import json
import numpy as np
import scipy.io.wavfile as wav
from scipy.signal import resample

CYCLE_LEN = 2048
N_HARMONICS = 256
TARGET_SR = 44100

SRC_DIR = os.path.dirname(__file__)
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

def find_best_cycle(data):
    """Find the 2048-sample window with the most energy."""
    best_start = 0
    best_energy = 0
    hop = 1024
    for s in range(0, len(data) - CYCLE_LEN, hop):
        energy = np.sum(data[s:s + CYCLE_LEN] ** 2)
        if energy > best_energy:
            best_energy = energy
            best_start = s
    return data[best_start:best_start + CYCLE_LEN]

def extract_harmonics(cycle):
    """DFT to get real/imag coefficients for PeriodicWave, normalized."""
    spectrum = np.fft.rfft(cycle)
    real = np.real(spectrum[:N_HARMONICS]) / CYCLE_LEN
    imag = -np.imag(spectrum[:N_HARMONICS]) / CYCLE_LEN
    # Zero DC
    real[0] = 0
    imag[0] = 0
    # Normalize so all wavetables have equal energy
    mag = np.sqrt(np.array(real)**2 + np.array(imag)**2)
    total_energy = np.sum(mag[1:])
    if total_energy > 0:
        scale = 1.0 / total_energy
        real = (np.array(real) * scale).tolist()
        imag = (np.array(imag) * scale).tolist()
    return real, imag

def main():
    print("=== Building PeriodicWave JSON files ===\n")

    wav_files = sorted(f for f in os.listdir(SRC_DIR) if f.startswith('WT_') and f.endswith('.wav'))

    all_waves = {}

    for fname in wav_files:
        path = os.path.join(SRC_DIR, fname)
        data = load_mono(path)
        cycle = find_best_cycle(data)
        real, imag = extract_harmonics(cycle)

        name = fname.replace('.wav', '')
        all_waves[name] = {'real': real, 'imag': imag}
        print(f"  {name}: {len(real)} harmonics")

    out_path = os.path.join(OUT_DIR, 'periodic_waves.json')
    with open(out_path, 'w') as f:
        json.dump(all_waves, f)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"\nSaved: periodic_waves.json ({size_kb:.0f} KB, {len(all_waves)} waves)")

if __name__ == '__main__':
    main()
