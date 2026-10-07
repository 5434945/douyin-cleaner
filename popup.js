"use strict";
const Core = DouyinCleanerCore;
const $ = id => document.getElementById(id);
const settingKeys = ['enabled', 'skipAds', 'skipLive', 'skipShopping', 'showNotice', 'iconDetection', 'apiDetection', 'shieldAds', 'skipBlocked', 'collectBrandPromoters'];
let settings = Core.normalizeSettings();
let stats = {};
let pageStatus = null;
let activeTab = null;
let busy = false;
let markingAd = false;
let connectionError = '';
function withTimeout(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('插件响应超时，尚未确认保存。请检查广告标记列表，或刷新抖音后重试。')), 5000); })]).finally(() => clearTimeout(timer));
}

function feedback(text, error = false) {
  $('feedback').textContent = text;
  $('feedback').className = error ? 'feedback error' : 'feedback';
  $('feedback').hidden = false;
}
async function background(action, fields = {}) {
  const result = await withTimeout(chrome.runtime.sendMessage({ target: 'dy-cleaner-background', action, ...fields }));
  if (!result?.ok) throw new Error(result?.error || '保存失败，请重新加载插件。');
  return result;
}
function renderSettings() {
  for (const key of settingKeys) $(key).checked = settings[key];
  $('skipDelay').value = settings.skipDelay;
  $('delay-value').value = `${settings.skipDelay} ms`;
  renderBlacklist();
  renderLearnedAds();
  $('authors').replaceChildren();
  $('empty-authors').hidden = settings.whitelist.length > 0;
  for (const author of settings.whitelist) {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = author.name || author.id;
    name.title = author.id;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除白名单作者 ${name.textContent}`);
    remove.addEventListener('click', () => background('patchSettings', { patch: { whitelist: settings.whitelist.filter(item => item.id !== author.id) } }).catch(error => feedback(error.message, true)));
    row.append(name, remove); $('authors').append(row);
  }
}
function renderLearnedAds() {
  $('learned-count').textContent = settings.learnedAds.length;
  $('learned-ads').replaceChildren(); $('empty-learned').hidden = settings.learnedAds.length > 0;
  for (const entry of settings.learnedAds) {
    const row = document.createElement('li'), title = document.createElement('span'), remove = document.createElement('button');
    title.textContent = entry.title || `视频 ${entry.id}`; title.title = entry.id;
    remove.type = 'button'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除广告标记 ${entry.id}`);
    remove.addEventListener('click', () => background('removeLearnedAd', { video: { id: entry.id } }).then(() => feedback('已移除广告标记。')).catch(error => feedback(error.message, true)));
    row.append(title, remove); $('learned-ads').append(row);
  }
}
function renderBlacklist() {
  $('blocked-authors').replaceChildren(); $('empty-blocked').hidden = settings.blacklist.length > 0;
  for (const author of settings.blacklist) {
    const row = document.createElement('li'), name = document.createElement('span'), remove = document.createElement('button');
    name.textContent = author.name || author.id; name.title = author.id;
    remove.type = 'button'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除黑名单作者 ${name.textContent}`);
    remove.addEventListener('click', () => background('patchSettings', { patch: { blacklist: settings.blacklist.filter(item => item.id !== author.id), collectionExclusions: [...settings.collectionExclusions.filter(id => id !== author.id), author.id].slice(-1000) } }).then(() => feedback('已移除该作者，并停止自动收录该作者。')).catch(error => feedback(error.message, true)));
    if (author.evidence) {
      const link = document.createElement('a'); link.href = author.evidence.source; link.textContent = '依据'; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(name, link, remove);
    } else row.append(name, remove);
    $('blocked-authors').append(row);
  }
}
function downloadJSON(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('import-blocklist').addEventListener('click', async () => {
  try {
    const items = Core.parseBlacklist($('blacklist-input').value);
    const merged = Core.normalizeAuthors([...settings.blacklist, ...items.map(item => { const previous = settings.blacklist.find(entry => entry.id === item.id); return { ...previous, ...item, name: item.name || previous?.name || '' }; })], 1001);
    if (merged.length > 1000) throw new Error('合并后超过 1000 个作者，请先移除部分名单。');
    await background('patchSettings', { patch: { blacklist: merged, collectionExclusions: settings.collectionExclusions.filter(id => !items.some(item => item.id === id)) } }); $('blacklist-input').value = ''; feedback(`已合并 ${items.length} 个作者，黑名单共 ${merged.length} 个。`);
  } catch (error) { feedback(error.message, true); }
});
$('export-blocklist').addEventListener('click', () => downloadJSON({ version: 1, authors: settings.blacklist }, 'douyin-cleaner-blacklist.json'));
function renderStats() {
  for (const key of ['ad', 'live', 'shopping', 'blocked']) $(`${key}-count`).textContent = Math.max(0, Number(stats[key]) || 0).toLocaleString('zh-CN');
}
function diagnosticData() {
  return {
    version: chrome.runtime.getManifest().version,
    time: new Date().toISOString(),
    settings: Object.fromEntries([...settingKeys, 'skipDelay'].map(key => [key, settings[key]])),
    status: pageStatus?.status || '未连接推荐流',
    current: pageStatus?.current ? { type: pageStatus.current.type, rule: pageStatus.current.rule, identified: pageStatus.current.identified } : null,
    rules: pageStatus?.rules || [],
    selectorHits: pageStatus?.selectorHits || {},
    totals: stats
  };
}
async function pageMessage(action) {
  if (!activeTab?.id) throw new Error('请在抖音推荐页面中打开插件。');
  try {
    const result = await withTimeout(chrome.tabs.sendMessage(activeTab.id, { target: 'dy-cleaner-page', action, ...(['markAd', 'unmarkAd'].includes(action) ? { expectedVideoId: pageStatus?.current?.videoId } : {}) }));
    if (!result?.ok) throw new Error(result?.error || '页面未响应，请刷新抖音页面。');
    return result;
  } catch (error) {
    if (/Receiving end|Could not establish|No tab/.test(error.message)) throw new Error('请进入抖音「推荐」页面，安装后先刷新页面。');
    throw error;
  }
}
async function refreshStatus() {
  if (busy || markingAd) return;
  busy = true;
  try {
    [activeTab] = await withTimeout(chrome.tabs.query({ active: true, currentWindow: true }));
    pageStatus = await pageMessage('status');
    connectionError = '';
    $('status').textContent = pageStatus.status;
    $('evidence').textContent = pageStatus.current?.evidence || '进入推荐视频流后开始检测';
  } catch (error) {
    connectionError = error.message;
    pageStatus = null;
    $('status').textContent = '等待抖音推荐页面';
    $('evidence').textContent = '安装后刷新抖音，点击左侧「推荐」';
  } finally {
    const usable = Boolean(pageStatus?.supported && pageStatus.current?.identified);
    $('status-dot').classList.toggle('active', Boolean(usable && settings.enabled));
    $('allow').disabled = !usable;
    // Keep the action clickable when disconnected so the user receives a reason.
    $('mark-ad').disabled = markingAd;
    if (!markingAd) $('mark-ad').textContent = pageStatus?.current?.markedAd ? '取消本条广告标记' : '标记本条为广告';
    $('undo').disabled = !pageStatus?.canUndo;
    $('block').disabled = !usable || !pageStatus?.current?.author?.id;
    $('whitelist').disabled = !usable || !pageStatus?.current?.author?.id;
    $('diagnostics').textContent = JSON.stringify(diagnosticData(), null, 2);
    busy = false;
  }
}
for (const key of settingKeys) $(key).addEventListener('change', () => background('patchSettings', { patch: { [key]: $(key).checked } }).catch(error => { feedback(error.message, true); renderSettings(); }));
$('skipDelay').addEventListener('input', () => { $('delay-value').value = `${$('skipDelay').value} ms`; });
$('skipDelay').addEventListener('change', () => background('patchSettings', { patch: { skipDelay: Number($('skipDelay').value) } }).catch(error => feedback(error.message, true)));
for (const action of ['allow', 'undo', 'whitelist', 'block']) $(action).addEventListener('click', async () => {
  try {
    await pageMessage(action);
    feedback(({ allow: '本条已放行 10 分钟。', undo: '正在返回，目标内容已放行。', whitelist: '已加入作者白名单。', block: '已屏蔽当前作者，可在黑名单中移除。' })[action]);
    await refreshStatus();
  } catch (error) { feedback(error.message, true); }
});
$('mark-ad').addEventListener('click', async () => {
  if (markingAd) return;
  const removing = Boolean(pageStatus?.current?.markedAd);
  markingAd = true;
  $('mark-ad').disabled = true;
  $('mark-ad').textContent = removing ? '正在取消标记…' : '正在保存标记…';
  feedback(removing ? '正在取消本条广告标记…' : '正在保存本条广告标记…');
  try {
    if (!pageStatus) throw new Error(connectionError || '未连接推荐流，请在 Chrome 重新加载插件后刷新抖音页面。');
    if (!pageStatus.supported) throw new Error('请在抖音“推荐”视频流中标记广告。');
    if (!pageStatus.current?.videoId) {
      if (pageStatus.version && pageStatus.version !== chrome.runtime.getManifest().version) throw new Error(`页面仍运行旧脚本 v${pageStatus.version}，请刷新抖音页面后再标记。`);
      throw new Error('未读取到稳定视频 ID，请停留在推荐视频上，刷新抖音页面后重试。');
    }
    const id = pageStatus.current.videoId;
    await pageMessage(removing ? 'unmarkAd' : 'markAd');
    const data = await withTimeout(chrome.storage.local.get('settings'));
    settings = Core.normalizeSettings(data.settings);
    const saved = settings.learnedAds.some(item => item.id === id);
    if (saved === removing) throw new Error('页面已响应，但未确认标记记录保存成功。请重新加载插件并刷新抖音页面。');
    renderSettings();
    feedback(removing ? '已取消本条广告标记，并临时放行。' : '已保存广告标记，可在“我标记的广告”中查看；再次遇到会自动跳过。');
  } catch (error) { feedback(error.message, true); }
  finally { markingAd = false; await refreshStatus(); }
});
$('resetStats').addEventListener('click', async () => {
  try { await background('resetStats'); feedback('已清空本地统计。'); } catch (error) { feedback(error.message, true); }
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(diagnosticData(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'douyin-cleaner-diagnostics.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) { settings = Core.normalizeSettings(changes.settings.newValue); renderSettings(); refreshStatus(); }
  if (changes.stats) { stats = changes.stats.newValue || {}; renderStats(); }
});
chrome.storage.local.get(['settings', 'stats']).then(data => {
  settings = Core.normalizeSettings(data.settings); stats = data.stats || {}; renderSettings(); renderStats(); refreshStatus();
}).catch(error => feedback(error.message, true));
setInterval(refreshStatus, 1000);
