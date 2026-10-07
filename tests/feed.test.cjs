const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Feed = require('../feed-data.js');
test('接口仅限抖音推荐流，忽略跟随、搜索和相似域名', () => {
  assert.ok(Feed.feedURL('https://www.douyin.com/aweme/v1/web/tab/feed/?token=private'));
  for (const u of ['https://evil.com/aweme/v1/web/tab/feed/', 'https://douyin.com.evil.com/aweme/v1/web/tab/feed/', '/aweme/v1/web/follow/feed/', 'http://www.douyin.com/aweme/v1/web/tab/feed/']) assert.equal(Feed.feedURL(u), false);
});
test('严格广告布尔值、字符串 ID；不根据 raw_ad_data 和作者直播状态猜测', () => {
  assert.deepEqual(Feed.records({ aweme_list: [
    { aweme_id: '123', is_ads: true, caption: 'private' }, { aweme_id: '124', is_ads: false },
    { aweme_id: '125', is_ads: 'true' }, { aweme_id: 126, is_ads: true },
    { aweme_id: '127', raw_ad_data: {}, author: { live_status: 1 } }
  ] }), [{ id: '123', ad: true }, { id: '124', ad: false }]);
  assert.equal(Feed.validate([{ id: 'bad', ad: true }]), null);
  assert.equal(Feed.validate(Array(501).fill({ id: '1', ad: true })), null);
});
function captureHarness() {
  const listeners = []; const messages = []; let cloneCount = 0;
  const response = { ok: true, url: 'https://www.douyin.com/aweme/v1/web/tab/feed/', clone() { cloneCount++; return { json: async () => ({ aweme_list: [{ aweme_id: '123', is_ads: true, caption: 'private' }] }) }; } };
  const promise = Promise.resolve(response);
  class XHR {
    open(...args) { this.args = args; return 'original'; }
    addEventListener(name, listener) { this.listener = listener; }
  }
  const window = { fetch: () => promise, XMLHttpRequest: XHR, addEventListener(name, listener) { listeners.push(listener); }, postMessage(data) { messages.push(data); } };
  const context = vm.createContext({ window, location: { origin: 'https://www.douyin.com' }, DouyinCleanerFeed: Feed, URL, WeakMap, WeakSet, Map, Reflect, Array, String, JSON });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../feed-capture.js'), 'utf8'), context);
  const configure = (enabled, source = window) => listeners[0]({ source, origin: 'https://www.douyin.com', data: { channel: Feed.CHANNEL, kind: 'configure', enabled } });
  return { window, messages, response, promise, configure, clones: () => cloneCount };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('fetch 保留原 Promise/响应、只读副本，关闭后不解析；拒绝其他窗口配置', async () => {
  const h = captureHarness();
  h.configure(true, {});
  await h.window.fetch('/aweme/v1/web/tab/feed/'); await flush(); assert.equal(h.clones(), 0);
  h.configure(true);
  assert.equal(h.window.fetch('/aweme/v1/web/tab/feed/'), h.promise);
  await flush(); assert.equal(h.clones(), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.messages[0].items)), [{ id: '123', ad: true }]);
  assert.equal(await h.promise, h.response);
  h.configure(false); await h.window.fetch('/aweme/v1/web/tab/feed/'); await flush(); assert.equal(h.clones(), 1);
});
test('XHR 重用仅注册一个监听器、忽略非推荐请求和不支持的响应类型', () => {
  const h = captureHarness(); h.configure(true);
  const xhr = new h.window.XMLHttpRequest();
  assert.equal(xhr.open('GET', '/aweme/v1/web/tab/feed/'), 'original');
  const listener = xhr.listener;
  xhr.open('GET', '/aweme/v1/web/tab/feed/'); assert.equal(xhr.listener, listener);
  Object.assign(xhr, { status: 200, responseType: 'json', response: { aweme_list: [{ aweme_id: '124', is_ads: false }] } });
  xhr.listener(); assert.equal(h.messages.length, 1);
  xhr.open('GET', '/aweme/v1/web/follow/feed/'); xhr.listener(); assert.equal(h.messages.length, 1);
  xhr.open('GET', '/aweme/v1/web/tab/feed/'); xhr.responseType = 'blob'; xhr.listener(); assert.equal(h.messages.length, 1);
});
