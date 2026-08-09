const body = document.body;
const questionsUrl = body.dataset.questionsUrl;
const answersUrl = body.dataset.answersUrl;
const level = Number(body.dataset.level || 4);
const storageKey = `gespWrongBook:v1:l${level}`;

const screens = {
  start: document.querySelector('#start-screen'),
  setup: document.querySelector('#setup-screen'),
  practice: document.querySelector('#practice-screen'),
  result: document.querySelector('#result-screen')
};

let questions = [];
let questionMap = new Map();
let answerMap = new Map();
let session = null;
let selectedRandomCount = 5;
let store = loadStore();

function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return {
      activeSession: parsed.activeSession || null,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-50) : []
    };
  } catch {
    return {activeSession: null, history: []};
  }
}

function saveStore() {
  localStorage.setItem(storageKey, JSON.stringify(store));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function inlineHtml(value) {
  const escaped = escapeHtml(value);
  return escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderBlocks(blocks) {
  return blocks.map((block) => {
    if (block.type === 'code') {
      return `<pre class="code-block"><code>${escapeHtml(block.value)}</code></pre>`;
    }
    return `<p>${inlineHtml(block.value)}</p>`;
  }).join('');
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function percentage(correct, total) {
  return total ? `${Math.round(correct / total * 100)}%` : '—';
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => { element.hidden = key !== name; });
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function updateStartStats() {
  document.querySelector('#total-count').textContent = questions.length;
  const attempts = store.history.length;
  document.querySelector('#attempt-count').textContent = attempts;
  if (!attempts) {
    document.querySelector('#accuracy-rate').textContent = '—';
  } else {
    const correct = store.history.reduce((sum, item) => sum + item.correct, 0);
    const total = store.history.reduce((sum, item) => sum + item.total, 0);
    document.querySelector('#accuracy-rate').textContent = percentage(correct, total);
  }
  document.querySelector('#resume-button').hidden = !store.activeSession;
}

function countChoices(container, onSelect) {
  const uniqueCounts = [...new Set([5, 10, questions.length])].filter((count) => count > 0 && count <= questions.length);
  container.innerHTML = uniqueCounts.map((count) => `<button class="count-button${count === selectedRandomCount ? ' is-selected' : ''}" type="button" data-count="${count}">${count === questions.length ? '全部' : `${count} 题`}</button>`).join('');
  container.querySelectorAll('[data-count]').forEach((button) => button.addEventListener('click', () => {
    selectedRandomCount = Number(button.dataset.count);
    countChoices(container, onSelect);
    onSelect(selectedRandomCount);
  }));
}

function prepareCounts() {
  selectedRandomCount = Math.min(5, questions.length);
  countChoices(document.querySelector('#start-counts'), (count) => { selectedRandomCount = count; });
  countChoices(document.querySelector('#random-counts'), (count) => { selectedRandomCount = count; });
}

function chooseRandomQuestions(count) {
  const choice = questions.filter((question) => question.type === 'single-choice');
  const truth = questions.filter((question) => question.type === 'true-false');
  if (count >= 2 && choice.length && truth.length) {
    const required = [choice[Math.floor(Math.random() * choice.length)], truth[Math.floor(Math.random() * truth.length)]];
    const remainder = shuffle(questions.filter((question) => !required.includes(question)));
    return shuffle([...required, ...remainder]).slice(0, count);
  }
  return shuffle(questions).slice(0, count);
}

function makeSession(mode, ids) {
  const selected = ids || (mode === 'all' ? questions.map((question) => question.id) : chooseRandomQuestions(selectedRandomCount).map((question) => question.id));
  // Keep A/B/C/D in the source order in every practice mode.
  return {mode, questionIds: selected, answers: {}, optionOrders: {}, index: 0, status: 'active', startedAt: new Date().toISOString()};
}

function startSession(mode, ids) {
  session = makeSession(mode, ids);
  store.activeSession = session;
  saveStore();
  renderPractice();
  showScreen('practice');
}

function resumeSession() {
  if (!store.activeSession || !store.activeSession.questionIds.every((id) => questionMap.has(id))) {
    store.activeSession = null;
    saveStore();
    updateStartStats();
    return;
  }
  session = store.activeSession;
  renderPractice();
  showScreen('practice');
}

function currentQuestion() { return questionMap.get(session.questionIds[session.index]); }

function optionEntries(question) {
  if (question.type === 'true-false') return [{key: 'true', label: '正确'}, {key: 'false', label: '错误'}];
  const expectedOrder = ['A', 'B', 'C', 'D'];
  return [...question.options].sort((left, right) => expectedOrder.indexOf(left.key) - expectedOrder.indexOf(right.key));
}

function optionText(question, answer) {
  if (answer === undefined || answer === null || answer === '') return '未作答';
  if (question.type === 'true-false') return answer === 'true' ? '正确' : '错误';
  const option = question.options.find((item) => item.key === answer);
  return option ? `${answer}. ${option.label}` : answer;
}

function renderRail() {
  const rail = document.querySelector('#question-rail-list');
  rail.innerHTML = session.questionIds.map((id, index) => `<button class="rail-button${index === session.index ? ' is-current' : ''}${session.answers[id] !== undefined ? ' is-answered' : ''}" type="button" data-index="${index}">${index + 1}</button>`).join('');
  rail.querySelectorAll('[data-index]').forEach((button) => button.addEventListener('click', () => {
    session.index = Number(button.dataset.index);
    persistSession();
    renderPractice();
  }));
}

function renderPractice() {
  const question = currentQuestion();
  const total = session.questionIds.length;
  const answered = session.questionIds.filter((id) => session.answers[id] !== undefined).length;
  document.querySelector('#session-title').textContent = `${question.type === 'single-choice' ? '选择题' : '判断题'} · 第 ${session.index + 1} / ${total} 题`;
  document.querySelector('#progress-text').textContent = `已答 ${answered} / ${total}`;
  document.querySelector('#progress-percent').textContent = percentage(answered, total);
  document.querySelector('#progress-fill').style.width = `${total ? answered / total * 100 : 0}%`;
  document.querySelector('#question-type').textContent = question.type === 'single-choice' ? `选择题 · 原题 ${question.sourceNumber}` : `判断题 · 原题 ${question.sourceNumber}`;
  document.querySelector('#knowledge-tag').textContent = question.knowledge;
  document.querySelector('#question-stem').innerHTML = renderBlocks(question.stem);
  const selectedAnswer = session.answers[question.id];
  document.querySelector('#option-list').innerHTML = optionEntries(question).map((option) => `
    <div class="option-item">
      <input type="radio" id="${question.id}-${option.key}" name="${question.id}" value="${option.key}"${selectedAnswer === option.key ? ' checked' : ''}>
      <label class="option-label" for="${question.id}-${option.key}"><span class="option-key">${question.type === 'true-false' ? (option.key === 'true' ? '✓' : '×') : option.key}</span><span>${option.code ? `<code>${escapeHtml(option.label)}</code>` : inlineHtml(option.label)}</span></label>
    </div>
  `).join('');
  document.querySelectorAll('#option-list input').forEach((input) => input.addEventListener('change', () => {
    session.answers[question.id] = input.value;
    persistSession();
    renderPractice();
  }));
  document.querySelector('[data-action="previous"]').disabled = session.index === 0;
  document.querySelector('[data-action="next"]').textContent = session.index === total - 1 ? '回到第一题' : '下一题';
  document.querySelector('#unanswered-note').textContent = answered === total ? '所有题目都已作答，可以交卷。' : `还有 ${total - answered} 题未作答。`;
  document.querySelector('#footer-note').textContent = selectedAnswer === undefined ? '选择一个答案后可以继续。' : '已记录答案，仍然可以修改。';
  renderRail();
}

function persistSession() {
  store.activeSession = session;
  saveStore();
}

function moveQuestion(delta) {
  session.index = (session.index + delta + session.questionIds.length) % session.questionIds.length;
  persistSession();
  renderPractice();
}

async function submitSession() {
  if (!session || session.status !== 'active') return;
  const unanswered = session.questionIds.filter((id) => session.answers[id] === undefined);
  if (unanswered.length && !window.confirm(`还有 ${unanswered.length} 题未作答，确定现在交卷吗？`)) return;
  const submitButton = document.querySelector('[data-action="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = '正在读取解析…';
  try {
    const response = await fetch(answersUrl, {cache: 'no-store'});
    if (!response.ok) throw new Error(`答案文件读取失败（HTTP ${response.status}）`);
    const data = await response.json();
    answerMap = new Map((data.answers || []).map((item) => [item.id, item]));
    const results = session.questionIds.map((id) => {
      const answer = answerMap.get(id);
      const userAnswer = session.answers[id];
      return {id, userAnswer, correctAnswer: answer ? String(answer.answer) : '', isCorrect: answer ? String(userAnswer) === String(answer.answer) : false};
    });
    const correct = results.filter((item) => item.isCorrect).length;
    const choiceResults = results.filter((item) => questionMap.get(item.id).type === 'single-choice');
    const tfResults = results.filter((item) => questionMap.get(item.id).type === 'true-false');
    const record = {mode: session.mode, timestamp: new Date().toISOString(), correct, total: results.length, wrongIds: results.filter((item) => !item.isCorrect).map((item) => item.id)};
    store.history = [...store.history, record].slice(-50);
    store.activeSession = null;
    saveStore();
    renderResult(results, correct, choiceResults, tfResults);
    showScreen('result');
    updateStartStats();
  } catch (error) {
    window.alert(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '交卷并查看结果';
  }
}

function renderResult(results, correct, choiceResults, tfResults) {
  document.querySelector('#score-value').textContent = Math.round(correct / results.length * 100);
  document.querySelector('#correct-count').textContent = `${correct} / ${results.length}`;
  document.querySelector('#choice-accuracy').textContent = percentage(choiceResults.filter((item) => item.isCorrect).length, choiceResults.length);
  document.querySelector('#tf-accuracy').textContent = percentage(tfResults.filter((item) => item.isCorrect).length, tfResults.length);
  const wrongCount = results.length - correct;
  document.querySelector('#result-title').textContent = wrongCount ? `完成练习，还可以再稳一点` : '满分完成，太棒了！';
  document.querySelector('#result-summary').textContent = wrongCount ? `这次答对 ${correct} 题。先看下面的解析，再点“只练错题”巩固一遍。` : '这次所有题目都答对了，可以继续随机练习保持手感。';
  const reviewList = document.querySelector('#review-list');
  reviewList.innerHTML = results.map((result, index) => {
    const question = questionMap.get(result.id);
    const answer = answerMap.get(result.id);
    return `<article class="review-item${result.isCorrect ? '' : ' is-wrong'}" data-review-correct="${result.isCorrect}">
      <div class="review-top"><strong>${index + 1}. ${question.type === 'single-choice' ? '选择题' : '判断题'} · 原题 ${question.sourceNumber}</strong><span class="review-status ${result.isCorrect ? 'is-right' : 'is-wrong'}">${result.isCorrect ? '答对' : '需要复习'}</span></div>
      <div class="review-copy">${renderBlocks(question.stem)}</div>
      <div class="review-answer"><span class="answer-chip">你的答案：${escapeHtml(optionText(question, result.userAnswer))}</span><span class="answer-chip">正确答案：${escapeHtml(optionText(question, result.correctAnswer))}</span></div>
      <div class="analysis"><strong>知识点：${escapeHtml(question.knowledge)}</strong>${(answer?.explanation || []).map((paragraph) => `<p>${inlineHtml(paragraph)}</p>`).join('')}</div>
    </article>`;
  }).join('');
  const wrongButton = document.querySelector('#retry-wrong');
  wrongButton.hidden = wrongCount === 0;
  wrongButton.dataset.ids = JSON.stringify(results.filter((item) => !item.isCorrect).map((item) => item.id));
  const wrongOnlyFilter = document.querySelector('#wrong-only-filter');
  wrongOnlyFilter.checked = false;
  wrongOnlyFilter.disabled = wrongCount === 0;
  document.querySelector('#wrong-only-count').textContent = `${wrongCount} 道`;
  applyReviewFilter();
}

function applyReviewFilter() {
  const filter = document.querySelector('#wrong-only-filter');
  const reviewItems = [...document.querySelectorAll('#review-list .review-item')];
  reviewItems.forEach((item) => {
    item.hidden = filter.checked && item.dataset.reviewCorrect === 'true';
  });
  const visibleCount = reviewItems.filter((item) => !item.hidden).length;
  document.querySelector('#review-filter-status').textContent = filter.checked
    ? `正在显示 ${visibleCount} 道错题`
    : `正在显示全部 ${visibleCount} 道题`;
}

function clearHistory() {
  if (!window.confirm('确定清空这一级的本机练习记录吗？')) return;
  store.history = [];
  saveStore();
  updateStartStats();
  window.alert('本机记录已清空。');
}

function bindActions() {
  document.querySelector('#wrong-only-filter').addEventListener('change', applyReviewFilter);
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'start-all') startSession('all');
    if (action === 'open-random') { prepareCounts(); showScreen('setup'); }
    if (action === 'start-random') startSession('random');
    if (action === 'resume') resumeSession();
    if (action === 'back-start') { updateStartStats(); showScreen('start'); }
    if (action === 'previous') moveQuestion(-1);
    if (action === 'next') moveQuestion(1);
    if (action === 'submit') submitSession();
    if (action === 'clear-history') clearHistory();
    if (action === 'retry-wrong') {
      const ids = JSON.parse(button.dataset.ids || '[]');
      if (ids.length) startSession('retry', ids);
    }
  }));
}

async function init() {
  try {
    const response = await fetch(questionsUrl, {cache: 'no-store'});
    if (!response.ok) throw new Error(`题库读取失败（HTTP ${response.status}）`);
    const data = await response.json();
    questions = data.questions || [];
    questionMap = new Map(questions.map((question) => [question.id, question]));
    document.querySelector('#book-title').textContent = data.title || document.querySelector('#book-title').textContent;
    document.querySelector('#book-subtitle').textContent = data.subtitle || document.querySelector('#book-subtitle').textContent;
    document.querySelector('#load-status').textContent = `题库更新时间：${data.updatedAt || '—'} · 共 ${questions.length} 题`;
    prepareCounts();
    updateStartStats();
    bindActions();
  } catch (error) {
    document.querySelector('#load-status').textContent = error.message;
    document.querySelector('#load-status').classList.add('error-state');
  }
}

init();
