// HSK Daily Dashboard — core logic (pure, testable in Node and browser).
// SRS anchored to first-learned date, per spec example:
// learn 2026-11-11 -> due 11-12 (R1), 11-14 (R3), 11-18 (R7), 11-25 (R14), 2027-01-10 (R60).
export const SRS_INTERVALS = [1, 3, 7, 14, 60];
export const SRS_NAMES = ['R1', 'R3', 'R7', 'R14', 'R60'];
export const DATA_VERSION = 1;

export function dateKeyFromParts(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function todayKeyJST(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = t => Number(parts.find(p => p.type === t).value);
  return dateKeyFromParts(g('year'), g('month'), g('day'));
}
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return dateKeyFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function diffDays(a, b) { // b - a in days
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

export function freshState() {
  return {
    version: DATA_VERSION,
    createdAt: null,
    curriculum: { vocabIndex: 0, grammarIndex: 0, vocabDone: false, grammarDone: false, vocabSeen: 0, grammarSeen: 0 },
    days: {},        // dateKey -> day plan
    items: {},       // 'word:<id>' | 'grammar:<id>' -> SRS item
    history: [],     // {date, action, detail}
    wordFlags: {},   // wordId -> {hard:true}
  };
}

export function createItem(kind, id, firstLearned) {
  return {
    key: `${kind}:${id}`, kind, id, firstLearned,
    nextStage: 0, completedStages: [],
    correct: 0, wrong: 0, weak: false,
    due: addDays(firstLearned, SRS_INTERVALS[0]),
    extraDue: null, mastered: false, lastReview: null,
    quizCorrect: 0, quizWrong: 0, extraCorrect: 0, extraWrong: 0, checkHistory: [], kpWeak: [],
  };
}

// Grade one scheduled review. Dedupe: same stage cannot be graded twice on the same day.
export function gradeItem(item, correct, today) {
  if (item.mastered) return { item, changed: false, reason: 'mastered' };
  if (item.lastReview && item.lastReview.date === today) {
    return { item, changed: false, reason: 'duplicate-same-day' };
  }
  const it = { ...item, completedStages: [...item.completedStages] };
  if (!correct) {
    it.wrong += 1; it.weak = true;
    it.extraDue = addDays(today, 1); // supplementary review tomorrow
    it.due = addDays(today, 1); // F1: a failed regular review must NOT reappear today; same stage retries tomorrow
    it.lastReview = { date: today, stage: it.nextStage, correct: false };
    it.checkHistory = [...(it.checkHistory || []), { date: today, kind: 'review', stage: SRS_INTERVALS[it.nextStage], correct: false }];
    return { item: it, changed: true, reason: 'wrong-extra-scheduled' };
  }
  it.correct += 1;
  it.checkHistory = [...(it.checkHistory || []), { date: today, kind: 'review', stage: SRS_INTERVALS[it.nextStage], correct: true }];
  it.completedStages.push(SRS_INTERVALS[it.nextStage]);
  it.lastReview = { date: today, stage: it.nextStage, correct: true };
  it.nextStage += 1;
  if (it.nextStage >= SRS_INTERVALS.length) {
    it.mastered = true; it.due = null; it.weak = false;
  } else {
    const anchored = addDays(it.firstLearned, SRS_INTERVALS[it.nextStage]);
    it.due = diffDays(today, anchored) <= 0 ? addDays(today, 1) : anchored; // late completion: next stage starts tomorrow — never reappears same day, never in the past
    if (it.correct > it.wrong) it.weak = false;
  }
  return { item: it, changed: true, reason: 'advanced' };
}

// Grade a supplementary (extra) review created by a wrong answer.
export function gradeExtra(item, correct, today) {
  const it = { ...item, checkHistory: [...(item.checkHistory || [])] };
  if (it.lastExtraReview === today) return it; // dedupe: one extra grade per day
  it.lastExtraReview = today;
  it.checkHistory.push({ date: today, kind: 'extra', correct });
  if (correct) { it.extraCorrect = (it.extraCorrect || 0) + 1; it.extraDue = null; if ((it.quizCorrect || 0) + it.correct > (it.quizWrong || 0) + it.wrong) it.weak = false; }
  else { it.extraWrong = (it.extraWrong || 0) + 1; it.weak = true; it.extraDue = addDays(today, 1); }
  return it;
}

// Due ENTRIES for a date. Each entry carries an explicit review type:
// 'regular' (scheduled SRS stage) or 'extra' (supplementary weak review).
// An item may legitimately produce TWO entries on the same day (one of each
// type) — they are distinct tasks and are never merged or confused.
// Priority: most overdue first (regular and extra alike), then frequently-wrong regular, then regular due today, then extra.
export function dueEntries(state, today) {
  const entries = [];
  for (const it of Object.values(state.items)) {
    if (it.mastered) continue;
    if (it.due) {
      const late = diffDays(it.due, today);
      if (late >= 0) entries.push({ key: it.key, item: it, type: 'regular', group: late > 0 ? 'overdue' : SRS_NAMES[it.nextStage], overdueDays: late });
    }
    if (it.extraDue && diffDays(it.extraDue, today) >= 0) {
      entries.push({ key: it.key, item: it, type: 'extra', group: 'extra', overdueDays: diffDays(it.extraDue, today) });
    }
  }
  const rank = e => e.overdueDays > 0 ? 0 : e.type === 'extra' ? 3 : (e.item.weak || e.item.wrong + (e.item.quizWrong || 0) > e.item.correct + (e.item.quizCorrect || 0)) ? 1 : 2;
  entries.sort((a, b) => rank(a) - rank(b) || b.overdueDays - a.overdueDays || (b.item.wrong + (b.item.quizWrong || 0)) - (a.item.wrong + (a.item.quizWrong || 0)));
  return entries;
}
export function dueGroups(state, today) {
  const groups = { R1: [], R3: [], R7: [], R14: [], R60: [], overdue: [], extra: [] };
  for (const e of dueEntries(state, today)) groups[e.group].push(e);
  return groups;
}
export function dueCount(state, today) { return dueEntries(state, today).length; }

// Memory classification is based on real check results, never on self-mark alone.
export function classifyWord(item, dayChecks) {
  if (!item && !dayChecks) return 'new';
  if (item && item.mastered) return 'mastered60';
  if (!item) return 'new';
  if (item.weak) return 'weak';
  const ev = (item.checkHistory || []).filter(h => (h.kind === 'review' || h.kind === 'quiz' || h.kind === 'recall') && h.counted !== false && !h.fuzzy);
  let c, w;
  if (ev.length) { c = ev.filter(h => h.correct).length; w = ev.length - c; }
  else { c = item.correct + (item.quizCorrect || 0); w = item.wrong + (item.quizWrong || 0); }
  if (w > c && w > 0) return 'weak';
  const spacedSuccess = ev.some(h => h.kind === 'review' && h.correct && (h.stage || 0) >= 7) ||
    (item.checkHistory || []).some(h => h.kind === 'recall' && h.correct && item.completedStages.length >= 2);
  if (item.completedStages.length >= 3 && c >= 3 && c / Math.max(1, c + w) >= 0.8 && spacedSuccess) return 'good';
  if (item.completedStages.length > 0 || c + w > 0) return 'learning';
  return 'new';
}
export const CLASS_LABELS = { new: 'Mới học', learning: 'Đang ghi nhớ', good: 'Nhớ tốt', weak: 'Cần củng cố', mastered60: 'Đã qua mốc 60 ngày' };

export function wordStats(state) {
  const s = { total: 0, good: 0, learning: 0, weak: 0, new: 0, mastered60: 0 };
  for (const it of Object.values(state.items)) {
    if (it.kind !== 'word') continue;
    s.total += 1;
    s[classifyWord(it)] += 1;
  }
  return s;
}
export function grammarStats(state) {
  const s = { total: 0, done: 0, learning: 0, weak: 0, kpWeak: 0 };
  for (const it of Object.values(state.items)) {
    if (it.kind !== 'grammar') continue;
    s.total += 1;
    if (it.mastered) s.done += 1; else s.learning += 1;
    if (it.weak) s.weak += 1;
    s.kpWeak += (it.kpWeak || []).length;
  }
  return s;
}

// Day completion %: vocab words checked + grammar done + due reviews done today, weighted equally by task counts.
export function dayProgress(state, dateKey) {
  const day = state.days[dateKey];
  if (!day) return { pct: 0, wordsDone: 0, wordsTotal: 0, grammarDone: false, reviewsDone: 0, reviewsTotal: 0 };
  const wordsTotal = (day.wordIds || []).length;
  const wordsDone = (day.wordIds || []).filter(id => { const c = (day.wordChecks || {})[id]; return c && (c.self || c.quiz || c.recall); }).length;
  const reviewsTotal = day.reviewTotal || 0;
  const reviewsDone = day.reviewsDone || 0;
  const parts = [];
  if (wordsTotal) parts.push(wordsDone / wordsTotal);
  parts.push(day.grammarStatus === 'done' ? 1 : day.grammarStatus === 'learning' ? 0.5 : 0);
  if (reviewsTotal) parts.push(Math.min(1, reviewsDone / reviewsTotal));
  const pct = parts.length ? Math.round(100 * parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
  return { pct, wordsDone, wordsTotal, grammarDone: day.grammarStatus === 'done', reviewsDone, reviewsTotal };
}

// Merge an imported backup into existing state WITHOUT overwriting existing records.
// Dedupe by key/date; keep the record with more activity.
export function mergeStates(existing, imported) {
  const out = JSON.parse(JSON.stringify(existing));
  if (!imported || imported.version !== DATA_VERSION) throw new Error('Phiên bản dữ liệu sao lưu không khớp.');
  imported = migrateState(JSON.parse(JSON.stringify(imported)));
  out.curriculum.vocabIndex = Math.max(out.curriculum.vocabIndex || 0, imported.curriculum?.vocabIndex || 0);
  out.curriculum.grammarIndex = Math.max(out.curriculum.grammarIndex || 0, imported.curriculum?.grammarIndex || 0);
  out.curriculum.vocabOffset = Math.max(out.curriculum.vocabOffset || 0, imported.curriculum?.vocabOffset || 0);
  if (imported.curriculum?.vocabDone && (imported.curriculum?.vocabSeen || 0) >= (out.curriculum.vocabSeen || 0)) out.curriculum.vocabDone = true;
  if (imported.curriculum?.grammarDone && (imported.curriculum?.grammarSeen || 0) >= (out.curriculum.grammarSeen || 0)) out.curriculum.grammarDone = true;
  out.wordFlags = { ...(imported.wordFlags || {}), ...(out.wordFlags || {}) };
  for (const [date, day] of Object.entries(imported.days || {})) {
    if (!day || typeof day !== 'object') continue;
    if (!out.days[date]) { out.days[date] = day; continue; }
    const cur = out.days[date];
    cur.wordChecks = { ...(day.wordChecks || {}), ...(cur.wordChecks || {}) };
    cur.tasksDone = { ...(day.tasksDone || {}), ...(cur.tasksDone || {}) };
    cur.vocabFinalized = !!(cur.vocabFinalized || day.vocabFinalized);
    cur.grammarFinalized = !!(cur.grammarFinalized || day.grammarFinalized);
    cur.grammarChecks = { ...(day.grammarChecks || {}), ...(cur.grammarChecks || {}) };
    if ((day.reviewsDone || 0) > (cur.reviewsDone || 0)) cur.reviewsDone = day.reviewsDone;
    if ((day.reviewTotal || 0) > (cur.reviewTotal || 0)) cur.reviewTotal = day.reviewTotal;
    if (day.grammarStatus === 'done') cur.grammarStatus = 'done';
  }
  const score = it => (it.mastered ? 1e6 : 0) + (it.completedStages || []).length * 1000 + (it.correct || 0) + (it.wrong || 0) + (it.quizCorrect || 0) + (it.quizWrong || 0);
  for (const [key, it] of Object.entries(imported.items || {})) {
    const cur = out.items[key];
    if (!cur) { out.items[key] = it; continue; }
    const winner = score(it) > score(cur) ? it : cur;
    const loser = winner === it ? cur : it;
    const seenH = new Set((winner.checkHistory || []).map(h => `${h.date}|${h.kind}|${h.correct}|${h.stage || ''}`));
    const mergedHistory = [...(winner.checkHistory || [])];
    for (const h of loser.checkHistory || []) { const k = `${h.date}|${h.kind}|${h.correct}|${h.stage || ''}`; if (!seenH.has(k)) { mergedHistory.push(h); seenH.add(k); } }
    out.items[key] = { ...winner, checkHistory: mergedHistory, kpWeak: [...new Set([...(cur.kpWeak || []), ...(it.kpWeak || [])])] };
  }
  const seen = new Set(out.history.map(h => `${h.date}|${h.action}|${h.detail}`));
  for (const h of imported.history || []) {
    const k = `${h.date}|${h.action}|${h.detail}`;
    if (!seen.has(k)) { out.history.push(h); seen.add(k); }
  }
  return out;
}

// Retention after spacing: share of correct regular reviews at stages >= 7 days.
export function retention(state) {
  let c = 0, n = 0;
  for (const it of Object.values(state.items)) {
    for (const h of it.checkHistory || []) {
      if (h.kind === 'review' && (h.stage || 0) >= 7 && !h.fuzzy) { n += 1; if (h.correct) c += 1; }
    }
  }
  return n === 0 ? null : { correct: c, total: n, pct: Math.round(100 * c / n) };
}
export function accuracyByType(state) {
  const out = {};
  for (const it of Object.values(state.items)) {
    for (const h of it.checkHistory || []) {
      if ((h.kind === 'quiz' || h.kind === 'recall') && h.counted !== false && !h.fuzzy) {
        const t = h.type || h.kind; out[t] = out[t] || { c: 0, n: 0 };
        out[t].n += 1; if (h.correct) out[t].c += 1;
      }
    }
  }
  return out;
}
export function oftenWrong(state, limit = 8) {
  return Object.values(state.items)
    .map(it => ({ item: it, misses: (it.wrong || 0) + (it.quizWrong || 0) + (it.extraWrong || 0) }))
    .filter(x => x.misses > 0)
    .sort((a, b) => b.misses - a.misses)
    .slice(0, limit);
}

export function recordQuiz(state, day, wordId, correct, today, meta = {}) {
  const chk = { ...(day.wordChecks[wordId] || {}) };
  const counted = meta.counted !== undefined ? meta.counted : !(chk.quizHistory && chk.quizHistory.length); // only the first attempt of the day counts toward classification
  chk.quiz = { correct, at: today };
  chk.quizHistory = [...(chk.quizHistory || []), { correct, at: today, type: meta.type || 'h2m', counted }];
  day.wordChecks[wordId] = chk;
  const item = state.items[`word:${wordId}`];
  if (!item) return null;
  const it = { ...item, checkHistory: [...(item.checkHistory || [])] };
  it.checkHistory.push({ date: today, kind: meta.kind || 'quiz', type: meta.type || 'h2m', correct, chosenId: meta.chosenId || null, counted });
  if (correct) it.quizCorrect = (it.quizCorrect || 0) + 1; else it.quizWrong = (it.quizWrong || 0) + 1;
  if (it.mastered) { state.items[it.key] = it; return it; } // F10: record, but mastery/SRS untouched
  if (!correct) {
    it.weak = true;
    if (!it.extraDue) it.extraDue = addDays(today, 1);
  } else if (it.weak && !it.extraDue && (it.quizCorrect + it.correct) > (it.quizWrong + it.wrong)) it.weak = false;
  state.items[it.key] = it;
  return it;
}

// Self-recall grading (Active Recall): level 2 = remembered clearly, 1 = fuzzy, 0 = forgot.
export function recordRecall(state, day, wordId, level, today) {
  if (level === 2) return recordQuiz(state, day, wordId, true, today, { kind: 'recall', type: 'recall' });
  if (level === 0) return recordQuiz(state, day, wordId, false, today, { kind: 'recall', type: 'recall' });
  day.wordChecks[wordId] = { ...(day.wordChecks[wordId] || {}), recall: { level: 1, at: today } };
  const item = state.items[`word:${wordId}`];
  if (item && !item.mastered) {
    const it = { ...item, checkHistory: [...(item.checkHistory || []), { date: today, kind: 'recall', type: 'recall', correct: false, fuzzy: true, counted: false }] };
    state.items[it.key] = it; return it;
  }
  return item || null;
}

// Recall grading for a regular SRS review: 2 advance, 0 fail, 1 stay + retry tomorrow (no extra).
export function gradeReviewRecall(item, level, today) {
  if (level === 2) return gradeItem(item, true, today);
  if (level === 0) return gradeItem(item, false, today);
  if (item.mastered || (item.lastReview && item.lastReview.date === today)) return { item, changed: false, reason: 'duplicate-same-day' };
  const it = { ...item, checkHistory: [...(item.checkHistory || []), { date: today, kind: 'review', stage: SRS_INTERVALS[item.nextStage], correct: false, fuzzy: true }] };
  it.lastReview = { date: today, stage: it.nextStage, correct: false, fuzzy: true };
  it.due = addDays(today, 1);
  return { item: it, changed: true, reason: 'fuzzy-retry-tomorrow' };
}

// Build an SRS word item from a finished day, folding in ALL quiz attempts.
export function buildWordItem(day, wordId, today) {
  const it = createItem('word', wordId, today);
  const chk = day.wordChecks[wordId] || {};
  if (chk.recall && !(chk.quizHistory && chk.quizHistory.length)) it.checkHistory.push({ date: chk.recall.at || today, kind: 'recall', type: 'recall', correct: false, fuzzy: true, counted: false });
  for (const q of chk.quizHistory || (chk.quiz ? [chk.quiz] : [])) {
    it.checkHistory.push({ date: q.at || today, kind: q.kind || 'quiz', type: q.type || 'h2m', correct: q.correct, counted: q.counted !== false });
    if (q.correct) it.quizCorrect += 1; else it.quizWrong += 1;
  }
  if (it.quizWrong > 0 || chk.self === 'weak') { it.weak = true; it.extraDue = addDays(today, 1); }
  return it;
}

// Curriculum completion: advancing past the last lesson sets a done flag
// instead of clamping back onto the last lesson.
// Manual curriculum positioning (Settings). Clamps to range, restarts the
// lesson from its beginning (offset 0) and revives a finished track when the
// user picks a lesson inside the catalogue. Never touches days/items/history.
export function setVocabPosition(state, idx, total) {
  const i = Math.max(0, Math.min(Number(idx) || 0, Math.max(0, (total || 0) - 1)));
  state.curriculum.vocabIndex = i;
  state.curriculum.vocabOffset = 0;
  if (total > 0) state.curriculum.vocabDone = false;
  return i;
}
export function setGrammarPosition(state, idx, total) {
  const i = Math.max(0, Math.min(Number(idx) || 0, Math.max(0, (total || 0) - 1)));
  state.curriculum.grammarIndex = i;
  if (total > 0) state.curriculum.grammarDone = false;
  return i;
}
export function advanceVocab(state, total) {
  state.curriculum.vocabIndex += 1;
  if (state.curriculum.vocabIndex >= total) { state.curriculum.vocabIndex = total; state.curriculum.vocabDone = true; state.curriculum.vocabSeen = Math.max(state.curriculum.vocabSeen || 0, total); }
}
export function advanceGrammar(state, total) {
  state.curriculum.grammarIndex += 1;
  if (state.curriculum.grammarIndex >= total) { state.curriculum.grammarIndex = total; state.curriculum.grammarDone = true; state.curriculum.grammarSeen = Math.max(state.curriculum.grammarSeen || 0, total); }
}
// If new lessons appear after completion, resume at the first new lesson.
export function reconcileCurriculum(state, vocabTotal, grammarTotal) {
  const c = state.curriculum;
  if (c.vocabDone && vocabTotal > (c.vocabSeen || 0)) { c.vocabDone = false; c.vocabIndex = c.vocabSeen || 0; }
  if (c.grammarDone && grammarTotal > (c.grammarSeen || 0)) { c.grammarDone = false; c.grammarIndex = c.grammarSeen || 0; }
  c.vocabSeen = vocabTotal; c.grammarSeen = grammarTotal;
}

// Idempotent migration: V1.0 state gains V1.1 fields with defaults. Nothing is removed.
export function migrateState(s) {
  if (s && typeof s === 'object') {
    if (!s.days || typeof s.days !== 'object') s.days = {};
    if (!s.items || typeof s.items !== 'object') s.items = {};
    if (!Array.isArray(s.history)) s.history = [];
    if (!s.wordFlags || typeof s.wordFlags !== 'object') s.wordFlags = {};
  }
  if (!s || s.version !== DATA_VERSION) return s;
  s.curriculum = { vocabDone: false, grammarDone: false, vocabSeen: 0, grammarSeen: 0, vocabOffset: 0, ...s.curriculum };
  for (const it of Object.values(s.items || {})) {
    if (it.quizCorrect === undefined) it.quizCorrect = 0;
    if (it.quizWrong === undefined) it.quizWrong = 0;
    if (it.extraCorrect === undefined) it.extraCorrect = 0;
    if (it.extraWrong === undefined) it.extraWrong = 0;
    if (!Array.isArray(it.kpWeak)) it.kpWeak = [];
    if (!Array.isArray(it.checkHistory)) it.checkHistory = [];
  }
  for (const day of Object.values(s.days || {})) {
    for (const chk of Object.values(day.wordChecks || {})) {
      if (chk && chk.quiz && !chk.quizHistory) chk.quizHistory = [chk.quiz];
    }
  }
  s.appVersion = '1.2';
  return s;
}

export function validateBackup(data) {
  if (!data || data.app !== 'hsk-daily-dashboard') throw new Error('File không phải bản sao lưu của HSK Daily Dashboard.');
  if (data.version !== DATA_VERSION || !data.state || typeof data.state !== 'object') throw new Error('Phiên bản sao lưu không tương thích.');
  const st = data.state;
  if (!st.days || typeof st.days !== 'object' || !st.items || typeof st.items !== 'object' || !st.curriculum || typeof st.curriculum !== 'object') throw new Error('File sao lưu thiếu dữ liệu tiến độ.');
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const [k, day] of Object.entries(st.days)) {
    if (!day || typeof day !== 'object' || Array.isArray(day)) throw new Error(`Ngày ${k} trong sao lưu không hợp lệ.`);
  }
  for (const [k, it] of Object.entries(st.items)) {
    if (!it || typeof it !== 'object' || !Array.isArray(it.completedStages)) throw new Error(`Mục ${k} trong sao lưu không hợp lệ.`);
    if (!Number.isInteger(it.nextStage) || it.nextStage < 0 || it.nextStage > SRS_INTERVALS.length) throw new Error(`Mục ${k} có mốc ôn không hợp lệ.`);
    for (const f of ['due', 'extraDue']) if (it[f] !== null && it[f] !== undefined && !dateRe.test(it[f])) throw new Error(`Mục ${k} có ngày ôn không hợp lệ.`);
  }
  try { migrateState(JSON.parse(JSON.stringify(st))); } catch { throw new Error('Sao lưu không qua được bước kiểm tra tương thích.'); }
  return data;
}

export function accuracy(state) {
  let c = 0, w = 0;
  for (const it of Object.values(state.items)) { c += it.correct + (it.quizCorrect || 0); w += it.wrong + (it.quizWrong || 0); }
  return c + w === 0 ? null : Math.round(100 * c / (c + w));
}
export function activeDates(state) {
  const set = new Set();
  for (const [date, day] of Object.entries(state.days || {})) {
    if (Object.keys(day.wordChecks || {}).length || day.grammarStatus === 'done' || (day.reviewsDone || 0) > 0) set.add(date);
  }
  for (const h of state.history || []) { if (/^(vocab-complete|grammar-complete|review-|quiz|recall)/.test(h.action || '')) set.add(h.date); }
  return set;
}
export function streakDays(state, today) {
  const set = activeDates(state);
  let cur = set.has(today) ? today : addDays(today, -1);
  if (!set.has(cur)) return 0;
  let n = 0; while (set.has(cur)) { n += 1; cur = addDays(cur, -1); }
  return n;
}
export function weeklySummary(state, today) {
  const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
  const set = activeDates(state);
  return {
    activeDays: days.filter(d => set.has(d)).length,
    wordsLearned: Object.values(state.items).filter(it => it.kind === 'word' && days.includes(it.firstLearned)).length,
    grammarLearned: Object.values(state.items).filter(it => it.kind === 'grammar' && days.includes(it.firstLearned)).length,
    reviews: (state.history || []).filter(h => days.includes(h.date) && (h.action === 'review-right' || h.action === 'review-wrong')).length,
  };
}

// The single recommended next action for the Today page.
export function nextAction(state, day, today) {
  const entries = dueEntries(state, today);
  const overdue = entries.filter(e => e.group === 'overdue');
  if (overdue.length) return { view: 'review', label: `Ôn bù ${overdue.length} mục quá hạn`, reason: 'Ưu tiên cao nhất: nhiệm vụ quá hạn không tự biến mất.' };
  const p = dayProgress(state, today);
  if (day.wordIds.length && p.wordsDone < p.wordsTotal) return { view: 'words', label: `Học tiếp từ vựng (${p.wordsDone}/${p.wordsTotal})`, reason: `Hoàn thành ${p.wordsTotal} từ mới của hôm nay.` };
  if (day.grammarLessonId && day.grammarStatus !== 'done') return { view: 'grammar', label: 'Học bài ngữ pháp hôm nay', reason: 'Một bài ngữ pháp mới đang chờ.' };
  if (entries.length) return { view: 'review', label: `Ôn tập ${entries.length} mục đến hạn`, reason: 'Giữ nhịp ôn cách quãng 1–3–7–14–60.' };
  if (!day.wordIds.length && !day.grammarLessonId) return { view: 'review', label: 'Ôn lại nội dung cũ', reason: 'Chương trình chính đã hoàn thành — ôn tập để giữ trí nhớ.' };
  return { view: 'stats', label: 'Xem tổng kết hôm nay', reason: 'Bạn đã hoàn thành mọi nhiệm vụ hôm nay. 🎉' };
}

export const DEFAULT_SCHEDULES = {
  day: [
    { id: 'd1', time: 'Linh hoạt tại công ty', title: 'Ôn từ và ngữ pháp cũ', minutes: 10 },
    { id: 'd2', time: 'Linh hoạt tại công ty', title: 'Học từ mới', minutes: 25 },
    { id: 'd3', time: 'Linh hoạt tại công ty', title: 'Kiểm tra từ mới', minutes: 15 },
    { id: 'd4', time: 'Linh hoạt tại công ty', title: 'Ôn nhanh kiến thức đến hạn', minutes: 10 },
    { id: 'd5', time: '22:00–22:40', title: 'Học ngữ pháp mới', minutes: 40 },
    { id: 'd6', time: '22:40–23:10', title: 'Làm bài tập ngữ pháp', minutes: 30 },
    { id: 'd7', time: '23:10–23:40', title: 'Nghe và đọc hội thoại', minutes: 30 },
    { id: 'd8', time: '23:40–00:00', title: 'Kiểm tra tổng hợp', minutes: 20 },
  ],
  night: [
    { id: 'n1', time: '09:00–09:15', title: 'Ôn tập bài cũ', minutes: 15 },
    { id: 'n2', time: '09:15–09:45', title: 'Học từ mới', minutes: 30 },
    { id: 'n3', time: '09:45–10:00', title: 'Kiểm tra từ mới', minutes: 15 },
    { id: 'n4', time: '14:00–16:00', title: 'Đi học (không xếp nhiệm vụ)', minutes: 120 },
    { id: 'n5', time: 'Buổi tối · 40 phút', title: 'Học ngữ pháp', minutes: 40 },
    { id: 'n6', time: 'Buổi tối · 20 phút', title: 'Làm bài tập', minutes: 20 },
    { id: 'n7', time: 'Buổi tối · 20 phút', title: 'Đọc và nghe hội thoại', minutes: 20 },
    { id: 'n8', time: 'Buổi tối · 10 phút', title: 'Kiểm tra tổng hợp', minutes: 10 },
  ],
};
