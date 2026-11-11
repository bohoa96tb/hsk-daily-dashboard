import * as Core from './core.js?v=6';
import { loadState, saveState, loadSettings, saveSettings, exportJson } from './store.js?v=6';
import { loadVocab, loadGrammar, VOCAB_WORD_URL, GRAMMAR_LESSON_URL, peekExternalProgress } from './data.js?v=6';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = Core.todayKeyJST();

let state, vocab, grammar, view = 'today';
let settings = Object.assign({ shift: 'day', weekdayShifts: {}, shiftOverrides: {}, schedules: null, loadMode: 'standard' }, loadSettings());
const LOAD_MODES = { light: { label: 'Nhẹ', quiz: 10, review: 5, target: 8 }, standard: { label: 'Tiêu chuẩn', quiz: 20, review: 10, target: 24 }, focused: { label: 'Tập trung', quiz: 30, review: 20, target: 24 } };
const loadMode = () => LOAD_MODES[settings.loadMode] || LOAD_MODES.standard;
if (!settings.schedules) settings.schedules = JSON.parse(JSON.stringify(Core.DEFAULT_SCHEDULES));

function warn(msg) { const b = $('#warn'); b.textContent = msg; b.hidden = !msg; if (msg) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
async function persist() { await saveState(state, warn); saveSettings(settings); }
function shiftOf(dateKey) {
  if (settings.shiftOverrides[dateKey]) return settings.shiftOverrides[dateKey];
  const [y, m, d] = dateKey.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return settings.weekdayShifts[wd] || settings.shift;
}
function tagZh(root) { (root || document).querySelectorAll('.zh').forEach(el => el.setAttribute('lang', 'zh-CN')); }
function speak(text) {
  if (!('speechSynthesis' in window)) { warn('Thiết bị không hỗ trợ giọng đọc.'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 0.85;
  const v = speechSynthesis.getVoices().find(v => /^zh[-_]CN/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^zh/i.test(v.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

function ensureDay() {
  let day = state.days[today];
  if (day) return day;
  const vl = state.curriculum.vocabDone ? null : vocab.lessons[state.curriculum.vocabIndex] || null;
  const gl = state.curriculum.grammarDone ? null : grammar.lessons[state.curriculum.grammarIndex] || null;
  const off = state.curriculum.vocabOffset || 0;
  const slice = vl ? vl.wordIds.slice(off, off + loadMode().target) : [];
  day = {
    date: today, vocabLessonId: vl ? vl.id : null, wordIds: slice, loadTarget: slice.length,
    grammarChecks: {}, grammarWeakKps: [],
    grammarLessonId: gl ? gl.id : null, wordChecks: {}, grammarStatus: 'not',
    tasksDone: {}, reviewTotal: Core.dueCount(state, today), reviewsDone: 0,
    vocabFinalized: false, grammarFinalized: false,
  };
  state.days[today] = day;
  return day;
}
function log(action, detail) { state.history.push({ date: today, action, detail }); if (state.history.length > 500) state.history = state.history.slice(-500); }

async function finalizeVocabIfDone(day) {
  const done = day.wordIds.filter(id => day.wordChecks[id] && (day.wordChecks[id].self || day.wordChecks[id].quiz)).length;
  if (done === day.wordIds.length && day.wordIds.length && !day.vocabFinalized) {
    for (const id of day.wordIds) {
      const key = `word:${id}`;
      if (!state.items[key]) state.items[key] = Core.buildWordItem(day, id, today);
    }
    day.vocabFinalized = true;
    const lesson = vocab.lessons.find(l => l.id === day.vocabLessonId);
    state.curriculum.vocabOffset = (state.curriculum.vocabOffset || 0) + day.wordIds.length;
    if (!lesson || state.curriculum.vocabOffset >= lesson.wordIds.length) { state.curriculum.vocabOffset = 0; Core.advanceVocab(state, vocab.lessons.length); }
    log('vocab-complete', day.vocabLessonId);
  }
}
async function finalizeGrammarIfDone(day) {
  if (day.grammarStatus === 'done' && !day.grammarFinalized && day.grammarLessonId) {
    const key = `grammar:${day.grammarLessonId}`;
    if (!state.items[key]) state.items[key] = Core.createItem('grammar', day.grammarLessonId, today);
    if ((day.grammarWeakKps || []).length) { const it = state.items[key]; it.kpWeak = [...new Set([...(it.kpWeak || []), ...day.grammarWeakKps])]; if (it.kpWeak.length) it.weak = true; }
    day.grammarFinalized = true;
    Core.advanceGrammar(state, grammar.lessons.length);
    log('grammar-complete', day.grammarLessonId);
  }
}

/* ---------- views ---------- */
function header(title, sub) { return `<header class="page-head"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</header>`; }

function viewToday() {
  const day = ensureDay();
  const p = Core.dayProgress(state, today);
  const groups = Core.dueGroups(state, today);
  const dueN = Core.dueCount(state, today);
  const vl = vocab.lessons.find(l => l.id === day.vocabLessonId);
  const gl = grammar.lessons.find(l => l.id === day.grammarLessonId);
  const shift = shiftOf(today);
  const blocks = settings.schedules[shift] || [];
  const totalMin = blocks.filter(b => !/không xếp/.test(b.title)).reduce((s, b) => s + (b.minutes || 0), 0);
  const niceDate = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Tokyo', weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date());
  const na = Core.nextAction(state, day, today);
  const streak = Core.streakDays(state, today);
  const estMin = Math.max(0, Math.round((p.wordsTotal - p.wordsDone) * 0.6 + (day.grammarStatus === 'done' ? 0 : 20) + Core.dueCount(state, today) * 0.5));
  const entriesToday = Core.dueEntries(state, today);
  const overdueN = entriesToday.filter(e => e.group === 'overdue').length;
  $('#view').innerHTML = `
  ${header('Học tập hôm nay', `${niceDate} · Giờ Nhật Bản (JST)`)}
  <section class="card next-action"><h2>▶ Việc tiếp theo</h2><p class="next-label">${esc(na.label)}</p><p class="muted">${esc(na.reason)}</p>
  <button class="btn primary block" data-go="${na.view}">Làm ngay →</button></section>
  <section class="card overview">
    <div class="row between"><strong>${shift === 'day' ? '☀️ Ca ngày' : '🌙 Ca tối'}</strong>
    <button class="btn small" id="flipShift">${shift === 'day' ? 'Đổi sang ca tối' : 'Đổi sang ca ngày'}</button></div>
    <div class="progress"><div style="width:${p.pct}%"></div></div>
    <p class="big-pct">${p.pct}% hoàn thành hôm nay</p>
    <div class="grid3">
      <div><strong>${p.wordsDone}/${p.wordsTotal}</strong><span>từ mới</span></div>
      <div><strong>${day.grammarStatus === 'done' ? '✓' : '1'}</strong><span>bài ngữ pháp</span></div>
      <div><strong>${dueN}</strong><span>lượt ôn đến hạn</span></div>
    </div>
    <p class="muted">Mục tiêu học: khoảng ${totalMin} phút theo lịch · Dự kiến phần còn lại hôm nay: khoảng ${estMin} phút (ước tính theo số nhiệm vụ, không phải đo thời gian thật).</p>
    ${streak > 1 ? `<p>🔥 Chuỗi học ${streak} ngày liên tục — giữ nhịp nhé!</p>` : ''}
  </section>
  <section class="card"><h2>Lịch học hôm nay</h2>
    ${blocks.map(b => `<label class="task"><input type="checkbox" data-task="${esc(b.id)}" ${day.tasksDone[b.id] ? 'checked' : ''}><span class="task-time">${esc(b.time)}</span><span class="grow">${esc(b.title)}</span><span class="muted">${b.minutes}′</span></label>`).join('')}
  </section>
  ${state.curriculum.vocabDone && state.curriculum.grammarDone ? `<section class="card done-all"><h2>🎉 Hoàn thành chương trình!</h2><p>Bạn đã học hết ${vocab.lessons.length} bài từ vựng và ${grammar.lessons.length} bài ngữ pháp đang có. Hãy tiếp tục ôn tập để giữ trí nhớ — khi có bài mới, Dashboard sẽ tự giao tiếp.</p><button class="btn primary block" data-go="review">Ôn lại nội dung cũ →</button></section>` : ''}
  <section class="card"><h2>${vl ? `${day.wordIds.length} từ mới · HSK ${vl.level} Bài ${vl.number}` : 'Từ mới hôm nay'}</h2>
    <p class="muted">${vl ? esc(vl.title) : ''} · Đã kiểm tra ${p.wordsDone}/${p.wordsTotal} từ</p>
    <button class="btn block" data-go="words">Học từ mới →</button>
    ${vl ? `<a class="btn block ghost" target="_blank" rel="noopener" href="${esc(VOCAB_WORD_URL(day.wordIds[0]))}">Mở bài gốc trên Hazi-Viet ↗</a>` : ''}
  </section>
  <section class="card"><h2>Bài ngữ pháp mới</h2>
    ${gl ? `<p><span class="zh">${esc(gl.titleZh)}</span><br>${esc(gl.titleVi)} · HSK ${gl.level.replace('HSK ', '')} Bài ${gl.number}</p><p class="muted">${esc(gl.goal || gl.note || '')}</p>` : '<p>Chưa có dữ liệu.</p>'}
    <button class="btn block" data-go="grammar">Học bài ngữ pháp →</button>
    ${gl ? `<a class="btn block ghost" target="_blank" rel="noopener" href="${esc(GRAMMAR_LESSON_URL(gl.id))}">Mở bài gốc trên HSK3.0 ↗</a>` : ''}
  </section>
  <section class="card"><h2>Hôm nay cần ôn</h2>
    ${dueN === 0 ? '<p class="muted">Không có mục nào đến hạn. 🎉</p>' : `
    <div class="chips">${Object.entries(groups).filter(([, a]) => a.length).map(([k, a]) => `<span class="chip ${k === 'overdue' ? 'overdue' : ''}">${k === 'overdue' ? '⚠ Quá hạn' : k === 'extra' ? 'Ôn bổ sung' : 'Ôn sau ' + k.slice(1) + ' ngày'}: ${a.length}</span>`).join('')}</div>
    <button class="btn block" data-go="review">Bắt đầu ôn tập →</button>`}
  </section>
  ${p.pct === 100 ? `<section class="card done-all"><h2>🎉 Tổng kết hôm nay — hoàn thành 100%!</h2>
    <p>Từ mới: <strong>${p.wordsDone}/${p.wordsTotal}</strong> · Ngữ pháp: <strong>Đã hoàn thành ✓</strong> · Ôn tập: <strong>${day.reviewsDone || 0} lượt</strong>. Hẹn gặp lại ngày mai — các mốc ôn đã được lên lịch sẵn.</p></section>` : ''}`;
  $('#flipShift').onclick = async () => { settings.shiftOverrides[today] = shiftOf(today) === 'day' ? 'night' : 'day'; await persist(); render(); };
  document.querySelectorAll('[data-task]').forEach(cb => cb.onchange = async () => { day.tasksDone[cb.dataset.task] = cb.checked; await persist(); });
  bindGo();
}
function bindGo() { document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { view = b.dataset.go; render(); }); }

function wordCard(id, idx) {
  const w = vocab.words[id]; if (!w) return '';
  const chk = (ensureDay().wordChecks[id]) || {};
  const hard = state.wordFlags && state.wordFlags[id] && state.wordFlags[id].hard;
  return `<article class="word ${chk.self === 'known' ? 'ok' : chk.self === 'weak' ? 'weak' : chk.self ? 'seen' : ''} ${chk.quiz ? 'done' : ''}" data-card="${id}">
    <div class="row"><span class="zh big">${esc(w.hanzi)}</span><button class="icon-btn" data-hard="${id}" aria-label="Gắn cờ từ khó" title="Gắn cờ từ khó">${hard ? '⚑' : '⚐'}</button><button class="icon-btn" data-speak="${esc(w.hanzi)}" aria-label="Nghe phát âm">🔊</button>
    <a class="icon-btn" target="_blank" rel="noopener" href="${esc(VOCAB_WORD_URL(id))}" aria-label="Mở trên Hazi-Viet">↗</a></div>
    <p class="pinyin">${esc(w.pinyin)}</p><p>${esc(w.meaning)}</p>
    ${w.example ? `<details class="wex"><summary>Ví dụ trong câu</summary><p class="zh">${esc(w.example.zh)}</p>${w.example.pinyin ? `<p class="pinyin">${esc(w.example.pinyin)}</p>` : ''}<p>${esc(w.example.vi)}</p></details>` : ''}
    ${chk.quiz ? `<p class="muted">Kiểm tra: ${chk.quiz.correct ? '✓ Đúng' : '✗ Sai'} · ${(chk.quizHistory || []).length} lần</p>` : ''}
    <div class="row mark">
      <button class="btn small ${chk.self === 'known' ? 'primary' : ''}" data-self="${id}:known">Đã nhớ</button>
      <button class="btn small ${chk.self === 'unknown' ? 'primary' : ''}" data-self="${id}:unknown">Chưa nhớ</button>
      <button class="btn small ${chk.self === 'weak' ? 'primary' : ''}" data-self="${id}:weak">Còn yếu</button>
    </div></article>`;
}
function viewWords() {
  const day = ensureDay();
  const groups = []; for (let i = 0; i < day.wordIds.length; i += 8) groups.push(day.wordIds.slice(i, i + 8));
  $('#view').innerHTML = `${header(`Học ${day.wordIds.length} từ mới`, `Chia nhóm 8 từ · đúng thứ tự gốc của Hazi-Viet${state.curriculum.vocabOffset ? ' · phần tiếp theo của bài' : ''}`)}
  ${groups.map((ids, g) => `<section class="card"><h2>Nhóm ${g + 1}</h2>${ids.map((id, i) => wordCard(id, g * 8 + i)).join('')}</section>`).join('')}
  <section class="card"><h2>Kiểm tra từ vựng</h2>
  <p class="muted">Kết quả kiểm tra thật quyết định thống kê trí nhớ và từ yếu — nút tự đánh dấu một mình không tính là nhớ tốt. Làm lại bao nhiêu lần cũng được, mọi lần đều được ghi.</p>
  <label>Nhóm từ<select id="quizPool">
    <option value="today">Từ hôm nay</option>
    <option value="hard">Từ khó đã gắn cờ ⚑</option>
    <option value="new">Từ mới (chưa có kết quả kiểm tra)</option>
    <option value="wrong">Từ đã trả lời sai</option>
    <option value="weak">Từ yếu / cần củng cố</option>
    <option value="mastered">Từ đã thành thạo</option>
    <option value="learned">Tất cả từ đã học</option>
  </select></label>
  <label>Dạng kiểm tra<select id="quizType">
    <option value="mixed">Trộn cả 4 dạng</option>
    <option value="h2m">Hán tự → chọn nghĩa</option>
    <option value="m2h">Nghĩa → chọn Hán tự</option>
    <option value="l2h">Nghe → chọn từ đúng</option>
    <option value="h2p">Hán tự → chọn Pinyin</option>
    <option value="recall">Tự nhớ trước (không trắc nghiệm)</option>
  </select></label>
  <div id="quiz"></div><button class="btn primary block" id="startQuiz">Bắt đầu kiểm tra</button></section>`;
  document.querySelectorAll('[data-speak]').forEach(b => b.onclick = () => speak(b.dataset.speak));
  document.querySelectorAll('[data-self]').forEach(b => b.onclick = async () => {
    const [id, val] = b.dataset.self.split(':'); const day2 = ensureDay();
    day2.wordChecks[id] = { ...(day2.wordChecks[id] || {}), self: val };
    const wasFinal = day2.vocabFinalized;
    await finalizeVocabIfDone(day2); await persist();
    if (day2.vocabFinalized && !wasFinal) { render(); return; } // U1: update in place, keep scroll & focus
    const card = document.querySelector(`[data-card="${id}"]`);
    if (card) card.querySelectorAll('[data-self]').forEach(x => x.classList.toggle('primary', x.dataset.self === `${id}:${val}`));
  });
  document.querySelectorAll('[data-hard]').forEach(b => b.onclick = async () => {
    const id = b.dataset.hard;
    state.wordFlags = state.wordFlags || {};
    const on = !(state.wordFlags[id] && state.wordFlags[id].hard);
    state.wordFlags[id] = { hard: on };
    b.textContent = on ? '⚑' : '⚐';
    await persist();
  });
  $('#startQuiz').onclick = () => runQuiz($('#quizPool').value, $('#quizType').value);
}
const QUIZ_TYPES = ['h2m', 'm2h', 'l2h', 'h2p', 'recall'];
function quizPoolIds(pool, day) {
  const items = state.items;
  switch (pool) {
    case 'today': return [...day.wordIds];
    case 'new': return day.wordIds.filter(id => { const c = day.wordChecks[id]; return !(c && c.quiz); });
    case 'wrong': return Object.values(items).filter(i => i.kind === 'word' && (i.quizWrong || 0) > (i.quizCorrect || 0)).map(i => i.id);
    case 'weak': return Object.values(items).filter(i => i.kind === 'word' && Core.classifyWord(i) === 'weak').map(i => i.id);
    case 'mastered': return Object.values(items).filter(i => i.kind === 'word' && (Core.classifyWord(i) === 'good' || Core.classifyWord(i) === 'mastered60')).map(i => i.id);
    case 'hard': return Object.keys(state.wordFlags || {}).filter(id => state.wordFlags[id].hard && vocab.words[id]);
    case 'learned': return Object.values(items).filter(i => i.kind === 'word').map(i => i.id);
    default: return [...day.wordIds];
  }
}
function buildQuestion(id, type) {
  const w = vocab.words[id]; if (!w) return null;
  if (type === 'h2p' && (w.readings || []).length > 1) type = 'h2m'; // multi-reading words: pinyin question would be unfair
  const field = type === 'h2m' ? 'meaning' : type === 'h2p' ? 'pinyin' : 'hanzi';
  // Distractor quality: same lesson first, then same level, then the rest;
  // for pinyin questions prefer the same initial sound (harder to eliminate).
  const lesson = vocab.lessons.find(l => l.wordIds.includes(id));
  const sameLesson = lesson ? lesson.wordIds.filter(x => x !== id).map(x => vocab.words[x]) : [];
  const sameLevel = Object.values(vocab.words).filter(x => x.id !== id && x.level === w.level && !(lesson && lesson.wordIds.includes(x.id)));
  const rest = Object.values(vocab.words).filter(x => x.id !== id && x.level !== w.level);
  const tiers = [sameLesson, sameLevel, rest].map(t => t.sort(() => Math.random() - 0.5));
  if (type === 'h2p') {
    const ini = x => (x.pinyin || '').replace(/[^a-z]/gi, '').charAt(0);
    tiers.forEach(t => t.sort((x, y) => (ini(y) === ini(w) ? 1 : 0) - (ini(x) === ini(w) ? 1 : 0)));
  }
  const distract = [];
  for (const tier of tiers) for (const x of tier) {
    if (x[field] && x[field] !== w[field] && !distract.some(d => d[field] === x[field])) distract.push(x);
    if (distract.length === 3) break;
  }
  if (distract.length < 3) return null;
  const options = [w, ...distract].sort(() => Math.random() - 0.5);
  return { id, type, w, options, field };
}
function runQuiz(pool, typeSel) {
  const day = ensureDay();
  let ids = quizPoolIds(pool, day).filter(id => vocab.words[id]);
  const box = $('#quiz');
  if (!ids.length) { box.innerHTML = '<p>Nhóm này chưa có từ nào. Hãy chọn nhóm khác.</p>'; return; }
  ids = ids.sort(() => Math.random() - 0.5).slice(0, loadMode().quiz);
  const retry = []; // wrong words come back ONCE at the end, as recall (error loop; not scored)
  let idx = 0;
  const finish = () => { box.innerHTML = `<p>Đã xong lượt kiểm tra (${ids.length} từ). ✓ Kết quả đã được ghi vào thống kê và lịch ôn. Chuyển trang bằng thanh điều hướng bên dưới để xem tiến độ cập nhật.</p>`; };
  const askRecall = (id, isRetry) => {
    const w = vocab.words[id];
    box.innerHTML = `<p class="muted">${isRetry ? 'Ôn lại lỗi sai · ' : ''}Tự nhớ trước · Câu ${idx + 1}/${ids.length + retry.length}</p>
    <p class="center"><span class="zh big">${esc(w.hanzi)}</span> <button class="icon-btn" data-qs aria-label="Nghe phát âm">🔊</button></p>
    <p class="muted center">Hãy tự nhớ nghĩa (và Pinyin) trong đầu trước, rồi mới hiện đáp án.</p>
    <button class="btn primary block" id="revealBtn">Hiện đáp án</button>
    <div id="recallAns"></div>`;
    box.querySelectorAll('[data-qs]').forEach(b => b.onclick = () => speak(w.hanzi));
    tagZh(box);
    $('#revealBtn').onclick = () => {
      $('#recallAns').innerHTML = `<p class="center"><span class="pinyin">${esc(w.pinyin)}</span><br><strong>${esc(w.meaning)}</strong></p>
      ${w.example ? `<p class="muted center"><span class="zh">${esc(w.example.zh)}</span> — ${esc(w.example.vi)}</p>` : ''}
      <p class="muted center">Bạn nhớ đến mức nào?</p>
      <div class="row"><button class="btn grow" data-rl="0">Không nhớ</button><button class="btn grow" data-rl="1">Mơ hồ</button><button class="btn primary grow" data-rl="2">Nhớ rõ</button></div>`;
      box.querySelectorAll('[data-rl]').forEach(b => b.onclick = async () => {
        const level = Number(b.dataset.rl);
        if (isRetry) { /* retry attempts are practice only */ }
        else {
          Core.recordRecall(state, day, id, level, today);
          if (pool === 'today') await finalizeVocabIfDone(day);
          if (level === 0 && !retry.includes(id) && !ids.slice(idx + 1).includes(id)) retry.push(id);
        }
        await persist(); idx++; next();
      });
    };
  };
  const next = () => {
    if (idx >= ids.length) {
      if (retry.length) { const id = retry.shift(); idx = ids.length - 1; return askRecall(id, true); }
      return finish();
    }
    let type = typeSel === 'mixed' ? QUIZ_TYPES[Math.floor(Math.random() * QUIZ_TYPES.length)] : typeSel;
    if (type === 'recall') return askRecall(ids[idx], false);
    const q = buildQuestion(ids[idx], type);
    if (!q) { idx++; return next(); }
    if (q.type === 'recall') return askRecall(q.id, false);
    const prompt = q.type === 'h2m' || q.type === 'h2p' ? `<span class="zh big">${esc(q.w.hanzi)}</span> <button class="icon-btn" data-qs aria-label="Nghe phát âm">🔊</button>`
      : q.type === 'm2h' ? `<strong>${esc(q.w.meaning)}</strong>`
      : `<button class="btn primary" data-qs>🔊 Nghe phát âm</button>`;
    const label = { h2m: 'Chọn nghĩa đúng:', h2p: 'Chọn Pinyin đúng:', m2h: 'Chọn từ đúng:', l2h: 'Nghe rồi chọn từ đúng:' }[q.type];
    box.innerHTML = `<div aria-live="polite"><p class="muted">Câu ${idx + 1}/${ids.length}</p><p class="center">${prompt}</p><p class="muted center">${label}</p>
    ${q.options.map(o => `<button class="btn block opt ${q.field === 'hanzi' ? 'zh' : ''}" data-opt="${o.id}">${esc(o[q.field])}</button>`).join('')}<div id="qfb"></div></div>`;
    box.querySelectorAll('[data-qs]').forEach(b => b.onclick = () => speak(q.w.hanzi));
    tagZh(box);
    if (q.type === 'l2h') speak(q.w.hanzi);
    box.querySelectorAll('[data-opt]').forEach(b => b.onclick = async () => {
      const correct = b.dataset.opt === q.id;
      b.classList.add(correct ? 'right' : 'wrong');
      box.querySelectorAll('[data-opt]').forEach(x => { if (x.dataset.opt === q.id) x.classList.add('right'); x.disabled = true; });
      Core.recordQuiz(state, day, q.id, correct, today, { type: q.type, chosenId: b.dataset.opt });
      if (pool === 'today') await finalizeVocabIfDone(day);
      await persist();
      if (correct) { $('#qfb').innerHTML = '<p class="center"><strong>✓ Đúng</strong></p>'; idx++; setTimeout(next, 700); }
      else {
        if (!retry.includes(q.id)) retry.push(q.id);
        $('#qfb').innerHTML = `<div class="correction"><p><strong>✗ Chưa đúng.</strong> Đáp án đúng: <span class="zh">${esc(q.w.hanzi)}</span> · ${esc(q.w.pinyin)} · ${esc(q.w.meaning)}</p>
        ${q.w.example ? `<p><span class="zh">${esc(q.w.example.zh)}</span> — ${esc(q.w.example.vi)}</p>` : ''}
        <button class="btn primary block" id="okBtn">Đã hiểu, tiếp tục</button></div>`;
        $('#okBtn').onclick = () => { idx++; next(); };
      }
    });
  };
  next();
}

function viewGrammar() {
  const day = ensureDay();
  const gl = grammar.lessons.find(l => l.id === day.grammarLessonId);
  if (!gl) { $('#view').innerHTML = header('Ngữ pháp', 'Chưa có dữ liệu bài học.'); return; }
  const st = day.grammarStatus;
  $('#view').innerHTML = `${header(`HSK ${gl.level.replace('HSK ', '')} · Bài ${gl.number}`, gl.titleVi)}
  <section class="card"><p class="zh big">${esc(gl.titleZh)}</p>
    <p><strong>Mục tiêu:</strong> ${esc(gl.goal || gl.note || '')}</p>
    ${gl.outcomes.length ? `<ul>${gl.outcomes.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
    ${gl.minutes ? `<p class="muted">Thời lượng ước tính: ${gl.minutes} phút</p>` : ''}
    <a class="btn primary block" target="_blank" rel="noopener" href="${esc(GRAMMAR_LESSON_URL(gl.id))}">Mở bài gốc trên HSK3.0 ↗</a></section>
  <section class="card"><h2>Chủ điểm ngữ pháp</h2>
    ${gl.points.map(pt => { const gc = (day.grammarChecks || {})[pt.id]; return `<div class="point"><h3>${esc(pt.title)}</h3><p>${esc(pt.explanationVi)}</p>
      ${pt.pattern ? `<p class="pattern zh">${esc(pt.pattern)}</p>` : ''}
      ${pt.useWhenVi ? `<p><strong>Khi nào dùng:</strong> ${esc(pt.useWhenVi)}</p>` : ''}
      ${pt.positionVi ? `<p><strong>Vị trí trong câu:</strong> ${esc(pt.positionVi)}</p>` : ''}
      ${(pt.examples && pt.examples.length ? pt.examples : (pt.example ? [pt.example] : [])).map(e => `<p><span class="zh">${esc(e.zh)}</span> · ${esc(e.pinyin)}<br><span class="muted">${esc(e.noteVi)}</span> <button class="icon-btn" data-speak="${esc(e.zh)}" aria-label="Nghe phát âm">🔊</button></p>`).join('')}
      ${pt.quickCheck ? `<div class="qcheck" data-qc="${pt.id}"><p><strong>Thử ngay:</strong> ${esc(pt.quickCheck.questionVi)}</p>
        ${pt.quickCheck.stemZh ? `<p class="zh center">${esc(pt.quickCheck.stemZh)}</p>` : ''}
        ${pt.quickCheck.options.map((o, i) => `<button class="btn block opt zh" data-qopt="${pt.id}:${i}">${esc(o.zh)}${o.vi ? ` <span class="muted">(${esc(o.vi)})</span>` : ''}</button>`).join('')}
        <div class="qfb">${gc ? `<p class="muted">Đã thử ${gc.attempts} lần · đúng ${gc.correct} lần</p>` : ''}</div></div>` : ''}
      </div>`; }).join('') || '<p class="muted">Bài này chưa có điểm ngữ pháp chi tiết.</p>'}
  </section>
  <section class="card"><h2>Trạng thái</h2><div class="row wrap">
    ${[['not', 'Chưa học'], ['learning', 'Đang học'], ['done', 'Đã hoàn thành'], ['again', 'Cần học lại']].map(([v, l]) => `<button class="btn ${st === v ? (v === 'done' ? 'success' : 'primary') : ''}" data-gst="${v}">${l}</button>`).join('')}
  </div><p class="muted">Đánh dấu “Đã hoàn thành” sẽ đưa bài vào lịch ôn 1–3–7–14–60 ngày và chuyển bài ngữ pháp tiếp theo cho ngày mai.</p></section>`;
  document.querySelectorAll('[data-speak]').forEach(b => b.onclick = () => speak(b.dataset.speak));
  document.querySelectorAll('[data-qopt]').forEach(b => b.onclick = async () => {
    const [kpId, oi] = b.dataset.qopt.split(':'); const pt = gl.points.find(p => p.id === kpId); if (!pt || !pt.quickCheck) return;
    const correct = Number(oi) + 1 === pt.quickCheck.answer;
    day.grammarChecks = day.grammarChecks || {};
    const gc = day.grammarChecks[kpId] || { attempts: 0, correct: 0, firstTry: false };
    gc.attempts += 1;
    if (correct && gc.correct === 0) { gc.correct = 1; if (gc.attempts === 1) gc.firstTry = true; }
    day.grammarChecks[kpId] = gc;
    if (!correct) { day.grammarWeakKps = [...new Set([...(day.grammarWeakKps || []), kpId])]; }
    const wrap = b.closest('.qcheck');
    wrap.querySelectorAll('[data-qopt]').forEach(x => { x.disabled = true; if (x.dataset.qopt === `${kpId}:${pt.quickCheck.answer - 1}`) x.classList.add('right'); });
    if (!correct) b.classList.add('wrong');
    wrap.querySelector('.qfb').innerHTML = `<p><strong>${correct ? '✓ Đúng' : '✗ Chưa đúng'}</strong> · ${esc(pt.quickCheck.explanationVi)}</p><p class="muted">Đã thử ${gc.attempts} lần · trạng thái: ${gc.firstTry ? 'đạt (đúng ngay lần đầu)' : gc.correct ? 'đã có lần đúng' : 'chưa đạt'} — có thể bấm các đáp án để thử lại điểm này.</p>`;
    wrap.querySelectorAll('[data-qopt]').forEach(x => { x.disabled = false; });
    await persist();
  });
  document.querySelectorAll('[data-gst]').forEach(b => b.onclick = async () => {
    if (b.dataset.gst === 'done') {
      const qcPts = gl.points.filter(p => p.quickCheck);
      if (qcPts.length) {
        const attempted = qcPts.filter(p => (day.grammarChecks || {})[p.id]);
        const passed = qcPts.filter(p => { const g = (day.grammarChecks || {})[p.id] || {}; return g.firstTry || (g.correct > 0 && g.attempts <= 2); }); // anti brute-force: pass on 1st try, or correct within 2 attempts
        if (attempted.length < qcPts.length || passed.length / qcPts.length < 0.6) {
          warn(`Chưa thể hoàn thành: hãy làm phần “Thử ngay” của mọi điểm có câu hỏi trong bài (đã thử ${attempted.length}/${qcPts.length} điểm, đạt ${passed.length} điểm, cần đạt ít nhất 60%).`);
          return;
        }
      }
    }
    day.grammarStatus = b.dataset.gst;
    if (day.grammarStatus === 'again') { const it = state.items[`grammar:${gl.id}`]; if (it) { it.weak = true; it.extraDue = Core.addDays(today, 1); } }
    await finalizeGrammarIfDone(day); await persist(); render();
  });
}

/* review session — entries carry an explicit type: 'regular' | 'extra' */
let session = null;
let reviewFilter = 'all';
function viewReview() {
  const entries = Core.dueEntries(state, today);
  const shown = entries.filter(e => reviewFilter === 'all' || e.item.kind === (reviewFilter === 'vocab' ? 'word' : 'grammar'));
  const groups = { R1: [], R3: [], R7: [], R14: [], R60: [], overdue: [], extra: [] };
  for (const e of shown) groups[e.group].push(e);
  $('#view').innerHTML = `${header('Hôm nay cần ôn', `Ôn cách quãng 1–3–7–14–60 ngày · Ưu tiên: quá hạn → hay sai → đến hạn hôm nay → bổ sung · Mỗi lượt tối đa ${loadMode().review} mục · Từ vựng ôn bằng cách tự nhớ trước`)}
  <section class="card"><div class="row wrap">
    ${[['all', 'Tất cả'], ['vocab', 'Chỉ từ vựng'], ['grammar', 'Chỉ ngữ pháp']].map(([v, l]) => `<button class="btn ${reviewFilter === v ? 'primary' : ''}" data-rf="${v}">${l}</button>`).join('')}
  </div></section>
  <section class="card" id="sessionCard" hidden><div id="session" aria-live="polite"></div></section>
  ${entries.length ? `<section class="card"><button class="btn primary block" id="startMixed">Ôn tất cả đến hạn theo thứ tự ưu tiên (${entries.length} mục)</button></section>` : ''}
  ${entries.length === 0 ? '<section class="card"><p>Không có mục nào đến hạn hôm nay. 🎉</p></section>' : `
  ${[['overdue', '⚠ Quá hạn'], ['R1', 'Ôn sau 1 ngày'], ['R3', 'Ôn sau 3 ngày'], ['R7', 'Ôn sau 7 ngày'], ['R14', 'Ôn sau 14 ngày'], ['R60', 'Ôn sau 60 ngày'], ['extra', 'Ôn bổ sung (từ còn yếu)']].map(([k, label]) => groups[k].length ? `<section class="card"><h2>${label} · ${groups[k].length} mục</h2><p class="muted">${groups[k].filter(e => e.item.kind === 'word').length} từ · ${groups[k].filter(e => e.item.kind === 'grammar').length} bài ngữ pháp${k === 'extra' ? ' · Ôn bổ sung chấm riêng, không thay mốc định kỳ' : ''}</p><button class="btn primary block" data-start="${k}">Bắt đầu ôn nhóm này</button></section>` : '').join('')}
  `}`;
  document.querySelectorAll('[data-rf]').forEach(b => b.onclick = () => { reviewFilter = b.dataset.rf; render(); });
  document.querySelectorAll('[data-start]').forEach(b => b.onclick = () => startSession(groups[b.dataset.start]));
  const sm = $('#startMixed'); if (sm) sm.onclick = () => startSession(entries);
}
function itemLabel(it) {
  if (it.kind === 'word') { const w = vocab.words[it.id]; return w ? `${w.hanzi} · ${w.pinyin} · ${w.meaning}` : it.id; }
  const g = grammar.lessons.find(l => l.id === it.id); return g ? `${g.titleZh} · ${g.titleVi}` : it.id;
}
function startSession(entries) {
  const cap = loadMode().review;
  session = { queue: entries.slice(0, cap), total: entries.length, done: 0 };
  if (entries.length > cap) session.capped = true;
  const card = $('#sessionCard'); if (card) { card.hidden = false; card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  nextInSession();
}
function nextInSession() {
  const box = $('#session'); if (!box) return;
  setTimeout(() => tagZh(box), 0);
  if (!session || !session.queue.length) {
    box.innerHTML = `<p>Đã ôn xong lượt này (${session ? session.done : 0} mục). ✓${session && session.capped ? ' Còn mục chưa ôn — bấm lại nút của nhóm để ôn lượt tiếp theo.' : ''}</p>`;
    session = null; return;
  }
  const entry = session.queue[0]; const it = entry.item;
  const typeLabel = entry.type === 'extra' ? 'Ôn bổ sung' : entry.group === 'overdue' ? 'Ôn bù quá hạn' : `Ôn định kỳ ${entry.group}`;
  if (it.kind === 'word' && entry.type === 'regular') {
    const w = vocab.words[it.id];
    box.innerHTML = `<p class="muted">${typeLabel} · còn ${session.queue.length} mục trong lượt</p><p class="zh big center">${esc(w ? w.hanzi : it.id)} <button class="icon-btn" id="sSpeak" aria-label="Nghe phát âm">🔊</button></p>
    <p class="muted center">Tự nhớ nghĩa và Pinyin trong đầu trước khi hiện đáp án.</p>
    <button class="btn primary block" id="sReveal">Hiện đáp án</button><div id="sAns"></div>`;
    $('#sSpeak').onclick = () => speak(w ? w.hanzi : '');
    $('#sReveal').onclick = () => {
      $('#sAns').innerHTML = `<p class="center"><span class="pinyin">${esc(w ? w.pinyin : '')}</span><br><strong>${esc(w ? w.meaning : '')}</strong></p>
      <div class="row"><button class="btn grow" data-srl="0">Không nhớ</button><button class="btn grow" data-srl="1">Mơ hồ</button><button class="btn primary grow" data-srl="2">Nhớ rõ</button></div>`;
      box.querySelectorAll('[data-srl]').forEach(b => b.onclick = async () => { await gradeRecallAndNext(entry, Number(b.dataset.srl)); });
    };
  } else if (it.kind === 'word') {
    const w = vocab.words[it.id];
    const distract = Object.keys(vocab.words).filter(x => x !== it.id && vocab.words[x].level === (w ? w.level : 1)).sort(() => Math.random() - 0.5).slice(0, 3);
    const opts = [it.id, ...distract].sort(() => Math.random() - 0.5);
    box.innerHTML = `<p class="muted">${typeLabel} · còn ${session.queue.length} mục trong lượt</p><p class="zh big center">${esc(w ? w.hanzi : it.id)} <button class="icon-btn" id="sSpeak" aria-label="Nghe phát âm">🔊</button></p>
    ${opts.map(o => `<button class="btn block opt" data-ropt="${o}">${esc(vocab.words[o].meaning)}</button>`).join('')}`;
    $('#sSpeak').onclick = () => speak(w ? w.hanzi : '');
    box.querySelectorAll('[data-ropt]').forEach(b => b.onclick = async () => { await gradeAndNext(entry, b.dataset.ropt === it.id); });
  } else {
    const gl2 = grammar.lessons.find(l => l.id === it.id);
    const weakPts = gl2 ? gl2.points.filter(p => (it.kpWeak || []).includes(p.id) && p.quickCheck) : [];
    if (weakPts.length && !entry.kpAsked) {
      const pt = weakPts[0];
      box.innerHTML = `<p class="muted">${typeLabel} · điểm từng sai: ${esc(pt.title)}</p>
      <p><strong>Thử lại:</strong> ${esc(pt.quickCheck.questionVi)}</p>
      ${pt.quickCheck.stemZh ? `<p class="zh center">${esc(pt.quickCheck.stemZh)}</p>` : ''}
      ${pt.quickCheck.options.map((o, i) => `<button class="btn block opt zh" data-kpopt="${i}">${esc(o.zh)}</button>`).join('')}`;
      box.querySelectorAll('[data-kpopt]').forEach(b => b.onclick = async () => {
        const correct = Number(b.dataset.kpopt) + 1 === pt.quickCheck.answer;
        const cur = state.items[entry.key];
        if (cur) {
          cur.kpWeak = correct ? (cur.kpWeak || []).filter(x => x !== pt.id) : [...new Set([...(cur.kpWeak || []), pt.id])];
          if (!cur.kpWeak.length && !(cur.extraDue && entry.type === 'extra')) cur.weak = cur.kpWeak.length > 0;
          state.items[entry.key] = cur;
        }
        await persist();
        entry.kpAsked = true;
        nextInSession();
      });
      return;
    }
    box.innerHTML = `<p class="muted">${typeLabel} · còn ${session.queue.length} mục trong lượt</p><p><strong>${esc(itemLabel(it))}</strong></p>
    <p class="muted">Tự nhớ lại chủ điểm và ví dụ của bài, rồi tự chấm:</p>
    <div class="row"><button class="btn primary grow" id="rRight">✓ Nhớ đúng</button><button class="btn grow" id="rWrong">✗ Chưa nhớ</button></div>
    <a class="btn block ghost" target="_blank" rel="noopener" href="${esc(GRAMMAR_LESSON_URL(it.id))}">Mở lại bài gốc ↗</a>`;
    $('#rRight').onclick = async () => gradeAndNext(entry, true);
    $('#rWrong').onclick = async () => gradeAndNext(entry, false);
  }
}
async function gradeAndNext(entry, correct) {
  const cur = state.items[entry.key]; if (!cur) { session.queue.shift(); return nextInSession(); }
  let effective = true;
  if (entry.type === 'extra') {
    const before = JSON.stringify([cur.extraDue, cur.lastExtraReview]);
    state.items[entry.key] = Core.gradeExtra(cur, correct, today);
    effective = JSON.stringify([state.items[entry.key].extraDue, state.items[entry.key].lastExtraReview]) !== before;
  } else {
    const r = Core.gradeItem(cur, correct, today);
    effective = r.changed;
    if (r.changed) state.items[entry.key] = r.item;
  }
  if (effective) { // F1: duplicates must not inflate today's review count or history
    const day = ensureDay(); day.reviewsDone = (day.reviewsDone || 0) + 1;
    log(correct ? 'review-right' : 'review-wrong', `${entry.type}:${entry.key}`);
  }
  await persist();
  session.queue.shift(); session.done += 1;
  nextInSession();
}
async function gradeRecallAndNext(entry, level) {
  const cur = state.items[entry.key]; if (!cur) { session.queue.shift(); return nextInSession(); }
  const r = Core.gradeReviewRecall(cur, level, today);
  if (r.changed) {
    state.items[entry.key] = r.item;
    const day = ensureDay(); day.reviewsDone = (day.reviewsDone || 0) + 1;
    log(level === 0 ? 'review-wrong' : level === 1 ? 'review-fuzzy' : 'review-right', `regular:${entry.key}:recall${level}`);
  }
  await persist();
  session.queue.shift(); session.done += 1;
  nextInSession();
}

function viewStats() {
  const ws = Core.wordStats(state);
  const gs = Core.grammarStats(state);
  const acc = Core.accuracy(state);
  const streak = Core.streakDays(state, today);
  const week = Core.weeklySummary(state, today);
  const ext = peekExternalProgress();
  $('#view').innerHTML = `${header('Thống kê', 'Trí nhớ tính từ kết quả kiểm tra thật, không tính nút tự đánh dấu')}
  <section class="card"><h2>Trí nhớ từ vựng</h2><table class="stat">
    <tr><td>Tổng số từ đã học</td><td class="num"><strong>${ws.total}</strong></td></tr>
    <tr><td>Nhớ tốt</td><td class="num"><strong>${ws.good}</strong></td></tr>
    <tr><td>Đang ghi nhớ</td><td class="num"><strong>${ws.learning}</strong></td></tr>
    <tr><td>Cần củng cố / chưa nhớ</td><td class="num"><strong>${ws.weak}</strong></td></tr>
    <tr><td>Đã vượt qua mốc 60 ngày</td><td class="num"><strong>${ws.mastered60}</strong></td></tr></table></section>
  <section class="card"><h2>Tiến độ thực chất</h2><table class="stat">
    <tr><td>Tỷ lệ trả lời đúng (kiểm tra + ôn tập)</td><td class="num"><strong>${acc === null ? '—' : acc + '%'}</strong></td></tr>
    ${(() => { const r = Core.retention(state); return `<tr><td>Nhớ lại được ở các mốc ≥ 7 ngày (retention)</td><td class="num"><strong>${r ? `${r.pct}% (${r.correct}/${r.total})` : 'chưa đủ dữ liệu'}</strong></td></tr>`; })()}
    <tr><td>Ngày học liên tục</td><td class="num"><strong>${streak} ngày</strong></td></tr>
    <tr><td>Tuần này: ngày có học</td><td class="num"><strong>${week.activeDays}/7</strong></td></tr>
    <tr><td>Tuần này: từ mới đã học</td><td class="num"><strong>${week.wordsLearned}</strong></td></tr>
    <tr><td>Tuần này: bài ngữ pháp mới</td><td class="num"><strong>${week.grammarLearned}</strong></td></tr>
    <tr><td>Tuần này: lượt ôn tập</td><td class="num"><strong>${week.reviews}</strong></td></tr>
    <tr><td>Số từ cần ôn (đến hạn hôm nay)</td><td class="num"><strong>${Core.dueEntries(state, today).filter(e => e.item.kind === 'word').length}</strong></td></tr></table>
    <p class="muted">Thời gian học thực tế không được đo — Dashboard không ghi nhận thời gian bạn mở trang, nên không hiển thị con số đoán.</p></section>
  ${(() => { const bt = Core.accuracyByType(state); const rows = Object.entries(bt).filter(([, v]) => v.n >= 5); const LBL = { h2m: 'Hán tự → nghĩa', m2h: 'Nghĩa → Hán tự', l2h: 'Nghe → chọn từ', h2p: 'Hán tự → Pinyin', recall: 'Tự nhớ trước' };
    return rows.length ? `<section class="card"><h2>Độ chính xác theo dạng kiểm tra</h2><table class="stat">${rows.map(([t, v]) => `<tr><td>${LBL[t] || t}</td><td class="num"><strong>${Math.round(100 * v.c / v.n)}% (${v.c}/${v.n})</strong></td></tr>`).join('')}</table><p class="muted">Chỉ tính lần thử đầu tiên trong ngày của mỗi từ; ôn bổ sung không tính vào đây.</p></section>` : ''; })()}
  ${(() => { const ow = Core.oftenWrong(state); return ow.length ? `<section class="card"><h2>Nội dung hay sai nhất</h2>${ow.map(({ item, misses }) => { const lbl = item.kind === 'word' ? (() => { const w = vocab.words[item.id]; return w ? `${w.hanzi} · ${w.meaning}` : item.id; })() : (() => { const g = grammar.lessons.find(l => l.id === item.id); return g ? `Ngữ pháp: ${g.titleVi}` : item.id; })(); return `<p class="row between"><span>${esc(lbl)}</span><span class="chip overdue">sai ${misses} lần</span></p>`; }).join('')}<p class="muted">Dùng nhóm “Từ yếu” hoặc “Từ đã trả lời sai” ở trang Học từ để luyện lại.</p></section>` : ''; })()}
  <section class="card"><h2>Ngữ pháp</h2><table class="stat">
    <tr><td>Tổng số bài đã học</td><td class="num"><strong>${gs.total}</strong></td></tr>
    <tr><td>Đã hoàn thành (qua 60 ngày)</td><td class="num"><strong>${gs.done}</strong></td></tr>
    <tr><td>Đang học / đang ôn</td><td class="num"><strong>${gs.learning}</strong></td></tr>
    <tr><td>Bài còn yếu</td><td class="num"><strong>${gs.weak}</strong></td></tr>
    <tr><td>Điểm ngữ pháp còn yếu (theo điểm kiến thức)</td><td class="num"><strong>${gs.kpWeak}</strong></td></tr></table>
    <div id="glist">${Object.values(state.items).filter(i => i.kind === 'grammar').map(it => { const g = grammar.lessons.find(l => l.id === it.id); return g ? `<p class="row between"><span>${esc(g.titleVi)}</span><a class="btn small" target="_blank" rel="noopener" href="${esc(GRAMMAR_LESSON_URL(g.id))}">Xem lại ↗</a></p>` : ''; }).join('') || '<p class="muted">Chưa có bài ngữ pháp nào.</p>'}</div></section>
  <section class="card"><h2>Tiến độ trên hai app gốc (chỉ đọc, cùng thiết bị)</h2>
    ${ext.vocab ? `<p>Hazi-Viet: đã học ${ext.vocab.learned} thẻ từ.</p>` : '<p class="muted">Không đọc được tiến độ Hazi-Viet trên thiết bị này.</p>'}
    ${ext.grammar ? `<p>HSK3.0: đã chạm ${ext.grammar.lessonsTouched} bài, hoàn thành ${ext.grammar.sectionsDone} mục.</p>` : '<p class="muted">Không đọc được tiến độ HSK3.0 trên thiết bị này.</p>'}
    <p class="muted">Dashboard không ghi đè hai nguồn này; tiến độ chính thức của Dashboard lưu riêng.</p></section>
  <section class="card"><h2>Lịch sử học</h2>
    ${[...state.history].reverse().slice(0, 60).map(h => { const LBL = { 'vocab-complete': 'Hoàn thành bài từ', 'grammar-complete': 'Hoàn thành bài ngữ pháp', 'review-right': 'Ôn tập đúng', 'review-wrong': 'Ôn tập chưa đúng', 'import': 'Nhập sao lưu (gộp)', 'import-replace': 'Nhập sao lưu (thay thế)' };
      const det = h.action === 'vocab-complete' ? (() => { const l = vocab.lessons.find(x => x.id === h.detail); return l ? `HSK ${l.level} Bài ${l.number}` : ''; })() : h.action === 'grammar-complete' ? (() => { const l = grammar.lessons.find(x => x.id === h.detail); return l ? l.titleVi : ''; })() : h.action.startsWith('review') ? (() => { const key = String(h.detail).split(':').slice(1).join(':'); const it = state.items[key]; return it ? itemLabel(it) : ''; })() : h.detail;
      return `<p class="muted">${esc(h.date)} · ${LBL[h.action] || h.action}${det ? ' · ' + esc(det) : ''}</p>`; }).join('') || '<p class="muted">Chưa có lịch sử.</p>'}</section>`;
}

let schedShift = null;
function viewSettings() {
  const shift = shiftOf(today);
  if (!schedShift) schedShift = shift;
  const wdNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  $('#view').innerHTML = `${header('Cài đặt', 'Múi giờ: Asia/Tokyo · Ngày học tính theo JST · Phiên bản ứng dụng 1.2.2')}
  <section class="card"><h2>Ca làm việc hôm nay</h2><div class="row">
    <button class="btn ${shift === 'day' ? 'primary' : ''}" id="shDay">☀️ Ca ngày</button>
    <button class="btn ${shift === 'night' ? 'primary' : ''}" id="shNight">🌙 Ca tối</button></div>
    <h3>Ca mặc định theo ngày trong tuần</h3>
    ${wdNames.map((n, i) => `<label class="row between"><span>${n}</span><select data-wd="${i}">
      <option value="">Theo ca mặc định (${settings.shift === 'day' ? 'ngày' : 'tối'})</option>
      <option value="day" ${settings.weekdayShifts[i] === 'day' ? 'selected' : ''}>Ca ngày</option>
      <option value="night" ${settings.weekdayShifts[i] === 'night' ? 'selected' : ''}>Ca tối</option></select></label>`).join('')}
    <p id="shiftMsg" class="pos-msg" role="status"></p>
  </section>
  <section class="card"><h2>Mức tải học mỗi ngày</h2>
    <label>Mức tải<select id="loadMode">
      ${Object.entries(LOAD_MODES).map(([k, m]) => `<option value="${k}" ${settings.loadMode === k ? 'selected' : ''}>${m.label} — tối đa ${m.target} từ mới/ngày, lượt ôn ${m.review} mục, kiểm tra ${m.quiz} câu</option>`).join('')}
    </select></label>
    <p class="muted">Mức tải chỉ đổi số từ mới được giao và độ dài phiên — không đổi khoảng ôn 1–3–7–14–60. Phần từ chưa học của bài sẽ được giao tiếp vào ngày sau, không mất bài.</p>
    <p id="loadMsg" class="pos-msg" role="status"></p></section>
  <section class="card"><h2>Vị trí học hiện tại</h2>
    <label>Bài từ vựng tiếp theo<select id="vocabPos">${vocab.lessons.map((l, i) => `<option value="${i}" ${i === state.curriculum.vocabIndex ? 'selected' : ''}>HSK ${l.level} · Bài ${l.number} — ${esc(l.title)}</option>`).join('')}</select></label>
    <label>Bài ngữ pháp tiếp theo<select id="grammarPos">${grammar.lessons.map((l, i) => `<option value="${i}" ${i === state.curriculum.grammarIndex ? 'selected' : ''}>${esc(l.level)} · Bài ${l.number} — ${esc(l.titleVi)}</option>`).join('')}</select></label>
    <p class="muted">Chỉ đổi khi bạn muốn bắt đầu từ vị trí khác. Ngày hôm nay đã tạo sẽ giữ nguyên bài đã giao.</p>
    <p id="posPreview" class="pos-preview"></p>
    <button class="btn block" id="applyToday">Đổi cả bài của hôm nay sang vị trí này</button>
    <p id="posMsg" class="pos-msg" role="status"></p></section>
  <section class="card"><h2>Lịch học (sửa trực tiếp)</h2>
    <label>Đang sửa lịch của<select id="schedShift"><option value="day" ${schedShift === 'day' ? 'selected' : ''}>Ca ngày</option><option value="night" ${schedShift === 'night' ? 'selected' : ''}>Ca tối</option></select></label>
    <div id="sched">
    ${(settings.schedules[schedShift] || []).map((b, i) => `<div class="srow"><input data-si="${i}" data-f="time" value="${esc(b.time)}" aria-label="Giờ"><input data-si="${i}" data-f="title" value="${esc(b.title)}" aria-label="Việc"><input data-si="${i}" data-f="minutes" type="number" min="1" value="${b.minutes}" aria-label="Phút"><button class="icon-btn" data-del="${i}" aria-label="Xóa khung học">✕</button></div>`).join('')}
    </div><button class="btn" id="addBlock">+ Thêm khung học</button>
    <p class="muted">Bộ chọn này chỉ đổi lịch đang sửa, không đổi ca làm việc của hôm nay.</p></section>
  <section class="card"><h2>Sao lưu & khôi phục</h2>
    <p class="muted">Dữ liệu lưu tự động trên thiết bị này (IndexedDB). Chưa có đồng bộ đám mây — hãy xuất bản sao lưu định kỳ. Nhập bản sao lưu sẽ GỘP dữ liệu, không ghi đè dữ liệu hiện có.</p>
    <button class="btn primary block" id="btnExport">⬇ Xuất bản sao lưu (JSON)</button>
    <div class="row wrap"><label><input type="radio" name="importMode" value="merge" checked> Gộp vào dữ liệu hiện có (an toàn)</label>
    <label><input type="radio" name="importMode" value="replace"> Thay thế toàn bộ</label></div>
    <label class="btn block center">⬆ Nhập bản sao lưu<input type="file" id="fileImport" accept="application/json" hidden></label>
    <button class="btn block" id="btnRefresh">↻ Cập nhật dữ liệu từ hai website gốc</button>
    <p class="muted" id="importMsg"></p></section>`;
  $('#shDay').onclick = async () => { settings.shiftOverrides[today] = 'day'; await persist(); render(); };
  $('#shNight').onclick = async () => { settings.shiftOverrides[today] = 'night'; await persist(); render(); };
  const posPreviewText = () => {
    const vl = state.curriculum.vocabDone ? null : vocab.lessons[state.curriculum.vocabIndex];
    const gl = state.curriculum.grammarDone ? null : grammar.lessons[state.curriculum.grammarIndex];
    return `Ngày học tiếp theo sẽ bắt đầu: Từ vựng — ${vl ? `HSK ${vl.level} · Bài ${vl.number}: ${vl.title}` : 'đã hoàn thành chương trình'} · Ngữ pháp — ${gl ? `${gl.level} · Bài ${gl.number}: ${gl.titleVi}` : 'đã hoàn thành chương trình'}`;
  };
  $('#posPreview').textContent = posPreviewText();
  document.querySelectorAll('[data-wd]').forEach(sel => sel.onchange = async () => { if (sel.value) settings.weekdayShifts[sel.dataset.wd] = sel.value; else delete settings.weekdayShifts[sel.dataset.wd]; await persist(); $('#shiftMsg').textContent = '✓ Đã lưu ca mặc định theo thứ.'; });
  $('#vocabPos').onchange = async e => {
    Core.setVocabPosition(state, Number(e.target.value), vocab.lessons.length);
    await persist();
    $('#posPreview').textContent = posPreviewText();
    $('#posMsg').textContent = '✓ Đã cập nhật vị trí học. Áp dụng cho ngày học tiếp theo.';
  };
  $('#grammarPos').onchange = async e => {
    Core.setGrammarPosition(state, Number(e.target.value), grammar.lessons.length);
    await persist();
    $('#posPreview').textContent = posPreviewText();
    $('#posMsg').textContent = '✓ Đã cập nhật vị trí học. Áp dụng cho ngày học tiếp theo.';
  };
  $('#loadMode').onchange = async e => { settings.loadMode = e.target.value; await persist(); $('#loadMsg').textContent = '✓ Đã đổi mức tải — áp dụng từ ngày học tiếp theo.'; };
  $('#applyToday').onclick = async () => {
    const day = ensureDay();
    const vl = state.curriculum.vocabDone ? null : vocab.lessons[state.curriculum.vocabIndex] || null;
    const gl = state.curriculum.grammarDone ? null : grammar.lessons[state.curriculum.grammarIndex] || null;
    if ((!vl || day.vocabLessonId === vl.id) && (!gl || day.grammarLessonId === gl.id)) { $('#posMsg').textContent = 'Bài hôm nay đã là vị trí này rồi.'; return; }
    const parts = [];
    if (vl && day.vocabLessonId !== vl.id) parts.push(`Từ vựng — HSK ${vl.level} · Bài ${vl.number}: ${vl.title}`);
    if (gl && day.grammarLessonId !== gl.id) parts.push(`Ngữ pháp — ${gl.level} · Bài ${gl.number}: ${gl.titleVi}`);
    const note = (day.vocabFinalized || day.grammarFinalized)
      ? '\n\nBài hôm nay đã chốt trước đó vẫn giữ nguyên lịch ôn đã tạo; không có mục ôn nào bị tạo trùng.'
      : '\n\nTừ đã học thuộc bài cũ hôm nay (nếu có) sẽ không được tính vào lịch ôn. Lịch ôn tập và dữ liệu cũ không thay đổi.';
    if (!confirm(`Đổi cả bài hôm nay sang:\n${parts.join('\n')}${note}`)) return;
    Core.reassignToday(state, day, vl, gl, loadMode().target);
    log('position-apply-today', `${vl ? vl.id : '-'}|${gl ? gl.id : '-'}`);
    await persist();
    $('#posMsg').textContent = '✓ Đã đổi cả bài hôm nay. Mở tab “Hôm nay” để học bài mới.';
  };
  $('#schedShift').onchange = e => { schedShift = e.target.value; render(); };
  const sched = settings.schedules[schedShift];
  document.querySelectorAll('[data-si]').forEach(inp => inp.onchange = async () => { const b = sched[Number(inp.dataset.si)]; if (inp.dataset.f === 'minutes') b.minutes = Math.max(1, Number(inp.value) || 1); else b[inp.dataset.f] = inp.value; await persist(); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { sched.splice(Number(b.dataset.del), 1); await persist(); render(); });
  $('#addBlock').onclick = async () => { sched.push({ id: 'x' + Date.now(), time: 'Tự chọn', title: 'Khung học mới', minutes: 15 }); await persist(); render(); };
  $('#btnExport').onclick = () => {
    const blob = new Blob([exportJson(state, settings)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `hsk-daily-backup-${today}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#btnRefresh').onclick = async () => { localStorage.removeItem('hsk-daily.cache.vocab-v3'); localStorage.removeItem('hsk-daily.cache.grammar-v3'); localStorage.removeItem('hsk-daily.cache.vocab-v2'); localStorage.removeItem('hsk-daily.cache.grammar-v2'); location.reload(); };
  $('#fileImport').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = Core.validateBackup(JSON.parse(await f.text())); // validate BEFORE touching current data
      const mode = document.querySelector('input[name="importMode"]:checked').value;
      if (mode === 'replace') {
        if (!confirm('Thay thế sẽ XÓA toàn bộ dữ liệu học hiện tại trên thiết bị này và dùng dữ liệu trong file. Bạn nên xuất sao lưu hiện tại trước. Tiếp tục?')) { $('#importMsg').textContent = 'Đã hủy thay thế.'; return; }
        state = Core.migrateState(data.state);
        log('import-replace', f.name);
        $('#importMsg').textContent = 'Đã thay thế dữ liệu bằng bản sao lưu. ✓';
      } else {
        state = Core.mergeStates(state, data.state);
        log('import', f.name);
        $('#importMsg').textContent = 'Đã gộp bản sao lưu thành công, không ghi đè dữ liệu hiện có. ✓';
      }
      if (data.settings && data.settings.schedules) settings.schedules = data.settings.schedules;
      Core.reconcileCurriculum(state, vocab.lessons.length, grammar.lessons.length);
      await persist(); render();
    } catch (err) { $('#importMsg').textContent = 'Nhập thất bại (dữ liệu hiện tại không đổi): ' + err.message; }
  };
}

let lastRenderedView = null;
function render() {
  document.querySelectorAll('nav.tabs button').forEach(b => { const on = b.dataset.view === view; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  ({ today: viewToday, words: viewWords, grammar: viewGrammar, review: viewReview, stats: viewStats, settings: viewSettings })[view]();
  document.querySelectorAll('.zh').forEach(el => el.setAttribute('lang', 'zh-CN'));
  if (lastRenderedView !== view) window.scrollTo(0, 0);
  lastRenderedView = view;
}

async function boot() {
  try {
    state = Core.migrateState(await loadState(warn));
    // One failing source must not kill the app: fall back per source.
    try { vocab = await loadVocab(); } catch { vocab = { lessons: [], words: {}, fromCache: false }; warn('Không tải được dữ liệu từ vựng — phần Học từ tạm trống, các phần khác vẫn dùng được.'); }
    try { grammar = await loadGrammar(); } catch { grammar = { lessons: [], fromCache: false }; warn('Không tải được dữ liệu ngữ pháp — phần Ngữ pháp tạm trống, các phần khác vẫn dùng được.'); }
    Core.reconcileCurriculum(state, vocab.lessons.length, grammar.lessons.length);
    ensureDay(); await persist();
    document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => { view = b.dataset.view; render(); });
    render();
    if (vocab.stale || grammar.stale) warn('Đang ngoại tuyến hoặc nguồn dữ liệu không phản hồi — đang dùng dữ liệu đã lưu tạm. Tiến độ học vẫn lưu bình thường.');
    else if (vocab.fromCache || grammar.fromCache) warn('Đang dùng dữ liệu đã lưu tạm từ hai website (tự cập nhật mỗi 24 giờ hoặc trong Cài đặt).');
    // JST rollover: if the app stays open across 00:00 JST, reload into the new study day.
    setInterval(() => { if (Core.todayKeyJST() !== today) location.reload(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Core.todayKeyJST() !== today) location.reload(); });
  } catch (err) {
    $('#view').innerHTML = `<section class="card"><h1>Chưa tải được dữ liệu</h1><p>${esc(err.message)}</p><p>Kiểm tra kết nối mạng rồi thử lại. Dữ liệu học của bạn vẫn được lưu trên thiết bị.</p><button class="btn primary" onclick="location.reload()">Thử lại</button></section>`;
  }
}
boot();
