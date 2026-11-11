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

// Case 6 + 15: many items due same day, no duplicates in groups
t('no duplicate item across due groups', () => {
  const s = Core.freshState();
  for (let i = 0; i < 30; i++) s.items[`word:w${i}`] = Core.createItem('word', `w${i}`, '2026-11-11');
  s.items['word:w0'].extraDue = '2026-11-12';
  const g = Core.dueGroups(s, '2026-11-12');
  const all = Object.values(g).flat().map(i => i.key);
  assert.equal(all.length, new Set(all).size); assert.equal(all.length, 30);
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

console.log(`\n${pass} tests passed`);
