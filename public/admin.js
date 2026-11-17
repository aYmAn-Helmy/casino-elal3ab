'use strict';
const $ = (id) => document.getElementById(id);
const { connectGame, escapeHTML, phaseText } = window.GameUtil;
let state = null; let isHost = false; let pin = ''; let connected = false;
function render() {
  $('loginPanel').hidden = isHost;
  $('controls').hidden = !isHost;
  if (!state || !isHost) return;
  $('phase').textContent = phaseText[state.phase];
  $('phase').className = 'pill ' + (state.phase === 'open' ? 'green' : state.phase === 'answering' ? 'gold' : 'red');
  $('round').textContent = state.roundId;
  $('winner').textContent = state.winnerName ? `الفائز بالجرس: ${state.winnerName}` : 'مفيش حد بيجاوب دلوقتي';
  $('lastEvent').textContent = state.lastEvent;
  $('count').textContent = `${state.players.length} لاعب`;
  $('correct').disabled = $('wrong').disabled = state.phase !== 'answering';
  $('open').disabled = false;
  $('close').disabled = state.phase === 'closed' || state.phase === 'idle';
  $('players').innerHTML = state.players.length ? state.players.map((p) => `<li><span><span class="dot ${p.connected ? 'online' : ''}"></span>${escapeHTML(p.name)} ${p.excluded ? '⛔' : ''} ${p.id === state.winnerId ? '🔔' : ''}</span><span class="score">${p.score}</span></li>`).join('') : '<li class="muted">لم ينضم لاعبون بعد</li>';
}
const ws = connectGame({
  onOpen(api) {
    connected = true;
    $('connection').textContent = 'متصل بالسيرفر';
    $('connection').className = 'pill green';
    if (pin) api.send('host-login', { pin });
  },
  onClose() {
    connected = false; isHost = false;
    $('connection').textContent = 'الاتصال مقطوع';
    $('connection').className = 'pill red'; render();
  },
  onMessage(msg) {
    if (msg.type === 'host-ok') { isHost = true; $('pin').value = ''; render(); }
    else if (msg.type === 'state') { state = msg.state; render(); }
    else if (msg.type === 'error') { $('feedback').textContent = $('loginFeedback').textContent = msg.message; }
  }
});
$('loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!connected) { $('loginFeedback').textContent = 'لا يوجد اتصال'; return; }
  pin = $('pin').value;
  ws.send('host-login', { pin });
});
document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', () => { if (isHost) ws.send('host-action', { action: el.dataset.action }); });
});
$('resetScores').addEventListener('click', () => {
  if (confirm('متأكد إنك عايز تصفر نقاط جميع اللاعبين؟')) ws.send('host-action', { action: 'reset-scores' });
});
$('clearPlayers').addEventListener('click', () => {
  if (confirm('تحذير: هتحذف كل اللاعبين ونقاطهم! متأكد؟')) ws.send('host-action', { action: 'clear-players' });
});
