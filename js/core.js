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
    curriculum: { vocabIndex: 0, grammarIndex: 0 },
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
    it.due = diffDays(today, anchored) < 0 ? today : anchored; // late completion: next stage due immediately, never duplicated
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

// Due lists for a date: grouped by stage name, plus overdue and extra. No item appears twice.
export function dueGroups(state, today) {
  const groups = { R1: [], R3: [], R7: [], R14: [], R60: [], overdue: [], extra: [] };
  const seen = new Set();
  for (const it of Object.values(state.items)) {
    if (it.mastered) continue;
    if (it.extraDue && diffDays(it.extraDue, today) >= 0 && !seen.has(it.key)) { groups.extra.push(it); seen.add(it.key); continue; }
    if (!it.due) continue;
    const late = diffDays(it.due, today);
    if (late < 0) continue;
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    if (late > 0) groups.overdue.push(it);
    else groups[SRS_NAMES[it.nextStage]].push(it);
  }
  return groups;
}
export function dueCount(state, today) {
  const g = dueGroups(state, today);
  return Object.values(g).reduce((s, a) => s + a.length, 0);
}

// Memory classification is based on real check results, never on self-mark alone.
export function classifyWord(item, dayChecks) {
  if (!item && !dayChecks) return 'new';
  const correct = item ? item.correct : 0, wrong = item ? item.wrong : 0;
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
