'use strict';
const $ = (id) => document.getElementById(id);
const { connectGame, escapeHTML, phaseText } = window.GameUtil;
connectGame({
  onOpen() { $('connection').className = 'pill green'; $('connection').textContent = 'متصل مباشر'; },
  onClose() { $('connection').className = 'pill red'; $('connection').textContent = 'الاتصال مقطوع'; },
  onMessage(msg) {
    if (msg.type !== 'state') return;
    const s = msg.state;
    $('room').textContent = s.roomName;
    $('phase').textContent = phaseText[s.phase];
    $('round').textContent = s.roundId;
    $('winner').textContent = s.winnerName ? `🔔 ${s.winnerName}` : 'جاهزين؟';
    $('event').textContent = s.lastEvent;
    $('questionCategory').textContent = s.question?.category || 'السؤال';
    $('questionText').textContent = s.question?.text || 'المذيع هيختار السؤال';
    $('scores').innerHTML = s.players.length ? s.players.map((p,i) => `<li><span>${i + 1}. ${escapeHTML(p.name)}</span><span class="score">${p.score}</span></li>`).join('') : '<li class="muted">مفيش لاعبين لسه</li>';
  }
});
