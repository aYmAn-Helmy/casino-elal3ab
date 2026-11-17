'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Game } = require('../server/game');
function fixture(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-party-test-'));
  const game = new Game({ dataDir: dir, ...opts });
  t.after(() => { game.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return game;
}
test('first valid packet wins; second and stale rounds are rejected', (t) => {
  const game = fixture(t);
  const a = game.join('أحمد'); const b = game.join('محمد');
  game.setConnected(a.id, true); game.setConnected(b.id, true);
  game.open();
  const round = game.roundId;
  assert.equal(game.buzz(a.id, round).ok, true);
  assert.equal(game.buzz(b.id, round).ok, false);
  assert.equal(game.state().winnerId, a.id);
  game.correct();
  assert.equal(game.getPlayer(a.id).score, 10);
  game.open();
  assert.equal(game.buzz(b.id, round).ok, false);
  assert.equal(game.buzz(b.id, game.roundId).ok, true);
});
test('wrong answer excludes only current player and reopens for others', (t) => {
  const game = fixture(t, { wrongPoints: 5 });
  const a = game.join('Ahmad'); const b = game.join('Ali');
  game.setConnected(a.id, true); game.setConnected(b.id, true);
  game.open();
  assert.equal(game.buzz(a.id, game.roundId).ok, true);
  game.wrong();
  assert.equal(game.getPlayer(a.id).score, -5);
  assert.equal(game.state().phase, 'open');
  assert.equal(game.buzz(a.id, game.roundId).ok, false);
  assert.equal(game.buzz(b.id, game.roundId).ok, true);
});
test('reconnection keeps score and recognizes a secure token; clear players revokes tokens', (t) => {
  const game = fixture(t);
  const p = game.join('Player');
  const rejoined = game.join('اسم جديد', p.token);
  assert.equal(rejoined.id, p.id);
  assert.equal(game.players().length, 1);
  game.setConnected(p.id, true);
  game.open(); game.buzz(p.id, game.roundId); game.correct();
  assert.equal(game.join('اسم جديد', p.token).score, 10);
  game.clearPlayers();
  assert.equal(game.players().length, 0);
  assert.notEqual(game.join('اسم جديد', p.token).id, p.id);
});
test('maxPlayers and name validation', (t) => {
  const game = fixture(t, { maxPlayers: 2 });
  assert.throws(() => game.join(' '), /الاسم/);
  game.join('one'); game.join('two');
  assert.throws(() => game.join('three'), /ممتلئة/);
});
