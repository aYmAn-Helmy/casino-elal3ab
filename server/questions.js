'use strict';

// Local question bank: loads only user-provided, authorized questions.
// This app does not bundle questions from any third-party commercial game.
class QuestionBank {
  constructor(db) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        answer TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        reference TEXT NOT NULL DEFAULT '',
        used INTEGER NOT NULL DEFAULT 0
      );
    `);
    this.currentId = null;
  }

  stats() {
    const row = this.db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END), 0) AS remaining FROM questions').get();
    return { total: row.total, remaining: row.remaining };
  }

  current() {
    if (this.currentId === null) return null;
    return this.db.prepare('SELECT id, text, answer, category, source, reference FROM questions WHERE id = ?').get(this.currentId) || null;
  }

  publicCurrent() {
    const q = this.current();
    return q ? { id: q.id, text: q.text, category: q.category } : null;
  }

  hostCurrent() {
    return this.current();
  }

  // Replace whole bank atomically; rows must be user-authorized.
  replace(rows) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) {
      throw new Error('ملف الأسئلة لازم يحتوي من 1 إلى 1000 سؤال');
    }
    const normalized = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const q = rows[i];
      if (!q || typeof q !== 'object' || Array.isArray(q)) throw new Error(`تنسيق السؤال رقم ${i + 1} غلط`);
      function str(key, max, required = true) {
        if (typeof q[key] !== 'string') {
          if (!required && (q[key] === undefined || q[key] === null)) return '';
          throw new Error(`السؤال رقم ${i + 1}: الحقل ${key} لازم يكون نص`);
        }
        const value = q[key].trim();
        if ((required && !value) || value.length > max) throw new Error(`السؤال رقم ${i + 1}: الحقل ${key} فاضي أو طويل`);
        return value;
      }
      const text = str('text', 400);
      const answer = str('answer', 400);
      const category = str('category', 60);
      const source = str('source', 120, false);
      const reference = str('reference', 250, false);
      const key = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) throw new Error(`السؤال رقم ${i + 1}: سؤال متكرر`);
      seen.add(key);
      normalized.push({ text, answer, category, source, reference });
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM questions');
      const insert = this.db.prepare('INSERT INTO questions (text, answer, category, source, reference) VALUES (?, ?, ?, ?, ?)');
      for (const q of normalized) insert.run(q.text, q.answer, q.category, q.source, q.reference);
      this.db.exec('COMMIT');
      this.currentId = null;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.stats();
  }

  next() {
    const next = this.db.prepare('SELECT id FROM questions WHERE used = 0 ORDER BY RANDOM() LIMIT 1').get();
    if (!next) throw new Error('مفيش أسئلة جديدة. ارفع ملف أو صفّر حالة استخدام الأسئلة');
    this.db.prepare('UPDATE questions SET used = 1 WHERE id = ?').run(next.id);
    this.currentId = next.id;
    return this.current();
  }

  resetUsage() {
    this.db.exec('UPDATE questions SET used = 0');
    this.currentId = null;
    return this.stats();
  }
}

module.exports = { QuestionBank };
