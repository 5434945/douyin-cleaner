// ==UserScript==
// @name         抖音清爽刷 · 广告直播带货过滤
// @namespace    https://github.com/5434945/douyin-cleaner
// @version      0.5.0
// @description  自动跳过抖音推荐流的明确广告、直播推荐和可选带货视频，支持手动标记广告、作者黑名单和快速拉黑；数据仅保存在本机。
// @author       5434945
// @license      MIT
// @match        https://www.douyin.com/*
// @match        https://douyin.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @homepageURL  https://github.com/5434945/douyin-cleaner
// @supportURL   https://github.com/5434945/douyin-cleaner/issues
// ==/UserScript==


(function () {
"use strict";
const localScope = {};

// Public promotion evidence is documented in BLOCKLIST-SOURCES.md.
(function (scope) {
  const authors = [{"id": "MS4wLjABAAAAzrsizXjQ2Y4DkAizBlloEjP4YYIARJYniZzFOk-6EobyNk2XPgl6L1pBB3GBVdtM", "name": "Car呆珊珊", "evidence": {"basis": "caption-disclosure", "source": "https://www.douyin.com/video/7605176127564352794"}}, {"id": "MS4wLjABAAAA4S9rB0aTAmiPKFbD7YUZ3bJhRYuYcJ2fpnGFWoveb1I", "name": "小怡", "evidence": {"basis": "referral-disclosure", "source": "https://www.douyin.com/note/7553214755192900907"}}];
  scope.DouyinCleanerBlocklist = authors;
  if (typeof module !== 'undefined' && module.exports) module.exports = authors;
})(localScope);


/* Independent implementation. Page signals are documented in REFERENCES.md. */
(function (scope) {
  "use strict";
  const seed = scope.DouyinCleanerBlocklist || (typeof module !== 'undefined' && module.exports ? require('./blocked-authors.js') : []);
  const DEFAULTS = Object.freeze({
    enabled: true, skipAds: true, skipLive: true, skipShopping: false,
    showNotice: true, iconDetection: true, apiDetection: true, shieldAds: true, skipDelay: 250, settingsRevision: 1, whitelist: [], skipBlocked: true, collectBrandPromoters: true, blacklist: seed, collectionExclusions: [], learnedAds: []
  });
  const SELECTORS = Object.freeze({
    cards: '[data-e2e="feed-item"]',
    active: '[data-e2e="feed-active-video"]',
    feed: '[data-e2e="slideList"], #slidelist',
    author: '[data-e2e="feed-video-nickname"]',
    authorLink: '[data-e2e="video-avatar"][href], [data-e2e="feed-video-nickname"] a[href], .account a[href*="/user/"]',
    description: '[data-e2e="video-desc"]',
    metadata: '.account, [data-e2e="video-info"]',
    live: '[data-e2e="feed-live"]',
    ad: '[data-e2e="ad-link"], [data-e2e="ad-label"], [data-e2e="ad-tag"]',
    shopping: '.xgplayer-shop-anchor, [data-e2e="product-card"], [data-e2e="goods-card"], [data-e2e="shopping-cart"], [data-e2e="video-product"]',
    next: '[data-e2e="video-switch-next-arrow"], .xgplayer-playswitch-next, [aria-label="下一条"], [aria-label="下一个视频"]',
    previous: '[data-e2e="video-switch-prev-arrow"], .xgplayer-playswitch-prev, [aria-label="上一条"], [aria-label="上一个视频"]',
    excluded: '[data-e2e="video-desc"], [data-e2e="feed-video-nickname"], [data-e2e="video-avatar"], [data-e2e="live-avatar"], [data-e2e*="comment"], [role="dialog"], #dy-cleaner-ui'
  });
  const AD_LABEL = /^(广告|推广|赞助|商业推广|品牌推广|付费推广)$/;
  const LIVE_ENTRY = /^(点击)?进入直播间$|^观看直播$/;
  const LABEL_NODES = 'span, small, i, label, div, button, a, [aria-label]';

  function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function normalizeSettings(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const settings = { ...DEFAULTS };
    for (const key of ['enabled', 'skipAds', 'skipLive', 'skipShopping', 'showNotice', 'iconDetection', 'apiDetection', 'shieldAds', 'skipBlocked', 'collectBrandPromoters']) {
      if (typeof value[key] === 'boolean') settings[key] = value[key];
    }
    if (Number.isFinite(value.skipDelay)) {
      // Migrate the original 450 ms default once; later explicit choices remain intact.
      const delay = value.settingsRevision == null && value.skipDelay === 450 ? DEFAULTS.skipDelay : value.skipDelay;
      settings.skipDelay = Math.max(200, Math.min(1500, Math.round(delay)));
    }
    settings.whitelist = Array.isArray(value.whitelist) ? value.whitelist.filter(item => item && typeof item.id === 'string' && /^[A-Za-z0-9_.-]{1,180}$/.test(item.id)).slice(0, 100).map(item => ({ id: item.id, name: cleanText(item.name).slice(0, 80) })) : [];
    settings.blacklist = normalizeAuthors(Array.isArray(value.blacklist) ? value.blacklist : seed, 1000);
    settings.collectionExclusions = Array.isArray(value.collectionExclusions) ? [...new Set(value.collectionExclusions.filter(id => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,180}$/.test(id)))].slice(0, 1000) : [];
    settings.learnedAds = normalizeLearnedAds(value.learnedAds);
    return settings;
  }
  function normalizeLearnedAds(items) {
    const unique = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      if (item && typeof item.id === 'string' && /^\d{1,30}$/.test(item.id)) unique.set(item.id, { id: item.id, title: cleanText(item.title).slice(0, 100) });
    }
    return Array.from(unique.values()).slice(0, 2000);
  }
  function videoId(root) {
    if (!root) return '';
    const match = identity(root).match(/^data-(?:e2e-vid|e2e-aweme-id|aweme-id):(\d{1,30})$/);
    return match ? match[1] : '';
  }
  function normalizeAuthors(items, limit = 1000) {
    const unique = new Map();
    for (const item of items) if (item && typeof item.id === 'string' && /^[A-Za-z0-9_.-]{1,180}$/.test(item.id)) {
      const entry = { id: item.id, name: cleanText(item.name).slice(0, 80) };
      if (item.evidence && ['ad-api', 'ad-node', 'ad-label', 'caption-disclosure', 'referral-disclosure'].includes(item.evidence.basis)) {
        try { const u = new URL(item.evidence.source); if (u.protocol === 'https:' && ['www.douyin.com', 'douyin.com'].includes(u.hostname) && /^\/(video|note)\/\d+$/.test(u.pathname)) entry.evidence = { basis: item.evidence.basis, source: `https://www.douyin.com${u.pathname}` }; } catch {}
      }
      unique.set(item.id, entry);
    }
    return Array.from(unique.values()).slice(0, limit);
  }
  function parseBlacklist(text) {
    let items;
    try { const value = JSON.parse(text); items = Array.isArray(value) ? value : value.authors; }
    catch { items = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(value => {
      try { const u = new URL(value); if (u.protocol === 'https:' && ['www.douyin.com', 'douyin.com'].includes(u.hostname) && /^\/user\/[A-Za-z0-9_.-]+\/?$/.test(u.pathname)) return { id: u.pathname.split('/')[2], name: '' }; } catch {}
      return null;
    }); }
    if (!Array.isArray(items) || !items.length || items.length > 1000 || items.some(item => !item || typeof item.id !== 'string' || !/^[A-Za-z0-9_.-]{1,180}$/.test(item.id))) throw new Error('请输入有效 JSON 名单或抖音作者主页链接，每行一个，最多 1000 个。');
    return normalizeAuthors(items);
  }
  function promotionEvidence(text, reasons = []) {
    if (!/(?:华为|鸿蒙|HarmonyOS|HUAWEI|问界|智界|享界|尊界|尚界|乾崑)/i.test(text)) return null;
    const explicit = reasons.find(item => item.type === 'ad' && ['ad-api', 'ad-node', 'ad-label'].includes(item.rule));
    if (explicit) return explicit.rule;
    // Exact disclosure hashtags only; ordinary discussion of commercial deals is ignored.
    if (/#(?:华为|鸿蒙智行|问界(?:M\d+)?|智界(?:R\d+|S\d+)?|享界(?:S\d+T?)?|尊界(?:S\d+)?|尚界(?:[A-Z]\d+)?)合作推广(?=\s|#|$)/i.test(text)) return 'caption-disclosure';
    if (/#鸿蒙智行推荐官计划/.test(text) && /(?:邀请|推荐)好友/.test(text) && /(?:下单|购车)/.test(text) && /(?:得|获|赚|赠).{0,8}积分/.test(text)) return 'referral-disclosure';
    return null;
  }
  function supportedPage(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['www.douyin.com', 'douyin.com'].includes(parsed.hostname)) return false;
      // Grid pages are harmless: no feed card means no action. Detail, search and live pages are excluded.
      return /^\/$|^\/(?:root\/)?recommend\/?$|^\/root\/?$/.test(parsed.pathname);
    } catch { return false; }
  }
  function visible(element) {
    if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const win = element.ownerDocument.defaultView;
    const style = win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (Number(win.getComputedStyle(parent).opacity) === 0) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth;
  }
  function usable(element) {
    if (!visible(element)) return false;
    return !element.closest('[disabled], [aria-disabled="true"], .disabled') && element.ownerDocument.defaultView.getComputedStyle(element).pointerEvents !== 'none';
  }
  function excluded(element) { return Boolean(element.closest(SELECTORS.excluded)); }
  function signalNodes(root, selector) {
    const nodes = Array.from(root.querySelectorAll(selector));
    if (root.matches(selector)) nodes.unshift(root);
    return nodes.filter(el => visible(el) && !excluded(el));
  }
  function findLabel(root, pattern) {
    return signalNodes(root, LABEL_NODES).find(el => {
      // Exact, small labels only. Never search the entire card's text as an ad signal.
      const text = cleanText(el.textContent);
      const aria = cleanText(el.getAttribute('aria-label'));
      return (el.children.length <= 2 && text.length <= 10 && pattern.test(text)) || pattern.test(aria);
    });
  }
  // Known visible 广告 glyph observed in the public recommendation UI on 2026-10-07.
  // Compare vector content rather than depending only on one viewBox value.
  const AD_GLYPH = 'M9.492 2.004L8.22 2.22c.216.336.408.72.588 1.128h-4.38v3.636c-.024 2.34-.348 4.176-.972 5.496l.96.852c.744-1.596 1.128-3.708 1.164-6.348V4.452h8.796V3.348h-4.308a16.717 16.717 0 0 0-.576-1.344zm15.564 6.672h-8.04v4.548h1.152v-.576h5.736v.576h1.152V8.676zm-6.888 2.904V9.756h5.736v1.824h-5.736zm-.276-6.732h2.688v1.656h-5.04V7.62h10.92V6.504h-4.74V4.848h3.828V3.756H21.72V2.148h-1.14v1.608h-2.016c.204-.408.372-.852.516-1.32l-1.128-.144c-.384 1.248-1.104 2.292-2.16 3.144l.684.9a8.301 8.301 0 0 0 1.416-1.488z'.replace(/[\s,]+/g, '');
  const AD_EXCLUDED = '[data-e2e="video-desc"], [data-e2e="video-avatar"], [data-e2e="live-avatar"], [data-e2e*="comment"], [role="dialog"], #dy-cleaner-ui';
  function adNodes(root, selector) {
    const nodes = Array.from(root.querySelectorAll(selector));
    if (root.matches(selector)) nodes.unshift(root);
    return nodes.filter(el => {
      if (!visible(el) || el.closest(AD_EXCLUDED)) return false;
      const author = el.closest(SELECTORS.author);
      if (!author) return true;
      // An explicit ad node is distinct from the nickname, even inside its wrapper.
      if (el !== author && el.matches(SELECTORS.ad)) return true;
      const nameText = author.querySelector('.account-name-text');
      return Boolean(el !== author && nameText && !nameText.contains(el) && !el.contains(nameText));
    });
  }
  function adLabel(root) {
    return adNodes(root, `${LABEL_NODES}, svg`).find(el => {
      const text = cleanText(el.textContent);
      const aria = cleanText(el.getAttribute('aria-label'));
      return (el.children.length <= 2 && text.length <= 10 && AD_LABEL.test(text)) || AD_LABEL.test(aria);
    });
  }
  function authorInfo(root) {
    const nameNode = root.querySelector(SELECTORS.author);
    const name = cleanText((nameNode?.querySelector('.account-name-text') || nameNode)?.textContent).replace(/^@/, '');
    for (const link of root.querySelectorAll(SELECTORS.authorLink)) {
      try {
        const url = new URL(link.getAttribute('href'), 'https://www.douyin.com');
        if (!['www.douyin.com', 'douyin.com'].includes(url.hostname)) continue;
        const match = url.pathname.match(/^\/user\/([A-Za-z0-9_.-]+)\/?$/);
        if (match) return { id: match[1], name: name || '此作者' };
      } catch { /* Ignore malformed links. */ }
    }
    return { id: '', name };
  }
  function classify(root, options = DEFAULTS, metadata = null) {
    const reasons = [];
    const author = authorInfo(root);
    const add = (type, rule, evidence) => reasons.push({ type, rule, evidence });
    const id = videoId(root);
    if (id && options.learnedAds?.some(item => item.id === id)) add('ad', 'ad-user', '你曾将这条视频标记为广告');
    if (signalNodes(root, SELECTORS.live).length) add('live', 'live-card', '直播卡片标识');
    else if (findLabel(root, LIVE_ENTRY)) add('live', 'live-entry', '进入直播间入口');
    if (options.apiDetection && metadata?.ad === true) add('ad', 'ad-api', '推荐接口明确标记为广告');
    if (adNodes(root, SELECTORS.ad).length) add('ad', 'ad-node', '广告专用节点');
    else {
      let label = null;
      for (const zone of root.querySelectorAll(SELECTORS.metadata)) {
        label = adLabel(zone);
        if (label) break;
      }
      // Accessible explicit tags elsewhere; nickname text, captions and comments stay excluded.
      label ||= adNodes(root, '[aria-label]').find(el => AD_LABEL.test(cleanText(el.getAttribute('aria-label'))));
      if (label) add('ad', 'ad-label', cleanText(label.getAttribute('aria-label') || label.textContent));
      else if (options.iconDetection) {
        const icon = adNodes(root, '.account svg').find(el =>
          Array.from(el.querySelectorAll('path[d]')).some(path => path.getAttribute('d').replace(/[\s,]+/g, '') === AD_GLYPH) ||
          cleanText(el.getAttribute('viewBox')).split(/[\s,]+/).map(Number).join(' ') === '0 0 30 16');
        if (icon) add('ad', 'ad-account-icon', '作者信息区的广告图标（兼容规则）');
      }
    }
    if (signalNodes(root, SELECTORS.shopping).length) add('shopping', 'shopping-node', '商品卡或购物组件');
    else {
      const productLink = signalNodes(root, 'a[href]').find(el => {
        const text = cleanText(el.textContent);
        if (!/^(立即购买|购买同款|去购买|查看商品|商品详情)$/.test(text)) return false;
        try {
          const url = new URL(el.getAttribute('href'), 'https://www.douyin.com');
          return /(^|\.)(jinritemai\.com|douyin\.com)$/.test(url.hostname) && /product|goods|commerce|shop/.test(url.pathname);
        } catch { return false; }
      });
      if (productLink) add('shopping', 'shopping-link', '商品购买入口');
    }
    if (author.id && options.whitelist.some(item => item.id === author.id)) return { type: 'allowed', rule: 'author-whitelist', evidence: '作者在白名单中', author, reasons };
    if (options.skipBlocked && author.id && options.blacklist?.some(item => item.id === author.id)) { add('blocked', 'author-blacklist', '作者在黑名单中'); return { type: 'blocked', rule: 'author-blacklist', evidence: '作者在黑名单中', author, reasons }; }
    const reason = reasons.find(item => ({ ad: options.skipAds, live: options.skipLive, shopping: options.skipShopping })[item.type]);
    return { ...(reason || { type: 'normal', rule: 'no-enabled-rule', evidence: '未发现已开启的过滤标识' }), author, reasons };
  }
  function activeCard(doc = document) {
    // Live slides can have a different root while old video cards stay mounted.
    // Always consider live/active roots, and retain the enclosing slide so its
    // entry label and room identity are included in the same detection scope.
    const cards = new Set(doc.querySelectorAll(SELECTORS.cards));
    for (const node of doc.querySelectorAll(`${SELECTORS.active}, ${SELECTORS.live}`)) {
      const slide = node.closest(SELECTORS.cards) || (node.closest(SELECTORS.feed) && node.closest('.dySwiperSlide'));
      cards.add(slide || node);
    }
    const win = doc.defaultView;
    let best = null;
    let score = -1;
    for (const root of cards) {
      if (!visible(root) || root.closest('[role="dialog"], [aria-modal="true"]')) continue;
      const rect = root.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 180) continue;
      const width = Math.max(0, Math.min(rect.right, win.innerWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, win.innerHeight) - Math.max(rect.top, 0));
      const fraction = width * height / (Math.min(rect.width, win.innerWidth) * Math.min(rect.height, win.innerHeight));
      if (fraction < 0.62) continue;
      const isActive = root.matches(SELECTORS.active) || Boolean(root.querySelector(SELECTORS.active));
      const value = fraction + (isActive ? 2 : 0) - Math.abs((rect.top + rect.bottom) / 2 - win.innerHeight / 2) / win.innerHeight * 0.1;
      if (value > score) { best = root; score = value; }
    }
    return best;
  }
  function identity(root) {
    const identityNode = root.matches('[data-e2e-vid], [data-e2e-aweme-id], [data-aweme-id], [data-room-id]') ? root : root.querySelector('[data-e2e-vid], [data-e2e-aweme-id], [data-aweme-id], [data-room-id]');
    if (identityNode) {
      for (const attr of ['data-e2e-vid', 'data-e2e-aweme-id', 'data-aweme-id', 'data-room-id']) {
        const id = identityNode.getAttribute(attr);
        if (id) return `${attr}:${id}`;
      }
    }
    const live = signalNodes(root, 'a[href]').find(el => {
      try { const u = new URL(el.getAttribute('href'), 'https://www.douyin.com'); return u.hostname === 'live.douyin.com' && /^\/\d+\/?$/.test(u.pathname); } catch { return false; }
    });
    if (live) return `room:${new URL(live.getAttribute('href'), 'https://www.douyin.com').pathname}`;
    const media = root.querySelector('video');
    const src = media?.currentSrc || media?.getAttribute('src');
    if (src) return `media:${src}`;
    const description = cleanText(root.querySelector(SELECTORS.description)?.textContent);
    const author = authorInfo(root);
    if (description || author.id || author.name) return `fallback:${author.id || author.name}:${description}`;
    return ''; // Ambiguous cards are never auto-skipped.
  }
  function navigationControl(root, direction) {
    const selector = direction === 'next' ? SELECTORS.next : SELECTORS.previous;
    const feed = root.closest(SELECTORS.feed);
    // Never click global controls belonging to another player.
    for (const zone of [root, feed].filter(Boolean)) {
      for (const el of zone.querySelectorAll(selector)) if (usable(el)) return el;
    }
    return null;
  }
  const api = Object.freeze({ DEFAULTS, SELECTORS, cleanText, normalizeSettings, normalizeLearnedAds, videoId, normalizeAuthors, parseBlacklist, promotionEvidence, supportedPage, visible, usable, classify, activeCard, identity, authorInfo, navigationControl });
  scope.DouyinCleanerCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(localScope);


(function (scope) {
  'use strict';
  const CHANNEL = 'douyin-cleaner-feed-v1';
  function feedURL(value) {
    try {
      const u = new URL(value, 'https://www.douyin.com');
      return u.protocol === 'https:' && ['www.douyin.com', 'douyin.com'].includes(u.hostname) && u.pathname === '/aweme/v1/web/tab/feed/';
    } catch { return false; }
  }
  function records(body) {
    if (!Array.isArray(body?.aweme_list)) return [];
    return body.aweme_list.slice(0, 500).filter(item => item && typeof item.aweme_id === 'string' && /^\d{1,30}$/.test(item.aweme_id) && typeof item.is_ads === 'boolean').map(item => ({ id: item.aweme_id, ad: item.is_ads }));
  }
  function validate(items) {
    if (!Array.isArray(items) || items.length > 500) return null;
    return items.every(item => item && typeof item.id === 'string' && /^\d{1,30}$/.test(item.id) && typeof item.ad === 'boolean') ? items.map(item => ({ id: item.id, ad: item.ad })) : null;
  }
  const api = Object.freeze({ CHANNEL, feedURL, records, validate });
  scope.DouyinCleanerFeed = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(localScope);


// Local compatibility layer. No Chrome extension API is used or modified.
const runtimeListeners = [], changeListeners = [], installedListeners = [], commandListeners = [];
const runtimeId = 'douyin-cleaner-userscript';
async function withStorageLock(fn) {
  // Coordinate writes between tabs of the same origin, when Web Locks is available.
  if (navigator.locks?.request) return navigator.locks.request(runtimeId + '-storage', fn);
  return fn();
}
function notifyStorage(key, oldValue, newValue) {
  for (const listener of changeListeners) listener({ [key]: { oldValue, newValue } }, 'local');
}
for (const key of ['settings', 'stats', 'recent']) {
  GM_addValueChangeListener(key, (name, oldValue, newValue, remote) => {
    if (remote) notifyStorage(name, oldValue, newValue);
  });
}
function dispatch(message) {
  return new Promise((resolve, reject) => {
    let replied = false, pending = false;
    const reply = value => { if (!replied) { replied = true; resolve(value); } };
    const sender = { id: runtimeId, url: location.href };
    if (!['patchSettings', 'resetStats', 'removeLearnedAd'].includes(message.action)) sender.tab = { id: 1, url: location.href };
    try {
      for (const listener of runtimeListeners) if (listener(message, sender, reply) === true) pending = true;
      if (!pending && !replied) reject(new Error('脚本尚未连接，请刷新抖音页面。'));
    } catch (error) { reject(error); }
  });
}
const chrome = {
  runtime: {
    id: runtimeId, getManifest: () => ({ version: '0.5.0' }), sendMessage: dispatch,
    onMessage: { addListener: listener => runtimeListeners.push(listener) },
    onInstalled: { addListener: listener => installedListeners.push(listener) }
  },
  commands: { onCommand: { addListener: listener => commandListeners.push(listener) } },
  tabs: { query: async () => [{ id: 1, url: location.href }], sendMessage: (_id, message) => dispatch(message) },
  storage: {
    onChanged: { addListener: listener => changeListeners.push(listener) },
    local: {
      get: async keys => Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, GM_getValue(key)])),
      set: async values => {
        for (const [key, value] of Object.entries(values)) {
          const oldValue = GM_getValue(key);
          await GM_setValue(key, value);
          notifyStorage(key, oldValue, value);
        }
      }
    }
  }
};


(() => {
"use strict";

const Core = localScope.DouyinCleanerCore;
let queue = Promise.resolve();
function serialize(fn) {
  const task = queue.then(() => withStorageLock(fn));
  queue = task.catch(() => {});
  return task;
}
async function initialize() {
  const data = await chrome.storage.local.get(['settings', 'stats']);
  const update = { settings: Core.normalizeSettings(data.settings) };
  if (!data.stats) update.stats = { ad: 0, live: 0, shopping: 0, blocked: 0, failures: 0 };
  await chrome.storage.local.set(update);
}
chrome.runtime.onInstalled.addListener(() => serialize(initialize));
chrome.commands.onCommand.addListener(async command => {
  if (command === 'block-current-author') {
    // Do not hold the storage queue while the page sends its save request back.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { target: 'dy-cleaner-page', action: 'quickBlock' });
    } catch { /* Closed tabs and pages without the extension are harmless. */ }
    return;
  }
  if (command !== 'toggle-enabled') return;
  return serialize(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const next = Core.normalizeSettings(settings);
    next.enabled = !next.enabled;
    await chrome.storage.local.set({ settings: next });
  });
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message || message.target !== 'dy-cleaner-background') return;
  if (sender.tab) {
    try {
      if (!Core.supportedPage(sender.url || sender.tab.url)) return;
    } catch { return; }
  }
  let job;
  if (message.action === 'record' && ['ad', 'live', 'shopping', 'blocked', 'failures'].includes(message.type) && sender.tab) {
    job = () => updateStats(message.type, message.rule);
  } else if (message.action === 'resetStats' && !sender.tab) {
    job = () => chrome.storage.local.set({ stats: { ad: 0, live: 0, shopping: 0, blocked: 0, failures: 0 }, recent: [] });
  } else if (message.action === 'patchSettings' && !sender.tab) {
    job = async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: Core.normalizeSettings({ ...Core.normalizeSettings(settings), ...message.patch }) });
    };
  } else if (message.action === 'setEnabledFromPage' && sender.tab && typeof message.enabled === 'boolean') {
    job = async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: Core.normalizeSettings({ ...settings, enabled: message.enabled }) });
    };
  } else if (['markAd', 'removeLearnedAd'].includes(message.action) && typeof message.video?.id === 'string' && /^\d{1,30}$/.test(message.video.id) && (message.action !== 'markAd' || sender.tab)) {
    job = async () => {
      const { settings } = await chrome.storage.local.get('settings');
      const next = Core.normalizeSettings(settings);
      const remaining = next.learnedAds.filter(item => item.id !== message.video.id);
      if (message.action === 'markAd') {
        if (remaining.length >= 2000) throw new Error('广告标记已满，请先移除部分标记。');
        remaining.push({ id: message.video.id, title: message.video.title });
      }
      next.learnedAds = Core.normalizeLearnedAds(remaining);
      await chrome.storage.local.set({ settings: next });
    };
  } else if (['addAuthor', 'blockAuthor', 'collectPromoter'].includes(message.action) && sender.tab && typeof message.author?.id === 'string') {
    job = async () => {
      const { settings } = await chrome.storage.local.get('settings');
      const next = Core.normalizeSettings(settings);
      const collecting = message.action === 'collectPromoter';
      if (collecting) {
        const entry = Core.normalizeAuthors([{ ...message.author, evidence: message.evidence }])[0];
        if (!entry?.evidence || !next.enabled || !next.skipBlocked || !next.collectBrandPromoters || next.collectionExclusions.includes(entry.id) || next.whitelist.some(item => item.id === entry.id)) return;
        if (next.blacklist.some(item => item.id === entry.id)) return;
        message = { ...message, author: entry };
      }
      const field = message.action !== 'addAuthor' ? 'blacklist' : 'whitelist';
      if (next[field].length >= (field === 'blacklist' ? 1000 : 100) && !next[field].some(item => item.id === message.author.id)) throw new Error('作者名单已满');
      next[field] = next[field].filter(item => item.id !== message.author.id);
      next[field].push(message.author);
      if (!collecting && field === 'blacklist') next.collectionExclusions = next.collectionExclusions.filter(id => id !== message.author.id);
      const other = field === 'blacklist' ? 'whitelist' : 'blacklist';
      next[other] = next[other].filter(item => item.id !== message.author.id);
      await chrome.storage.local.set({ settings: Core.normalizeSettings(next) });
    };
  }
  if (!job) return;
  serialize(job).then(() => reply({ ok: true }), () => reply({ ok: false, error: '本地存储更新失败，请重新加载插件。' }));
  return true;
});
async function updateStats(type, rule) {
  const { stats = {}, recent = [] } = await chrome.storage.local.get(['stats', 'recent']);
  const next = {};
  for (const key of ['ad', 'live', 'shopping', 'blocked', 'failures']) next[key] = Math.max(0, Number(stats[key]) || 0);
  next[type] += 1;
  // No video URL, caption, author, or account information is logged.
  const entries = Array.isArray(recent) ? recent.slice(-19) : [];
  entries.push({ time: new Date().toISOString(), type, rule: String(rule || '').replace(/[^a-z0-9-]/g, '').slice(0, 60) });
  await chrome.storage.local.set({ stats: next, recent: entries });
}
})();


for (const initialize of installedListeners) initialize();

try {
// Passive observer: original requests, response bodies and promises are preserved.
(function (window) {
  'use strict';
  const Feed = localScope.DouyinCleanerFeed;
  if (!Feed || typeof Feed.records !== 'function' || typeof Feed.feedURL !== 'function') return;
  let enabled = false;
  const cache = new Map();
  const publish = items => window.postMessage({ channel: Feed.CHANNEL, kind: 'records', items }, location.origin);
  function receive(body) {
    if (!enabled) return;
    const items = Feed.records(body);
    for (const item of items) { cache.delete(item.id); cache.set(item.id, item); }
    while (cache.size > 500) cache.delete(cache.keys().next().value);
    if (items.length) publish(items);
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== Feed.CHANNEL || event.data.kind !== 'configure' || typeof event.data.enabled !== 'boolean') return;
    enabled = event.data.enabled;
    if (!enabled) cache.clear();
    else if (cache.size) publish(Array.from(cache.values()));
  });
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') window.fetch = function (...args) {
    const promise = Reflect.apply(originalFetch, this, args);
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    if (enabled && Feed.feedURL(url)) promise.then(response => {
      if (enabled && response.ok && Feed.feedURL(response.url || url)) response.clone().json().then(receive).catch(() => {});
    }).catch(() => {});
    return promise;
  };
  const proto = window.XMLHttpRequest?.prototype;
  if (proto) {
    const originalOpen = proto.open;
    const urls = new WeakMap();
    const observed = new WeakSet();
    proto.open = function (...args) {
      const result = Reflect.apply(originalOpen, this, args);
      urls.set(this, Feed.feedURL(typeof args[1] === 'string' ? args[1] : String(args[1])));
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener('load', () => {
          if (!enabled || !urls.get(this) || (this.responseURL && !Feed.feedURL(this.responseURL)) || this.status < 200 || this.status >= 300) return;
          try {
            if (this.responseType === 'json') receive(this.response);
            else if (!this.responseType || this.responseType === 'text') receive(JSON.parse(this.responseText));
          } catch { /* Invalid or unreadable JSON is ignored. */ }
        });
      }
      return result;
    };
  }
})(unsafeWindow);
} catch (error) { console.warn("清爽刷：接口辅助识别不可用，页面识别仍可运行", error); }

(function () {
  "use strict";
  const Core = localScope.DouyinCleanerCore;
  // The optional API observer must never prevent DOM filtering or manual marking.
  const feedAvailable = typeof localScope.DouyinCleanerFeed?.validate === 'function' && typeof localScope.DouyinCleanerFeed?.CHANNEL === 'string';
  const Feed = feedAvailable ? localScope.DouyinCleanerFeed : { CHANNEL: 'douyin-cleaner-feed-v1', validate: () => null };
  const feedRecords = new Map();
  let shield = null;
  function configureCapture() {
    const enabled = feedAvailable && settings.enabled && settings.apiDetection && settings.skipAds && Core.supportedPage(location.href);
    if (!enabled) feedRecords.clear();
    window.postMessage({ channel: Feed.CHANNEL, kind: 'configure', enabled }, location.origin);
  }
  window.addEventListener('message', event => {
    if (!feedAvailable || (event.source !== window && event.source !== unsafeWindow) || event.origin !== location.origin || event.data?.channel !== Feed.CHANNEL || event.data.kind !== 'records' || !settings.enabled || !settings.apiDetection || !settings.skipAds || !Core.supportedPage(location.href)) return;
    const items = Feed.validate(event.data.items);
    if (!items) return;
    for (const item of items) { feedRecords.delete(item.id); feedRecords.set(item.id, { ad: item.ad, expires: Date.now() + 600000 }); }
    while (feedRecords.size > 500) feedRecords.delete(feedRecords.keys().next().value);
    schedule(0);
  });
  function classify(root, key) {
    const match = key.match(/^data-(?:e2e-vid|e2e-aweme-id|aweme-id):(\d{1,30})$/);
    const record = match && feedRecords.get(match[1]);
    return Core.classify(root, settings, record?.expires > Date.now() ? record : null);
  }
  function clearShield() {
    if (!shield) return;
    const previous = shield; shield = null;
    clearTimeout(previous.timeout); previous.host.remove();
  }
  function showShield(root) {
    clearShield();
    if (!settings.shieldAds) return;
    const rect = root.getBoundingClientRect();
    const host = document.createElement('div'); host.id = 'dy-cleaner-shield';
    host.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;background:#111;color:#ddd;display:flex;align-items:center;justify-content:center;font:14px system-ui;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    host.textContent = '正在跳过广告';
    shield = { host, root, key: Core.identity(root), timeout: setTimeout(clearShield, 4200) };
    document.documentElement.appendChild(host);
    // Audio preferences belong to the player/user; do not trigger volumechange.
  }
  const labels = { ad: '广告 / 推广', live: '直播推荐', shopping: '带货视频', blocked: '黑名单作者' };
  let settings = Core.normalizeSettings();
  let ready = false;
  let stopped = false;
  let route = location.href;
  let current = null;
  let transaction = null;
  let lastSkipped = null;
  let manualUntil = 0;
  let status = '正在初始化';
  let timer = null;
  let timerDue = Infinity;
  let watchedFeed = null;
  let noticeTimer = null;
  let uiHost = null;
  let ui = null;
  let failUntil = 0;
  const allowed = new Map();
  const failed = new Set();
  const collectingAuthors = new Set();
  function collectCurrentPromoter() {
    const author = current.detection.author;
    if (!settings.skipBlocked || !settings.collectBrandPromoters || settings.blacklist.length >= 1000 || !current.root.querySelector('video') || !author.id || settings.collectionExclusions.includes(author.id) || settings.blacklist.some(item => item.id === author.id)) return false;
    const match = current.key.match(/^data-(?:e2e-vid|e2e-aweme-id|aweme-id):(\d{1,30})$/);
    if (!match) return false;
    const text = Core.cleanText(current.root.querySelector(Core.SELECTORS.description)?.textContent);
    const basis = Core.promotionEvidence(text, current.detection.reasons);
    if (!basis) return false;
    if (!collectingAuthors.has(author.id)) {
      collectingAuthors.add(author.id);
      sendBackground('collectPromoter', { author, evidence: { basis, source: `https://www.douyin.com/video/${match[1]}` } }).catch(storageFailure).finally(() => { collectingAuthors.delete(author.id); schedule(0); });
    }
    return true;
  }
  const observer = new MutationObserver(() => schedule(60));

  function sendBackground(action, fields = {}) {
    return chrome.runtime.sendMessage({ target: 'dy-cleaner-background', action, ...fields }).then(result => {
      if (!result?.ok) throw new Error('Storage update failed');
      return result;
    });
  }
  function schedule(delay = 60) {
    if (stopped) return;
    const due = Date.now() + delay;
    if (timer && timerDue <= due) return;
    clearTimeout(timer);
    timerDue = due;
    timer = setTimeout(() => { timer = null; timerDue = Infinity; tick(); }, delay);
  }
  function allowKey(key) {
    if (!key) return;
    allowed.delete(key);
    allowed.set(key, Date.now() + 10 * 60 * 1000);
    while (allowed.size > 200) allowed.delete(allowed.keys().next().value);
  }
  function isAllowed(key) {
    const expiry = allowed.get(key);
    if (!expiry) return false;
    if (expiry <= Date.now()) { allowed.delete(key); return false; }
    return true;
  }
  function isEditingOrModal() {
    const focused = document.activeElement?.shadowRoot?.activeElement || document.activeElement;
    if (focused?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return true;
    return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .semi-modal-content, [data-e2e="comment-list"]')).some(Core.visible);
  }
  function refreshObserver(root) {
    const feed = root?.closest(Core.SELECTORS.feed) || root?.parentElement || document.querySelector(Core.SELECTORS.feed);
    if (feed === watchedFeed && feed?.isConnected) return;
    observer.disconnect();
    watchedFeed = feed;
    if (feed) observer.observe(feed, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['data-e2e', 'data-e2e-vid', 'data-e2e-aweme-id', 'data-aweme-id', 'data-room-id', 'data-active', 'src', 'href', 'aria-label', 'viewBox', 'd', 'aria-hidden', 'class'] });
  }
  function ensureUI() {
    if (uiHost?.isConnected) return;
    uiHost = document.createElement('div');
    uiHost.id = 'dy-cleaner-ui';
    const shadow = uiHost.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all:initial; color-scheme:dark; } * { box-sizing:border-box; }
      .notice { font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif; color:#f2f5f7; background:#151b24f5; border:1px solid #34434d; border-radius:12px; padding:12px 14px; box-shadow:0 8px 28px #0005; max-width:360px; }
      .notice[hidden] { display:none; } .eyebrow { color:#6bdccc; font-size:11px; margin-bottom:3px; } .actions { display:flex; gap:8px; margin-top:9px; }
      button { border:1px solid #43535c; background:#25343d; color:#eaf9f7; border-radius:6px; padding:5px 10px; cursor:pointer; font:12px system-ui,"Microsoft YaHei",sans-serif; } button:hover { background:#345058; }
    </style><section class="notice" role="status" aria-live="polite" hidden><div class="eyebrow">抖音清爽刷</div><div class="message"></div><div class="actions"><button class="undo" type="button">返回并放行</button><button class="pause" type="button">暂停过滤</button><button class="dismiss" type="button" aria-label="关闭提示">关闭</button></div></section>`;
    ui = { box: shadow.querySelector('.notice'), message: shadow.querySelector('.message'), undo: shadow.querySelector('.undo') };
    ui.undo.addEventListener('click', () => undo());
    shadow.querySelector('.pause').addEventListener('click', async () => {
      settings.enabled = false;
      cancelTransaction();
      await sendBackground('setEnabledFromPage', { enabled: false }).catch(storageFailure);
      ui.box.hidden = true;
    });
    shadow.querySelector('.dismiss').addEventListener('click', () => { ui.box.hidden = true; });
    document.documentElement.appendChild(uiHost);
  }
  function notice(text, canUndo = false, force = false) {
    if (!settings.showNotice && !force) return;
    ensureUI();
    ui.message.textContent = text;
    ui.undo.hidden = !canUndo;
    ui.box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { if (ui) ui.box.hidden = true; }, canUndo ? 6000 : 4500);
  }
  function cancelTransaction() { clearShield(); transaction = null; }
  function updateCurrent(root, now) {
    if (!root) { current = null; return; }
    const key = Core.identity(root);
    const top = root.getBoundingClientRect().top;
    if (!current || current.key !== key || current.root !== root) {
      current = { root, key, since: now, top, detection: classify(root, key) };
    } else {
      if (Math.abs(top - current.top) > 6) current.since = now;
      current.top = top;
      current.detection = classify(root, key);
    }
  }
  function navigate(tx, fallback = false) {
    // Re-read the active card immediately before any action.
    const root = Core.activeCard();
    if (!root || Core.identity(root) !== tx.from || !Core.supportedPage(location.href) || isEditingOrModal() || document.hidden) return false;
    const control = !fallback && Core.navigationControl(root, tx.direction);
    tx.method = control ? 'button' : 'keyboard';
    tx.attemptedAt = Date.now();
    tx.attempts += 1;
    if (control) control.click();
    else {
      const key = tx.direction === 'next' ? 'ArrowDown' : 'ArrowUp';
      const code = tx.direction === 'next' ? 40 : 38;
      for (const type of ['keydown', 'keyup']) document.body.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true }));
    }
    return true;
  }
  function completeTransaction(tx) {
    clearShield();
    transaction = null;
    if (tx.kind === 'skip') {
      lastSkipped = { key: tx.from, destination: current.key, reason: tx.reason };
      sendBackground('record', { type: tx.reason.type, rule: tx.reason.rule }).catch(storageFailure);
      notice(`已跳过：${labels[tx.reason.type]}`, true);
    } else notice('已返回，本条已放行 10 分钟。', false, true);
    // The destination already has a stability timestamp. Keep the elapsed settling
    // time so consecutive ads do not incur a second full delay after confirmation.
  }
  function storageFailure() {
    settings.enabled = false;
    configureCapture();
    cancelTransaction();
    status = '插件连接中断，请刷新抖音页面';
    notice(status, false, true);
  }
  function tick() {
    if (!ready || stopped) return;
    const now = Date.now();
    if (location.href !== route) {
      route = location.href; configureCapture(); current = null; lastSkipped = null; cancelTransaction();
      if (ui) ui.box.hidden = true;
    }
    if (!Core.supportedPage(location.href)) {
      status = '仅在推荐视频流中生效'; current = null; cancelTransaction(); refreshObserver(null); return;
    }
    if (document.hidden) { status = '标签页在后台，已暂停'; cancelTransaction(); return; }
    const root = Core.activeCard();
    refreshObserver(root);
    updateCurrent(root, now);
    if (shield && (root !== shield.root || current?.key !== shield.key)) clearShield();
    if (!settings.enabled && transaction?.kind !== 'undo') { status = '已暂停自动过滤'; cancelTransaction(); return; }
    if (isEditingOrModal()) { status = '正在输入或有弹窗，暂停过滤'; cancelTransaction(); return; }
    if (now < manualUntil) { status = '手动操作中'; schedule(manualUntil - now); return; }
    if (!current?.key) { status = root ? '未读取到内容标识，保留本条' : '等待推荐流播放器'; return; }
    if (transaction) {
      const tx = transaction;
      if (current.key !== tx.from) {
        if (now - current.since < 120) { status = '正在确认切换'; schedule(40); return; }
        if (tx.kind === 'undo' && current.key !== tx.destination) {
          cancelTransaction(); notice('未能返回指定内容，请手动回看后点击“本条放行”。', false, true); return;
        }
        completeTransaction(tx);
      } else if (now - tx.attemptedAt > 1700) {
        if (tx.attempts < 2 && tx.method === 'button') {
          if (!navigate(tx, true)) cancelTransaction();
        } else {
          cancelTransaction();
          failed.add(current.key);
          if (failed.size > 200) failed.delete(failed.values().next().value);
          failUntil = now + 2500;
          status = '切换失败，已保留本条';
          sendBackground('record', { type: 'failures', rule: 'navigation-timeout' }).catch(storageFailure);
          notice('自动切换未成功，已停止重试。可手动切换下一条。', false, true);
        }
      }
      schedule(40);
      return;
    }
    if (lastSkipped && current.key !== lastSkipped.destination && ui) ui.undo.hidden = true;
    if (isAllowed(current.key)) { status = '本条已放行'; return; }
    if (failed.has(current.key)) { status = '切换失败，已保留本条'; return; }
    if (current.detection.type === 'allowed') { status = '白名单作者，保留本条'; return; }
    if (now - current.since < settings.skipDelay || now < failUntil) {
      status = '等待画面稳定';
      schedule(Math.max(20, Math.min(80, Math.max(current.since + settings.skipDelay, failUntil) - now)));
      return;
    }
    if (collectCurrentPromoter()) { status = '正在保存推广作者黑名单'; schedule(100); return; }
    if (!labels[current.detection.type]) { status = '检测中 · 保留当前内容'; return; }
    status = `正在跳过${labels[current.detection.type]}`;
    const tx = { kind: 'skip', from: current.key, reason: current.detection, direction: 'next', attempts: 0, attemptedAt: now };
    transaction = tx;
    if (tx.reason.type === 'ad') showShield(current.root);
    if (!navigate(tx)) cancelTransaction();
    schedule(40);
  }
  function undo() {
    const root = Core.activeCard();
    if (transaction || !lastSkipped || !root || Core.identity(root) !== lastSkipped.destination) {
      const result = { ok: false, error: '当前已不是紧接着的下一条，请手动回看后点击“本条放行”。' };
      notice(result.error, false, true); return result;
    }
    if (document.hidden || isEditingOrModal()) return { ok: false, error: '请先关闭页面弹窗或输入框，再返回。' };
    allowKey(lastSkipped.key);
    const tx = { kind: 'undo', from: lastSkipped.destination, destination: lastSkipped.key, direction: 'previous', attempts: 0, attemptedAt: Date.now() };
    transaction = tx;
    manualUntil = 0;
    if (!navigate(tx)) { cancelTransaction(); return { ok: false, error: '暂时无法返回，请手动回看。' }; }
    schedule(40);
    return { ok: true };
  }
  function manualInput(event) {
    if (!event.isTrusted || (event.composedPath().includes(uiHost) || event.composedPath().some(node => node?.id === 'dy-cleaner-userscript'))) return;
    if (event.type === 'keydown' && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Escape', ' '].includes(event.key)) return;
    const back = (event.type === 'keydown' && ['ArrowUp', 'PageUp'].includes(event.key)) || (event.type === 'wheel' && event.deltaY < 0);
    if (back && lastSkipped && current?.key === lastSkipped.destination) allowKey(lastSkipped.key);
    cancelTransaction();
    const navigationKey = event.type === 'keydown' && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key);
    const navigationClick = event.type === 'pointerdown' && event.target instanceof Element && event.target.closest(`${Core.SELECTORS.next}, ${Core.SELECTORS.previous}`);
    // Scroll/next-video inputs settle sooner; typing, touch and other clicks retain
    // the original guard. Repeated wheel/key events extend the guard each time.
    manualUntil = Date.now() + (navigationKey || navigationClick || event.type === 'wheel' ? 350 : 800);
    if (current) current.since = Date.now();
    schedule(60);
  }
  function getStatus() {
    tick();
    return {
      ok: true, status, supported: Core.supportedPage(location.href), version: chrome.runtime.getManifest().version,
      current: current ? { type: current.detection.type, rule: current.detection.rule, evidence: current.detection.evidence, author: current.detection.author, identified: Boolean(current.key), videoId: Core.videoId(current.root), markedAd: settings.learnedAds.some(item => item.id === Core.videoId(current.root)) } : null,
      canUndo: Boolean(lastSkipped && current?.key === lastSkipped.destination && !transaction),
      rules: current?.detection.reasons || [],
      selectorHits: { feedAvailable, card: Boolean(current), active: Boolean(current?.root.matches(Core.SELECTORS.active) || current?.root.querySelector(Core.SELECTORS.active)), next: Boolean(current && Core.navigationControl(current.root, 'next')) }
    };
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.target !== 'dy-cleaner-page') return;
    if (message.action === 'status') reply(getStatus());
    else if (message.action === 'undo') reply(undo());
    else if (message.action === 'allow') {
      const root = Core.activeCard();
      const key = root && Core.identity(root);
      if (!key) { reply({ ok: false, error: '未读取到当前内容，请进入推荐流。' }); return; }
      allowKey(key); cancelTransaction(); notice('本条已放行 10 分钟。', false, true); schedule(100); reply({ ok: true });
    } else if (['markAd', 'unmarkAd'].includes(message.action)) {
      const root = Core.activeCard();
      const id = Core.videoId(root);
      if (!Core.supportedPage(location.href) || !root?.querySelector('video') || !id) { reply({ ok: false, error: '未读取到稳定视频 ID，请停留在推荐视频上再试。' }); return; }
      if (message.expectedVideoId !== id) { reply({ ok: false, error: '视频已切换，请重新确认当前视频再标记。' }); return; }
      const key = Core.identity(root);
      cancelTransaction();
      sendBackground(message.action === 'markAd' ? 'markAd' : 'removeLearnedAd', { video: { id, title: Core.cleanText(root.querySelector(Core.SELECTORS.description)?.textContent).slice(0, 100) } }).then(result => {
        if (message.action === 'markAd') { allowed.delete(key); failed.delete(key); }
        else allowKey(key);
        schedule(100); reply(result);
      }, () => reply({ ok: false, error: '保存广告标记失败，请刷新页面或检查标记名单是否已满。' }));
      return true;
    } else if (['whitelist', 'block', 'quickBlock'].includes(message.action)) {
      const root = Core.activeCard();
      if (!Core.supportedPage(location.href)) { reply({ ok: false, error: '仅在推荐视频流中屏蔽作者。' }); return; }
      if (message.action === 'quickBlock' && (document.hidden || isEditingOrModal())) { reply({ ok: false, error: '正在输入或有弹窗，快捷屏蔽未执行。' }); return; }
      const author = root && Core.authorInfo(root);
      if (!author?.id) { if (message.action === 'quickBlock') notice('未读取到作者 ID，未屏蔽。', false, true); reply({ ok: false, error: '没有读取到作者 ID，可先使用“本条放行”。' }); return; }
      if (message.action === 'whitelist') allowKey(Core.identity(root));
      else { allowed.delete(Core.identity(root)); if (message.action === 'quickBlock') failed.delete(Core.identity(root)); }
      cancelTransaction();
      sendBackground(message.action !== 'whitelist' ? 'blockAuthor' : 'addAuthor', { author }).then(result => {
        if (message.action === 'quickBlock') notice(`已屏蔽作者：${author.name || '此作者'}${!settings.enabled || !settings.skipBlocked ? '（过滤已暂停或未开启）' : ''}`, false, true);
        schedule(100); reply(result);
      }, () => { if (message.action === 'quickBlock') notice('屏蔽保存失败，请刷新页面重试。', false, true); reply({ ok: false, error: '保存作者名单失败，请刷新页面。' }); });
      return true;
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = Core.normalizeSettings(changes.settings.newValue);
    configureCapture();
    cancelTransaction();
    if (current) current.since = Date.now();
    if (!settings.enabled && ui) ui.box.hidden = true;
    schedule(100);
  });
  for (const type of ['keydown', 'wheel', 'touchstart', 'pointerdown']) document.addEventListener(type, manualInput, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { cancelTransaction(); if (current) current.since = Date.now(); schedule(100); });
  window.addEventListener('popstate', () => schedule(100));
  window.addEventListener('hashchange', () => schedule(100));
  const heartbeat = setInterval(() => schedule(0), 400);
  window.addEventListener('pagehide', event => {
    observer.disconnect(); watchedFeed = null; cancelTransaction();
    window.postMessage({ channel: Feed.CHANNEL, kind: 'configure', enabled: false }, location.origin);
    if (!event.persisted) { stopped = true; clearInterval(heartbeat); clearTimeout(timer); clearTimeout(noticeTimer); }
  });
  window.addEventListener('pageshow', () => { configureCapture(); current = null; schedule(100); });
  chrome.storage.local.get('settings').then(data => { settings = Core.normalizeSettings(data.settings); ready = true; configureCapture(); schedule(0); }).catch(storageFailure);
})();



function mountPanel() {
  const host = document.createElement('div'); host.id = 'dy-cleaner-userscript';
  host.style.cssText = 'position:fixed;right:20px;top:70px;z-index:2147483647;';
  const shadow = host.attachShadow({mode:'open'});
  const style = document.createElement('style'); style.textContent = ":root { color-scheme: dark; font: 13px/1.5 system-ui,\"Microsoft YaHei\",sans-serif; background:#11161d; color:#e7eef4; }\n* { box-sizing:border-box; }\nbody { width:360px; margin:0; }\nheader { display:flex; align-items:center; gap:11px; padding:22px 22px 18px; }\n.brand-icon { display:grid; place-items:center; width:40px; height:40px; border-radius:12px; background:#193b3a; color:#77e6cd; font-size:29px; font-weight:600; }\nh1 { font-size:19px; line-height:1.4; margin:0; letter-spacing:.03em; }\nheader p { margin:3px 0 0; color:#8f9fae; font-size:11px; }\n.version { margin-left:auto; color:#8999a7; font-size:10px; background:#202934; border-radius:6px; padding:3px 5px; }\nmain { padding:0 18px; }\n.master { display:flex; align-items:center; justify-content:space-between; padding:15px 16px; border:1px solid #31544b; background:linear-gradient(120deg,#18362f,#19252b); border-radius:12px; }\nstrong { display:block; font-size:13px; font-weight:600; }\nsmall { display:block; color:#91a1ad; font-size:11px; margin-top:3px; }\n.master strong { font-size:14px; }\n.master small { color:#a2b8b0; }\n.switch { display:inline-block; position:relative; width:35px; height:21px; flex-shrink:0; cursor:pointer; }\n.switch input { width:100%; height:100%; margin:0; position:absolute; opacity:0; cursor:pointer; }\n.switch > span { display:block; width:100%; height:100%; background:#3a4652; border-radius:20px; pointer-events:none; transition:background .15s; }\n.switch > span:after { content:\"\"; position:absolute; left:3px; top:3px; width:15px; height:15px; background:#d1dbe3; border-radius:50%; transition:transform .15s; }\n.switch input:checked + span { background:#64d7b5; }\n.switch input:checked + span:after { transform:translateX(14px); background:#122922; }\n.switch input:focus-visible + span { outline:2px solid #bcecdc; outline-offset:4px; }\n.status { display:flex; gap:9px; padding:14px 5px; min-height:66px; }\n.status strong { font-size:12px; color:#b7c8d5; }\n.status p { color:#8195a6; font-size:11px; margin:3px 0 0; word-break:break-word; }\n.dot { margin-top:6px; width:6px; height:6px; border-radius:50%; background:#748493; flex-shrink:0; }\n.dot.active { background:#67d9b7; box-shadow:0 0 9px #67d9b755; }\n.settings { border:1px solid #29333f; border-radius:12px; padding:0 14px; background:#19212a; }\n.setting { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:13px 0; }\n.settings .setting + .setting { border-top:1px solid #2a333e; }\n.setting em { font-style:normal; font-weight:400; color:#a7b7c5; font-size:9px; margin-left:4px; background:#2c3742; padding:2px 4px; border-radius:3px; }\n.stats { margin:16px 0; display:grid; grid-template-columns:repeat(4,1fr); }\n.stats div { text-align:center; }\n.stats div + div { border-left:1px solid #2d3742; }\n.stats b { display:block; font-size:23px; font-weight:600; font-variant-numeric:tabular-nums; }\n.stats span { color:#8195a6; font-size:10px; }\n.actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }\nbutton { border:1px solid #354552; border-radius:8px; background:#20303b; color:#cfdfeb; padding:9px 8px; font:12px system-ui,\"Microsoft YaHei\",sans-serif; cursor:pointer; }\nbutton:hover { background:#2b414b; border-color:#48636c; }\nbutton:disabled { color:#617381; border-color:#28323c; background:#18212a; cursor:default; }\nbutton:focus-visible { outline:2px solid #77d9bd; outline-offset:2px; }\n.wide { grid-column:1/-1; }\n.feedback { background:#23352f; border-radius:7px; padding:8px 10px; color:#aee1cc; font-size:11px; }\n.feedback.error { background:#3b2a27; color:#efbbb1; }\ndetails { border-top:1px solid #283340; margin-top:15px; }\nsummary { color:#9db0bf; padding:12px 0 0; font-size:11px; cursor:pointer; }\n.details-body { padding:8px 0 0; }\n.details-body .setting { padding:8px 0; }\n.details-body .setting strong { font-size:12px; }\n.details-body .setting small { max-width:243px; line-height:1.6; }\n.delay-label { display:flex; justify-content:space-between; margin-top:12px; color:#b7c8d5; font-size:11px; }\noutput { color:#72d6b9; font-variant-numeric:tabular-nums; }\ninput[type=range] { width:100%; margin:10px 0 2px; accent-color:#72d6b9; }\n.hint { font-size:10px; line-height:1.7; color:#8195a6; margin:4px 0 10px; }\nh2 { font-size:12px; margin:14px 0 6px; font-weight:500; }\n.authors { list-style:none; margin:0; padding:0; }\n.authors li { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:7px 0; border-bottom:1px solid #283340; }\n.authors li span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n.authors button { padding:3px 8px; font-size:10px; }\n.text-button { border:0; padding-left:0; background:none; color:#8fa7b8; font-size:11px; }\npre { font-size:10px; color:#8da7b8; white-space:pre-wrap; word-break:break-word; max-height:240px; overflow:auto; background:#0c1218; padding:10px; border-radius:8px; }\nfooter { color:#6f8292; font-size:10px; line-height:1.8; text-align:center; padding:16px 18px 20px; }\n\n.blacklist-setting { margin-top:10px; }\n#blacklist-input { box-sizing:border-box;width:100%;margin:5px 0 8px;background:#0c1218;border:1px solid #354552;border-radius:7px;color:#cfdfeb;padding:8px;font:11px system-ui;resize:vertical; }\n#blocked-authors { max-height:210px;overflow:auto; }\n\n#blocked-authors a { color:#77d9bd;font-size:10px;flex-shrink:0; }\n\n#dy-cleaner-ui { position: fixed; right: 24px; bottom: 28px; z-index: 2147483647; }\n" + `
    :host { all:initial; color-scheme:dark; } .shell { display:flex;flex-direction:column;align-items:flex-end; }
    .panel { font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#e7eef4;width:min(440px,calc(100vw - 40px));max-height:calc(100vh - 160px);overflow:auto;background:#10171f;border:1px solid #33454e;border-radius:14px;padding:16px;box-shadow:0 8px 32px #0008; }
    .panel[hidden] {display:none;} .toggle {background:#153c39;color:#a3f4e3;border:1px solid #448477;border-radius:8px;padding:9px 13px;font:14px system-ui;margin-bottom:8px;cursor:pointer;}
  `;
  const shell=document.createElement('div'); shell.className='shell';
  const toggle=document.createElement('button'); toggle.type='button'; toggle.className='toggle';toggle.textContent='清爽刷设置';toggle.setAttribute('aria-expanded','false');
  const panel=document.createElement('section'); panel.className='panel';panel.hidden=true;panel.innerHTML="\n  <header><div class=\"brand-icon\" aria-hidden=\"true\">↧</div><div><h1>抖音清爽刷</h1><p>留下想看的，跳过打扰。</p></div><span class=\"version\">v0.5.0 油猴版</span></header>\n  <main>\n    <section class=\"master\"><div><strong>自动过滤</strong><small>快捷键 Alt + Shift + S</small></div><label class=\"switch\"><input id=\"enabled\" type=\"checkbox\" aria-label=\"自动过滤\"><span></span></label></section>\n    <section class=\"status\" aria-live=\"polite\"><span id=\"status-dot\" class=\"dot\"></span><div><strong id=\"status\">正在连接…</strong><p id=\"evidence\">打开抖音的「推荐」页面开始使用</p></div></section>\n    <section class=\"settings\" aria-label=\"过滤类型\">\n      <label class=\"setting\"><span><strong>广告与推广</strong><small>明确标识、广告专用节点</small></span><span class=\"switch\"><input id=\"skipAds\" type=\"checkbox\"><span></span></span></label>\n      <label class=\"setting\"><span><strong>直播推荐</strong><small>推荐流中的直播卡片</small></span><span class=\"switch\"><input id=\"skipLive\" type=\"checkbox\"><span></span></span></label>\n      <label class=\"setting\"><span><strong>带货视频 <em>可选</em></strong><small>带商品卡或播放器购物入口；需单独开启</small></span><span class=\"switch\"><input id=\"skipShopping\" type=\"checkbox\"><span></span></span></label>\n    </section>\n    <section class=\"settings blacklist-setting\"><label class=\"setting\"><span><strong>黑名单作者</strong><small>自动跳过名单内作者的视频和直播</small></span><span class=\"switch\"><input id=\"skipBlocked\" type=\"checkbox\"><span></span></span></label></section>\n    <section class=\"stats\" aria-label=\"累计成功跳过\"><div><b id=\"ad-count\">0</b><span>广告推广</span></div><div><b id=\"live-count\">0</b><span>直播推荐</span></div><div><b id=\"shopping-count\">0</b><span>带货视频</span></div><div><b id=\"blocked-count\">0</b><span>黑名单</span></div></section>\n    <section class=\"actions\"><button id=\"allow\" type=\"button\">本条放行</button><button id=\"undo\" type=\"button\" disabled>返回并放行</button><button id=\"mark-ad\" type=\"button\" class=\"wide\">标记本条为广告</button><button id=\"block\" type=\"button\" class=\"wide\">屏蔽当前作者 · Alt + Shift + B</button><button id=\"whitelist\" type=\"button\" class=\"wide\">将当前作者加入白名单</button></section>\n    <p id=\"feedback\" class=\"feedback\" role=\"status\" hidden></p>\n    <details><summary>更多设置</summary><div class=\"details-body\">\n      <label class=\"setting\"><span><strong>跳过提示</strong><small>提示中可直接返回并放行</small></span><span class=\"switch\"><input id=\"showNotice\" type=\"checkbox\"><span></span></span></label>\n      <label class=\"setting\"><span><strong>广告图标兼容识别</strong><small>匹配作者信息区的已知图标；误判时关闭</small></span><span class=\"switch\"><input id=\"iconDetection\" type=\"checkbox\"><span></span></span></label>\n      <label class=\"setting\"><span><strong>接口广告标识识别</strong><small>补充检测推荐接口的明确广告标记</small></span><span class=\"switch\"><input id=\"apiDetection\" type=\"checkbox\"><span></span></span></label>\n      <label class=\"setting\"><span><strong>跳过时遮挡广告</strong><small>切换时遮挡画面，保留你的声音设置</small></span><span class=\"switch\"><input id=\"shieldAds\" type=\"checkbox\"><span></span></span></label>\n      <label class=\"delay-label\" for=\"skipDelay\">画面稳定等待 <output id=\"delay-value\">250 ms</output></label><input id=\"skipDelay\" type=\"range\" min=\"200\" max=\"1500\" step=\"50\">\n      <p class=\"hint\">标识较晚出现时会重新检测。数值越大，手动切换时越从容。</p>\n      <h2>作者白名单</h2><ul id=\"authors\" class=\"authors\"></ul><p id=\"empty-authors\" class=\"hint\">暂无。加入后，该作者的广告和直播也会保留。</p>\n      <button id=\"resetStats\" class=\"text-button\" type=\"button\">清空本地统计</button>\n    </div></details>\n    <details><summary>我标记的广告 <span id=\"learned-count\">0</span></summary><div class=\"details-body\"><p class=\"hint\">仅记住你标记的视频，下次在推荐流遇到同一条就跳过。保存在本机；广告开关、作者白名单和本条放行仍有效。</p><ul id=\"learned-ads\" class=\"authors\"></ul><p id=\"empty-learned\" class=\"hint\">暂无标记。遇到漏掉的广告时，点击“标记本条为广告”。</p><p class=\"hint\">最多 2000 条；移除可撤销。重发或剪辑形成的新视频需另行标记。</p></div></details>\n    <details><summary>管理黑名单</summary><div class=\"details-body\"><p class=\"hint\">按作者主页 ID 匹配。名单内作者的所有推荐内容都会跳过；白名单和本条放行优先。移除即可恢复。</p><label class=\"setting\"><span><strong>自动收录明确推广作者</strong><small>品牌相关且有广告标记或合作披露时收录</small></span><span class=\"switch\"><input id=\"collectBrandPromoters\" type=\"checkbox\"><span></span></span></label><p class=\"hint\">范围：华为、鸿蒙、鸿蒙智行相关品牌。只保存作者与作品证据链接；移除后不会再自动收录该作者。</p><ul id=\"blocked-authors\" class=\"authors\"></ul><p id=\"empty-blocked\" class=\"hint\">暂无黑名单作者。</p><label class=\"hint\" for=\"blacklist-input\">导入 JSON 名单，或粘贴作者主页链接（每行一个）</label><textarea id=\"blacklist-input\" rows=\"3\" placeholder=\"https://www.douyin.com/user/…\"></textarea><div class=\"actions\"><button id=\"import-blocklist\" type=\"button\">合并导入</button><button id=\"export-blocklist\" type=\"button\">导出名单</button></div><p class=\"hint\">合并不覆盖已有名单，最多 1000 个作者。</p></div></details>\n    <details><summary>诊断信息</summary><div class=\"details-body\"><p class=\"hint\">识别不了时可查看命中的规则。导出的诊断不包含视频地址、文案和作者信息。</p><pre id=\"diagnostics\">等待连接</pre><button id=\"export\" type=\"button\">导出诊断</button></div></details>\n  </main>\n  <footer>本机处理 · 无需账号 · 仅抖音推荐流<br>漏掉的广告可手动标记</footer>\n  \n  \n";
  shell.append(toggle,panel);shadow.append(style,shell);document.documentElement.append(host);
  const noticeStyle=document.createElement('style');noticeStyle.textContent='#dy-cleaner-ui {position:fixed;right:24px;bottom:28px;z-index:2147483647;}';document.documentElement.append(noticeStyle);
  function open() {panel.hidden=false;toggle.setAttribute('aria-expanded','true');}
  toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));});
  GM_registerMenuCommand('打开抖音清爽刷设置',open);
  // Pass a DOM facade to the original popup implementation so IDs stay inside Shadow DOM.
  (function(document) {
    "use strict";
const Core = localScope.DouyinCleanerCore;
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
  if (!result?.ok) throw new Error(result?.error || '保存失败，请重新启用油猴脚本。');
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
    if (!pageStatus) throw new Error(connectionError || '未连接推荐流，请重新启用油猴脚本后刷新抖音页面。');
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
    if (saved === removing) throw new Error('页面已响应，但未确认标记记录保存成功。请重新启用油猴脚本并刷新抖音页面。');
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

  })({getElementById:id=>shadow.getElementById(id),createElement:tag=>document.createElement(tag)});
}
GM_registerMenuCommand('屏蔽当前作者（Alt + Shift + B）',()=>dispatch({target:'dy-cleaner-page',action:'quickBlock'}).catch(console.warn));
GM_registerMenuCommand('开启／暂停过滤（Alt + Shift + S）',()=>commandListeners.forEach(fn=>fn('toggle-enabled')));
document.addEventListener('keydown',event=>{
  if (!event.isTrusted || event.repeat || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
  const focused=document.activeElement?.shadowRoot?.activeElement || document.activeElement;
  if (document.hidden || focused?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
  const command=event.code==='KeyB'?'block-current-author':event.code==='KeyS'?'toggle-enabled':null;
  if (command) {event.preventDefault(); commandListeners.forEach(fn=>fn(command));}
},true);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountPanel,{once:true});else mountPanel();


})();
