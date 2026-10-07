(() => {
"use strict";
importScripts('core.js');
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
  if (!data.stats) update.stats = { ad: 0, live: 0, shopping: 0, failures: 0 };
  await chrome.storage.local.set(update);
}
chrome.runtime.onInstalled.addListener(() => serialize(initialize));
chrome.commands.onCommand.addListener(command => {
  if (command !== 'toggle-enabled') return;
  serialize(async () => {
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
  if (message.action === 'record' && ['ad', 'live', 'shopping', 'failures'].includes(message.type) && sender.tab) {
    job = () => updateStats(message.type, message.rule);
  } else if (message.action === 'resetStats' && !sender.tab) {
    job = () => chrome.storage.local.set({ stats: { ad: 0, live: 0, shopping: 0, failures: 0 }, recent: [] });
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
  } else if (message.action === 'addAuthor' && sender.tab && typeof message.author?.id === 'string') {
    job = async () => {
      const { settings } = await chrome.storage.local.get('settings');
      const next = Core.normalizeSettings(settings);
      next.whitelist = next.whitelist.filter(item => item.id !== message.author.id);
      next.whitelist.push(message.author);
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
  for (const key of ['ad', 'live', 'shopping', 'failures']) next[key] = Math.max(0, Number(stats[key]) || 0);
  next[type] += 1;
  // No video URL, caption, author, or account information is logged.
  const entries = Array.isArray(recent) ? recent.slice(-19) : [];
  entries.push({ time: new Date().toISOString(), type, rule: String(rule || '').replace(/[^a-z0-9-]/g, '').slice(0, 60) });
  await chrome.storage.local.set({ stats: next, recent: entries });
}
})();
