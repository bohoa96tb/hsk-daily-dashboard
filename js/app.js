import * as Core from './core.js?v=1';
import { loadState, saveState, loadSettings, saveSettings, exportJson } from './store.js?v=1';
import { loadVocab, loadGrammar, VOCAB_WORD_URL, GRAMMAR_LESSON_URL, peekExternalProgress } from './data.js?v=1';
import { mergeStates } from './core.js?v=1';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = Core.todayKeyJST();

let state, vocab, grammar, view = 'today';
let settings = Object.assign({ shift: 'day', weekdayShifts: {}, shiftOverrides: {}, schedules: null }, loadSettings());
if (!settings.schedules) settings.schedules = JSON.parse(JSON.stringify(Core.DEFAULT_SCHEDULES));

function warn(msg) { const b = $('#warn'); b.textContent = msg; b.hidden = !msg; }
async function persist() { await saveState(state, warn); saveSettings(settings); }
function shiftOf(dateKey) {
  if (settings.shiftOverrides[dateKey]) return settings.shiftOverrides[dateKey];
  const [y, m, d] = dateKey.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return settings.weekdayShifts[wd] || settings.shift;
}
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
  const vl = vocab.lessons[Math.min(state.curriculum.vocabIndex, vocab.lessons.length - 1)];
  const gl = grammar.lessons[Math.min(state.curriculum.grammarIndex, grammar.lessons.length - 1)];
  day = {
    date: today, vocabLessonId: vl ? vl.id : null, wordIds: vl ? [...vl.wordIds] : [],
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
      if (!state.items[key]) {
        const it = Core.createItem('word', id, today);
        const chk = day.wordChecks[id];
        if (chk.quiz && chk.quiz.correct === false) { it.wrong = 1; it.weak = true; it.extraDue = Core.addDays(today, 1); }
        if (chk.self === 'weak') { it.weak = true; it.extraDue = Core.addDays(today, 1); }
        state.items[key] = it;
      }
    }
    day.vocabFinalized = true;
    state.curriculum.vocabIndex = Math.min(state.curriculum.vocabIndex + 1, vocab.lessons.length - 1);
    log('vocab-complete', day.vocabLessonId);
  }
}
async function finalizeGrammarIfDone(day) {
  if (day.grammarStatus === 'done' && !day.grammarFinalized && day.grammarLessonId) {
    const key = `grammar:${day.grammarLessonId}`;
    if (!state.items[key]) state.items[key] = Core.createItem('grammar', day.grammarLessonId, today);
    day.grammarFinalized = true;
    state.curriculum.grammarIndex = Math.min(state.curriculum.grammarIndex + 1, grammar.lessons.length - 1);
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
  $('#view').innerHTML = `
  ${header('Học tập hôm nay', `${niceDate} · Giờ Nhật Bản (JST)`)}
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
    <p class="muted">Mục tiêu học: khoảng ${totalMin} phút · Lịch linh hoạt, không cần đúng từng phút.</p>
  </section>
  <section class="card"><h2>Lịch học hôm nay</h2>
    ${blocks.map(b => `<label class="task"><input type="checkbox" data-task="${esc(b.id)}" ${day.tasksDone[b.id] ? 'checked' : ''}><span class="task-time">${esc(b.time)}</span><span class="grow">${esc(b.title)}</span><span class="muted">${b.minutes}′</span></label>`).join('')}
  </section>
  <section class="card"><h2>24 từ mới ${vl ? `· HSK ${vl.level} Bài ${vl.number}` : ''}</h2>
    <p class="muted">${vl ? esc(vl.title) : ''} · Đã kiểm tra ${p.wordsDone}/${p.wordsTotal} từ</p>
    <button class="btn primary block" data-go="words">Học 24 từ mới →</button>
    ${vl ? `<a class="btn block ghost" target="_blank" rel="noopener" href="${esc(VOCAB_WORD_URL(day.wordIds[0]))}">Mở bài gốc trên Hazi-Viet ↗</a>` : ''}
  </section>
  <section class="card"><h2>Bài ngữ pháp mới</h2>
    ${gl ? `<p><span class="zh">${esc(gl.titleZh)}</span><br>${esc(gl.titleVi)} · HSK ${gl.level.replace('HSK ', '')} Bài ${gl.number}</p><p class="muted">${esc(gl.goal || gl.note || '')}</p>` : '<p>Chưa có dữ liệu.</p>'}
    <button class="btn primary block" data-go="grammar">Học bài ngữ pháp →</button>
    ${gl ? `<a class="btn block ghost" target="_blank" rel="noopener" href="${esc(GRAMMAR_LESSON_URL(gl.id))}">Mở bài gốc trên HSK3.0 ↗</a>` : ''}
  </section>
  <section class="card"><h2>Hôm nay cần ôn</h2>
    ${dueN === 0 ? '<p class="muted">Không có mục nào đến hạn. 🎉</p>' : `
    <div class="chips">${Object.entries(groups).filter(([, a]) => a.length).map(([k, a]) => `<span class="chip">${k === 'overdue' ? 'Quá hạn' : k === 'extra' ? 'Ôn bổ sung' : 'Ôn sau ' + k.slice(1) + ' ngày'}: ${a.length}</span>`).join('')}</div>
    <button class="btn primary block" data-go="review">Bắt đầu ôn tập →</button>`}
  </section>`;
  $('#flipShift').onclick = async () => { settings.shiftOverrides[today] = shiftOf(today) === 'day' ? 'night' : 'day'; await persist(); render(); };
  document.querySelectorAll('[data-task]').forEach(cb => cb.onchange = async () => { day.tasksDone[cb.dataset.task] = cb.checked; await persist(); });
  bindGo();
}
function bindGo() { document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { view = b.dataset.go; render(); }); }

function wordCard(id, idx) {
  const w = vocab.words[id]; if (!w) return '';
  const chk = (ensureDay().wordChecks[id]) || {};
  return `<article class="word ${chk.self === 'known' ? 'ok' : chk.self === 'weak' ? 'weak' : chk.self === 'unknown' ? 'unknown' : ''}">
    <div class="row"><span class="zh big">${esc(w.hanzi)}</span><button class="icon-btn" data-speak="${esc(w.hanzi)}" aria-label="Nghe phát âm">🔊</button>
    <a class="icon-btn" target="_blank" rel="noopener" href="${esc(VOCAB_WORD_URL(id))}" aria-label="Mở bài gốc">↗</a></div>
    <p class="pinyin">${esc(w.pinyin)}</p><p>${esc(w.meaning)}</p>
    ${chk.quiz ? `<p class="muted">Kiểm tra: ${chk.quiz.correct ? '✓ Đúng' : '✗ Sai'}</p>` : ''}
    <div class="row mark">
      <button class="btn small ${chk.self === 'known' ? 'primary' : ''}" data-self="${id}:known">Đã nhớ</button>
      <button class="btn small ${chk.self === 'unknown' ? 'primary' : ''}" data-self="${id}:unknown">Chưa nhớ</button>
      <button class="btn small ${chk.self === 'weak' ? 'primary' : ''}" data-self="${id}:weak">Còn yếu</button>
    </div></article>`;
}
function viewWords() {
  const day = ensureDay();
  const groups = [0, 1, 2].map(g => day.wordIds.slice(g * 8, g * 8 + 8));
  $('#view').innerHTML = `${header('Học 24 từ mới', '3 nhóm × 8 từ · đúng thứ tự gốc của Hazi-Viet')}
  ${groups.map((ids, g) => `<section class="card"><h2>Nhóm ${g + 1}</h2>${ids.map((id, i) => wordCard(id, g * 8 + i)).join('')}</section>`).join('')}
  <section class="card"><h2>Kiểm tra từ mới</h2><p class="muted">Chọn nghĩa đúng — kết quả kiểm tra thật mới tính vào thống kê trí nhớ, nút “Đã nhớ” một mình không tính là nhớ tốt.</p>
  <div id="quiz"></div><button class="btn primary block" id="startQuiz">Bắt đầu kiểm tra</button></section>`;
  document.querySelectorAll('[data-speak]').forEach(b => b.onclick = () => speak(b.dataset.speak));
  document.querySelectorAll('[data-self]').forEach(b => b.onclick = async () => {
    const [id, val] = b.dataset.self.split(':'); const day2 = ensureDay();
    day2.wordChecks[id] = { ...(day2.wordChecks[id] || {}), self: val };
    await finalizeVocabIfDone(day2); await persist(); render();
  });
  $('#startQuiz').onclick = () => runQuiz(day);
}
function quizOptions(day, id) {
  const others = day.wordIds.filter(x => x !== id).sort(() => Math.random() - 0.5).slice(0, 3);
  return [id, ...others].sort(() => Math.random() - 0.5);
}
function runQuiz(day) {
  const pending = day.wordIds.filter(id => !(day.wordChecks[id] && day.wordChecks[id].quiz));
  const box = $('#quiz');
  if (!pending.length) { box.innerHTML = '<p>Đã kiểm tra hết 24 từ hôm nay. ✓</p>'; return; }
  const id = pending[0]; const w = vocab.words[id];
  box.innerHTML = `<p class="zh big center">${esc(w.hanzi)} <button class="icon-btn" id="qSpeak">🔊</button></p>
  <p class="muted center">Còn ${pending.length} từ · Chọn nghĩa đúng:</p>
  ${quizOptions(day, id).map(o => `<button class="btn block opt" data-opt="${o}">${esc(vocab.words[o].meaning)}</button>`).join('')}`;
  $('#qSpeak').onclick = () => speak(w.hanzi);
  box.querySelectorAll('[data-opt]').forEach(b => b.onclick = async () => {
    const correct = b.dataset.opt === id;
    day.wordChecks[id] = { ...(day.wordChecks[id] || {}), quiz: { correct, at: today } };
    b.classList.add(correct ? 'right' : 'wrong');
    await finalizeVocabIfDone(day); await persist();
    setTimeout(() => runQuiz(day), 650);
  });
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
    ${gl.points.map(pt => `<div class="point"><h3>${esc(pt.title)}</h3><p>${esc(pt.explanationVi)}</p>
      ${pt.pattern ? `<p class="pattern zh">${esc(pt.pattern)}</p>` : ''}
      ${pt.example ? `<p><span class="zh">${esc(pt.example.zh)}</span> · ${esc(pt.example.pinyin)}<br><span class="muted">${esc(pt.example.noteVi)}</span> <button class="icon-btn" data-speak="${esc(pt.example.zh)}">🔊</button></p>` : ''}</div>`).join('') || '<p class="muted">Bài này chưa có điểm ngữ pháp chi tiết.</p>'}
  </section>
  <section class="card"><h2>Trạng thái</h2><div class="row wrap">
    ${[['not', 'Chưa học'], ['learning', 'Đang học'], ['done', 'Đã hoàn thành'], ['again', 'Cần học lại']].map(([v, l]) => `<button class="btn ${st === v ? 'primary' : ''}" data-gst="${v}">${l}</button>`).join('')}
  </div><p class="muted">Đánh dấu “Đã hoàn thành” sẽ đưa bài vào lịch ôn 1–3–7–14–60 ngày và chuyển bài ngữ pháp tiếp theo cho ngày mai.</p></section>`;
  document.querySelectorAll('[data-speak]').forEach(b => b.onclick = () => speak(b.dataset.speak));
  document.querySelectorAll('[data-gst]').forEach(b => b.onclick = async () => {
    day.grammarStatus = b.dataset.gst;
    if (day.grammarStatus === 'again') { const it = state.items[`grammar:${gl.id}`]; if (it) { it.weak = true; it.extraDue = Core.addDays(today, 1); } day.grammarFinalized = day.grammarFinalized && false; }
    await finalizeGrammarIfDone(day); await persist(); render();
  });
}

/* review session */
let session = null;
function viewReview() {
  const groups = Core.dueGroups(state, today);
  const total = Core.dueCount(state, today);
  $('#view').innerHTML = `${header('Hôm nay cần ôn', 'Ôn cách quãng 1–3–7–14–60 ngày · Quá hạn vẫn giữ nguyên, ôn bù được')}
  ${total === 0 ? '<section class="card"><p>Không có mục nào đến hạn hôm nay. 🎉</p></section>' : `
  ${[['R1', 'Ôn sau 1 ngày'], ['R3', 'Ôn sau 3 ngày'], ['R7', 'Ôn sau 7 ngày'], ['R14', 'Ôn sau 14 ngày'], ['R60', 'Ôn sau 60 ngày'], ['overdue', 'Quá hạn'], ['extra', 'Ôn bổ sung (từ còn yếu)']].map(([k, label]) => groups[k].length ? `<section class="card"><h2>${label} · ${groups[k].length} mục</h2><p class="muted">${groups[k].filter(i => i.kind === 'word').length} từ · ${groups[k].filter(i => i.kind === 'grammar').length} bài ngữ pháp</p><button class="btn primary block" data-start="${k}">Bắt đầu ôn nhóm này</button></section>` : '').join('')}
  <section class="card"><div id="session"></div></section>`}`;
  document.querySelectorAll('[data-start]').forEach(b => b.onclick = () => startSession(groups[b.dataset.start]));
}
function itemLabel(it) {
  if (it.kind === 'word') { const w = vocab.words[it.id]; return w ? `${w.hanzi} · ${w.pinyin} · ${w.meaning}` : it.id; }
  const g = grammar.lessons.find(l => l.id === it.id); return g ? `${g.titleZh} · ${g.titleVi}` : it.id;
}
function startSession(items) {
  session = { queue: [...items], done: 0 };
  nextInSession();
}
function nextInSession() {
  const box = $('#session'); if (!box) return;
  if (!session || !session.queue.length) { box.innerHTML = '<p>Đã ôn xong nhóm này. ✓ Tiến độ đã được lưu và lên lịch mốc tiếp theo.</p>'; session = null; return; }
  const it = session.queue[0];
  const isExtra = !!it.extraDue && Core.diffDays(it.extraDue, today) >= 0 && it.due !== today;
  if (it.kind === 'word') {
    const w = vocab.words[it.id];
    const distract = Object.keys(vocab.words).filter(x => x !== it.id && vocab.words[x].level === (w ? w.level : 1)).sort(() => Math.random() - 0.5).slice(0, 3);
    const opts = [it.id, ...distract].sort(() => Math.random() - 0.5);
    box.innerHTML = `<p class="muted">Ôn tập · còn ${session.queue.length} mục</p><p class="zh big center">${esc(w ? w.hanzi : it.id)} <button class="icon-btn" id="sSpeak">🔊</button></p>
    ${opts.map(o => `<button class="btn block opt" data-ropt="${o}">${esc(vocab.words[o].meaning)}</button>`).join('')}`;
    $('#sSpeak').onclick = () => speak(w ? w.hanzi : '');
    box.querySelectorAll('[data-ropt]').forEach(b => b.onclick = async () => { await gradeAndNext(it, b.dataset.ropt === it.id, isExtra); });
  } else {
    box.innerHTML = `<p class="muted">Ôn ngữ pháp · còn ${session.queue.length} mục</p><p><strong>${esc(itemLabel(it))}</strong></p>
    <p class="muted">Tự nhớ lại chủ điểm và ví dụ của bài, rồi tự chấm:</p>
    <div class="row"><button class="btn primary grow" id="rRight">✓ Nhớ đúng</button><button class="btn grow" id="rWrong">✗ Chưa nhớ</button></div>
    <a class="btn block ghost" target="_blank" rel="noopener" href="${esc(GRAMMAR_LESSON_URL(it.id))}">Mở lại bài gốc ↗</a>`;
    $('#rRight').onclick = async () => gradeAndNext(it, true, isExtra);
    $('#rWrong').onclick = async () => gradeAndNext(it, false, isExtra);
  }
}
async function gradeAndNext(it, correct, isExtra) {
  const key = it.key; const cur = state.items[key]; if (!cur) { session.queue.shift(); return nextInSession(); }
  if (isExtra) state.items[key] = Core.gradeExtra(cur, correct, today);
  else { const r = Core.gradeItem(cur, correct, today); if (r.changed) state.items[key] = r.item; }
  const day = ensureDay(); day.reviewsDone = (day.reviewsDone || 0) + 1;
  log(correct ? 'review-right' : 'review-wrong', key);
  await persist();
  session.queue.shift(); session.done += 1;
  nextInSession();
}

function viewStats() {
  const ws = Core.wordStats(state);
  const gs = Core.grammarStats(state);
  const ext = peekExternalProgress();
  $('#view').innerHTML = `${header('Thống kê', 'Trí nhớ tính từ kết quả kiểm tra thật, không tính nút tự đánh dấu')}
  <section class="card"><h2>Trí nhớ từ vựng</h2><table class="stat">
    <tr><td>Tổng số từ đã học</td><strong>${ws.total}</strong></tr>
    <tr><td>Nhớ tốt</td><strong>${ws.good}</strong></tr>
    <tr><td>Đang ghi nhớ</td><strong>${ws.learning}</strong></tr>
    <tr><td>Cần củng cố / chưa nhớ</td><strong>${ws.weak}</strong></tr>
    <tr><td>Đã vượt qua mốc 60 ngày</td><strong>${ws.mastered60}</strong></tr></table></section>
  <section class="card"><h2>Ngữ pháp</h2><table class="stat">
    <tr><td>Tổng số bài đã học</td><strong>${gs.total}</strong></tr>
    <tr><td>Đã hoàn thành (qua 60 ngày)</td><strong>${gs.done}</strong></tr>
    <tr><td>Đang học / đang ôn</td><strong>${gs.learning}</strong></tr>
    <tr><td>Bài còn yếu</td><strong>${gs.weak}</strong></tr></table>
    <div id="glist">${Object.values(state.items).filter(i => i.kind === 'grammar').map(it => { const g = grammar.lessons.find(l => l.id === it.id); return g ? `<p class="row between"><span>${esc(g.titleVi)}</span><a class="btn small" target="_blank" rel="noopener" href="${esc(GRAMMAR_LESSON_URL(g.id))}">Xem lại ↗</a></p>` : ''; }).join('') || '<p class="muted">Chưa có bài ngữ pháp nào.</p>'}</div></section>
  <section class="card"><h2>Tiến độ trên hai app gốc (chỉ đọc, cùng thiết bị)</h2>
    ${ext.vocab ? `<p>Hazi-Viet: đã học ${ext.vocab.learned} thẻ từ.</p>` : '<p class="muted">Không đọc được tiến độ Hazi-Viet trên thiết bị này.</p>'}
    ${ext.grammar ? `<p>HSK3.0: đã chạm ${ext.grammar.lessonsTouched} bài, hoàn thành ${ext.grammar.sectionsDone} mục.</p>` : '<p class="muted">Không đọc được tiến độ HSK3.0 trên thiết bị này.</p>'}
    <p class="muted">Dashboard không ghi đè hai nguồn này; tiến độ chính thức của Dashboard lưu riêng.</p></section>
  <section class="card"><h2>Lịch sử học</h2>
    ${[...state.history].reverse().slice(0, 60).map(h => `<p class="muted">${esc(h.date)} · ${esc(h.action)} · ${esc(h.detail)}</p>`).join('') || '<p class="muted">Chưa có lịch sử.</p>'}</section>`;
}

function viewSettings() {
  const shift = shiftOf(today);
  const wdNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  $('#view').innerHTML = `${header('Cài đặt', 'Múi giờ: Asia/Tokyo · Ngày học tính theo JST')}
  <section class="card"><h2>Ca làm việc hôm nay</h2><div class="row">
    <button class="btn ${shift === 'day' ? 'primary' : ''}" id="shDay">☀️ Ca ngày</button>
    <button class="btn ${shift === 'night' ? 'primary' : ''}" id="shNight">🌙 Ca tối</button></div>
    <h3>Ca mặc định theo ngày trong tuần</h3>
    ${wdNames.map((n, i) => `<label class="row between"><span>${n}</span><select data-wd="${i}">
      <option value="">Theo ca mặc định (${settings.shift === 'day' ? 'ngày' : 'tối'})</option>
      <option value="day" ${settings.weekdayShifts[i] === 'day' ? 'selected' : ''}>Ca ngày</option>
      <option value="night" ${settings.weekdayShifts[i] === 'night' ? 'selected' : ''}>Ca tối</option></select></label>`).join('')}
  </section>
  <section class="card"><h2>Vị trí học hiện tại</h2>
    <label>Bài từ vựng tiếp theo<select id="vocabPos">${vocab.lessons.map((l, i) => `<option value="${i}" ${i === state.curriculum.vocabIndex ? 'selected' : ''}>HSK ${l.level} · Bài ${l.number} — ${esc(l.title)}</option>`).join('')}</select></label>
    <label>Bài ngữ pháp tiếp theo<select id="grammarPos">${grammar.lessons.map((l, i) => `<option value="${i}" ${i === state.curriculum.grammarIndex ? 'selected' : ''}>${esc(l.level)} · Bài ${l.number} — ${esc(l.titleVi)}</option>`).join('')}</select></label>
    <p class="muted">Chỉ đổi khi bạn muốn bắt đầu từ vị trí khác. Ngày hôm nay đã tạo sẽ giữ nguyên bài đã giao.</p></section>
  <section class="card"><h2>Lịch học — ca ${shift === 'day' ? 'ngày' : 'tối'} (sửa trực tiếp)</h2><div id="sched">
    ${(settings.schedules[shift] || []).map((b, i) => `<div class="srow"><input data-si="${i}" data-f="time" value="${esc(b.time)}" aria-label="Giờ"><input data-si="${i}" data-f="title" value="${esc(b.title)}" aria-label="Việc"><input data-si="${i}" data-f="minutes" type="number" min="1" value="${b.minutes}" aria-label="Phút"><button class="icon-btn" data-del="${i}">✕</button></div>`).join('')}
    </div><button class="btn" id="addBlock">+ Thêm khung học</button>
    <p class="muted">Đang sửa lịch của ca hiện tại (hôm nay). Đổi ca ở trên để sửa lịch ca còn lại.</p></section>
  <section class="card"><h2>Sao lưu & khôi phục</h2>
    <p class="muted">Dữ liệu lưu tự động trên thiết bị này (IndexedDB). Chưa có đồng bộ đám mây — hãy xuất bản sao lưu định kỳ. Nhập bản sao lưu sẽ GỘP dữ liệu, không ghi đè dữ liệu hiện có.</p>
    <button class="btn primary block" id="btnExport">⬇ Xuất bản sao lưu (JSON)</button>
    <label class="btn block center">⬆ Nhập bản sao lưu<input type="file" id="fileImport" accept="application/json" hidden></label>
    <button class="btn block" id="btnRefresh">↻ Cập nhật dữ liệu từ hai website gốc</button>
    <p class="muted" id="importMsg"></p></section>`;
  $('#shDay').onclick = async () => { settings.shiftOverrides[today] = 'day'; await persist(); render(); };
  $('#shNight').onclick = async () => { settings.shiftOverrides[today] = 'night'; await persist(); render(); };
  document.querySelectorAll('[data-wd]').forEach(sel => sel.onchange = async () => { if (sel.value) settings.weekdayShifts[sel.dataset.wd] = sel.value; else delete settings.weekdayShifts[sel.dataset.wd]; await persist(); });
  $('#vocabPos').onchange = async e => { state.curriculum.vocabIndex = Number(e.target.value); await persist(); warn('Đã đổi vị trí từ vựng cho các ngày tiếp theo.'); };
  $('#grammarPos').onchange = async e => { state.curriculum.grammarIndex = Number(e.target.value); await persist(); warn('Đã đổi vị trí ngữ pháp cho các ngày tiếp theo.'); };
  const sched = settings.schedules[shift];
  document.querySelectorAll('[data-si]').forEach(inp => inp.onchange = async () => { const b = sched[Number(inp.dataset.si)]; if (inp.dataset.f === 'minutes') b.minutes = Math.max(1, Number(inp.value) || 1); else b[inp.dataset.f] = inp.value; await persist(); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { sched.splice(Number(b.dataset.del), 1); await persist(); render(); });
  $('#addBlock').onclick = async () => { sched.push({ id: 'x' + Date.now(), time: 'Tự chọn', title: 'Khung học mới', minutes: 15 }); await persist(); render(); };
  $('#btnExport').onclick = () => {
    const blob = new Blob([exportJson(state, settings)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `hsk-daily-backup-${today}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#btnRefresh').onclick = async () => { localStorage.removeItem('hsk-daily.cache.vocab-v2'); localStorage.removeItem('hsk-daily.cache.grammar-v2'); location.reload(); };
  $('#fileImport').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || data.app !== 'hsk-daily-dashboard' || !data.state) throw new Error('File không phải bản sao lưu của Dashboard.');
      state = mergeStates(state, data.state);
      if (data.settings && data.settings.schedules) settings.schedules = data.settings.schedules;
      await persist();
      $('#importMsg').textContent = 'Đã gộp bản sao lưu thành công, không ghi đè dữ liệu hiện có. ✓';
      log('import', f.name);
    } catch (err) { $('#importMsg').textContent = 'Nhập thất bại: ' + err.message; }
  };
}

function render() {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  ({ today: viewToday, words: viewWords, grammar: viewGrammar, review: viewReview, stats: viewStats, settings: viewSettings })[view]();
  window.scrollTo(0, 0);
}

async function boot() {
  try {
    state = await loadState(warn);
    [vocab, grammar] = await Promise.all([loadVocab(), loadGrammar()]);
    ensureDay(); await persist();
    document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => { view = b.dataset.view; render(); });
    render();
    if (vocab.fromCache || grammar.fromCache) warn('Đang dùng dữ liệu đã lưu tạm từ hai website (tự cập nhật mỗi 24 giờ hoặc trong Cài đặt).');
  } catch (err) {
    $('#view').innerHTML = `<section class="card"><h1>Chưa tải được dữ liệu</h1><p>${esc(err.message)}</p><p>Kiểm tra kết nối mạng rồi thử lại. Dữ liệu học của bạn vẫn được lưu trên thiết bị.</p><button class="btn primary" onclick="location.reload()">Thử lại</button></section>`;
  }
}
boot();
