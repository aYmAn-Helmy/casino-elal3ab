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
