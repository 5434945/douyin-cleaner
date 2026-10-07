const previewMode = new URLSearchParams(location.search).get('mode') || 'normal';
// Local UI preview only. Not included in manifest or injected into real sites.
const popupData = { settings: { enabled: true, skipAds: true, skipLive: true, skipShopping: false, showNotice: true, iconDetection: true, skipDelay: 250, settingsRevision: 1, whitelist: [] }, stats: { ad: 12, live: 8, shopping: 0 } };
const listeners = [];
window.chrome = {
    runtime: { getManifest: () => ({ version: '0.4.3' }), async sendMessage(message) {
    if (message.action === 'patchSettings') { const previous = { ...popupData.settings }; Object.assign(popupData.settings, message.patch); for (const fn of listeners) fn({ settings: { oldValue: previous, newValue: popupData.settings } }, 'local'); }
    if (message.action === 'removeLearnedAd') { popupData.settings.learnedAds = (popupData.settings.learnedAds || []).filter(v => v.id !== message.video.id); for (const fn of listeners) fn({ settings: { newValue: popupData.settings } }, 'local'); }
    if (message.action === 'resetStats') { popupData.stats = { ad: 0, live: 0, shopping: 0, blocked: 0, failures: 0 }; for (const fn of listeners) fn({ stats: { newValue: popupData.stats } }, 'local'); }
    return { ok: true };
  } },
  storage: { local: { async get() { return popupData; } }, onChanged: { addListener(fn) { listeners.push(fn); } } },
  tabs: { async query() { return [{ id: 1 }]; }, async sendMessage(id, message) {
    if (previewMode === 'disconnected') throw new Error('Could not establish connection. Receiving end does not exist.');
    if (previewMode === 'legacy' && message.action === 'status') return { ok: true, supported: true, version: '0.3.1', current: { identified: true, author: { id: 'MS4w.preview' } }, status: '检测中' };
    if (previewMode === 'missing-id' && message.action === 'status') return { ok: true, supported: true, version: '0.4.3', current: { identified: true }, status: '未读取到视频 ID' };
    if (previewMode === 'hang' && message.action === 'markAd') return new Promise(() => {});
    if (previewMode === 'false-ack' && message.action === 'markAd') return { ok: true };

    if (['markAd', 'unmarkAd'].includes(message.action)) { popupData.settings.learnedAds = message.action === 'markAd' ? [{ id: '88800001', title: '示例广告视频' }] : []; for (const fn of listeners) fn({ settings: { newValue: popupData.settings } }, 'local'); }

    if (message.action === 'status') return { ok: true, supported: true, status: popupData.settings.enabled ? '检测中 · 保留当前内容' : '已暂停自动过滤', current: { type: 'normal', rule: 'no-enabled-rule', evidence: '未发现已开启的过滤标识', identified: true, videoId: '88800001', markedAd: (popupData.settings.learnedAds || []).some(v => v.id === '88800001'), author: { id: 'MS4w.preview', name: '示例作者' } }, rules: [], selectorHits: { card: true, active: true, next: true }, canUndo: false };
    return { ok: true };
  } }
};
