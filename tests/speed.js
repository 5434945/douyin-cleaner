"use strict";
const model = { index: 0, sample: 0, armed: false, start: 0, action: 0 };
const samples = [];
const cardsNode = document.getElementById('cards');
document.getElementById('version').textContent = `默认稳定等待 ${originalCore.DEFAULTS.skipDelay} ms；旧版配置经读取后 ${originalCore.normalizeSettings({ skipDelay: 450 }).skipDelay} ms`;
function render() {
  const isAd = model.index === 1;
  cardsNode.innerHTML = `<div class="card" data-e2e="feed-item"><div data-e2e="feed-active-video" data-e2e-vid="bench-${model.sample}-${model.index}"><h2>${isAd ? '广告' : '普通内容'}</h2><a data-e2e="video-avatar" href="https://www.douyin.com/user/MS4w.bench">头像</a><div data-e2e="video-info"><div class="account"><span data-e2e="feed-video-nickname">@速度测量作者</span>${isAd ? '<span class="badge">广告</span>' : ''}</div><div data-e2e="video-desc">本地模拟内容</div></div></div></div>`;
}
document.getElementById('prepare').addEventListener('click', async () => {
  const raw = { enabled: true, skipAds: true, skipLive: true, skipShopping: false, showNotice: false, iconDetection: true, skipDelay: 450, whitelist: [] };
  await fixtureDispatch({ target: 'dy-cleaner-background', action: 'resetStats' });
  await chrome.storage.local.set({ settings: raw });
  model.index = 0; model.sample++; model.armed = true; model.start = 0; model.action = 0; render();
  document.getElementById('status').textContent = '已准备：现在按一次向下方向键';
});
document.addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' || !model.armed || model.index !== 0) return;
  model.start = performance.now(); model.index = 1; render();
  document.getElementById('status').textContent = '广告已出现，等待自动跳过';
});
document.querySelector('[data-e2e="video-switch-next-arrow"]').addEventListener('click', () => {
  if (model.index === 1 && model.armed) { model.action = performance.now() - model.start; model.index = 2; render(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.stats?.newValue.ad || !model.armed || !model.action) return;
  const confirmed = performance.now() - model.start;
  samples.push({ action: Math.round(model.action), confirmed: Math.round(confirmed) });
  model.armed = false;
  const row = document.createElement('tr');
  for (const text of [samples.length, `${Math.round(model.action)} ms`, `${Math.round(confirmed)} ms`]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
  document.getElementById('results').append(row);
  document.getElementById('status').textContent = `完成 ${samples.length} 次 · 平均发起 ${Math.round(samples.reduce((sum, sample) => sum + sample.action, 0) / samples.length)} ms · 平均确认 ${Math.round(samples.reduce((sum, sample) => sum + sample.confirmed, 0) / samples.length)} ms`;
});
render();
