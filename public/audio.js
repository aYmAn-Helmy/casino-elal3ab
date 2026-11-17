'use strict';

// First preference: a locally hosted recording of a REAL hotel counter bell.
// Optional licensed file: /DATA/AppData/casino-party-lan/data/bell.mp3.
// Fallback: locally generated resonant metal-desk-bell sound (offline).
// Success chime is always separate and only played when points are awarded.
window.GameSounds = (() => {
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  let context = null;
  let enabled = true;
  let recordedBell = null;
  if (typeof window.Audio === 'function') {
    try {
      recordedBell = new window.Audio('/bell.mp3');
      recordedBell.preload = 'auto';
      recordedBell.load();
    } catch { recordedBell = null; }
  }

  function audioContext() {
    if (!AudioEngine) return null;
    try {
      if (!context || context.state === 'closed') context = new AudioEngine();
      if (context.state === 'suspended') {
        const pending = context.resume();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      }
      return context;
    } catch { return null; }
  }

  function note(ctx, frequency, start, length, loudness) {
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(loudness, start + 0.007);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(envelope);
    envelope.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + length + 0.015);
  }

  function synthesize(kind) {
    if (!enabled) return;
    const ctx = audioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime + 0.005;
      if (kind === 'tap') {
        // Inharmonic decaying resonances imitate a struck brass counter bell.
        const partials = [
          [780, 0.20, 0.95], [1087, 0.12, 0.84], [1481, 0.10, 0.72],
          [2083, 0.072, 0.56], [2870, 0.045, 0.38], [4190, 0.025, 0.20]
        ];
        for (const [freq, level, length] of partials) note(ctx, freq, now, length, level);
        // Small mechanical click on impact, if the API supports an audio buffer.
        if (typeof ctx.createBuffer === 'function' && typeof ctx.createBufferSource === 'function') {
          const count = Math.max(1, Math.round(ctx.sampleRate * 0.018));
          const buf = ctx.createBuffer(1, count, ctx.sampleRate);
          const values = buf.getChannelData(0);
          for (let i = 0; i < count; i++) {
            const envelope = Math.pow(1 - i / count, 4);
            values[i] = (Math.random() * 2 - 1) * envelope * 0.11;
          }
          const click = ctx.createBufferSource();
          click.buffer = buf;
          click.connect(ctx.destination);
          click.start(now);
        }
      } else if (kind === 'win') {
        // Soft success jingle, NOT played on buzz priority or on a wrong answer.
        note(ctx, 660, now, 0.25, 0.11);
        note(ctx, 880, now + 0.12, 0.31, 0.14);
        note(ctx, 1320, now + 0.12, 0.28, 0.055);
      }
    } catch {
      // Audio must never affect the network buzzer.
    }
  }

  function playRecordedBell() {
    if (!recordedBell || recordedBell.readyState < 2) return false;
    try {
      recordedBell.pause();
      recordedBell.currentTime = 0;
      const pending = recordedBell.play(); // Called directly inside the user tap.
      if (pending && typeof pending.catch === 'function') {
        pending.catch(() => synthesize('tap'));
      }
      return true;
    } catch { return false; }
  }

  return {
    tap() {
      if (!enabled) return;
      if (!playRecordedBell()) synthesize('tap');
    },
    win() { synthesize('win'); },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled && recordedBell) {
        try { recordedBell.pause(); recordedBell.currentTime = 0; } catch {}
      }
    },
    isSupported: Boolean(AudioEngine) || Boolean(recordedBell)
  };
})();
