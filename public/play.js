'use strict';
const $ = (id) => document.getElementById(id);
const { connectGame, escapeHTML, phaseText } = window.GameUtil;
const sounds = window.GameSounds;
const SOUND_KEY = 'casino_sound_enabled';
let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'false';
sounds.setEnabled(soundEnabled);
function updateSoundUI() {
  $('soundToggle').textContent = soundEnabled ? '🔊 الصوت شغال' : '🔇 الصوت مكتوم';
  $('soundToggle').setAttribute('aria-pressed', String(soundEnabled));
  $('soundHint').textContent = sounds.isSupported
    ? 'جرس ميكانيكي عند الضغط، ونغمة نجاح بعد ما المذيع يحسب إجابتك صح ويضيف النقطة. مفيش صوت قفل.'
    : 'المتصفح الحالي مش بيدعم تشغيل الصوت؛ الجرس هيشتغل عادي.';
}
updateSoundUI();
$('soundToggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, String(soundEnabled));
  sounds.setEnabled(soundEnabled);
  updateSoundUI();
});
let player = null; let state = null; let socketUp = false; let lastBuzzRound = -1;
let savedName = localStorage.getItem('casino_name') || '';
let savedToken = localStorage.getItem('casino_token') || '';
$('name').value = savedName;
function render() {
  if (state) {
    $('room').textContent = state.roomName;
    const mine = state.players.find((p) => player && p.id === player.id);
    if (mine) $('score').textContent = `${mine.score} نقطة`;
    $('scores').innerHTML = state.players.length ? state.players.map((p) => `<li><span><span class="dot ${p.connected ? 'online' : ''}"></span>${escapeHTML(p.name)} ${p.id === state.winnerId ? '🔔' : ''} <span class="card-tally">🟨${p.yellow_cards || 0} 🟥${p.red_cards || 0}</span></span><span class="score">${p.score}</span></li>`).join('') : '<li class="muted">لسه محدش دخل</li>';
  }
  $('joinPanel').hidden = !!player;
  $('gamePanel').hidden = !player;
  if (!player) return;
  $('playerName').textContent = player.name;
  const mine = state?.players.find((p) => p.id === player.id);
  const allowed = !!(socketUp && state && state.phase === 'open' && mine && !mine.excluded && lastBuzzRound !== state.roundId);
  $('buzzer').disabled = !allowed;
  $('status').textContent = state ? phaseText[state.phase] : 'جاري الاتصال';
  if (!socketUp) $('detail').textContent = 'الاتصال بالسيرفر مقطوع، جاري إعادة المحاولة';
  else if (state?.winnerId === player.id) $('detail').textContent = '🎉 أنت أول واحد وصل للسيرفر! اتفضل جاوب';
  else if (state?.phase === 'answering') $('detail').textContent = `${state.winnerName} كسب الجرس، مستنيين الإجابة`;
  else $('detail').textContent = state?.lastEvent || 'استنى المذيع يفتح الجرس';
}
const ws = connectGame({
  onOpen(api) {
    socketUp = true; player = null;
    $('connection').textContent = 'متصل بالسيرفر';
    $('connection').className = 'pill green';
    if (savedName) api.send('join', { name: savedName, token: savedToken });
    render();
  },
  onClose() {
    socketUp = false;
    $('connection').textContent = 'الاتصال مقطوع';
    $('connection').className = 'pill red';
    render();
  },
  onMessage(msg) {
    if (msg.type === 'state') { state = msg.state; render(); }
    else if (msg.type === 'joined') {
      player = msg.player; savedName = player.name; savedToken = player.token;
      localStorage.setItem('casino_name', savedName);
      localStorage.setItem('casino_token', savedToken);
      $('feedback').textContent = 'أنت داخل الغرفة، بالتوفيق!';
      render();
    } else if (msg.type === 'buzz-result') {
      $('feedback').textContent = msg.ok ? '🔔 كسبت حق الإجابة! جاوب واستنى تحكيم المذيع.' : msg.reason;
      if (msg.ok && navigator.vibrate) navigator.vibrate([100, 50, 100]);
      render();
    } else if (msg.type === 'answer-correct') {
      // Sound is reserved for a host-verified correct answer with awarded points.
      // Buzzer priority alone never plays this chime.
      if (player && msg.playerId === player.id && msg.points > 0) {
        sounds.win();
        $('feedback').textContent = `✅ إجابة صح! اتضافت لك ${msg.points} نقطة. مبروك!`;
        render();
      }
    } else if (msg.type === 'kicked') {
      player = null; savedToken = ''; localStorage.removeItem('casino_token');
      $('feedback').textContent = msg.message; render();
    } else if (msg.type === 'error') {
      $('feedback').textContent = msg.message;
      if (!player) window.alert(msg.message);
    }
  }
});
$('joinForm').addEventListener('submit', (event) => {
  event.preventDefault(); savedName = $('name').value.trim();
  if (!socketUp) { alert('السيرفر مش متصل، حاول تاني'); return; }
  ws.send('join', { name: savedName, token: savedToken });
});
$('buzzer').addEventListener('click', () => {
  if (!state || !player || $('buzzer').disabled) return;
  // Local sound plays in the user's tap gesture, before sending to the server.
  sounds.tap();
  lastBuzzRound = state.roundId;
  $('feedback').textContent = 'استلمنا الضغطة على الموبايل؛ مستنيين نتيجة السيرفر...';
  ws.send('buzz', { roundId: state.roundId }); render();
});
$('rename').addEventListener('click', () => {
  const value = prompt('الاسم الجديد:', savedName);
  if (value && value.trim()) ws.send('join', { name: value.trim(), token: savedToken });
});
