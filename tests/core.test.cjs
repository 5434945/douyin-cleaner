const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../core.js');

test('推荐页与旧版推荐页允许，搜索、详情、直播、非抖音页面拒绝', () => {
  for (const url of ['https://www.douyin.com/', 'https://www.douyin.com/?recommend=1', 'https://www.douyin.com/recommend', 'https://douyin.com/root/recommend/', 'https://www.douyin.com/root']) assert.equal(Core.supportedPage(url), true, url);
  for (const url of ['https://www.douyin.com/video/123', 'https://www.douyin.com/search/广告', 'https://www.douyin.com/root/live/123', 'https://live.douyin.com/123', 'https://creator.douyin.com/', 'https://example.com/', 'http://www.douyin.com/', 'not a url']) assert.equal(Core.supportedPage(url), false, url);
});
test('默认开启广告和直播，带货关闭', () => {
  const settings = Core.normalizeSettings();
  assert.equal(settings.enabled, true);
  assert.equal(settings.skipAds, true);
  assert.equal(settings.skipLive, true);
  assert.equal(settings.skipShopping, false);
  assert.deepEqual(settings.whitelist, []);
});
test('设置类型校验与延迟范围约束', () => {
  assert.equal(Core.normalizeSettings(null).enabled, true);
  assert.equal(Core.normalizeSettings({ enabled: 'false' }).enabled, true);
  assert.equal(Core.normalizeSettings({ enabled: false }).enabled, false);
  assert.equal(Core.normalizeSettings({ skipDelay: -100 }).skipDelay, 200);
  assert.equal(Core.normalizeSettings({ skipDelay: 90000 }).skipDelay, 1500);
  assert.equal(Core.normalizeSettings({ skipDelay: Infinity }).skipDelay, 250);
  assert.equal(Core.normalizeSettings({ skipDelay: 312.5 }).skipDelay, 313);
});
test('旧版默认等待迁移为 250 ms，自定义值和后续手选 450 ms 保留', () => {
  assert.equal(Core.normalizeSettings({ skipDelay: 450 }).skipDelay, 250);
  assert.equal(Core.normalizeSettings({ skipDelay: 1000 }).skipDelay, 1000);
  assert.equal(Core.normalizeSettings({ settingsRevision: 1, skipDelay: 450 }).skipDelay, 450);
  const migrated = Core.normalizeSettings({ skipDelay: 450, enabled: false, whitelist: [{ id: 'MS4w.author', name: '作者' }] });
  assert.equal(migrated.enabled, false);
  assert.equal(migrated.whitelist[0].id, 'MS4w.author');
  assert.equal(Core.normalizeSettings(migrated).skipDelay, 250);
});
test('白名单 ID 校验，名称作为纯文本，数量受限', () => {
  const input = [{ id: '../bad', name: 'bad' }, { id: 'MS4w.good', name: '  作者  名称  ' }, { id: 10 }];
  assert.deepEqual(Core.normalizeSettings({ whitelist: input }).whitelist, [{ id: 'MS4w.good', name: '作者 名称' }]);
  assert.equal(Core.normalizeSettings({ whitelist: Array.from({ length: 110 }, (_, i) => ({ id: `id${i}` })) }).whitelist.length, 100);
});

function backgroundHarness() {
  const data = {};
  const listeners = [];
  let installed;
  let command;
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const chrome = {
    runtime: { id: 'unit-test-extension', onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener(fn) { listeners.push(fn); } } },
    commands: { onCommand: { addListener(fn) { command = fn; } } },
    storage: { local: {
      async get(keys) { await new Promise(resolve => setTimeout(resolve, 2)); return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, clone(data[key])])); },
      async set(update) { await new Promise(resolve => setTimeout(resolve, 2)); Object.assign(data, clone(update)); }
    } }
  };
  const context = vm.createContext({ chrome, DouyinCleanerCore: Core, importScripts() {}, Promise, Date });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  const sender = { id: chrome.runtime.id, tab: { id: 1, url: 'https://www.douyin.com/?recommend=1' }, url: 'https://www.douyin.com/?recommend=1' };
  function dispatch(message, from = sender) {
    return new Promise(resolve => {
      let async = false;
      for (const fn of listeners) if (fn({ target: 'dy-cleaner-background', ...message }, from, resolve) === true) async = true;
      if (!async) resolve(undefined);
    });
  }
  return { data, dispatch, sender, popup: { id: chrome.runtime.id }, installed: () => installed(), command: key => command(key) };
}
test('多标签页并发记录不会丢计数；仅保存类型、时间与规则', async () => {
  const harness = backgroundHarness();
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => harness.dispatch({ action: 'record', type: i % 2 ? 'live' : 'ad', rule: 'ad-label', caption: '不得保存', url: '不得保存' })));
  assert.ok(results.every(result => result.ok));
  assert.equal(harness.data.stats.ad, 13);
  assert.equal(harness.data.stats.live, 12);
  assert.equal(harness.data.recent.length, 20);
  assert.deepEqual(Object.keys(harness.data.recent[0]).sort(), ['rule', 'time', 'type']);
});
test('拒绝外部发送者、其他网站、无效统计类型和网页任意设置写入', async () => {
  const harness = backgroundHarness();
  assert.equal(await harness.dispatch({ action: 'record', type: 'ad' }, { ...harness.sender, id: 'someone-else' }), undefined);
  assert.equal(await harness.dispatch({ action: 'record', type: 'ad' }, { ...harness.sender, url: 'https://example.com/' }), undefined);
  assert.equal(await harness.dispatch({ action: 'record', type: 'unknown' }), undefined);
  assert.equal(await harness.dispatch({ action: 'patchSettings', patch: { enabled: false } }), undefined);
  assert.deepEqual(harness.data, {});
});
test('设置修改、白名单保存、网页暂停和统计清空', async () => {
  const harness = backgroundHarness();
  await harness.dispatch({ action: 'patchSettings', patch: { skipShopping: true } }, harness.popup);
  assert.equal(harness.data.settings.skipShopping, true);
  await harness.dispatch({ action: 'addAuthor', author: { id: 'MS4w.author', name: '作者' } });
  await harness.dispatch({ action: 'addAuthor', author: { id: 'MS4w.author', name: '新名称' } });
  assert.equal(harness.data.settings.whitelist.length, 1);
  assert.equal(harness.data.settings.whitelist[0].name, '新名称');
  await harness.dispatch({ action: 'setEnabledFromPage', enabled: false });
  assert.equal(harness.data.settings.enabled, false);
  await harness.dispatch({ action: 'record', type: 'failures', rule: 'navigation-timeout' });
  assert.equal(harness.data.stats.failures, 1);
  await harness.dispatch({ action: 'resetStats' }, harness.popup);
  assert.deepEqual(harness.data.stats, { ad: 0, live: 0, shopping: 0, failures: 0 });
  assert.deepEqual(harness.data.recent, []);
});
test('更新与面板设置能保存新的等待值，仍允许用户调回 450 ms', async () => {
  const harness = backgroundHarness();
  harness.data.settings = { skipDelay: 450, enabled: true };
  await harness.installed();
  assert.equal(harness.data.settings.skipDelay, 250);
  assert.equal(harness.data.settings.settingsRevision, 1);
  await harness.dispatch({ action: 'patchSettings', patch: { skipDelay: 450 } }, harness.popup);
  assert.equal(harness.data.settings.skipDelay, 450);
  harness.data.settings = { skipDelay: 450, enabled: true };
  await harness.dispatch({ action: 'patchSettings', patch: { skipDelay: 450 } }, harness.popup);
  assert.equal(harness.data.settings.skipDelay, 450);
});
test('Manifest 限定抖音域名，所有脚本和 UI 资源存在', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.content_scripts[0].matches.includes('<all_urls>'), false);
  for (const file of [...manifest.content_scripts.flatMap(entry => [...entry.js, ...(entry.css || [])]), manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
});
