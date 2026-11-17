'use strict';

// The two original sound effects are synthesized in the player's browser.
// No audio files, network requests, or sound on the TV / other players.
// A button tap initializes/resumes the AudioContext under a user gesture.
window.GameSounds = (() => {
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  let context = null;
  let enabled = true;

  function audioContext() {
    if (!AudioEngine) return null;
    try {
      if (!context || context.state === 'closed') context = new AudioEngine();
      if (context.state === 'suspended') {
        const resuming = context.resume();
        if (resuming && typeof resuming.catch === 'function') resuming.catch(() => {});
      }
      return context;
    } catch {
      // Audio is optional: the buzzer must keep working when sound is blocked.
      return null;
    }
  }

  function note(ctx, frequency, start, length, loudness) {
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(loudness, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(envelope);
    envelope.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + length + 0.015);
  }

  function play(kind) {
    if (!enabled) return;
    const ctx = audioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime + 0.005;
      if (kind === 'tap') {
        // Short punchy metallic bell, played immediately for the tapping player.
        note(ctx, 830, now, 0.17, 0.15);
        note(ctx, 1245, now + 0.005, 0.13, 0.07);
      } else if (kind === 'win') {
        // Distinct rising two-part success chime on server-confirmed win only.
        note(ctx, 660, now, 0.25, 0.11);
        note(ctx, 880, now + 0.12, 0.31, 0.14);
        note(ctx, 1320, now + 0.12, 0.28, 0.055);
      }
    } catch {
      // Never let an audio failure block the network buzzer action.
    }
  }

  return {
    tap() { play('tap'); },
    win() { play('win'); },
    setEnabled(value) { enabled = Boolean(value); },
    isSupported: Boolean(AudioEngine)
  };
})();
