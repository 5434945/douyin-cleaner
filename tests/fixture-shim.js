"use strict";
const originalCore = DouyinCleanerCore;
window.DouyinCleanerCore = Object.freeze({ ...originalCore, supportedPage: () => true });
const storageData = { settings: { ...originalCore.DEFAULTS, skipDelay: 200 }, stats: { ad: 0, live: 0, shopping: 0, blocked: 0, failures: 0 } };
const messageListeners = [];
const changeListeners = [];
const clone = value => JSON.parse(JSON.stringify(value));
window.fixtureDispatch = function (message, pageSender = false) {
  return new Promise(resolve => {
    const sender = { id: 'fixture-extension', ...(pageSender ? { tab: { id: 1, url: 'https://www.douyin.com/?recommend=1' }, url: 'https://www.douyin.com/?recommend=1' } : {}) };
    let asynchronous = false;
    for (const listener of messageListeners) if (listener(message, sender, resolve) === true) asynchronous = true;
    if (!asynchronous) resolve(undefined);
  });
};
window.importScripts = () => {}; // core.js already loaded; production worker uses native importScripts.
window.chrome = {
  runtime: {
    id: 'fixture-extension', getManifest: () => ({ version: '0.4.3' }),
    onInstalled: { addListener() {} }, onMessage: { addListener(fn) { messageListeners.push(fn); } },
    sendMessage(message) { return fixtureDispatch(message, true); }
  },
  commands: { onCommand: { addListener() {} } },
  storage: {
    onChanged: { addListener(fn) { changeListeners.push(fn); } },
    local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in storageData).map(key => [key, clone(storageData[key])])); },
      async set(update) {
        const changes = {};
        for (const [key, value] of Object.entries(update)) { changes[key] = { oldValue: clone(storageData[key] ?? null), newValue: clone(value) }; storageData[key] = clone(value); }
        for (const listener of changeListeners) listener(changes, 'local');
      }
    }
  }
};
