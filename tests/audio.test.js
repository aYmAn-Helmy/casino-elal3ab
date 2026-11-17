'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'audio.js'), 'utf8');
const player = fs.readFileSync(path.join(__dirname, '..', 'public', 'play.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'play.html'), 'utf8');

function simulator(support = true) {
  const recordings = { created: 0, started: [], stopped: [], frequencies: [], gains: [], resumes: 0 };
  class AudioContextMock {
    constructor() {
      recordings.created++;
      this.currentTime = 3;
      this.destination = {};
      this.state = 'suspended';
    }
    resume() {
      recordings.resumes++;
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      const oscillator = {
        frequency: { setValueAtTime: (f, when) => recordings.frequencies.push({ f, when }) },
        connect: () => {},
        start: time => recordings.started.push(time),
        stop: time => recordings.stopped.push(time)
      };
      return oscillator;
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: (...value) => recordings.gains.push(value),
          exponentialRampToValueAtTime: (...value) => recordings.gains.push(value)
        },
        connect: () => {}
      };
    }
  }
  const window = support ? { AudioContext: AudioContextMock } : {};
  vm.runInNewContext(source, { window });
  return { recordings, sounds: window.GameSounds };
}

test('tap makes a locally synthesized bell, and a win makes a distinct chime', () => {
  const { sounds, recordings } = simulator();
  sounds.tap();
  assert.equal(recordings.created, 1);
  assert.equal(recordings.resumes, 1);
  assert.equal(recordings.started.length, 6);
  const first = recordings.frequencies.map(x => x.f);
  sounds.win();
  assert.equal(recordings.created, 1, 'reuses a single audio context');
  assert.equal(recordings.started.length, 9);
  assert.notDeepEqual(recordings.frequencies.slice(6).map(x => x.f), first);
  assert.equal(recordings.stopped.length, 9);
});

test('mute suppresses both effects and unmute restores sound', () => {
  const { sounds, recordings } = simulator();
  sounds.setEnabled(false);
  sounds.tap();
  sounds.win();
  assert.equal(recordings.created, 0);
  sounds.setEnabled(true);
  sounds.tap();
  assert.equal(recordings.started.length, 6);
});

test('missing Web Audio API never breaks buzzer actions', () => {
  const { sounds } = simulator(false);
  assert.equal(sounds.isSupported, false);
  assert.doesNotThrow(() => { sounds.tap(); sounds.win(); });
});

test('player UI plays a success chime only after host awards points for a correct answer', () => {
  assert.match(page, /id="soundToggle"/);
  assert.match(page, /src="\/audio.js"/);
  assert.match(player, /sounds\.tap\(\);\s*lastBuzzRound = state\.roundId/);
  assert.match(player, /msg\.type === 'answer-correct'/);
  assert.match(player, /msg\.playerId === player\.id && msg\.points > 0/);
  assert.match(player, /sounds\.win\(\);/);
  const buzzResultBlock = player.split("msg.type === 'buzz-result'")[1].split("msg.type === 'answer-correct'")[0];
  assert.doesNotMatch(buzzResultBlock, /sounds\.win\(\)/);

  assert.doesNotMatch(player, /sounds\.close\(/);
});

test('real bell recording is preferred when local bell.mp3 is ready', () => {
  const playback = { plays: 0, pauses: 0 };
  class RecordedAudio {
    constructor(src) { assert.equal(src, '/bell.mp3'); this.readyState = 4; }
    load() {}
    pause() { playback.pauses++; }
    play() { playback.plays++; return Promise.resolve(); }
  }
  const window = { Audio: RecordedAudio };
  vm.runInNewContext(source, { window });
  window.GameSounds.tap();
  assert.equal(playback.plays, 1);
  window.GameSounds.setEnabled(false);
  window.GameSounds.tap();
  assert.equal(playback.plays, 1);
});

test('not-yet-downloaded bell falls back to locally synthesized sound', () => {
  const { sounds, recordings } = simulator();
  sounds.tap();
  assert.equal(recordings.started.length, 6);
});
