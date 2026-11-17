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
  assert.equal(game.getPlayer(a.id).score, 1);
  game.open();
  assert.equal(game.buzz(b.id, round).ok, false);
  assert.equal(game.buzz(b.id, game.roundId).ok, true);
});
test('wrong answer deducts one and reopens for all players, including the same player', (t) => {
  const game = fixture(t);
  const a = game.join('Ahmad'); const b = game.join('Ali');
  game.setConnected(a.id, true); game.setConnected(b.id, true);
  game.open();
  assert.equal(game.buzz(a.id, game.roundId).ok, true);
  game.wrong();
  assert.equal(game.getPlayer(a.id).score, -1);
  assert.equal(game.state().phase, 'open');
  const round = game.roundId;
  assert.equal(game.buzz(a.id, round).ok, true, 'same player can buzz again');
  game.wrong();
  assert.equal(game.getPlayer(a.id).score, -2);
  assert.equal(game.buzz(b.id, game.roundId).ok, true, 'other players can also buzz');
});
test('reconnection keeps score and recognizes a secure token; clear players revokes tokens', (t) => {
  const game = fixture(t);
  const p = game.join('Player');
  const rejoined = game.join('اسم جديد', p.token);
  assert.equal(rejoined.id, p.id);
  assert.equal(game.players().length, 1);
  game.setConnected(p.id, true);
  game.open(); game.buzz(p.id, game.roundId); game.correct();
  assert.equal(game.join('اسم جديد', p.token).score, 1);
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

test('yellow card -1 and red card -3; counts stay with reconnect and reset', t => {
  const game = fixture(t);
  const a = game.join('سارة');
  game.card(a.id, 'yellow');
  game.card(a.id, 'red');
  assert.equal(game.getPlayer(a.id).score, -4);
  assert.equal(game.getPlayer(a.id).yellow_cards, 1);
  assert.equal(game.getPlayer(a.id).red_cards, 1);
  assert.equal(game.join('سارة', a.token).score, -4);
  assert.throws(() => game.card(a.id, 'green'), /الكارت/);
  assert.throws(() => game.card('no such player', 'yellow'), /اللاعب/);
  game.resetScores();
  assert.equal(game.getPlayer(a.id).score, 0);
  assert.equal(game.getPlayer(a.id).yellow_cards, 0);
  assert.equal(game.getPlayer(a.id).red_cards, 0);
});

test('one connected player can re-buzz after their own wrong answer', t => {
  const game = fixture(t);
  const player = game.join('واحد');
  game.setConnected(player.id, true);
  game.open();
  const oldRound = game.roundId;
  assert.equal(game.buzz(player.id, oldRound).ok, true);
  game.wrong();
  assert.equal(game.state().phase, 'open');
  assert.ok(game.roundId > oldRound);
  assert.equal(game.buzz(player.id, oldRound).ok, false, 'stale packet rejected');
  assert.equal(game.buzz(player.id, game.roundId).ok, true);
});

test('scores and cards migrate without wiping an older SQLite database', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-migrate-'));
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'game.sqlite'));
  db.exec("CREATE TABLE players (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  db.prepare('INSERT INTO players (id, token_hash, name, score) VALUES (?, ?, ?, ?)').run('existing', 'hashed', 'player', 9);
  db.close();
  const game = new Game({ dataDir: dir });
  t.after(() => { game.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(game.getPlayer('existing').score, 9);
  assert.equal(game.getPlayer('existing').yellow_cards, 0);
  game.card('existing', 'yellow');
  assert.equal(game.getPlayer('existing').score, 8);
  assert.equal(game.getPlayer('existing').yellow_cards, 1);
});
