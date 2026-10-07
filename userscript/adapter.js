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
