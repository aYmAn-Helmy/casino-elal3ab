'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { QuestionBank } = require('./questions');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

class Game {
  constructor({ dataDir, roomName = 'Casino Party LAN', maxPlayers = 20, correctPoints = 1, wrongPoints = 1 }) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'game.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        yellow_cards INTEGER NOT NULL DEFAULT 0,
        red_cards INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Schema migration for pre-1.3 databases; never discard existing player scores.
    const columns = new Set(this.db.prepare('PRAGMA table_info(players)').all().map(row => row.name));
    if (!columns.has('yellow_cards')) this.db.exec('ALTER TABLE players ADD COLUMN yellow_cards INTEGER NOT NULL DEFAULT 0');
    if (!columns.has('red_cards')) this.db.exec('ALTER TABLE players ADD COLUMN red_cards INTEGER NOT NULL DEFAULT 0');
    this.questions = new QuestionBank(this.db);
    // Seed the current 1000 text-only questions only when the bank is empty.
    // Keep any existing imported bank untouched.
    if (this.questions.stats().total === 0) {
      const seedPath = path.join(__dirname, '..', 'questions', 'text_only_1000.json');
      if (fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        this.questions.replace(seed.questions);
      }
    }
    this.roomName = roomName;
    this.maxPlayers = maxPlayers;
    this.correctPoints = correctPoints;
    this.wrongPoints = wrongPoints;
    this.phase = 'idle';
    this.roundId = 0;
    this.winnerId = null;
    this.excluded = new Set();
    this.connected = new Set();
    this.lastEvent = 'جاهزين لبدء اللعب';
  }

  getPlayer(id) {
    return this.db.prepare('SELECT id, name, score, yellow_cards, red_cards FROM players WHERE id = ?').get(id) || null;
  }
  getByToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.prepare('SELECT id, name, score, yellow_cards, red_cards FROM players WHERE token_hash = ?').get(hash(token)) || null;
  }
  join(name, token) {
    const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if ([...cleanName].length < 1 || [...cleanName].length > 24) throw new Error('الاسم لازم يكون من 1 إلى 24 حرف');
    const existing = this.getByToken(token);
    if (existing) {
      this.db.prepare('UPDATE players SET name = ? WHERE id = ?').run(cleanName, existing.id);
      return { ...this.getPlayer(existing.id), token };
    }
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM players').get().count;
    if (count >= this.maxPlayers) throw new Error('الغرفة ممتلئة؛ اطلب من المذيع مسح قائمة اللاعبين القديمة');
    const id = crypto.randomUUID();
    const newToken = crypto.randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO players (id, token_hash, name, score) VALUES (?, ?, ?, 0)').run(id, hash(newToken), cleanName);
    return { ...this.getPlayer(id), token: newToken };
  }
  setConnected(playerId, connected) {
    if (connected) this.connected.add(playerId);
    else this.connected.delete(playerId);
  }
  players() {
    return this.db.prepare('SELECT id, name, score, yellow_cards, red_cards FROM players ORDER BY score DESC, created_at ASC')
      .all().map((p) => ({ ...p, connected: this.connected.has(p.id), excluded: this.excluded.has(p.id) }));
  }
  state() {
    const players = this.players();
    const winner = players.find((p) => p.id === this.winnerId) || null;
    return {
      roomName: this.roomName, phase: this.phase, roundId: this.roundId,
      winnerId: this.winnerId, winnerName: winner ? winner.name : null,
      players, question: this.questions.publicCurrent(), questionStats: this.questions.stats(),
      correctPoints: this.correctPoints, wrongPoints: this.wrongPoints,
      lastEvent: this.lastEvent, serverTime: Date.now()
    };
  }
  open() {
    this.phase = 'open';
    this.roundId += 1;
    this.winnerId = null;
    this.excluded.clear();
    this.lastEvent = `الجرس مفتوح — الجولة ${this.roundId}`;
    return this.state();
  }
  buzz(playerId, submittedRoundId) {
    if (!this.getPlayer(playerId)) return { ok: false, reason: 'اللاعب غير مسجل' };
    if (this.phase !== 'open') return { ok: false, reason: 'الجرس مقفول' };
    if (!Number.isInteger(submittedRoundId) || submittedRoundId !== this.roundId) return { ok: false, reason: 'ضغطة من جولة قديمة' };
    this.winnerId = playerId;
    this.phase = 'answering';
    this.lastEvent = `${this.getPlayer(playerId).name} كسب الجرس`;
    return { ok: true, reason: 'أنت أول واحد وصل للسيرفر' };
  }
  correct() {
    if (this.phase !== 'answering' || !this.winnerId) throw new Error('مفيش لاعب بيجاوب حاليًا');
    this.db.prepare('UPDATE players SET score = score + ? WHERE id = ?').run(this.correctPoints, this.winnerId);
    this.lastEvent = `${this.getPlayer(this.winnerId).name} جاوب صح (+${this.correctPoints})`;
    this.phase = 'closed';
    return this.state();
  }
  wrong() {
    if (this.phase !== 'answering' || !this.winnerId) throw new Error('مفيش لاعب بيجاوب حاليًا');
    const player = this.getPlayer(this.winnerId);
    this.db.prepare('UPDATE players SET score = score - ? WHERE id = ?').run(this.wrongPoints, this.winnerId);
    // After a wrong answer EVERY connected player may buzz again,
    // including the one who was just marked wrong. Advance roundId to
    // reject any delayed packets from the previous round.
    this.excluded.clear();
    this.winnerId = null;
    this.roundId += 1;
    const canBuzz = this.players().some(p => p.connected);
    this.phase = canBuzz ? 'open' : 'closed';
    this.lastEvent = `${player.name} جاوب غلط (-${this.wrongPoints}) — ${canBuzz ? 'الجرس اتفتح لكل اللاعبين من جديد' : 'مفيش لاعبين متصلين'}`;
    return this.state();
  }
  close() {
    this.phase = 'closed';
    this.winnerId = null;
    this.lastEvent = 'المذيع قفل الجرس';
    return this.state();
  }
  card(playerId, color) {
    if (color !== 'yellow' && color !== 'red') throw new Error('نوع الكارت غير صحيح');
    const player = this.getPlayer(playerId);
    if (!player) throw new Error('اللاعب المطلوب غير موجود');
    // Yellow = -1, Red = -3. Neither card ejects a player.
    const points = color === 'yellow' ? 1 : 3;
    if (color === 'yellow') {
      this.db.prepare('UPDATE players SET score = score - 1, yellow_cards = yellow_cards + 1 WHERE id = ?').run(playerId);
    } else {
      this.db.prepare('UPDATE players SET score = score - 3, red_cards = red_cards + 1 WHERE id = ?').run(playerId);
    }
    this.lastEvent = `${player.name} أخذ كارت ${color === 'yellow' ? 'أصفر' : 'أحمر'} (-${points})`;
    return this.state();
  }
  resetScores() {
    this.db.exec('UPDATE players SET score = 0, yellow_cards = 0, red_cards = 0');
    this.close();
    this.lastEvent = 'تم تصفير كل النقاط';
    return this.state();
  }
  clearPlayers() {
    this.db.exec('DELETE FROM players');
    this.connected.clear();
    this.excluded.clear();
    this.roundId = 0;
    this.phase = 'idle';
    this.winnerId = null;
    this.lastEvent = 'تم حذف اللاعبين وإعادة ضبط الغرفة';
    return this.state();
  }
  nextQuestion(category = null) {
    if (this.phase === 'answering') throw new Error('احسم إجابة اللاعب الحالي قبل السؤال التالي');
    const q = this.questions.next(category);
    this.close();
    this.excluded.clear();
    this.lastEvent = `سؤال جديد — ${q.category}`;
    return this.state();
  }
  replaceQuestions(rows) {
    if (this.phase === 'answering') throw new Error('احسم الإجابة أولًا قبل استيراد بنك جديد');
    const stats = this.questions.replace(rows);
    this.close();
    this.excluded.clear();
    this.lastEvent = `تم استيراد ${stats.total} سؤال`;
    return this.state();
  }
  resetQuestionUsage() {
    if (this.phase === 'answering') throw new Error('احسم الإجابة أولًا');
    const stats = this.questions.resetUsage();
    this.close();
    this.lastEvent = `تمت إعادة ${stats.total} سؤال لقائمة الأسئلة المتاحة`;
    return this.state();
  }
  stop() { this.db.close(); }
}

module.exports = { Game };
