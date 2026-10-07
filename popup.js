"use strict";
const Core = DouyinCleanerCore;
const $ = id => document.getElementById(id);
const settingKeys = ['enabled', 'skipAds', 'skipLive', 'skipShopping', 'showNotice', 'iconDetection', 'apiDetection', 'shieldAds'];
let settings = Core.normalizeSettings();
let stats = {};
let pageStatus = null;
let activeTab = null;
let busy = false;

function feedback(text, error = false) {
  $('feedback').textContent = text;
  $('feedback').className = error ? 'feedback error' : 'feedback';
  $('feedback').hidden = false;
}
async function background(action, fields = {}) {
  const result = await chrome.runtime.sendMessage({ target: 'dy-cleaner-background', action, ...fields });
  if (!result?.ok) throw new Error(result?.error || '保存失败，请重新加载插件。');
  return result;
}
function renderSettings() {
  for (const key of settingKeys) $(key).checked = settings[key];
  $('skipDelay').value = settings.skipDelay;
  $('delay-value').value = `${settings.skipDelay} ms`;
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
function renderStats() {
  for (const key of ['ad', 'live', 'shopping']) $(`${key}-count`).textContent = Math.max(0, Number(stats[key]) || 0).toLocaleString('zh-CN');
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
    const result = await chrome.tabs.sendMessage(activeTab.id, { target: 'dy-cleaner-page', action });
    if (!result?.ok) throw new Error(result?.error || '页面未响应，请刷新抖音页面。');
    return result;
  } catch (error) {
    if (/Receiving end|Could not establish|No tab/.test(error.message)) throw new Error('请进入抖音「推荐」页面，安装后先刷新页面。');
    throw error;
  }
}
async function refreshStatus() {
  if (busy) return;
  busy = true;
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    pageStatus = await pageMessage('status');
    $('status').textContent = pageStatus.status;
    $('evidence').textContent = pageStatus.current?.evidence || '进入推荐视频流后开始检测';
  } catch {
    pageStatus = null;
    $('status').textContent = '等待抖音推荐页面';
    $('evidence').textContent = '安装后刷新抖音，点击左侧「推荐」';
  } finally {
    const usable = Boolean(pageStatus?.supported && pageStatus.current?.identified);
    $('status-dot').classList.toggle('active', Boolean(usable && settings.enabled));
    $('allow').disabled = !usable;
    $('undo').disabled = !pageStatus?.canUndo;
    $('whitelist').disabled = !usable || !pageStatus?.current?.author?.id;
    $('diagnostics').textContent = JSON.stringify(diagnosticData(), null, 2);
    busy = false;
  }
}
for (const key of settingKeys) $(key).addEventListener('change', () => background('patchSettings', { patch: { [key]: $(key).checked } }).catch(error => { feedback(error.message, true); renderSettings(); }));
$('skipDelay').addEventListener('input', () => { $('delay-value').value = `${$('skipDelay').value} ms`; });
$('skipDelay').addEventListener('change', () => background('patchSettings', { patch: { skipDelay: Number($('skipDelay').value) } }).catch(error => feedback(error.message, true)));
for (const action of ['allow', 'undo', 'whitelist']) $(action).addEventListener('click', async () => {
  try {
    await pageMessage(action);
    feedback(({ allow: '本条已放行 10 分钟。', undo: '正在返回，目标内容已放行。', whitelist: '已加入作者白名单。' })[action]);
    await refreshStatus();
  } catch (error) { feedback(error.message, true); }
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
