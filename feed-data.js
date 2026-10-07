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
})(globalThis);
