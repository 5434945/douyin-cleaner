"use strict";
const Core = DouyinCleanerCore;
const results = document.getElementById('results');
const fixtures = document.getElementById('fixtures');
const cardsNode = document.getElementById('cards');
const model = { items: [], index: 0, clicks: 0, keys: 0, navigationWorks: true, buttonWorks: true, reuse: false };
let sequence = 0;
let passed = 0;
let failedCount = 0;
let running = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pageAction = (action, fields = {}) => fixtureDispatch({ target: 'dy-cleaner-page', action, ...fields });
const settingsPatch = patch => fixtureDispatch({ target: 'dy-cleaner-background', action: 'patchSettings', patch });
const assert = (condition, message = '断言未通过') => { if (!condition) throw new Error(message); };
async function until(condition, timeout = 5500) {
  const start = Date.now();
  while (!condition()) { if (Date.now() - start > timeout) throw new Error('等待超时'); await delay(40); }
}
function item(kind = 'normal', extra = '') { return { id: `case-${++sequence}`, kind, extra }; }
function cardHTML(entry, active = true) {
  if (entry.kind === 'live-independent') return `<div class="card dySwiperSlide" data-room-id="${entry.id}"><div data-e2e="feed-live"><h2>模拟独立直播推荐</h2><a href="https://live.douyin.com/123456">进入直播间</a></div></div>`;
  if (entry.kind === 'live-entry') return `<div class="card" data-e2e="feed-item" data-room-id="${entry.id}"><h2>模拟直播入口</h2><button>进入直播间</button></div>`;
  const marker = { normal: '', ad: '<span class="badge">广告</span>', promo: '<span class="badge">推广</span>', icon: '<svg viewBox="0 0 30 16"><rect width="30" height="16" fill="white"/></svg>', live: '<div data-e2e="feed-live"><a href="https://live.douyin.com/123456">进入直播间</a></div>', shopping: '<div data-e2e="product-card">商品卡</div>' }[entry.kind] || '';
  const meta = ['ad', 'promo', 'icon'].includes(entry.kind) ? marker : '';
  const main = ['live', 'shopping'].includes(entry.kind) ? marker : '';
  return `<div class="card" data-e2e="feed-item"><div data-e2e="${active ? 'feed-active-video' : 'feed-video'}" data-e2e-vid="${entry.id}"><h2>模拟${entry.kind}内容</h2><a data-e2e="video-avatar" href="https://www.douyin.com/user/${entry.authorId || 'MS4w.author'}"><span data-e2e="live-avatar">头像</span></a>${main}<div data-e2e="video-info"><div class="account"><span data-e2e="feed-video-nickname">@普通作者</span>${meta}<span class="time">昨天</span></div><div data-e2e="video-desc">普通视频的简介 ${entry.extra}</div></div></div></div>`;
}
function render() {
  if (model.reuse && cardsNode.firstElementChild && model.items[model.index]) {
    cardsNode.firstElementChild.innerHTML = new DOMParser().parseFromString(cardHTML(model.items[model.index]), 'text/html').body.firstElementChild.innerHTML;
  } else cardsNode.innerHTML = model.items[model.index] ? cardHTML(model.items[model.index]) : '';
  document.getElementById('trace').textContent = `当前序号 ${model.index} · 按钮次数 ${model.clicks} · 键盘次数 ${model.keys}`;
}
function navigate(direction) {
  if (!model.navigationWorks) return;
  model.index = Math.max(0, Math.min(model.items.length - 1, model.index + direction));
  render();
}
document.querySelector('[data-e2e="video-switch-next-arrow"]').addEventListener('click', () => { model.clicks++; if (model.buttonWorks) navigate(1); });
document.querySelector('[data-e2e="video-switch-prev-arrow"]').addEventListener('click', () => { model.clicks++; if (model.buttonWorks) navigate(-1); });
document.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target.matches('input')) return;
  model.keys++; navigate(event.key === 'ArrowDown' ? 1 : -1);
});
async function reset(items, patch = {}) {
  cardsNode.replaceChildren(); fixtures.replaceChildren();
  document.getElementById('editor').blur();
  await settingsPatch({ ...originalCore.DEFAULTS, skipDelay: 200, showNotice: false, enabled: false });
  await fixtureDispatch({ target: 'dy-cleaner-background', action: 'resetStats' });
  Object.assign(model, { items, index: 0, clicks: 0, keys: 0, navigationWorks: true, buttonWorks: true, reuse: false });
  render();
  await settingsPatch({ enabled: true, ...patch });
  await pageAction('status');
}
function sample(entry) {
  fixtures.innerHTML = cardHTML(entry);
  const node = fixtures.firstElementChild;
  node.className = 'sample';
  return node;
}
function nestedBadge(root, hidden = false) {
  root.querySelector('[data-e2e="feed-video-nickname"]').innerHTML = '<span class="account-name-text">@魔兽世界：无限</span><span class="badge"' + (hidden ? ' hidden' : '') + '>广告</span>';
}
const observedAdGlyph = 'M9.492 2.004L8.22 2.22c.216.336.408.72.588 1.128h-4.38v3.636c-.024 2.34-.348 4.176-.972 5.496l.96.852c.744-1.596 1.128-3.708 1.164-6.348V4.452h8.796V3.348h-4.308a16.717 16.717 0 0 0-.576-1.344zm15.564 6.672h-8.04v4.548h1.152v-.576h5.736v.576h1.152V8.676zm-6.888 2.904V9.756h5.736v1.824h-5.736zm-.276-6.732h2.688v1.656h-5.04V7.62h10.92V6.504h-4.74V4.848h3.828V3.756H21.72V2.148h-1.14v1.608h-2.016c.204-.408.372-.852.516-1.32l-1.128-.144c-.384 1.248-1.104 2.292-2.16 3.144l.684.9a8.301 8.301 0 0 0 1.416-1.488z';
function glyphBadge(root) {
  root.querySelector('.account').insertAdjacentHTML('beforeend', `<svg viewBox="0 0 60 32" width="30" height="16"><path d="${observedAdGlyph}"/></svg>`);
}
async function check(name, fn) {
  const row = document.createElement('li'); row.textContent = `运行中：${name}`; results.append(row);
  try { await fn(); passed++; row.textContent = `✓ ${name}`; row.style.color = '#a6e0c8'; }
  catch (error) { failedCount++; row.textContent = `✗ ${name}：${error.message}`; row.style.color = '#ffb2aa'; console.error(name, error); }
  document.getElementById('summary').textContent = `运行中 · 通过 ${passed} · 失败 ${failedCount}`;
}

document.getElementById('run').addEventListener('click', async () => {
  passed = 0; failedCount = 0; results.replaceChildren();
  await check('缺少接口模块时仍能响应插件面板', async () => { await reset([], { enabled: false }); const result = await pageAction('status'); assert(result.ok && result.selectorHits.feedAvailable === false); });
  await check('缺少接口模块时仍自动跳过页面广告标签', async () => { await reset([item('ad'), item()]); await until(() => storageData.stats.ad === 1); assert(model.index === 1); });
  await check('缺少接口模块时手动标记保存并跳过', async () => { const ad = { ...item(), id: '888222001' }; await reset([ad, item()], { enabled: false }); cardsNode.firstElementChild.append(document.createElement('video')); assert((await pageAction('markAd', { expectedVideoId: ad.id })).ok); assert(storageData.settings.learnedAds[0].id === ad.id); await settingsPatch({ enabled: true }); await until(() => storageData.stats.ad === 1); assert(model.index === 1); });
  await check('模块缺失时忽略接口桥接消息，不误跳普通视频', async () => { const normal = { ...item(), id: '888222002' }; await reset([normal, item()]); window.postMessage({ channel: 'douyin-cleaner-feed-v1', kind: 'records', items: [{ id: normal.id, ad: true }] }, location.origin); await delay(650); assert(model.index === 0); });
  fixtures.replaceChildren(); document.getElementById('summary').textContent = `缺少接口模块回归：通过 ${passed} · 失败 ${failedCount}`;
});
