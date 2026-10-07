/* Independent implementation. Page signals are documented in REFERENCES.md. */
(function (scope) {
  "use strict";
  const DEFAULTS = Object.freeze({
    enabled: true, skipAds: true, skipLive: true, skipShopping: false,
    showNotice: true, iconDetection: true, skipDelay: 450, whitelist: []
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
    shopping: '[data-e2e="product-card"], [data-e2e="goods-card"], [data-e2e="shopping-cart"], [data-e2e="video-product"]',
    next: '[data-e2e="video-switch-next-arrow"], .xgplayer-playswitch-next, [aria-label="下一条"], [aria-label="下一个视频"]',
    previous: '[data-e2e="video-switch-prev-arrow"], .xgplayer-playswitch-prev, [aria-label="上一条"], [aria-label="上一个视频"]',
    excluded: '[data-e2e="video-desc"], [data-e2e="feed-video-nickname"], [data-e2e="video-avatar"], [data-e2e="live-avatar"], [data-e2e*="comment"], [role="dialog"], #dy-cleaner-ui'
  });
  const AD_LABEL = /^(广告|推广|赞助|商业推广|品牌推广|付费推广)$/;
  const LIVE_ENTRY = /^(点击)?进入直播间$|^观看直播$/;
  const LABEL_NODES = 'span, small, i, label, div, [aria-label]';

  function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function normalizeSettings(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const settings = { ...DEFAULTS };
    for (const key of ['enabled', 'skipAds', 'skipLive', 'skipShopping', 'showNotice', 'iconDetection']) {
      if (typeof value[key] === 'boolean') settings[key] = value[key];
    }
    if (Number.isFinite(value.skipDelay)) settings.skipDelay = Math.max(200, Math.min(1500, Math.round(value.skipDelay)));
    settings.whitelist = Array.isArray(value.whitelist) ? value.whitelist.filter(item => item && typeof item.id === 'string' && /^[A-Za-z0-9_.-]{1,180}$/.test(item.id)).slice(0, 100).map(item => ({ id: item.id, name: cleanText(item.name).slice(0, 80) })) : [];
    return settings;
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
  function authorInfo(root) {
    const name = cleanText(root.querySelector(SELECTORS.author)?.textContent).replace(/^@/, '');
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
  function classify(root, options = DEFAULTS) {
    const reasons = [];
    const author = authorInfo(root);
    const add = (type, rule, evidence) => reasons.push({ type, rule, evidence });
    if (signalNodes(root, SELECTORS.live).length) add('live', 'live-card', '直播卡片标识');
    else if (findLabel(root, LIVE_ENTRY)) add('live', 'live-entry', '进入直播间入口');
    if (signalNodes(root, SELECTORS.ad).length) add('ad', 'ad-node', '广告专用节点');
    else {
      let label = null;
      for (const zone of root.querySelectorAll(SELECTORS.metadata)) {
        label = findLabel(zone, AD_LABEL);
        if (label) break;
      }
      // Accessible explicit tags elsewhere, excluding captions, author names and comments.
      label ||= signalNodes(root, '[aria-label]').find(el => AD_LABEL.test(cleanText(el.getAttribute('aria-label'))));
      if (label) add('ad', 'ad-label', cleanText(label.getAttribute('aria-label') || label.textContent));
      else if (options.iconDetection) {
        const icon = signalNodes(root, '.account svg[viewBox="0 0 30 16"]').find(el => !el.closest(SELECTORS.author));
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
    const reason = reasons.find(item => ({ ad: options.skipAds, live: options.skipLive, shopping: options.skipShopping })[item.type]);
    return { ...(reason || { type: 'normal', rule: 'no-enabled-rule', evidence: '未发现已开启的过滤标识' }), author, reasons };
  }
  function activeCard(doc = document) {
    let cards = Array.from(doc.querySelectorAll(SELECTORS.cards));
    if (!cards.length) cards = Array.from(doc.querySelectorAll(`${SELECTORS.active}, ${SELECTORS.live}`));
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
  const api = Object.freeze({ DEFAULTS, SELECTORS, cleanText, normalizeSettings, supportedPage, visible, usable, classify, activeCard, identity, authorInfo, navigationControl });
  scope.DouyinCleanerCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
