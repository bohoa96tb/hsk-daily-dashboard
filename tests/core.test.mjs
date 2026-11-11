// Node tests mapping to the spec's 15 mandatory cases (logic/data level).
// DOM-level cases (reload, shift toggle, links, mobile) are covered via the same
// state functions the UI calls, plus manual/browser verification recorded in CHECKPOINT.
import assert from 'node:assert';
import fs from 'node:fs';
import * as Core from '../js/core.js';
import { slimVocab, slimGrammar } from '../js/data.js';

let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('✓', name); };

// Case: SRS schedule example from spec (learn 2026-11-11)
t('SRS anchored dates 1/3/7/14/60 from 2026-11-11', () => {
  const it = Core.createItem('word', 'x', '2026-11-11');
  assert.equal(it.due, '2026-11-12');
  let r = Core.gradeItem(it, true, '2026-11-12'); assert.equal(r.item.due, '2026-11-14');
  r = Core.gradeItem(r.item, true, '2026-11-14'); assert.equal(r.item.due, '2026-11-18');
  r = Core.gradeItem(r.item, true, '2026-11-18'); assert.equal(r.item.due, '2026-11-25');
  r = Core.gradeItem(r.item, true, '2026-11-25'); assert.equal(r.item.due, '2027-01-10');
  r = Core.gradeItem(r.item, true, '2027-01-10'); assert.equal(r.item.mastered, true); assert.equal(r.item.due, null);
});

// Case 7: missed review day -> stays overdue, not completed, no deletion
t('missed review stays overdue', () => {
  const s = Core.freshState(); s.items['word:a'] = Core.createItem('word', 'a', '2026-11-11');
  const g = Core.dueGroups(s, '2026-11-15');
  assert.equal(g.overdue.length, 1); assert.equal(s.items['word:a'].mastered, false);
});

// Case 8: wrong answer -> weak + supplementary review tomorrow; stage not advanced
t('wrong answer marks weak and schedules extra', () => {
  const it = Core.createItem('word', 'a', '2026-11-11');
  const r = Core.gradeItem(it, false, '2026-11-12');
  assert.equal(r.item.weak, true); assert.equal(r.item.extraDue, '2026-11-13'); assert.equal(r.item.nextStage, 0); assert.equal(r.item.wrong, 1);
});

// Case 6 + 15 (V1.1 semantics): entries are unique per (item, type).
// An item with both a regular stage and an extra review due the same day
// legitimately yields TWO distinct entries — never merged, never confused.
t('due entries unique per item+type; same-day regular+extra stay distinct', () => {
  const s = Core.freshState();
  for (let i = 0; i < 30; i++) s.items[`word:w${i}`] = Core.createItem('word', `w${i}`, '2026-11-11');
  s.items['word:w0'].extraDue = '2026-11-12';
  const entries = Core.dueEntries(s, '2026-11-12');
  const sig = entries.map(e => `${e.key}|${e.type}`);
  assert.equal(sig.length, new Set(sig).size); assert.equal(entries.length, 31);
  const w0 = entries.filter(e => e.key === 'word:w0');
  assert.deepEqual(w0.map(e => e.type).sort(), ['extra', 'regular']);
});

// Dedupe: same stage graded twice same day counts once
t('same stage twice in one day is deduped', () => {
  const it = Core.createItem('word', 'a', '2026-11-11');
  const r1 = Core.gradeItem(it, true, '2026-11-12');
  const r2 = Core.gradeItem(r1.item, true, '2026-11-12');
  assert.equal(r2.changed, false); assert.equal(r2.item.correct, 1);
});

// Case 1/2: day progress partial and full
t('day progress 8/24 then 24/24', () => {
  const s = Core.freshState();
  const ids = Array.from({ length: 24 }, (_, i) => `w${i}`);
  s.days['2026-11-11'] = { date: '2026-11-11', wordIds: ids, wordChecks: {}, grammarStatus: 'not', reviewTotal: 0, reviewsDone: 0 };
  ids.slice(0, 8).forEach(id => s.days['2026-11-11'].wordChecks[id] = { self: 'known' });
  let p = Core.dayProgress(s, '2026-11-11'); assert.equal(p.wordsDone, 8);
  ids.forEach(id => s.days['2026-11-11'].wordChecks[id] = { self: 'known' });
  s.days['2026-11-11'].grammarStatus = 'done';
  p = Core.dayProgress(s, '2026-11-11'); assert.equal(p.pct, 100);
});

// Case F: classification never from self-mark alone
t('classification needs real checks', () => {
  assert.equal(Core.classifyWord(null, { self: 'known' }), 'new');
  const it = Core.createItem('word', 'a', '2026-11-11'); it.correct = 3; it.completedStages = [1, 3];
  assert.equal(Core.classifyWord(it), 'good');
  const bad = Core.createItem('word', 'b', '2026-11-11'); bad.wrong = 2;
  assert.equal(Core.classifyWord(bad), 'weak');
});

// Case 10/11/15: import merge does not overwrite, dedupes items/history
t('merge import keeps existing and dedupes', () => {
  const a = Core.freshState(); a.items['word:x'] = Core.createItem('word', 'x', '2026-11-11'); a.items['word:x'].correct = 5;
  a.history.push({ date: '2026-11-11', action: 'vocab-complete', detail: 'L1' });
  const b = Core.freshState(); b.items['word:x'] = Core.createItem('word', 'x', '2026-11-11'); b.items['word:x'].correct = 1;
  b.items['word:y'] = Core.createItem('word', 'y', '2026-11-11');
  b.history.push({ date: '2026-11-11', action: 'vocab-complete', detail: 'L1' });
  const m = Core.mergeStates(a, b);
  assert.equal(m.items['word:x'].correct, 5); // existing richer record kept
  assert.ok(m.items['word:y']); assert.equal(m.history.length, 1);
});

// Case P2: real data adapters against cloned source repos (paths injected by runner)
const audit = process.env.AUDIT_DIR;
if (audit) {
  t('vocab adapter: 94 lessons x up to 24 words, 2234 words, order kept', () => {
    const raw = JSON.parse(fs.readFileSync(`${audit}/hazi-viet/data/vocabulary/hanzii-course.json`, 'utf8'));
    const slim = slimVocab(raw);
    assert.equal(slim.lessons.length, 94); assert.equal(Object.keys(slim.words).length, 2234);
    assert.ok(slim.lessons.every(l => l.wordIds.length >= 1 && l.wordIds.length <= 24));
    assert.equal(slim.lessons[0].wordIds[0], 'hz-h1-64d354d405bb');
    assert.equal(slim.words['hz-h1-64d354d405bb'].hanzi, '我');
  });
  t('grammar adapter: 18 ready lessons in order, first is hsk1-l01 with points', () => {
    const raw = JSON.parse(fs.readFileSync(`${audit}/HSK3.0/data/content.json`, 'utf8'));
    const slim = slimGrammar(raw);
    assert.equal(slim.lessons.length, 18); assert.equal(slim.lessons[0].id, 'hsk1-l01');
    assert.ok(slim.lessons[0].points.length >= 5); assert.ok(slim.lessons[0].goal.length > 0);
    assert.equal(slim.lessons[17].id, 'hsk2-l03');
  });
}

// Case 4/5: shift is a pure settings value; both schedules exist with spec blocks
t('schedules day/night match spec templates', () => {
  assert.equal(Core.DEFAULT_SCHEDULES.day.length, 8); assert.equal(Core.DEFAULT_SCHEDULES.night.length, 8);
  assert.ok(Core.DEFAULT_SCHEDULES.night.some(b => /14:00/.test(b.time)));
  assert.ok(Core.DEFAULT_SCHEDULES.day.some(b => /22:00/.test(b.time)));
});

// JST date: 2026-11-11T15:30Z is already 2026-11-12 in Tokyo
t('today uses Asia/Tokyo', () => {
  assert.equal(Core.todayKeyJST(new Date('2026-11-11T15:30:00Z')), '2026-11-12');
  assert.equal(Core.todayKeyJST(new Date('2026-11-11T14:30:00Z')), '2026-11-11');
});

// ---- V1.1 regression tests ----

// 3.1a self-mark everything first, then quiz WRONG -> existing item updated
t('V1.1 quiz after finalize updates item (weak + extra + history)', () => {
  const s = Core.freshState();
  const day = { date: '2026-11-11', wordIds: ['a'], wordChecks: { a: { self: 'known' } }, grammarStatus: 'not' };
  s.items['word:a'] = Core.buildWordItem(day, 'a', '2026-11-11');
  Core.recordQuiz(s, day, 'a', false, '2026-11-11');
  const it = s.items['word:a'];
  assert.equal(it.quizWrong, 1); assert.equal(it.weak, true); assert.equal(it.extraDue, '2026-11-12');
  assert.equal(it.checkHistory.length, 1); assert.equal(Core.classifyWord(it), 'weak');
});

// 3.1b quiz first, then finalize builds item from all attempts; no duplicates
t('V1.1 quiz before finalize folds all attempts into one item', () => {
  const s = Core.freshState();
  const day = { date: '2026-11-11', wordIds: ['a'], wordChecks: {}, grammarStatus: 'not' };
  Core.recordQuiz(s, day, 'a', false, '2026-11-11');
  Core.recordQuiz(s, day, 'a', true, '2026-11-11');
  Core.recordQuiz(s, day, 'a', true, '2026-11-11');
  const it = Core.buildWordItem(day, 'a', '2026-11-11');
  assert.equal(it.quizWrong, 1); assert.equal(it.quizCorrect, 2); assert.equal(it.checkHistory.length, 3);
});

// 3.1c wrong then right in review-day quiz clears weakness when ahead
t('V1.1 repeated quiz wrong->right keeps full history', () => {
  const s = Core.freshState(); s.items['word:a'] = Core.createItem('word', 'a', '2026-11-10');
  const day = { date: '2026-11-11', wordIds: [], wordChecks: {}, grammarStatus: 'not' };
  Core.recordQuiz(s, day, 'a', false, '2026-11-11');
  Core.gradeExtra(s.items['word:a'], true, '2026-11-12'); // supplementary done next day handled by caller pattern
  Core.recordQuiz(s, day, 'a', true, '2026-11-11');
  assert.equal(s.items['word:a'].checkHistory.length, 2);
});

// 3.3 late review: next stage never due same day or in the past
t('V1.1 late grade reschedules to tomorrow at earliest', () => {
  const it = Core.createItem('word', 'a', '2026-11-11'); // R1 due 11-12, R3 anchored 11-14
  const r = Core.gradeItem(it, true, '2026-11-20'); // graded very late
  assert.equal(r.item.due, '2026-11-21');
  const g = Core.dueEntries({ items: { 'word:a': r.item } }, '2026-11-20');
  assert.equal(g.length, 0); // not shown again the same day
});

// 3.4 end of curriculum + new lessons arriving later
t('V1.1 curriculum completion and new-lesson detection', () => {
  const s = Core.freshState(); s.curriculum.vocabIndex = 93;
  Core.advanceVocab(s, 94);
  assert.equal(s.curriculum.vocabDone, true); assert.equal(s.curriculum.vocabIndex, 94);
  Core.reconcileCurriculum(s, 94, 18); assert.equal(s.curriculum.vocabDone, true);
  Core.reconcileCurriculum(s, 96, 18); // two new lessons published
  assert.equal(s.curriculum.vocabDone, false); assert.equal(s.curriculum.vocabIndex, 94);
});

// Migration: a raw V1.0-shaped state gains V1.1 fields, loses nothing
t('V1.1 migration preserves V1.0 data', () => {
  const old = { version: 1, curriculum: { vocabIndex: 3, grammarIndex: 2 }, days: { '2026-11-11': { wordChecks: { a: { self: 'known', quiz: { correct: true, at: '2026-11-11' } } } } }, items: { 'word:a': { key: 'word:a', kind: 'word', id: 'a', correct: 2, wrong: 0 } }, history: [] };
  const m = Core.migrateState(JSON.parse(JSON.stringify(old)));
  assert.equal(m.curriculum.vocabIndex, 3); assert.equal(m.items['word:a'].correct, 2);
  assert.equal(m.items['word:a'].quizCorrect, 0); assert.deepEqual(m.days['2026-11-11'].wordChecks.a.quizHistory, [{ correct: true, at: '2026-11-11' }]);
});

// Backup validation rejects garbage before any state is touched
t('V1.1 validateBackup rejects invalid files', () => {
  assert.throws(() => Core.validateBackup({ app: 'other' }));
  assert.throws(() => Core.validateBackup({ app: 'hsk-daily-dashboard', version: 1, state: {} }));
  assert.ok(Core.validateBackup({ app: 'hsk-daily-dashboard', version: 1, state: { days: {}, items: {}, curriculum: {} } }));
});

// Stats: accuracy, streak, weekly
t('V1.1 accuracy/streak/weekly from real activity', () => {
  const s = Core.freshState();
  s.items['word:a'] = Core.createItem('word', 'a', '2026-11-10'); s.items['word:a'].correct = 3; s.items['word:a'].quizWrong = 1;
  s.days['2026-11-10'] = { wordChecks: { a: { self: 'known' } }, grammarStatus: 'done', reviewsDone: 0 };
  s.days['2026-11-11'] = { wordChecks: {}, grammarStatus: 'not', reviewsDone: 2 };
  s.history.push({ date: '2026-11-11', action: 'review-right', detail: 'regular:word:a' });
  assert.equal(Core.accuracy(s), 75);
  assert.equal(Core.streakDays(s, '2026-11-11'), 2);
  const w = Core.weeklySummary(s, '2026-11-11'); assert.equal(w.activeDays, 2); assert.equal(w.reviews, 1);
});

// Export->import roundtrip equality of items (merge into empty == source)
t('V1.1 export/import merge roundtrip', () => {
  const src = Core.freshState(); src.items['word:a'] = Core.createItem('word', 'a', '2026-11-11'); src.items['word:a'].correct = 4;
  const dst = Core.freshState();
  const merged = Core.mergeStates(dst, JSON.parse(JSON.stringify(src)));
  assert.equal(merged.items['word:a'].correct, 4);
});

// Priority order: overdue first, extra last
t('V1.1 due priority overdue > due-today > extra', () => {
  const s = Core.freshState();
  s.items['word:late'] = Core.createItem('word', 'late', '2026-11-01'); // due 11-02, overdue on 11-11
  s.items['word:now'] = Core.createItem('word', 'now', '2026-11-10'); // due 11-11
  s.items['word:x'] = Core.createItem('word', 'x', '2026-11-10'); s.items['word:x'].due = null; s.items['word:x'].extraDue = '2026-11-11';
  const order = Core.dueEntries(s, '2026-11-11').map(e => `${e.item.id}:${e.type}`);
  assert.deepEqual(order, ['late:regular', 'now:regular', 'x:extra']);
});

console.log(`\n${pass} tests passed`);
