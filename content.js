(function () {
  "use strict";
  const Core = DouyinCleanerCore;
  const Feed = DouyinCleanerFeed;
  const feedRecords = new Map();
  let shield = null;
  function configureCapture() {
    const enabled = settings.enabled && settings.apiDetection && settings.skipAds && Core.supportedPage(location.href);
    if (!enabled) feedRecords.clear();
    window.postMessage({ channel: Feed.CHANNEL, kind: 'configure', enabled }, location.origin);
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== Feed.CHANNEL || event.data.kind !== 'records' || !settings.enabled || !settings.apiDetection || !settings.skipAds || !Core.supportedPage(location.href)) return;
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
    for (const [video, muted] of previous.videos) if (video.muted === true) video.muted = muted;
  }
  function showShield(root) {
    clearShield();
    if (!settings.shieldAds) return;
    const rect = root.getBoundingClientRect();
    const host = document.createElement('div'); host.id = 'dy-cleaner-shield';
    host.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;background:#111;color:#ddd;display:flex;align-items:center;justify-content:center;font:14px system-ui;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    host.textContent = '正在跳过广告';
    const videos = Array.from(root.querySelectorAll('video'), video => [video, video.muted]);
    shield = { host, videos, root, key: Core.identity(root), timeout: setTimeout(clearShield, 4200) };
    document.documentElement.appendChild(host);
    for (const [video] of videos) video.muted = true;
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
    const focused = document.activeElement;
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
    if (!event.isTrusted || event.composedPath().includes(uiHost)) return;
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
      current: current ? { type: current.detection.type, rule: current.detection.rule, evidence: current.detection.evidence, author: current.detection.author, identified: Boolean(current.key) } : null,
      canUndo: Boolean(lastSkipped && current?.key === lastSkipped.destination && !transaction),
      rules: current?.detection.reasons || [],
      selectorHits: { card: Boolean(current), active: Boolean(current?.root.matches(Core.SELECTORS.active) || current?.root.querySelector(Core.SELECTORS.active)), next: Boolean(current && Core.navigationControl(current.root, 'next')) }
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
    } else if (['whitelist', 'block'].includes(message.action)) {
      const root = Core.activeCard();
      const author = root && Core.authorInfo(root);
      if (!author?.id) { reply({ ok: false, error: '没有读取到作者 ID，可先使用“本条放行”。' }); return; }
      if (message.action === 'whitelist') allowKey(Core.identity(root));
      else allowed.delete(Core.identity(root));
      cancelTransaction();
      sendBackground(message.action === 'block' ? 'blockAuthor' : 'addAuthor', { author }).then(result => reply(result), () => reply({ ok: false, error: '保存作者名单失败，请刷新页面。' }));
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
