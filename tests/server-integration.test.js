'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function openClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    for (let i = 0; i < waiters.length; i++) {
      if (waiters[i].match(msg)) {
        const waiter = waiters.splice(i, 1)[0];
        clearTimeout(waiter.timer); waiter.resolve(msg); return;
      }
    }
    inbox.push(msg);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    send(obj) { ws.send(JSON.stringify(obj)); },
    next(match, timeout = 8000) {
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1);
          reject(new Error('Timeout waiting for WebSocket event'));
        }, timeout);
        waiters.push(waiter);
      });
    },
    close() { ws.close(); }
  };
}
test('HTTP and real WebSocket player/admin buzzer flow on seeded LAN server', { timeout: 45000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-http-ws-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_PIN: 'integration-test-secret-13579',
      DATA_DIR: dataDir,
      APK_DIR: dataDir,
      NODE_ENV: 'test'
    }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (v) => { logs += v; });
  child.stderr.on('data', (v) => { logs += v; });
  const sockets = [];
  t.after(async () => {
    for (const client of sockets) client.close();
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  let response;
  for (let n = 0; n < 120; n++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) break;
    } catch {}
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.equal(response?.ok, true, 'HTTP server startup: ' + logs);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(health.questions, 1000);
  for (const pathname of ['/', '/play', '/admin', '/screen']) {
    const r = await fetch(`http://127.0.0.1:${port}${pathname}`);
    assert.equal(r.status, 200, pathname);
    assert.match(r.headers.get('content-type'), /text\/html/);
  }

  const audioResponse = await fetch(`http://127.0.0.1:${port}/audio.js`);
  assert.equal(audioResponse.status, 200, 'player sound file is served over LAN');
  const audioSource = await audioResponse.text();
  assert.match(audioSource, /window\.GameSounds/);
  assert.match(audioSource, /play\('tap'\)/);
  assert.match(audioSource, /play\('win'\)/);

  const host = await openClient(port);
  const playerA = await openClient(port);
  const playerB = await openClient(port);
  sockets.push(host, playerA, playerB);
  assert.equal((await host.next(m => m.type === 'state')).state.questionStats.total, 1000);
  host.send({ type: 'host-login', pin: 'integration-test-secret-13579' });
  await host.next(m => m.type === 'host-ok');
  playerA.send({ type: 'join', name: 'سارة' });
  const a = (await playerA.next(m => m.type === 'joined')).player;
  playerB.send({ type: 'join', name: 'أحمد' });
  const b = (await playerB.next(m => m.type === 'joined')).player;
  assert.notEqual(a.id, b.id);
  host.send({ type: 'host-action', action: 'next-question', category: 'وصف أكلة' });
  const selected = await host.next(m => m.type === 'host-question' && m.question?.category === 'وصف أكلة');
  assert.ok(selected.question.answer);
  const screen = await playerB.next(m => m.type === 'state' && m.state.question?.category === 'وصف أكلة');
  assert.equal(screen.state.question.answer, undefined);
  assert.equal(screen.state.question.category, 'وصف أكلة');
  host.send({ type: 'host-action', action: 'open' });
  const opened = await playerA.next(m => m.type === 'state' && m.state.phase === 'open');
  playerA.send({ type: 'buzz', roundId: opened.state.roundId });
  assert.equal((await playerA.next(m => m.type === 'buzz-result')).ok, true);
  playerB.send({ type: 'buzz', roundId: opened.state.roundId });
  assert.equal((await playerB.next(m => m.type === 'buzz-result')).ok, false);
  host.send({ type: 'host-action', action: 'correct' });
  const scored = await host.next(m => m.type === 'state' && m.state.players.some(p => p.id === a.id && p.score === 10));
  assert.equal(scored.state.players.find(p => p.id === a.id).score, 10);
});
