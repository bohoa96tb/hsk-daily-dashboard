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
  };
}

export function createItem(kind, id, firstLearned) {
  return {
    key: `${kind}:${id}`, kind, id, firstLearned,
    nextStage: 0, completedStages: [],
    correct: 0, wrong: 0, weak: false,
    due: addDays(firstLearned, SRS_INTERVALS[0]),
    extraDue: null, mastered: false, lastReview: null,
    quizCorrect: 0, quizWrong: 0, checkHistory: [],
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
    it.lastReview = { date: today, stage: it.nextStage, correct: false };
    return { item: it, changed: true, reason: 'wrong-extra-scheduled' };
  }
  it.correct += 1;
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
  const it = { ...item };
  if (correct) { it.correct += 1; it.extraDue = null; if (it.correct > it.wrong) it.weak = false; }
  else { it.wrong += 1; it.weak = true; it.extraDue = addDays(today, 1); }
  return it;
}

// Due ENTRIES for a date. Each entry carries an explicit review type:
// 'regular' (scheduled SRS stage) or 'extra' (supplementary weak review).
// An item may legitimately produce TWO entries on the same day (one of each
// type) — they are distinct tasks and are never merged or confused.
// Priority: overdue regular > frequently-wrong due today > regular due today > extra.
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
  const rank = e => e.type === 'extra' ? 3 : e.group === 'overdue' ? 0 : (e.item.weak || e.item.wrong + (e.item.quizWrong || 0) > e.item.correct + (e.item.quizCorrect || 0)) ? 1 : 2;
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
  const correct = item ? item.correct + (item.quizCorrect || 0) : 0, wrong = item ? item.wrong + (item.quizWrong || 0) : 0;
  if (item && item.mastered) return 'mastered60';
  if (item && item.weak) return 'weak';
  if (wrong > correct && wrong > 0) return 'weak';
  if (item && item.completedStages.length >= 2 && correct >= 2 && correct / Math.max(1, correct + wrong) >= 0.8) return 'good';
  if (item && (item.completedStages.length > 0 || correct + wrong > 0)) return 'learning';
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
  const s = { total: 0, done: 0, learning: 0, due: 0, weak: 0 };
  for (const it of Object.values(state.items)) {
    if (it.kind !== 'grammar') continue;
    s.total += 1;
    if (it.mastered) s.done += 1; else s.learning += 1;
    if (it.weak) s.weak += 1;
  }
  return s;
}

// Day completion %: vocab words checked + grammar done + due reviews done today, weighted equally by task counts.
export function dayProgress(state, dateKey) {
  const day = state.days[dateKey];
  if (!day) return { pct: 0, wordsDone: 0, wordsTotal: 0, grammarDone: false, reviewsDone: 0, reviewsTotal: 0 };
  const wordsTotal = (day.wordIds || []).length;
  const wordsDone = Object.values(day.wordChecks || {}).filter(c => c && (c.self || c.quiz)).length;
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
  out.curriculum.vocabIndex = Math.max(out.curriculum.vocabIndex || 0, imported.curriculum?.vocabIndex || 0);
  out.curriculum.grammarIndex = Math.max(out.curriculum.grammarIndex || 0, imported.curriculum?.grammarIndex || 0);
  for (const [date, day] of Object.entries(imported.days || {})) {
    if (!out.days[date]) { out.days[date] = day; continue; }
    const cur = out.days[date];
    cur.wordChecks = { ...(day.wordChecks || {}), ...(cur.wordChecks || {}) };
    if ((day.reviewsDone || 0) > (cur.reviewsDone || 0)) cur.reviewsDone = day.reviewsDone;
    if (day.grammarStatus === 'done') cur.grammarStatus = 'done';
  }
  for (const [key, it] of Object.entries(imported.items || {})) {
    const cur = out.items[key];
    if (!cur) { out.items[key] = it; continue; }
    if ((it.correct + it.wrong) > (cur.correct + cur.wrong)) out.items[key] = it;
  }
  const seen = new Set(out.history.map(h => `${h.date}|${h.action}|${h.detail}`));
  for (const h of imported.history || []) {
    const k = `${h.date}|${h.action}|${h.detail}`;
    if (!seen.has(k)) { out.history.push(h); seen.add(k); }
  }
  return out;
}


// Record a vocabulary quiz result. Self-marks and quiz results are separate:
// every quiz attempt updates the SRS item immediately when it exists
// (wrong -> weak + supplementary review tomorrow; history is kept),
// and is also stored on the day so finalize can build the item from all attempts.
export function recordQuiz(state, day, wordId, correct, today) {
  const chk = { ...(day.wordChecks[wordId] || {}) };
  chk.quiz = { correct, at: today };
  chk.quizHistory = [...(chk.quizHistory || []), { correct, at: today }];
  day.wordChecks[wordId] = chk;
  const item = state.items[`word:${wordId}`];
  if (!item || item.mastered) return item || null;
  const it = { ...item, checkHistory: [...(item.checkHistory || [])] };
  it.checkHistory.push({ date: today, kind: 'quiz', correct });
  if (correct) {
    it.quizCorrect = (it.quizCorrect || 0) + 1;
    if (it.weak && !it.extraDue && it.quizCorrect + it.correct > it.quizWrong + it.wrong) it.weak = false;
  } else {
    it.quizWrong = (it.quizWrong || 0) + 1;
    it.weak = true;
    if (!it.extraDue) it.extraDue = addDays(today, 1);
  }
  state.items[it.key] = it;
  return it;
}

// Build an SRS word item from a finished day, folding in ALL quiz attempts.
export function buildWordItem(day, wordId, today) {
  const it = createItem('word', wordId, today);
  const chk = day.wordChecks[wordId] || {};
  for (const q of chk.quizHistory || (chk.quiz ? [chk.quiz] : [])) {
    it.checkHistory.push({ date: q.at || today, kind: 'quiz', correct: q.correct });
    if (q.correct) it.quizCorrect += 1; else it.quizWrong += 1;
  }
  if (it.quizWrong > 0 || chk.self === 'weak') { it.weak = true; it.extraDue = addDays(today, 1); }
  return it;
}

// Curriculum completion: advancing past the last lesson sets a done flag
// instead of clamping back onto the last lesson.
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
  if (!s || s.version !== DATA_VERSION) return s;
  s.curriculum = { vocabDone: false, grammarDone: false, vocabSeen: 0, grammarSeen: 0, ...s.curriculum };
  for (const it of Object.values(s.items || {})) {
    if (it.quizCorrect === undefined) it.quizCorrect = 0;
    if (it.quizWrong === undefined) it.quizWrong = 0;
    if (!Array.isArray(it.checkHistory)) it.checkHistory = [];
  }
  for (const day of Object.values(s.days || {})) {
    for (const chk of Object.values(day.wordChecks || {})) {
      if (chk && chk.quiz && !chk.quizHistory) chk.quizHistory = [chk.quiz];
    }
  }
  s.appVersion = '1.1';
  return s;
}

export function validateBackup(data) {
  if (!data || data.app !== 'hsk-daily-dashboard') throw new Error('File không phải bản sao lưu của HSK Daily Dashboard.');
  if (data.version !== DATA_VERSION || !data.state || typeof data.state !== 'object') throw new Error('Phiên bản sao lưu không tương thích.');
  if (!data.state.days || !data.state.items || !data.state.curriculum) throw new Error('File sao lưu thiếu dữ liệu tiến độ.');
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
  for (const h of state.history || []) set.add(h.date);
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
  if (day.wordIds.length && p.wordsDone < p.wordsTotal) return { view: 'words', label: `Học tiếp từ vựng (${p.wordsDone}/${p.wordsTotal})`, reason: 'Hoàn thành 24 từ mới của hôm nay.' };
  if (day.grammarLessonId && day.grammarStatus !== 'done') return { view: 'grammar', label: 'Học bài ngữ pháp hôm nay', reason: 'Một bài ngữ pháp mới đang chờ.' };
  if (entries.length) return { view: 'review', label: `Ôn tập ${entries.length} mục đến hạn`, reason: 'Giữ nhịp ôn cách quãng 1–3–7–14–60.' };
  if (!day.wordIds.length && !day.grammarLessonId) return { view: 'review', label: 'Ôn lại nội dung cũ', reason: 'Chương trình chính đã hoàn thành — ôn tập để giữ trí nhớ.' };
  return { view: 'stats', label: 'Xem tổng kết hôm nay', reason: 'Bạn đã hoàn thành mọi nhiệm vụ hôm nay. 🎉' };
}

export const DEFAULT_SCHEDULES = {
  day: [
    { id: 'd1', time: 'Linh hoạt tại công ty', title: 'Ôn từ và ngữ pháp cũ', minutes: 10 },
    { id: 'd2', time: 'Linh hoạt tại công ty', title: 'Học 24 từ mới', minutes: 25 },
    { id: 'd3', time: 'Linh hoạt tại công ty', title: 'Kiểm tra từ mới', minutes: 15 },
    { id: 'd4', time: 'Linh hoạt tại công ty', title: 'Ôn nhanh kiến thức đến hạn', minutes: 10 },
    { id: 'd5', time: '22:00–22:40', title: 'Học ngữ pháp mới', minutes: 40 },
    { id: 'd6', time: '22:40–23:10', title: 'Làm bài tập ngữ pháp', minutes: 30 },
    { id: 'd7', time: '23:10–23:40', title: 'Nghe và đọc hội thoại', minutes: 30 },
    { id: 'd8', time: '23:40–00:00', title: 'Kiểm tra tổng hợp', minutes: 20 },
  ],
  night: [
    { id: 'n1', time: '09:00–09:15', title: 'Ôn tập bài cũ', minutes: 15 },
    { id: 'n2', time: '09:15–09:45', title: 'Học 24 từ mới', minutes: 30 },
    { id: 'n3', time: '09:45–10:00', title: 'Kiểm tra từ mới', minutes: 15 },
    { id: 'n4', time: '14:00–16:00', title: 'Đi học (không xếp nhiệm vụ)', minutes: 120 },
    { id: 'n5', time: 'Buổi tối · 40 phút', title: 'Học ngữ pháp', minutes: 40 },
    { id: 'n6', time: 'Buổi tối · 20 phút', title: 'Làm bài tập', minutes: 20 },
    { id: 'n7', time: 'Buổi tối · 20 phút', title: 'Đọc và nghe hội thoại', minutes: 20 },
    { id: 'n8', time: 'Buổi tối · 10 phút', title: 'Kiểm tra tổng hợp', minutes: 10 },
  ],
};
