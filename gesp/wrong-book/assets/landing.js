const list = document.querySelector('#level-list');

function renderLevels(levels) {
  list.innerHTML = levels.map((level) => `
    <a class="level-card" href="${level.path}">
      <div>
        <span class="level-number">LEVEL ${level.level}</span>
        <h3>${escapeHtml(level.title)}</h3>
        <p>${escapeHtml(level.subtitle)}</p>
      </div>
      <div class="card-footer"><span>${level.questionCount} 道题 · 更新于 ${escapeHtml(level.updatedAt)}</span><span class="arrow" aria-hidden="true">→</span></div>
    </a>
  `).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

fetch(`data/levels.json?v=${Date.now()}`, {cache: 'no-store'})
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((data) => renderLevels(data.levels || []))
  .catch((error) => {
    list.innerHTML = `<div class="error-state"><p>题库目录读取失败：${escapeHtml(error.message)}。请通过本地静态服务器打开此页面。</p></div>`;
  });
