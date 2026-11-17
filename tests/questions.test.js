'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Game } = require('../server/game');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-question-test-'));
  const game = new Game({ dataDir: dir });
  t.after(() => {
    game.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return game;
}

function make(i) {
  return { text: `سؤال اختباري ${i}`, answer: `إجابة ${i}`, category: 'اختبار', source: 'بيانات اختبار وليست أسئلة أصلية' };
}

test('1000 authorized questions can be imported and counted', (t) => {
  const game = fixture(t);
  const imported = game.replaceQuestions(Array.from({ length: 1000 }, (_, i) => make(i)));
  assert.equal(imported.questionStats.total, 1000);
  assert.equal(imported.questionStats.remaining, 1000);
  assert.equal(imported.question, null);
});

test('answer only reaches host and is excluded from broadcast state', (t) => {
  const game = fixture(t);
  game.replaceQuestions([make(1)]);
  game.nextQuestion();
  assert.equal(game.state().question.text, make(1).text);
  assert.equal(game.state().question.answer, undefined);
  assert.equal(game.questions.hostCurrent().answer, make(1).answer);
  assert.equal(game.state().questionStats.remaining, 0);
});

test('duplicate and oversized bank are rejected without changing old questions', (t) => {
  const game = fixture(t);
  game.replaceQuestions([make(3)]);
  assert.throws(() => game.replaceQuestions([make(1), make(1)]), /متكرر/);
  assert.throws(() => game.replaceQuestions(Array.from({ length: 1001 }, (_, i) => make(i))), /1000/);
  assert.equal(game.state().questionStats.total, 1);
});

test('next and reset usage avoid repeats until manually reset', (t) => {
  const game = fixture(t);
  game.replaceQuestions([make(4)]);
  game.nextQuestion();
  assert.throws(() => game.nextQuestion(), /مفيش أسئلة/);
  game.resetQuestionUsage();
  assert.equal(game.state().questionStats.remaining, 1);
  assert.equal(game.state().question, null);
  game.nextQuestion();
  assert.equal(game.state().question.text, make(4).text);
});

test('bundled text-only bank has 1000 unique questions across 11 categories', (t) => {
  const seed = require('../questions/text_only_1000.json').questions;
  assert.equal(seed.length, 1000);
  const count = {};
  const seen = new Set();
  for (const q of seed) {
    assert.ok(q.text.length > 0 && q.answer.length > 0 && q.category.length > 0);
    assert.ok(!('image' in q) && !('audio' in q) && !('video' in q), 'text only');
    assert.ok(q.text.length <= 400 && q.answer.length <= 400, 'field length limits');
    assert.ok(q.source.includes('ليست أسئلة لعبة مروان سري الرسمية'));
    const k = q.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
    assert.ok(!seen.has(k), 'No duplicate: ' + q.text);
    seen.add(k);
    count[q.category] = (count[q.category] || 0) + 1;
    if (q.category === 'كلمات معكوسة') {
      const reversed = q.text.match(/«([^»]+)»/)[1];
      assert.equal([...reversed].reverse().join(''), q.answer);
    }
  }
  assert.deepEqual(count, {
    'كلمات معكوسة': 290,
    'عواصم البلاد': 230,
    'كلمة في أغنية': 200,
    'معلومات عامة': 60,
    'وصف أكلة': 50,
    'وصف مكان': 30,
    'وصف مهنة': 25,
    'أكمل المثل الشعبي': 50,
    'أفلام ومسلسلات': 25,
    'الإفيه ده من فيلم إيه؟': 20,
    'غنّي لمطرب معيّن': 20
  });
  const game = fixture(t);
  assert.equal(game.state().questionStats.total, 1000);
  assert.equal(game.state().questionStats.remaining, 1000);
});

test('startup seeding never overwrites a previously imported question bank', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-question-persist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = new Game({ dataDir: dir });
  assert.equal(game.state().questionStats.total, 1000);
  game.replaceQuestions([make(993)]);
  game.stop();
  const restarted = new Game({ dataDir: dir });
  assert.equal(restarted.state().questionStats.total, 1);
  restarted.nextQuestion();
  assert.equal(restarted.state().question.text, make(993).text);
  restarted.stop();
});

test('food clues and folk sayings are playable as host-judged text questions', (t) => {
  const game = fixture(t);
  const seed = require('../questions/text_only_1000.json').questions;
  const sample = [
    seed.find(q => q.category === 'وصف أكلة'),
    seed.find(q => q.category === 'أكمل المثل الشعبي'),
    seed.find(q => q.category === 'الإفيه ده من فيلم إيه؟')
  ];
  game.replaceQuestions(sample);
  assert.equal(game.state().questionStats.total, 3);
  for (let i = 0; i < sample.length; i++) {
    game.nextQuestion();
    const state = game.state();
    assert.ok(state.question.text.length > 0);
    assert.equal(state.question.answer, undefined);
    assert.ok(game.questions.hostCurrent().answer.length > 0);
  }
});
