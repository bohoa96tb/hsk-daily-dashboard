// Data adapters: read public JSON from the two existing sites. Nothing is written back to them.
// GitHub Pages serves Access-Control-Allow-Origin: *, and all three sites share the
// bohoa96tb.github.io origin, so fetches work directly. Slim indexes are cached in
// localStorage so daily use does not re-download ~9.6 MB of source JSON.
export const VOCAB_JSON = 'https://bohoa96tb.github.io/hazi-viet/data/vocabulary/hanzii-course.json';
export const GRAMMAR_JSON = 'https://bohoa96tb.github.io/HSK3.0/data/content.json';
export const VOCAB_WORD_URL = id => `https://bohoa96tb.github.io/hazi-viet/vocabulary.html?word=${encodeURIComponent(id)}`;
export const GRAMMAR_LESSON_URL = id => `https://bohoa96tb.github.io/HSK3.0/#/lesson/${encodeURIComponent(id)}`;

const CACHE_V = 'hsk-daily.cache.vocab-v2';
const CACHE_G = 'hsk-daily.cache.grammar-v2';

function cacheGet(k) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && v.slim ? v : null; } catch { return null; } }
function cacheSet(k, slim) { try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), slim })); } catch { /* cache is optional */ } }

export function slimVocab(raw) {
  if (!raw || raw.schemaVersion !== 2 || !Array.isArray(raw.words) || !Array.isArray(raw.lessons)) throw new Error('Dữ liệu từ vựng không đúng phiên bản.');
  const words = {};
  for (const w of raw.words) {
    words[w.id] = { id: w.id, hanzi: w.hanzi, pinyin: (w.intro && w.intro[0] && w.intro[0].pinyin) || '', meaning: w.meaning || '', level: w.level, status: w.status };
  }
  const lessons = raw.lessons.map(l => ({ id: l.id, level: l.level, number: l.number, title: l.title, wordIds: [...l.wordIds] }));
  return { lessons, words };
}

export function slimGrammar(raw) {
  if (!raw || !Array.isArray(raw.lessons)) throw new Error('Dữ liệu ngữ pháp không đúng định dạng.');
  const contents = {};
  const add = c => { if (c && c.lessonId) contents[c.lessonId] = c; };
  add(raw.pilot); (raw.additionalLessons || []).forEach(add);
  const lessons = [];
  for (const l of raw.lessons) {
    if (l.publicationStatus !== 'pilot-ready' || !contents[l.id]) continue; // only lessons with real content, in curriculum order
    const c = contents[l.id];
    lessons.push({
      id: l.id, level: l.level, number: l.lessonNumber, titleVi: l.titleVi, titleZh: l.titleZh,
      note: l.publicationNote || '',
      goal: (c.intro && c.intro.goalVi) || '',
      outcomes: (c.intro && c.intro.outcomesVi) || [],
      minutes: (c.intro && c.intro.estimatedMinutes) || null,
      points: (c.knowledgePoints || []).map(k => ({
        id: k.id, title: k.title, explanationVi: k.explanationVi || '', pattern: k.pattern || '',
        example: (k.examples && k.examples[0]) ? { zh: k.examples[0].zh, pinyin: k.examples[0].pinyin || '', noteVi: k.examples[0].noteVi || '' } : null,
      })),
    });
  }
  return { lessons, contentVersion: raw.contentVersion || '' };
}

export async function loadVocab(force = false) {
  if (!force) { const c = cacheGet(CACHE_V); if (c && Date.now() - c.at < 24 * 3600 * 1000) return { ...c.slim, fromCache: true }; }
  try {
    const r = await fetch(VOCAB_JSON);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const slim = slimVocab(await r.json());
    cacheSet(CACHE_V, slim);
    return { ...slim, fromCache: false };
  } catch (e) {
    const c = cacheGet(CACHE_V); // stale cache is better than a dead app (offline)
    if (c) return { ...c.slim, fromCache: true, stale: true };
    throw new Error('Không tải được dữ liệu từ vựng và chưa có bản lưu tạm.');
  }
}
export async function loadGrammar(force = false) {
  if (!force) { const c = cacheGet(CACHE_G); if (c && Date.now() - c.at < 24 * 3600 * 1000) return { ...c.slim, fromCache: true }; }
  try {
    const r = await fetch(GRAMMAR_JSON);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const slim = slimGrammar(await r.json());
    cacheSet(CACHE_G, slim);
    return { ...slim, fromCache: false };
  } catch (e) {
    const c = cacheGet(CACHE_G);
    if (c) return { ...c.slim, fromCache: true, stale: true };
    throw new Error('Không tải được dữ liệu ngữ pháp và chưa có bản lưu tạm.');
  }
}

// Read-only peek at the two apps' own progress (same origin localStorage).
// The Dashboard NEVER writes these keys; this is display-only reference info.
export function peekExternalProgress() {
  const out = {};
  try {
    const v = JSON.parse(localStorage.getItem('hanzi-viet-vocabulary-v1') || 'null');
    if (v && v.cards) out.vocab = { learned: Object.values(v.cards).filter(c => c.learned).length, total: Object.keys(v.cards).length };
  } catch { /* ignore */ }
  try {
    const g = JSON.parse(localStorage.getItem('hsk30.progress.v1') || 'null');
    if (g && g.lessons) out.grammar = { lessonsTouched: Object.keys(g.lessons).length, sectionsDone: Object.values(g.lessons).reduce((s, l) => s + ((l.completedSections || []).length), 0) };
  } catch { /* ignore */ }
  return out;
}
