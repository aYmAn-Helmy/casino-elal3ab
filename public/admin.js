'use strict';
const $ = (id) => document.getElementById(id);
const { connectGame, escapeHTML, phaseText } = window.GameUtil;
let state = null; let isHost = false; let pin = ''; let connected = false;
let hostQuestion = null;
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
  $('questionStats').textContent = `${state.questionStats?.total || 0} سؤال، باقي ${state.questionStats?.remaining || 0}`;
  const selected = $('questionCategoryFilter').value;
  const categories = state.questionStats?.categories || [];
  const desired = ['', ...categories.map(row => row.category)];
  const actual = [...$('questionCategoryFilter').options].map(option => option.value);
  if (JSON.stringify(desired) !== JSON.stringify(actual)) {
    $('questionCategoryFilter').replaceChildren();
    const all = document.createElement('option');
    all.value = ''; all.textContent = 'كل الأنواع — عشوائي';
    $('questionCategoryFilter').append(all);
    for (const row of categories) {
      const option = document.createElement('option');
      option.value = row.category;
      option.textContent = row.category;
      $('questionCategoryFilter').append(option);
    }
    $('questionCategoryFilter').value = desired.includes(selected) ? selected : '';
  }
  for (const option of $('questionCategoryFilter').options) {
    if (!option.value) continue;
    const info = categories.find(row => row.category === option.value);
    if (info) option.textContent = `${info.category} (${info.remaining} باقي)`;
  }
  const selectedCategory = $('questionCategoryFilter').value;
  const remainingForSelected = selectedCategory
    ? categories.find(row => row.category === selectedCategory)?.remaining || 0
    : state.questionStats?.remaining || 0;
  $('nextQuestion').disabled = remainingForSelected === 0 || state.phase === 'answering';
  $('questionCategory').textContent = hostQuestion?.category || state.question?.category || 'لم يتم اختيار سؤال';
  $('questionText').textContent = hostQuestion?.text || state.question?.text || 'استورد أسئلة من ملف JSON ثم اضغط السؤال التالي';
  $('questionAnswer').textContent = hostQuestion?.answer || '—';
  $('questionSource').textContent = hostQuestion?.source ? `مصدر الملف: ${hostQuestion.source}${hostQuestion.reference ? ' — ' + hostQuestion.reference : ''}` : '';
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
    connected = false; isHost = false; hostQuestion = null;
    $('connection').textContent = 'الاتصال مقطوع';
    $('connection').className = 'pill red'; render();
  },
  onMessage(msg) {
    if (msg.type === 'host-ok') { isHost = true; $('pin').value = ''; render(); }
    else if (msg.type === 'state') { state = msg.state; render(); }
    else if (msg.type === 'host-question') { hostQuestion = msg.question; render(); }
    else if (msg.type === 'import-ok') { $('questionStatus').textContent = `تم استيراد ${msg.count} سؤال بنجاح`; }
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
  el.addEventListener('click', () => {
    if (!isHost) return;
    const category = el.dataset.action === 'next-question' ? $('questionCategoryFilter').value : null;
    ws.send('host-action', { action: el.dataset.action, ...(category ? { category } : {}) });
  });
});
$('resetScores').addEventListener('click', () => {
  if (confirm('متأكد إنك عايز تصفر نقاط جميع اللاعبين؟')) ws.send('host-action', { action: 'reset-scores' });
});
$('clearPlayers').addEventListener('click', () => {
  if (confirm('تحذير: هتحذف كل اللاعبين ونقاطهم! متأكد؟')) ws.send('host-action', { action: 'clear-players' });
});

$('importQuestions').addEventListener('click', async () => {
  const file = $('questionsFile').files[0];
  if (!file) { $('questionStatus').textContent = 'اختار ملف JSON الأول'; return; }
  if (file.size > 2000000) { $('questionStatus').textContent = 'حجم ملف الأسئلة كبير جدًا (الحد 2MB)'; return; }
  try {
    const value = JSON.parse(await file.text());
    const questions = Array.isArray(value) ? value : value.questions;
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 1000) {
      throw new Error('لازم ملف يحتوي من 1 إلى 1000 سؤال');
    }
    if (!confirm(`استبدال بنك الأسئلة الحالي كاملًا بـ ${questions.length} سؤال من الملف المحدد؟`)) return;
    $('questionStatus').textContent = 'جاري إرسال الأسئلة إلى السيرفر...';
    if (!ws.send('questions-import', { questions })) throw new Error('الاتصال بالسيرفر مقطوع');
  } catch (err) { $('questionStatus').textContent = err.message; }
});
$('resetQuestionUsage').addEventListener('click', () => {
  if (confirm('إعادة جميع الأسئلة لحالة غير مستخدمة؟')) ws.send('host-action', { action: 'reset-question-usage' });
});

$('questionCategoryFilter').addEventListener('change', render);
