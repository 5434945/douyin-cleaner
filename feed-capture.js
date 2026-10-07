// Passive observer: original requests, response bodies and promises are preserved.
(function () {
  'use strict';
  const Feed = DouyinCleanerFeed;
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
})();
