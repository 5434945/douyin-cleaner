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
const pageAction = action => fixtureDispatch({ target: 'dy-cleaner-page', action });
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
async function check(name, fn) {
  const row = document.createElement('li'); row.textContent = `运行中：${name}`; results.append(row);
  try { await fn(); passed++; row.textContent = `✓ ${name}`; row.style.color = '#a6e0c8'; }
  catch (error) { failedCount++; row.textContent = `✗ ${name}：${error.message}`; row.style.color = '#ffb2aa'; console.error(name, error); }
  document.getElementById('summary').textContent = `运行中 · 通过 ${passed} · 失败 ${failedCount}`;
}
document.getElementById('run').addEventListener('click', async event => {
  const runButton = event.currentTarget;
  if (running) return;
  running = true; runButton.disabled = true; results.replaceChildren(); passed = 0; failedCount = 0;
  await reset([], { enabled: false });
  const classify = (root, patch = {}) => originalCore.classify(root, originalCore.normalizeSettings(patch));
  await check('普通文案中提到广告，保留', () => assert(classify(sample(item('normal', '这个广告拍得不错'))).type === 'normal'));
  await check('作者名为广告，不误判', () => { const root = sample(item()); root.querySelector('[data-e2e="feed-video-nickname"]').textContent = '广告'; assert(classify(root).type === 'normal'); });
  await check('普通视频带直播头像，不误判', () => assert(classify(sample(item())).type === 'normal'));
  await check('作者信息区广告标识识别', () => assert(classify(sample(item('ad'))).type === 'ad'));
  await check('推广标识识别', () => assert(classify(sample(item('promo'))).type === 'ad'));
  await check('广告专用节点识别', () => { const root = sample(item()); root.insertAdjacentHTML('beforeend', '<a data-e2e="ad-link">了解详情</a>'); assert(classify(root).rule === 'ad-node'); });
  await check('广告图标兼容规则可关闭', () => { const root = sample(item('icon')); assert(classify(root).type === 'ad'); assert(classify(root, { iconDetection: false }).type === 'normal'); });
  await check('直播卡片识别', () => assert(classify(sample(item('live'))).type === 'live'));
  await check('直播入口文字直接位于按钮或链接时识别', () => {
    for (const tag of ['button', 'a']) {
      const root = sample(item());
      root.insertAdjacentHTML('beforeend', `<${tag}>进入直播间</${tag}>`);
      assert(classify(root).type === 'live', `${tag} 入口未识别`);
    }
  });
  await check('独立直播卡片与屏外普通视频共存时选中直播', () => {
    const root = sample(item()); root.style.top = '2000px';
    const live = document.createElement('div');
    live.className = 'sample'; live.dataset.e2e = 'feed-live';
    live.innerHTML = '<a href="https://live.douyin.com/123456">进入直播间</a>';
    fixtures.append(live);
    assert(originalCore.activeCard() === live, '被屏外 feed-item 阻止');
    assert(originalCore.identity(live) === 'room:/123456');
  });
  await check('普通视频头像直播链接与直播入口文案均保留', () => {
    const root = sample(item());
    const avatar = root.querySelector('[data-e2e="video-avatar"]');
    avatar.href = 'https://live.douyin.com/123456'; avatar.innerHTML = '<span>进入直播间</span>';
    assert(classify(root).type === 'normal');
  });
  await check('仅描述进入直播间，不误判', () => { const root = sample(item('normal', '进入直播间')); root.querySelector('[data-e2e="video-desc"]').innerHTML = '<span>进入直播间</span>'; assert(classify(root).type === 'normal'); });
  await check('作者昵称中的直播入口，不误判', () => { const root = sample(item()); root.querySelector('[data-e2e="feed-video-nickname"]').innerHTML = '<span>进入直播间</span>'; assert(classify(root).type === 'normal'); });
  await check('隐藏的广告标签，不触发', () => { const root = sample(item('ad')); root.querySelector('.badge').hidden = true; assert(classify(root).type === 'normal'); });
  await check('透明祖先中的广告标识，不触发', () => { const root = sample(item('ad')); root.querySelector('.account').style.opacity = '0'; assert(classify(root).type === 'normal'); });
  await check('文案中提及其他作者，不当成当前作者', () => { const root = sample(item()); root.querySelector('[data-e2e="video-avatar"]').remove(); root.querySelector('[data-e2e="video-desc"]').innerHTML = '<a href="https://www.douyin.com/user/MS4w.someone">@其他作者</a>'; assert(originalCore.authorInfo(root).id === ''); });
  await check('评论里提到广告，不触发', () => { const root = sample(item()); root.querySelector('[data-e2e="video-info"]').insertAdjacentHTML('beforeend', '<div data-e2e="comment-list"><span>广告</span></div>'); assert(classify(root).type === 'normal'); });
  await check('带货独立开关默认关闭', () => { const root = sample(item('shopping')); assert(classify(root).type === 'normal'); assert(classify(root, { skipShopping: true }).type === 'shopping'); });
  await check('商品购买链接识别', () => { const root = sample(item()); root.insertAdjacentHTML('beforeend', '<a href="https://haohuo.jinritemai.com/product/123">立即购买</a>'); assert(classify(root, { skipShopping: true }).type === 'shopping'); });
  await check('作者白名单覆盖广告规则', () => assert(classify(sample(item('ad')), { whitelist: [{ id: 'MS4w.author', name: '作者' }] }).type === 'allowed'));
  await check('预加载的屏外广告不会选为当前卡片', () => { const normal = item(); sample(normal); const ad = document.createElement('div'); ad.innerHTML = cardHTML(item('ad')); const node = ad.firstElementChild; node.style.position = 'fixed'; node.style.top = '2000px'; node.style.width = '600px'; node.style.height = '400px'; fixtures.append(node); assert(originalCore.identity(originalCore.activeCard()) === `data-e2e-vid:${normal.id}`); });
  await check('节点复用后内容 ID 变化', () => { const root = sample(item()); const before = originalCore.identity(root); root.querySelector('[data-e2e-vid]').setAttribute('data-e2e-vid', 'changed'); assert(originalCore.identity(root) !== before); });
  fixtures.replaceChildren();
  await check('广告跳过一次，确认成功后计数', async () => { await reset([item('ad'), item()]); await until(() => storageData.stats.ad === 1); await delay(800); assert(model.index === 1 && model.clicks === 1 && storageData.stats.ad === 1); });
  await check('连续广告和直播都跳过，不多跳正常视频', async () => { await reset([item('ad'), item('live'), item()]); await until(() => storageData.stats.live === 1); assert(model.index === 2 && model.clicks === 2 && storageData.stats.ad === 1); });
  await check('独立直播与旧视频共存时真实切换并计数', async () => {
    await reset([item('live-independent'), item()]);
    const old = document.createElement('div'); old.innerHTML = cardHTML(item());
    old.style.cssText = 'position:fixed;top:2000px;width:600px;height:400px'; fixtures.append(old);
    await until(() => storageData.stats.live === 1);
    assert(model.index === 1 && model.clicks === 1 && storageData.stats.failures === 0);
  });
  await check('没有视频 ID 的直播入口可以跳过并确认', async () => {
    await reset([item('live-entry'), item()]); await until(() => storageData.stats.live === 1);
    assert(model.index === 1 && model.clicks === 1);
  });
  await check('关闭直播开关后保留独立直播卡片', async () => {
    await reset([item('live-independent'), item()], { skipLive: false }); await delay(850);
    assert(model.index === 0 && model.clicks === 0 && storageData.stats.live === 0);
  });
  await check('延迟出现的广告标识触发重检', async () => { await reset([item(), item()]); await delay(600); assert(model.index === 0); cardsNode.querySelector('.account').insertAdjacentHTML('beforeend', '<span class="badge">广告</span>'); await until(() => storageData.stats.ad === 1); assert(model.index === 1); });
  await check('稳定画面中晚出现的标签迅速响应', async () => { await reset([item(), item()]); await delay(650); const start = performance.now(); cardsNode.querySelector('.account').insertAdjacentHTML('beforeend', '<span class="badge">广告</span>'); await until(() => model.index === 1); assert(performance.now() - start < 350, '稳定画面的标签响应超过 350 ms'); await until(() => storageData.stats.ad === 1); });
  await check('画面持续移动时不提前跳过', async () => { await reset([item('ad'), item()], { skipDelay: 250 }); const root = cardsNode.firstElementChild; let frame = 0; const moving = setInterval(() => { frame++; root.style.transform = `translateY(${frame * 8}px)`; }, 40); try { await delay(380); assert(model.index === 0, '画面仍在移动时跳过'); } finally { clearInterval(moving); } await until(() => storageData.stats.ad === 1); });
  await check('短暂旧广告标签清除后保留内容', async () => { await reset([item('ad'), item()], { skipDelay: 250 }); await delay(90); cardsNode.querySelector('.badge').remove(); await delay(650); assert(model.index === 0 && model.clicks === 0); });
  await check('等待中节点复用为正常视频不会沿用旧判断', async () => { await reset([item('ad'), item()], { skipDelay: 250 }); await delay(70); cardsNode.querySelector('[data-e2e-vid]').setAttribute('data-e2e-vid', `normal-reuse-${++sequence}`); await delay(90); cardsNode.querySelector('.badge').remove(); await delay(650); assert(model.index === 0 && model.clicks === 0); });
  await check('用户自定义 1000 ms 等待仍然有效', async () => { await reset([item('ad'), item()], { skipDelay: 1000 }); await delay(800); assert(model.index === 0 && model.clicks === 0); await until(() => storageData.stats.ad === 1); });
  await check('暂停开关保留广告', async () => { await reset([item('ad'), item()], { enabled: false }); await delay(850); assert(model.index === 0 && model.clicks === 0); });
  await check('等待期内关闭广告开关会取消跳过', async () => { await reset([item('ad'), item()], { skipDelay: 1000 }); await delay(100); await settingsPatch({ skipAds: false }); await delay(1250); assert(model.index === 0 && storageData.stats.ad === 0); });
  await check('本条放行阻止自动跳过', async () => { await reset([item('ad'), item()], { skipDelay: 1000 }); assert((await pageAction('allow')).ok); await delay(1250); assert(model.index === 0 && model.clicks === 0); });
  await check('输入框聚焦时暂停', async () => { await reset([item('ad'), item()]); document.getElementById('editor').focus(); await delay(850); assert(model.index === 0); document.getElementById('editor').blur(); await until(() => storageData.stats.ad === 1); });
  await check('弹窗打开时暂停', async () => { await reset([item('ad'), item()]); const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.textContent = '模拟弹窗'; dialog.style.cssText = 'position:fixed;top:30px;left:30px;width:200px;height:80px;background:red'; document.body.append(dialog); await delay(850); assert(model.index === 0); dialog.remove(); await until(() => storageData.stats.ad === 1); });
  await check('返回并放行，不会再次跳过', async () => { await reset([item('ad'), item()]); await until(() => storageData.stats.ad === 1); assert((await pageAction('undo')).ok); await until(() => model.index === 0); await delay(900); assert(model.index === 0 && storageData.stats.ad === 1); });
  await check('浏览到其他内容后，返回按钮不误退一条', async () => { await reset([item('ad'), item(), item()]); await until(() => storageData.stats.ad === 1); navigate(1); await pageAction('status'); const response = await pageAction('undo'); assert(!response.ok && model.index === 2); });
  await check('暂停时仍可返回已跳过内容', async () => { await reset([item('ad'), item()]); await until(() => storageData.stats.ad === 1); await settingsPatch({ enabled: false }); assert((await pageAction('undo')).ok); await until(() => model.index === 0); await delay(500); assert(model.index === 0); });
  await check('按钮失效时使用键盘兜底', async () => { await reset([item('ad'), item()]); model.buttonWorks = false; await until(() => storageData.stats.ad === 1); assert(model.clicks === 1 && model.keys === 1 && model.index === 1); });
  await check('切换失败仅有限重试，不计成功跳过', async () => { await reset([item('ad'), item()]); model.navigationWorks = false; await until(() => storageData.stats.failures === 1); await delay(900); assert(model.clicks === 1 && model.keys === 1 && model.index === 0 && storageData.stats.ad === 0); });
  await check('节点复用后继续识别下一条广告', async () => { await reset([item('ad'), item('promo'), item()]); model.reuse = true; await until(() => storageData.stats.ad === 2); assert(model.index === 2 && model.clicks === 2); });
  await check('作者加入白名单后立即保留', async () => { await reset([item('ad'), item()], { skipDelay: 1000 }); assert((await pageAction('whitelist')).ok); await delay(1250); assert(model.index === 0 && storageData.settings.whitelist[0].id === 'MS4w.author'); });
  await check('网页暂停消息可持久保存设置', async () => { await reset([item('ad'), item()], { showNotice: true }); await until(() => storageData.stats.ad === 1); await fixtureDispatch({ target: 'dy-cleaner-background', action: 'setEnabledFromPage', enabled: false }, true); assert(storageData.settings.enabled === false); });
  const metadata = items => window.postMessage({ channel: DouyinCleanerFeed.CHANNEL, kind: 'records', items }, location.origin);
  const numericItem = () => ({ ...item(), id: String(900000 + sequence) });
  await check('接口标记匹配当前 ID 时，无可见广告标签也跳过', async () => {
    const ad = numericItem(); await reset([ad, item()]); metadata([{ id: ad.id, ad: true }]);
    await until(() => storageData.stats.ad === 1); assert(model.index === 1);
  });
  await check('预加载下一条接口广告，不误跳当前正常视频', async () => {
    const normal = numericItem(), ad = numericItem(); await reset([normal, ad]); metadata([{ id: ad.id, ad: true }]);
    await delay(650); assert(model.index === 0 && model.clicks === 0);
  });
  await check('接口标记受广告开关、接口开关、白名单保护', async () => {
    for (const patch of [{ apiDetection: false }, { skipAds: false }, { whitelist: [{ id: 'MS4w.author', name: '作者' }] }]) {
      const ad = numericItem(); await reset([ad, item()], patch); metadata([{ id: ad.id, ad: true }]);
      await delay(600); assert(model.index === 0 && model.clicks === 0);
    }
  });
  await check('接口 false 更新撤销等待中的广告判断', async () => {
    const ad = numericItem(); await reset([ad, item()], { skipDelay: 1000 }); metadata([{ id: ad.id, ad: true }]);
    await delay(100); metadata([{ id: ad.id, ad: false }]); await delay(1100); assert(model.clicks === 0);
  });
  await check('切换时遮挡静音，暂停后恢复原本音量状态', async () => {
    await reset([item('ad'), item()]); model.navigationWorks = false;
    const video = document.createElement('video'); cardsNode.firstElementChild.append(video);
    await until(() => Boolean(document.getElementById('dy-cleaner-shield'))); assert(video.muted);
    await settingsPatch({ enabled: false }); assert(!video.muted && !document.getElementById('dy-cleaner-shield'));
  });
  await check('切换失败后移除遮挡，保留原本静音状态', async () => {
    await reset([item('ad'), item()]); model.navigationWorks = false;
    const video = document.createElement('video'); video.muted = true; cardsNode.firstElementChild.append(video);
    await until(() => storageData.stats.failures === 1); assert(video.muted && !document.getElementById('dy-cleaner-shield'));
  });
  await check('成功切换后恢复旧播放器，不影响下一条播放器', async () => {
    await reset([item('ad'), item()]);
    const video = document.createElement('video'); cardsNode.firstElementChild.append(video);
    await until(() => storageData.stats.ad === 1); assert(!video.muted && !document.getElementById('dy-cleaner-shield'));
  });
  await check('遮挡开关关闭仍可跳过广告，不改变视频静音', async () => {
    await reset([item('ad'), item()], { shieldAds: false }); model.navigationWorks = false;
    const video = document.createElement('video'); cardsNode.firstElementChild.append(video);
    await until(() => model.clicks === 1); assert(!video.muted && !document.getElementById('dy-cleaner-shield'));
    await settingsPatch({ enabled: false });
  });
  const blockedAuthor = { id: 'MS4w.author', name: '作者' };
  await check('黑名单作者普通视频自动跳过并独立计数', async () => {
    await reset([item(), item()], { blacklist: [blockedAuthor] });
    // Destination belongs to another author.
    model.items[1].authorId = 'MS4w.destination';
    await until(() => storageData.stats.blocked === 1);
    await settingsPatch({ enabled: false }); assert(model.index === 1 && storageData.stats.ad === 0);
  });
  await check('黑名单直播不依赖全局直播开关', async () => {
    await reset([item('live'), item()], { blacklist: [blockedAuthor], skipLive: false });
    await until(() => storageData.stats.blocked === 1); await settingsPatch({ enabled: false }); assert(model.index === 1);
  });
  await check('关闭黑名单开关保留作者普通内容', async () => {
    await reset([item(), item()], { blacklist: [blockedAuthor], skipBlocked: false }); await delay(700); assert(model.index === 0 && model.clicks === 0);
  });
  await check('同昵称不同作者 ID 不被黑名单误伤', async () => {
    await reset([item(), item()], { blacklist: [{ id: 'MS4w.someone-else', name: '普通作者' }] }); await delay(700); assert(model.clicks === 0);
  });
  await check('白名单和本条放行优先于黑名单', async () => {
    await reset([item(), item()], { blacklist: [blockedAuthor], whitelist: [blockedAuthor] }); await delay(650); assert(model.clicks === 0);
    await reset([item(), item()], { blacklist: [blockedAuthor], skipDelay: 1000 }); await pageAction('allow'); await delay(1100); assert(model.clicks === 0);
  });
  await check('移除黑名单立即取消等待中的屏蔽', async () => {
    await reset([item(), item()], { blacklist: [blockedAuthor], skipDelay: 1000 }); await delay(100); await settingsPatch({ blacklist: [] }); await delay(1100); assert(model.clicks === 0);
  });
  await check('一键屏蔽当前作者可保存并触发跳过', async () => {
    await reset([item(), item()], { blacklist: [] }); assert((await pageAction('block')).ok);
    await until(() => storageData.stats.blocked === 1); await settingsPatch({ enabled: false }); assert(storageData.settings.blacklist.some(item => item.id === blockedAuthor.id));
  });
  await check('品牌广告明确标记自动收录并保存证据、跳过', async () => {
    const ad = numericItem(); ad.kind = 'ad'; ad.extra = '#华为 #鸿蒙'; await reset([ad, item()], { blacklist: [] });
    cardsNode.firstElementChild.append(document.createElement('video'));
    await until(() => storageData.stats.blocked === 1); await settingsPatch({ enabled: false });
    const saved = storageData.settings.blacklist.find(item => item.id === blockedAuthor.id);
    assert(saved?.evidence?.basis === 'ad-label' && saved.evidence.source === `https://www.douyin.com/video/${ad.id}`);
  });
  await check('无页面广告标签但明确合作推广披露可自动收录', async () => {
    const ad = numericItem(); ad.extra = '#享界s9t合作推广'; await reset([ad, item()], { blacklist: [] });
    cardsNode.firstElementChild.append(document.createElement('video'));
    await until(() => storageData.stats.blocked === 1); await settingsPatch({ enabled: false });
    assert(storageData.settings.blacklist[0].evidence.basis === 'caption-disclosure');
  });
  await check('只提品牌、收录关闭、手动移除排除项均不自动加名单', async () => {
    for (const patch of [{}, { collectBrandPromoters: false }, { collectionExclusions: [blockedAuthor.id] }]) {
      const ad = numericItem(); ad.extra = Object.keys(patch).length ? '#享界s9t合作推广' : '华为手机正常体验';
      await reset([ad, item()], { blacklist: [], ...patch }); cardsNode.firstElementChild.append(document.createElement('video'));
      await delay(650); assert(storageData.settings.blacklist.length === 0 && model.clicks === 0);
    }
  });
  await check('缺少视频 ID 或作者 ID 时不自动收录', async () => {
    const ad = item(); ad.extra = '#享界s9t合作推广'; await reset([ad, item()], { blacklist: [] }); cardsNode.firstElementChild.append(document.createElement('video'));
    await delay(650); assert(storageData.settings.blacklist.length === 0);
    const numeric = numericItem(); numeric.extra = '#享界s9t合作推广'; await reset([numeric, item()], { blacklist: [] }); cardsNode.firstElementChild.append(document.createElement('video'));
    cardsNode.querySelector('[data-e2e="video-avatar"]').remove(); await delay(650); assert(storageData.settings.blacklist.length === 0);
  });
  await check('白名单及本条放行阻止自动收录推广作者', async () => {
    const ad = numericItem(); ad.extra = '#享界s9t合作推广'; await reset([ad, item()], { blacklist: [], whitelist: [blockedAuthor] }); cardsNode.firstElementChild.append(document.createElement('video'));
    await delay(650); assert(storageData.settings.blacklist.length === 0);
    const other = numericItem(); other.extra = '#享界s9t合作推广'; await reset([other, item()], { blacklist: [], skipDelay: 1000 }); cardsNode.firstElementChild.append(document.createElement('video'));
    await pageAction('allow'); await delay(1100); assert(storageData.settings.blacklist.length === 0);
  });
  await reset([item(), item('ad'), item()], { skipDelay: 800, showNotice: true });
  document.getElementById('summary').textContent = `已完成 · 通过 ${passed} · 失败 ${failedCount} · 总计 ${passed + failedCount}`;
  document.getElementById('summary').dataset.result = failedCount ? 'fail' : 'pass';
  document.getElementById('manual-status').textContent = '手动验证：按向下方向键进入广告，随后立刻按向上方向键。插件应保留正常视频。';
  runButton.disabled = false; running = false;
});
