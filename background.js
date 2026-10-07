(() => {
"use strict";
importScripts('blocked-authors.js', 'core.js');
const Core = DouyinCleanerCore;
let queue = Promise.resolve();
function serialize(fn) {
  const task = queue.then(fn);
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
