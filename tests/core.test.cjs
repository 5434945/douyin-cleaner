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

test('黑名单严格 ID 校验、去重、数量限制，空名单不恢复默认名单', () => {
  assert.deepEqual(Core.normalizeSettings({ blacklist: [{ id: '../bad' }, { id: 'MS4w.good', name: '旧名称' }, { id: 'MS4w.good', name: '新名称' }] }).blacklist, [{ id: 'MS4w.good', name: '新名称' }]);
  assert.equal(Core.normalizeSettings({ blacklist: Array.from({ length: 1001 }, (_, i) => ({ id: `id${i}` })) }).blacklist.length, 1000);
  assert.deepEqual(Core.normalizeSettings({ blacklist: [] }).blacklist, []);
  assert.equal(Core.normalizeSettings({ skipBlocked: false }).skipBlocked, false);
});
test('名单导入只接受稳定 ID JSON 或真实抖音 HTTPS 作者主页，不按昵称猜测', () => {
  assert.deepEqual(Core.parseBlacklist('{"authors":[{"id":"MS4w.good","name":"作者","evidence":"ignored"}]}'), [{ id: 'MS4w.good', name: '作者' }]);
  assert.deepEqual(Core.parseBlacklist('https://www.douyin.com/user/MS4w.good\nhttps://douyin.com/user/MS4w.good/'), [{ id: 'MS4w.good', name: '' }]);
  for (const input of ['普通作者', 'https://douyin.com.evil.com/user/MS4w.good', 'https://www.douyin.com/video/123', '[{"id":"../bad"}]', '{}']) assert.throws(() => Core.parseBlacklist(input));
});
test('推广收录要求品牌与明确依据；排除单纯话题、评论、图标和商业关系讨论', () => {
  assert.equal(Core.promotionEvidence('华为手机使用心得', []), null);
  assert.equal(Core.promotionEvidence('华为是否找人合作推广？', []), null);
  assert.equal(Core.promotionEvidence('华为 #花粉', [{ type: 'ad', rule: 'ad-account-icon' }]), null);
  assert.equal(Core.promotionEvidence('无品牌广告', [{ type: 'ad', rule: 'ad-api' }]), null);
  assert.equal(Core.promotionEvidence('#华为 #鸿蒙', [{ type: 'ad', rule: 'ad-api' }]), 'ad-api');
  assert.equal(Core.promotionEvidence('#享界s9t合作推广 #享界', []), 'caption-disclosure');
  assert.equal(Core.promotionEvidence('#鸿蒙智行推荐官计划 邀请好友下单得1万积分', []), 'referral-disclosure');
  assert.equal(Core.promotionEvidence('讨论#华为合作推广假的', []), null);
});
test('证据只保留允许的规则和抖音作品链接，剔除查询信息或其他域名', () => {
  const items = Core.normalizeAuthors([{ id: 'a', evidence: { basis: 'ad-api', source: 'https://www.douyin.com/video/123?private=token' } }, { id: 'b', evidence: { basis: 'ad-api', source: 'https://evil.com/video/123' } }]);
  assert.deepEqual(items[0].evidence, { basis: 'ad-api', source: 'https://www.douyin.com/video/123' });
  assert.equal(items[1].evidence, undefined);
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
  assert.deepEqual(harness.data.stats, { ad: 0, live: 0, shopping: 0, blocked: 0, failures: 0 });
  assert.deepEqual(harness.data.recent, []);
});

test('一键屏蔽与白名单互斥，作者屏蔽成功独立计数且不记作者资料', async () => {
  const h = backgroundHarness();
  await h.dispatch({ action: 'addAuthor', author: { id: 'MS4w.author', name: '作者' } });
  await h.dispatch({ action: 'blockAuthor', author: { id: 'MS4w.author', name: '作者' } });
  assert.equal(h.data.settings.whitelist.length, 0);
  assert.equal(h.data.settings.blacklist.find(item => item.id === 'MS4w.author').name, '作者');
  await h.dispatch({ action: 'record', type: 'blocked', rule: 'author-blacklist', author: '不得记录' });
  assert.equal(h.data.stats.blocked, 1);
  assert.deepEqual(Object.keys(h.data.recent[0]).sort(), ['rule', 'time', 'type']);
  await h.dispatch({ action: 'addAuthor', author: { id: 'MS4w.author', name: '作者' } });
  assert.equal(h.data.settings.blacklist.some(item => item.id === 'MS4w.author'), false);
});
test('自动收录可保存依据，但服从关闭、白名单、手动移除排除项和有效证据', async () => {
  const h = backgroundHarness();
  const message = { action: 'collectPromoter', author: { id: 'MS4w.promoter', name: '作者' }, evidence: { basis: 'ad-api', source: 'https://www.douyin.com/video/123' } };
  for (const patch of [{ collectBrandPromoters: false }, { skipBlocked: false }, { enabled: false }, { whitelist: [{ id: 'MS4w.promoter' }] }, { collectionExclusions: ['MS4w.promoter'] }]) {
    h.data.settings = Core.normalizeSettings({ blacklist: [], ...patch });
    await h.dispatch(message); assert.equal(h.data.settings.blacklist.length, 0);
  }
  h.data.settings = Core.normalizeSettings({ blacklist: [] });
  await h.dispatch({ ...message, evidence: { basis: 'invented', source: message.evidence.source } }); assert.equal(h.data.settings.blacklist.length, 0);
  await h.dispatch(message); assert.equal(h.data.settings.blacklist[0].evidence.basis, 'ad-api');
});
test('升级加入首批名单，之后主动清空不会重新补回', async () => {
  const h = backgroundHarness(); h.data.settings = { enabled: true, whitelist: [] };
  await h.installed(); assert.equal(h.data.settings.blacklist.length, 2);
  h.data.settings.blacklist = []; await h.installed(); assert.equal(h.data.settings.blacklist.length, 0);
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


test('手动广告标记只接受字符串视频 ID，去重、清理字段、限制数量', () => {
  assert.deepEqual(Core.normalizeSettings().learnedAds, []);
  assert.deepEqual(Core.normalizeLearnedAds([{ id: 123 }, { id: 'media:123' }, { id: '123', title: '  旧 标题 ' }, { id: '123', title: '新标题', author: '不保存' }]), [{ id: '123', title: '新标题' }]);
  assert.equal(Core.normalizeLearnedAds(Array.from({ length: 2001 }, (_, i) => ({ id: String(i) }))).length, 2000);
  assert.equal(Core.normalizeLearnedAds([{ id: '123', title: 'a'.repeat(150) }])[0].title.length, 100);
  assert.deepEqual(Core.normalizeSettings({ learnedAds: [] }).learnedAds, []);
  assert.equal(Core.promotionEvidence('华为 手机推荐', [{ type: 'ad', rule: 'ad-user' }]), null);
});
test('手动广告标记并发保存、重复更新、升级保留、撤销不会丢失其他条目', async () => {
  const h = backgroundHarness();
  await Promise.all(['123', '456'].map(id => h.dispatch({ action: 'markAd', video: { id, title: '广告', url: '不得保存', author: '不得保存' } })));
  assert.deepEqual(h.data.settings.learnedAds.map(v => v.id), ['123', '456']);
  await h.dispatch({ action: 'markAd', video: { id: '123', title: '新的标题' } });
  assert.equal(h.data.settings.learnedAds.length, 2);
  assert.deepEqual(h.data.settings.learnedAds[1], { id: '123', title: '新的标题' });
  h.installed(); await h.dispatch({ action: 'patchSettings', patch: { skipAds: false } }, h.popup);
  assert.equal(h.data.settings.learnedAds.length, 2);
  await h.dispatch({ action: 'removeLearnedAd', video: { id: '123' } }, h.popup);
  assert.deepEqual(h.data.settings.learnedAds.map(v => v.id), ['456']);
  await h.dispatch({ action: 'removeLearnedAd', video: { id: '456' } });
  assert.deepEqual(h.data.settings.learnedAds, []);
});
test('拒绝外部、非推荐页面、非法 ID 的手动广告写入，满额不静默丢旧条目', async () => {
  const h = backgroundHarness();
  const message = { action: 'markAd', video: { id: '123', title: '广告' } };
  for (const sender of [h.popup, { ...h.sender, id: 'other' }, { ...h.sender, url: 'https://example.com/' }]) assert.equal(await h.dispatch(message, sender), undefined);
  assert.equal(await h.dispatch({ ...message, video: { id: '../123' } }), undefined);
  h.data.settings = Core.normalizeSettings({ learnedAds: Array.from({ length: 2000 }, (_, i) => ({ id: String(i) })) });
  assert.equal((await h.dispatch({ ...message, video: { id: '99999' } })).ok, false);
  assert.equal(h.data.settings.learnedAds.length, 2000);
  assert.equal(h.data.settings.learnedAds[0].id, '0');
});
