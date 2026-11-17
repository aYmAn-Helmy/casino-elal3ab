'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const WebSocket = require('ws');
const { Game } = require('./game');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || '';
if (ADMIN_PIN.length < 8) {
  console.error('ERROR: Set ADMIN_PIN to at least 8 characters.');
  process.exit(1);
}
if (ADMIN_PIN.startsWith('CHANGE_')) console.warn('WARNING: Change the sample ADMIN_PIN before public use.');
const APP_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(APP_DIR, 'data');
const APK_DIR = process.env.APK_DIR || path.join(APP_DIR, 'apk');
const game = new Game({
  dataDir: DATA_DIR,
  roomName: process.env.ROOM_NAME || 'Casino Party LAN',
  maxPlayers: clamp(process.env.MAX_PLAYERS, 20, 2, 100),
  correctPoints: clamp(process.env.CORRECT_POINTS, 10, 0, 10000),
  wrongPoints: clamp(process.env.WRONG_POINTS, 0, 0, 10000)
});
const activePlayers = new Map();
const sockets = new Set();
function clamp(raw, fallback, min, max) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}
function broadcastState() {
  const state = game.state();
  for (const ws of sockets) send(ws, 'state', { state });
}
function fail(ws, message) { send(ws, 'error', { message }); }
function pinMatches(input) {
  if (typeof input !== 'string') return false;
  const expected = crypto.createHash('sha256').update(ADMIN_PIN).digest();
  const received = crypto.createHash('sha256').update(input).digest();
  return crypto.timingSafeEqual(expected, received);
}

const staticFiles = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/play', ['public/play.html', 'text/html; charset=utf-8']],
  ['/admin', ['public/admin.html', 'text/html; charset=utf-8']],
  ['/screen', ['public/screen.html', 'text/html; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/shared.js', ['public/shared.js', 'text/javascript; charset=utf-8']],
  ['/play.js', ['public/play.js', 'text/javascript; charset=utf-8']],
  ['/admin.js', ['public/admin.js', 'text/javascript; charset=utf-8']],
  ['/screen.js', ['public/screen.js', 'text/javascript; charset=utf-8']]
]);
function serveFile(res, filepath, type, filename) {
  try {
    const stat = fs.statSync(filepath);
    if (!stat.isFile()) throw new Error('Not a file');
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      ...(filename ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    fs.createReadStream(filepath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}
function findApk() {
  try {
    const files = fs.readdirSync(APK_DIR).filter((n) => /^[a-zA-Z0-9._-]+\.apk$/i.test(n));
    const name = files.includes('casino-party.apk') ? 'casino-party.apk' : files.sort()[0];
    return name || null;
  } catch { return null; }
}
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { res.writeHead(400).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, app: 'Casino Party LAN', apkReady: !!findApk(), players: game.players().length }));
    return;
  }
  if (pathname === '/download') {
    const filename = findApk();
    if (!filename) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('APK not uploaded yet. You can play now at /play.');
    } else serveFile(res, path.join(APK_DIR, filename), 'application/vnd.android.package-archive', filename);
    return;
  }
  const file = staticFiles.get(pathname);
  if (!file) { res.writeHead(404).end('Not found'); return; }
  serveFile(res, path.join(APP_DIR, file[0]), file[1]);
});

const wss = new WebSocket.Server({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { socket.destroy(); return; }
  if (pathname !== '/ws') { socket.destroy(); return; }
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
  } catch { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.isHost = false;
  ws.failedLogins = 0;
  ws.alive = true;
  sockets.add(ws);
  ws.on('pong', () => { ws.alive = true; });
  send(ws, 'state', { state: game.state() });
  ws.on('message', (buffer) => {
    let msg;
    try { msg = JSON.parse(buffer.toString()); }
    catch { fail(ws, 'صيغة رسالة غير صحيحة'); return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    try {
      if (msg.type === 'join') {
        const player = game.join(msg.name, msg.token);
        const prev = activePlayers.get(player.id);
        if (prev && prev !== ws) { send(prev, 'error', { message: 'تم تسجيل الدخول من جهاز تاني' }); prev.close(1000); }
        if (ws.playerId && ws.playerId !== player.id && activePlayers.get(ws.playerId) === ws) {
          activePlayers.delete(ws.playerId);
          game.setConnected(ws.playerId, false);
        }
        ws.playerId = player.id;
        activePlayers.set(player.id, ws);
        game.setConnected(player.id, true);
        send(ws, 'joined', { player });
        broadcastState();
      } else if (msg.type === 'buzz') {
        if (!ws.playerId || activePlayers.get(ws.playerId) !== ws) { fail(ws, 'لازم تدخل باسمك الأول'); return; }
        const result = game.buzz(ws.playerId, msg.roundId);
        send(ws, 'buzz-result', result);
        if (result.ok) broadcastState();
      } else if (msg.type === 'host-login') {
        if (ws.failedLogins >= 5) { fail(ws, 'محاولات دخول كتير؛ افتح الاتصال من جديد بعد شوية'); ws.close(1008); return; }
        if (!pinMatches(msg.pin)) { ws.failedLogins++; fail(ws, 'كلمة مرور المذيع غلط'); return; }
        ws.isHost = true;
        ws.failedLogins = 0;
        send(ws, 'host-ok');
        send(ws, 'state', { state: game.state() });
      } else if (msg.type === 'host-action') {
        if (!ws.isHost) { fail(ws, 'مطلوب تسجيل دخول المذيع'); return; }
        switch (msg.action) {
          case 'open': game.open(); break;
          case 'correct': game.correct(); break;
          case 'wrong': game.wrong(); break;
          case 'close': game.close(); break;
          case 'reset-scores': game.resetScores(); break;
          case 'clear-players':
            game.clearPlayers();
            for (const other of activePlayers.values()) {
              other.playerId = null;
              send(other, 'kicked', { message: 'المذيع مسح اللاعبين، ادخل باسمك من جديد' });
            }
            activePlayers.clear();
            break;
          default: throw new Error('أمر غير معروف');
        }
        broadcastState();
      }
    } catch (err) { fail(ws, err.message || 'حصل خطأ'); }
  });
  ws.on('close', () => {
    sockets.delete(ws);
    if (ws.playerId && activePlayers.get(ws.playerId) === ws) {
      activePlayers.delete(ws.playerId);
      game.setConnected(ws.playerId, false);
      broadcastState();
    }
  });
  ws.on('error', (err) => console.warn('WebSocket error:', err.message));
});
const heartbeat = setInterval(() => {
  for (const ws of sockets) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 30000);
server.listen(PORT, '0.0.0.0', () => console.log(`Casino Party LAN: http://0.0.0.0:${PORT}`));
function shutdown() {
  clearInterval(heartbeat);
  for (const ws of sockets) ws.terminate();
  wss.close();
  server.close(() => { game.stop(); process.exit(0); });
  setTimeout(() => process.exit(1), 4000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
