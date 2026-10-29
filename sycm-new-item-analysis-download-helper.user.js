// ==UserScript==
// @name         生意参谋新品分析下载助手-批量续跑修复版
// @namespace    https://github.com/anysky911/WuLuLu
// @version      0.7.0
// @description  生意参谋新品分析：批量续跑、店铺加日期命名、下载完成后统一复制到授权共享目录的日期文件夹
// @author       anysky911
// @homepageURL  https://github.com/anysky911/WuLuLu
// @supportURL   https://github.com/anysky911/WuLuLu/issues
// @updateURL    https://raw.githubusercontent.com/anysky911/WuLuLu/main/sycm-new-item-analysis-download-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/anysky911/WuLuLu/main/sycm-new-item-analysis-download-helper.user.js
// @match        https://sycm.taobao.com/cc/new_item_analysis*
// @match        https://sycm.taobao.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // 发布新修改时必须同时递增此版本和元数据 @version，保留原更新地址。
  const VERSION = '0.7.0';
  const ARCHIVE_ROOT = String.raw`\\192.168.1.252\work\男童店\链接数据`;
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const CONFIG = {
    fileExtension: 'xls',

    storeTriggerFallbackPoint: {
      x: 145,
      y: 38,
    },

    waitAfterOpenStoreMenuMs: 700,
    waitAfterSelectShopMs: 3500,
    waitAfterSelect30DaysMs: 2500,
    waitAfterScrollBottomMs: 800,

    randomWaitMinMs: 10000,
    randomWaitMaxMs: 15000,

    elementWaitTimeoutMs: 12000,
    pollIntervalMs: 200,

    maxRetryPerShop: 3,

    autoResumeDelayMs: 2200,
  };

  const SHOP_NAMES = [
    '优优1点旗舰店',
    '小猪彼特旗舰店',
    '稚豆儿旗舰店',
    'mcticco旗舰店',
    'Timmama旗舰店',
    'ikarnow艾卡诺旗舰店',
    'amencl童装旗舰店',
    'ove旗舰店',
    'moonkids旗舰店',
    '憨憨象旗舰店',
  ];

  const PANEL_ID = 'sycm-download-helper-center';
  const COMPLETE_POPUP_ID = 'sycm-download-complete-popup';
  const BATCH_STATE_KEY = 'sycm-helper-batch-state-fixed-v6';

  const state = {
    running: false,
    stopRequested: false,
    activeDownload: null,
    archiveHandle: null,
    archiving: false,
    batchId: '',
    lastShopName: '',
  };

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function smartSleep(ms) {
    const step = 200;
    let passed = 0;

    while (passed < ms) {
      if (state.stopRequested) {
        throw new Error('用户已停止');
      }

      const wait = Math.min(step, ms - passed);
      await sleep(wait);
      passed += wait;
    }
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async function randomStableWait(label, min = CONFIG.randomWaitMinMs, max = CONFIG.randomWaitMaxMs) {
    const ms = randomInt(min, max);
    updateStatus(`${label}，等待 ${Math.round(ms / 1000)} 秒`);
    await smartSleep(ms);
  }

  function norm(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeFileName(name) {
    let safe = norm(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120).replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = '_' + safe;
    return safe || '生意参谋新品分析';
  }

  function currentDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const part = (type) => parts.find((p) => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function buildDownloadFileName(shopName, date = currentDate(), extension = CONFIG.fileExtension) {
    return `${sanitizeFileName(shopName)}${date}.${extension}`;
  }

  function readBatchState() {
    try {
      const raw = sessionStorage.getItem(BATCH_STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeBatchState(patch) {
    const prev = readBatchState() || {};

    const next = {
      ...prev,
      ...patch,
      updatedAt: Date.now(),
    };

    sessionStorage.setItem(BATCH_STATE_KEY, JSON.stringify(next));

    return next;
  }

  function clearBatchState() {
    sessionStorage.removeItem(BATCH_STATE_KEY);
  }

  function startBatchState(shops, startIndex = 0) {
    return writeBatchState({
      active: true,
      batchId: crypto.randomUUID(),
      shops,
      index: startIndex,
      completed: 0,
      failures: [],
      stopRequested: false,
      startedAt: Date.now(),
      phase: 'start',
    });
  }

  function stopBatchState() {
    const prev = readBatchState() || {};

    writeBatchState({
      ...prev,
      active: false,
      stopRequested: true,
    });
  }

  function getRect(el) {
    try {
      return el.getBoundingClientRect();
    } catch (_) {
      return null;
    }
  }

  function isInHelperPanel(el) {
    if (!el || !el.closest) return false;

    return Boolean(
      el.closest(`#${PANEL_ID}`) ||
      el.closest(`#${COMPLETE_POPUP_ID}`)
    );
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isInHelperPanel(el)) return false;

    const style = window.getComputedStyle(el);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false;
    }

    const rect = getRect(el);

    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function elementText(el) {
    return norm(el?.innerText || el?.textContent || '');
  }

  function queryVisible(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(isVisible);
  }

  function textMatches(source, target, exact) {
    const text = norm(source);
    const needle = norm(target);

    return exact ? text === needle : text.includes(needle);
  }

  function textCandidates(label, options = {}) {
    const exact = options.exact ?? false;
    const selector = options.selector || 'body *';
    const root = options.root || document;
    const target = norm(label);

    if (!target) return [];

    const candidates = queryVisible(selector, root).filter((el) => {
      return textMatches(elementText(el), target, exact);
    });

    return candidates.sort((a, b) => {
      const aText = elementText(a);
      const bText = elementText(b);
      const aRect = getRect(a);
      const bRect = getRect(b);

      const aArea = aRect ? aRect.width * aRect.height : Number.MAX_SAFE_INTEGER;
      const bArea = bRect ? bRect.width * bRect.height : Number.MAX_SAFE_INTEGER;

      const aPenalty = Math.abs(aText.length - target.length) * 100 + aArea;
      const bPenalty = Math.abs(bText.length - target.length) * 100 + bArea;

      return aPenalty - bPenalty;
    });
  }

  function uniqElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function nearestClickable(el) {
    if (!el) return null;

    return (
      el.closest(
        [
          'button',
          'a[href]',
          '[role="button"]',
          '[role="menuitem"]',
          '[role="option"]',
          'li',
          '[class*="dropdown"]',
          '[class*="Dropdown"]',
          '[class*="trigger"]',
          '[class*="Trigger"]',
          '[class*="switch"]',
          '[class*="Switch"]',
          '[class*="button"]',
          '[class*="Button"]',
          '[class*="btn"]',
          '[class*="Btn"]',
          '[class*="item"]',
          '[class*="Item"]',
          '[class*="option"]',
          '[class*="Option"]',
        ].join(',')
      ) || el
    );
  }

  async function waitFor(fn, label, timeoutMs = CONFIG.elementWaitTimeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      if (state.stopRequested) {
        throw new Error('用户已停止');
      }

      const value = await fn();

      if (value) return value;

      await sleep(CONFIG.pollIntervalMs);
    }

    throw new Error(`等待超时：${label}`);
  }

  function addStyle(css) {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
      return;
    }

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function log(message, isError = false) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${message}`;

    if (isError) {
      console.error('[SYCM 下载助手]', message);
    } else {
      console.log('[SYCM 下载助手]', message);
    }

    const logBox = document.querySelector(`#${PANEL_ID} .sycm-helper-log`);

    if (logBox) {
      const div = document.createElement('div');
      div.textContent = line;
      div.style.color = isError ? '#d93025' : '#33415c';
      logBox.appendChild(div);
      logBox.scrollTop = logBox.scrollHeight;
    }
  }

  function updateStatus(message, isError = false) {
    const status = document.querySelector(`#${PANEL_ID} .sycm-helper-status`);

    if (status) {
      status.textContent = message;
      status.dataset.error = isError ? 'true' : 'false';
    }

    log(message, isError);
  }

  function setPanelRunning(running) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.classList.toggle('sycm-helper-running', running);

    const oneButton = panel.querySelector('.sycm-helper-run-one');
    const allButton = panel.querySelector('.sycm-helper-run-all');
    const stopButton = panel.querySelector('.sycm-helper-stop');

    if (oneButton) oneButton.disabled = running;
    if (allButton) allButton.disabled = running;
    if (stopButton) stopButton.disabled = !running;
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    panel.innerHTML = `
      <div class="sycm-helper-title">新品分析下载助手 v${VERSION}</div>

      <input class="sycm-helper-input"
             type="text"
             value="${SHOP_NAMES[0]}"
             placeholder="单店店铺名">

      <div class="sycm-helper-buttons">
        <button class="sycm-helper-run-one" type="button">下载单店</button>
        <button class="sycm-helper-run-all" type="button">一键下载列表</button>
        <button class="sycm-helper-stop" type="button" disabled>停止</button>
        <button class="sycm-helper-clear" type="button">清空日志</button>
      </div>

      <div class="sycm-helper-buttons">
        <button class="sycm-helper-pick-folder" type="button">选择归档目录</button>
        <button class="sycm-helper-copy" type="button">补拷贝 / 授权续跑</button>
      </div>
      <div class="sycm-helper-archive-status">首次请选择：${ARCHIVE_ROOT}</div>
      <textarea class="sycm-helper-shop-list"
                placeholder="每行一个店铺名">${SHOP_NAMES.join('\n')}</textarea>

      <div class="sycm-helper-status">等待操作</div>
      <div class="sycm-helper-log"></div>
    `;

    document.documentElement.appendChild(panel);

    panel.querySelector('.sycm-helper-run-one').addEventListener('click', async () => {
      const shopName = norm(panel.querySelector('.sycm-helper-input').value);

      if (!shopName) {
        updateStatus('请先输入店铺名', true);
        return;
      }

      await runShopList([shopName]);
    });

    panel.querySelector('.sycm-helper-run-all').addEventListener('click', async () => {
      const shops = panel
        .querySelector('.sycm-helper-shop-list')
        .value
        .split('\n')
        .map((s) => norm(s))
        .filter(Boolean);

      if (!shops.length) {
        updateStatus('店铺列表为空', true);
        return;
      }

      await runShopList([...new Set(shops)]);
    });

    panel.querySelector('.sycm-helper-pick-folder').addEventListener('click', chooseArchiveDirectory);
    panel.querySelector('.sycm-helper-copy').addEventListener('click', authorizeAndCopy);

    panel.querySelector('.sycm-helper-stop').addEventListener('click', () => {
      state.stopRequested = true;
      stopBatchState();
      state.activeDownload?.controller.abort();
      updateStatus('收到停止请求，当前步骤结束后停止；已取得表格仍可补拷贝');
    });

    panel.querySelector('.sycm-helper-clear').addEventListener('click', () => {
      const logBox = panel.querySelector('.sycm-helper-log');
      if (logBox) logBox.innerHTML = '';
    });
  }

  function removeCompletionPopup() {
    document.getElementById(COMPLETE_POPUP_ID)?.remove();
  }

  function showCompletionPopup({ completed, total, failed }) {
    removeCompletionPopup();

    const popup = document.createElement('div');
    popup.id = COMPLETE_POPUP_ID;

    popup.innerHTML = `
      <div class="sycm-complete-card">
        <div class="sycm-complete-title">运行完成</div>
        <div class="sycm-complete-main">已完成 ${completed}/${total} 家店铺</div>
        <div class="sycm-complete-sub">
          ${failed > 0 ? `失败 ${failed} 家，请查看面板日志` : '全部店铺已处理完成'}
        </div>
        <button class="sycm-complete-close" type="button">知道了</button>
      </div>
    `;

    document.documentElement.appendChild(popup);
    popup.querySelector('.sycm-complete-close').addEventListener('click', removeCompletionPopup);
  }

  addStyle(`
    #${PANEL_ID} {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 2147483647;
      width: 360px;
      box-sizing: border-box;
      padding: 14px;
      border: 1px solid rgba(20, 30, 50, 0.16);
      border-radius: 10px;
      background: #ffffff;
      color: #172033;
      box-shadow: 0 8px 28px rgba(20, 30, 50, 0.22);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    }

    #${PANEL_ID} .sycm-helper-title {
      margin-bottom: 10px;
      font-weight: 700;
      font-size: 16px;
      text-align: center;
    }

    #${PANEL_ID} .sycm-helper-input,
    #${PANEL_ID} .sycm-helper-shop-list {
      display: block;
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #cfd7e6;
      border-radius: 6px;
      outline: none;
      color: #172033;
      background: #ffffff;
      font-size: 13px;
    }

    #${PANEL_ID} .sycm-helper-input {
      height: 32px;
      padding: 4px 8px;
      margin-bottom: 8px;
    }

    #${PANEL_ID} .sycm-helper-shop-list {
      height: 120px;
      padding: 8px;
      resize: vertical;
      margin-top: 6px;
      margin-bottom: 8px;
    }

    #${PANEL_ID} .sycm-helper-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 6px;
    }

    #${PANEL_ID} button {
      height: 32px;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
    }

    #${PANEL_ID} .sycm-helper-run-one {
      background: #2f6bff;
      color: #ffffff;
    }

    #${PANEL_ID} .sycm-helper-run-all {
      background: #00a870;
      color: #ffffff;
    }

    #${PANEL_ID} .sycm-helper-stop {
      background: #d93025;
      color: #ffffff;
    }

    #${PANEL_ID} .sycm-helper-clear {
      background: #eef2f8;
      color: #33415c;
    }

    #${PANEL_ID} button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    #${PANEL_ID} .sycm-helper-archive-status {
      margin: 6px 0;
      font-size: 12px;
      color: #4d5a70;
      overflow-wrap: anywhere;
    }

    #${PANEL_ID} .sycm-helper-status {
      min-height: 20px;
      margin-bottom: 8px;
      color: #4d5a70;
      word-break: break-word;
    }

    #${PANEL_ID} .sycm-helper-status[data-error="true"] {
      color: #c9342f;
    }

    #${PANEL_ID} .sycm-helper-log {
      height: 170px;
      overflow-y: auto;
      padding: 8px;
      border-radius: 6px;
      background: #f4f6fb;
      color: #33415c;
      word-break: break-word;
      font-size: 12px;
    }

    #${COMPLETE_POPUP_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.18);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    }

    #${COMPLETE_POPUP_ID} .sycm-complete-card {
      width: 300px;
      box-sizing: border-box;
      padding: 18px;
      border-radius: 8px;
      background: #ffffff;
      color: #172033;
      box-shadow: 0 14px 36px rgba(20, 30, 50, 0.22);
      text-align: center;
    }

    #${COMPLETE_POPUP_ID} .sycm-complete-title {
      margin-bottom: 8px;
      font-size: 18px;
      font-weight: 700;
    }

    #${COMPLETE_POPUP_ID} .sycm-complete-main {
      margin-bottom: 4px;
      font-size: 15px;
      font-weight: 600;
    }

    #${COMPLETE_POPUP_ID} .sycm-complete-sub {
      margin-bottom: 14px;
      color: #4d5a70;
    }

    #${COMPLETE_POPUP_ID} .sycm-complete-close {
      width: 100%;
      height: 34px;
      border: 0;
      border-radius: 6px;
      background: #2f6bff;
      color: #ffffff;
      cursor: pointer;
      font-weight: 600;
    }
  `);

  let archiveDBPromise;
  function archiveDB(storeName, mode, operation) {
    if (!archiveDBPromise) {
      archiveDBPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('sycm-download-archive-v1', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('settings');
          request.result.createObjectStore('files', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('归档缓存被其他页面占用，请关闭旧页面'));
      });
    }
    return archiveDBPromise.then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error('缓存写入中断'));
    }));
  }

  async function hasArchivePermission() {
    return state.archiveHandle &&
      await state.archiveHandle.queryPermission({ mode: 'readwrite' }) === 'granted';
  }

  async function refreshArchiveStatus() {
    const records = await archiveDB('files', 'readonly', (store) => store.getAll());
    const pending = records.filter((record) => !record.archived).length;
    const element = document.querySelector(`#${PANEL_ID} .sycm-helper-archive-status`);
    if (element) element.textContent =
      `${state.archiveHandle ? `所选目录：${state.archiveHandle.name}` : `请选择：${ARCHIVE_ROOT}`}；待拷贝 ${pending} 份`;
  }

  async function chooseArchiveDirectory() {
    if (state.running || state.archiving) return updateStatus('请在任务结束后更换目录', true);
    try {
      if (typeof pageWindow.showDirectoryPicker !== 'function') {
        throw new Error('请使用支持目录授权的 Chrome 或 Edge 浏览器');
      }
      // 必须直接在按钮点击中调用；网页无法通过 UNC 路径静默获得目录权限。
      const handle = await pageWindow.showDirectoryPicker({ id: 'sycm-archive', mode: 'readwrite' });
      if (handle.name !== '链接数据') throw new Error(`请选择 ${ARCHIVE_ROOT} 中的“链接数据”目录`);
      await archiveDB('settings', 'readwrite', (store) => store.put(handle, 'directory'));
      state.archiveHandle = handle;
      await refreshArchiveStatus();
      updateStatus('目录已授权。请确认所选“链接数据”位于指定共享路径；现在可以开始下载');
    } catch (error) {
      updateStatus(error.name === 'AbortError' ? '已取消选择目录' : error.message, true);
    }
  }

  async function authorizeAndCopy() {
    if (state.running || state.archiving) return updateStatus('已有任务正在运行，请稍候', true);
    try {
      if (!state.archiveHandle) return await chooseArchiveDirectory();
      // 用户点击时申请权限，刷新后的自动续跑只查询权限，不触发弹窗。
      if (await state.archiveHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('尚未获得目录写入权限');
      }
      state.stopRequested = false;
      const copied = await copyPendingFiles();
      updateStatus(`补拷贝完成：${copied} 份`);
      const batch = readBatchState();
      if (batch?.active && !batch.stopRequested && batch.batchId) {
        await runShopList(batch.shops, batch.index || 0, true);
      }
    } catch (error) {
      updateStatus(`拷贝未完成：${error.message}；缓存已保留，可重试`, true);
    }
  }

  async function digestBlob(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function availableArchiveFile(directory, record) {
    const hash = await digestBlob(record.blob);
    for (let number = 1; number <= 999; number += 1) {
      const name = number === 1 ? record.filename : record.filename.replace(/(\.[^.]+)$/, ` (${number})$1`);
      try {
        const handle = await directory.getFileHandle(name);
        const existing = await handle.getFile();
        // 同内容不重复拷贝；同名不同内容保留两份，不覆盖已存在的表格。
        if (existing.size === record.blob.size && await digestBlob(existing) === hash) {
          return { handle, name, exists: true, hash };
        }
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
        return { handle: await directory.getFileHandle(name, { create: true }), name, exists: false, hash };
      }
    }
    throw new Error(`同名文件过多：${record.filename}`);
  }

  async function copyPendingFiles() {
    if (state.archiving) throw new Error('正在归档，请稍候');
    state.archiving = true;
    let copied = 0;
    try {
      if (!await hasArchivePermission()) throw new Error('请点击“补拷贝 / 授权续跑”授予目录写入权限');
      const records = await archiveDB('files', 'readonly', (store) => store.getAll());
      for (const record of records.filter((item) => !item.archived)) {
        if (state.stopRequested) throw new Error('用户已停止');
        if (!record.blob?.size) throw new Error(`缓存表格为空：${record.filename}`);
        // 首次归档按拷贝当天建目录；重试沿用已记录的日期。
        if (!record.archiveDate) {
          record.archiveDate = currentDate();
          await archiveDB('files', 'readwrite', (store) => store.put(record));
        }
        updateStatus(`正在归档：${record.archiveDate} / ${record.filename}`);
        const directory = await state.archiveHandle.getDirectoryHandle(record.archiveDate, { create: true });
        const target = await availableArchiveFile(directory, record);
        if (!target.exists) {
          const writable = await target.handle.createWritable();
          try {
            await writable.write(record.blob);
            await writable.close();
          } catch (error) {
            await writable.abort().catch(() => {});
            throw error;
          }
        }
        if (await digestBlob(await target.handle.getFile()) !== target.hash) {
          throw new Error(`拷贝校验失败：${target.name}`);
        }
        record.archived = true;
        record.archiveName = target.name;
        // 本地下载失败的文件保留缓存，以便恢复本地下载。
        if (record.localSaved) record.blob = null;
        await archiveDB('files', 'readwrite', (store) => store.put(record));
        copied += 1;
      }
      return copied;
    } finally {
      state.archiving = false;
      await refreshArchiveStatus();
    }
  }

  function looksLikeExportHref(href) {
    return /^(blob:|data:)/i.test(href) || /\.(xls|xlsx)(?:[?#]|$)|download|export|excel/i.test(href);
  }

  function fetchExportBlob(url, context) {
    const parsed = new URL(url, location.href);
    if (!['https:', 'http:', 'blob:', 'data:'].includes(parsed.protocol)) {
      return Promise.reject(new Error('不支持的下载地址'));
    }
    if (['blob:', 'data:'].includes(parsed.protocol) || parsed.origin === location.origin) {
      // 立即读取 Blob，避免页面在 click() 返回后 revokeObjectURL。
      return pageWindow.fetch(parsed.href, { credentials: 'include', signal: context.controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`下载请求失败：HTTP ${response.status}`);
          return response.blob();
        });
    }
    return new Promise((resolve, reject) => {
      const request = GM_xmlhttpRequest({
        method: 'GET', url: parsed.href, responseType: 'blob', timeout: 60000,
        onload: (response) => response.status >= 200 && response.status < 300
          ? resolve(response.response) : reject(new Error(`下载请求失败：HTTP ${response.status}`)),
        onerror: () => reject(new Error('跨域下载失败，请检查篡改猴连接授权')),
        ontimeout: () => reject(new Error('获取表格超时')),
        onabort: () => reject(new Error('下载已取消')),
      });
      context.controller.signal.addEventListener('abort', () => request.abort(), { once: true });
      if (context.controller.signal.aborted) request.abort();
    });
  }

  async function spreadsheetExtension(blob) {
    if (!blob?.size) throw new Error('下载结果为空，未计为成功');
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4) return 'xlsx';
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'xls';
    const text = await blob.slice(0, 65536).text();
    // 生意参谋也可能导出 HTML 表格或 SpreadsheetML 格式的 .xls。
    if (/<table[\s>]|<(?:(?:\w+):)?Workbook[\s>]/i.test(text)) return 'xls';
    throw new Error('响应不是可识别的 Excel 表格，可能是登录页或接口错误；未计为成功');
  }

  async function saveLocalDownload(record, signal) {
    if (record.localSaved) return record;
    if (signal.aborted) throw new Error('下载已取消');
    const url = URL.createObjectURL(record.blob);
    try {
      await new Promise((resolve, reject) => {
        let request;
        const onAbort = () => { request?.abort(); finish(new Error('下载已取消')); };
        const timer = window.setTimeout(() => {
          request?.abort();
          finish(new Error('本地下载超时，请检查浏览器下载权限'));
        }, 90000);
        function finish(error) {
          window.clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          error ? reject(error) : resolve();
        }
        signal.addEventListener('abort', onAbort, { once: true });
        try {
          request = GM_download({
            url, name: record.filename, saveAs: false, conflictAction: 'uniquify',
            onload: () => finish(),
            onerror: (error) => finish(new Error(`本地下载失败：${error.error || '未知错误'}；请允许篡改猴下载 xls/xlsx 文件`)),
            ontimeout: () => finish(new Error('本地下载超时')),
          });
        } catch (error) { finish(error); }
      });
      record.localSaved = true;
      if (record.archived) record.blob = null;
      await archiveDB('files', 'readwrite', (store) => store.put(record));
      return record;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function installPageDownloadRenameHook() {
    if (pageWindow.__SYCM_DOWNLOAD_ARCHIVE_HOOK__) return;
    pageWindow.__SYCM_DOWNLOAD_ARCHIVE_HOOK__ = true;
    const blobs = new Map();
    const rawCreateURL = pageWindow.URL.createObjectURL;
    pageWindow.URL.createObjectURL = function (blob) {
      const url = rawCreateURL.apply(this, arguments);
      if (state.activeDownload && blob && typeof blob.arrayBuffer === 'function') blobs.set(url, blob);
      return url;
    };
    const capture = (url, filename = '') => {
      const context = state.activeDownload;
      if (!context || typeof url !== 'string' || !url ||
          (!looksLikeExportHref(url) && !/\.xlsx?$/i.test(filename))) return false;
      // 同一次导出的 click 和 window.open 只处理一次；不拦截普通页面链接。
      if (context.captured) return true;
      context.captured = true;
      const source = blobs.has(url) ? Promise.resolve(blobs.get(url)) : fetchExportBlob(url, context);
      blobs.clear();
      (async () => {
        const blob = await source;
        const extension = await spreadsheetExtension(blob);
        if (context.controller.signal.aborted) throw new Error('下载已取消');
        const record = {
          id: context.id, shopName: context.shopName, date: context.date,
          filename: buildDownloadFileName(context.shopName, context.date, extension),
          blob, localSaved: false, archived: false,
        };
        await archiveDB('files', 'readwrite', (store) => store.put(record));
        return saveLocalDownload(record, context.controller.signal);
      })().then(context.resolve, context.reject);
      return true;
    };
    const rawClick = pageWindow.HTMLAnchorElement.prototype.click;
    pageWindow.HTMLAnchorElement.prototype.click = function () {
      if (!capture(this.href, this.download)) return rawClick.apply(this, arguments);
    };
    document.addEventListener('click', (event) => {
      const anchor = event.target?.closest?.('a[href]');
      if (anchor && capture(anchor.href, anchor.download)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    const rawOpen = pageWindow.open;
    pageWindow.open = function (url) {
      if (capture(url)) return null;
      return rawOpen.apply(this, arguments);
    };
    // 导出库可能直接调用 FileSaver 的全局 saveAs。
    if (typeof pageWindow.saveAs === 'function') {
      const rawSaveAs = pageWindow.saveAs;
      pageWindow.saveAs = function (blob, filename) {
        if (state.activeDownload && blob && typeof blob.arrayBuffer === 'function') {
          const url = pageWindow.URL.createObjectURL(blob);
          if (capture(url, filename)) { pageWindow.URL.revokeObjectURL(url); return; }
          pageWindow.URL.revokeObjectURL(url);
        }
        return rawSaveAs.apply(this, arguments);
      };
    }
    log('表格下载捕获、实际完成确认及持久化缓存已启用');
  }


  function dispatchMouseLikeEvent(target, type, point, buttons) {
    if (!target) return;

    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      screenX: point.x + window.screenX,
      screenY: point.y + window.screenY,
      button: 0,
      buttons,
    };

    if (window.PointerEvent && type.startsWith('pointer')) {
      target.dispatchEvent(
        new PointerEvent(type, {
          ...eventInit,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
      return;
    }

    target.dispatchEvent(
      new MouseEvent(type.replace(/^pointer/, 'mouse'), eventInit)
    );
  }

  async function clickElement(el, label) {
    if (!el) throw new Error(`没有找到可点击元素：${label}`);

    el.scrollIntoView({
      block: 'center',
      inline: 'center',
    });

    await sleep(randomInt(160, 260));

    const rect = getRect(el);

    if (!rect) throw new Error(`元素不可见：${label}`);

    const point = {
      x: Math.min(
        Math.max(rect.left + rect.width / 2, 2),
        window.innerWidth - 2
      ),
      y: Math.min(
        Math.max(rect.top + rect.height / 2, 2),
        window.innerHeight - 2
      ),
    };

    const pointTarget = document.elementFromPoint(point.x, point.y);

    const target =
      pointTarget && !isInHelperPanel(pointTarget)
        ? pointTarget
        : el;

    dispatchMouseLikeEvent(target, 'pointerover', point, 0);
    dispatchMouseLikeEvent(target, 'mouseover', point, 0);
    dispatchMouseLikeEvent(target, 'pointermove', point, 0);
    dispatchMouseLikeEvent(target, 'mousemove', point, 0);

    await sleep(randomInt(60, 140));

    dispatchMouseLikeEvent(target, 'pointerdown', point, 1);
    dispatchMouseLikeEvent(target, 'mousedown', point, 1);

    await sleep(randomInt(80, 160));

    dispatchMouseLikeEvent(target, 'pointerup', point, 0);
    dispatchMouseLikeEvent(target, 'mouseup', point, 0);

    await sleep(randomInt(40, 120));

    if (typeof target.click === 'function') {
      target.click();
    } else {
      dispatchMouseLikeEvent(target, 'click', point, 0);
    }

    log(`已点击：${label}`);
  }

  function setNativeValue(input, value) {
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
  }

  async function fillInput(input, value) {
    input.focus();

    setNativeValue(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await sleep(randomInt(80, 160));

    setNativeValue(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getCurrentShopName(expectedName) {
    const names = [...new Set([expectedName, ...SHOP_NAMES].filter(Boolean))];
    for (const shopName of names) {
      const match = textCandidates(shopName, { exact: true }).find((el) => {
        if (el.closest('.oui-typeahead-dropdown, [class*="typeahead-dropdown"]')) return false;
        const rect = getRect(el);

        return rect &&
          rect.top >= 0 &&
          rect.top < 90 &&
          rect.left >= 0 &&
          rect.left < 520 &&
          rect.width < 280;
      });

      if (match) return shopName;
    }

    return '';
  }

  function compactAncestorNearTopLeft(el) {
    let current = el;

    for (let depth = 0; current && depth < 6; depth += 1) {
      const rect = getRect(current);

      if (
        rect &&
        rect.top < 90 &&
        rect.left < 460 &&
        rect.width <= 320 &&
        rect.height <= 80
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return el;
  }

  function findShopDropdowns() {
    return queryVisible('.oui-typeahead-dropdown, [class*="typeahead-dropdown"]')
      .sort((a, b) => {
        const ar = getRect(a);
        const br = getRect(b);

        const aScore = ar ? ar.top * 2 + ar.left : Number.MAX_SAFE_INTEGER;
        const bScore = br ? br.top * 2 + br.left : Number.MAX_SAFE_INTEGER;

        return aScore - bScore;
      });
  }

  function findShopItemInDropdown(shopName) {
    const wanted = norm(shopName);

    if (!wanted) return null;

    const dropdowns = findShopDropdowns();

    for (const dropdown of dropdowns) {
      const items = queryVisible(
        '.oui-typeahead-dropdown-item, [class*="shopSelectMenuItem"], [class*="selectMenuItem"]',
        dropdown
      );

      const exact = items.find((item) => {
        const textNode = item.querySelector('.text');
        return elementText(textNode || item) === wanted;
      });

      if (exact) return exact;

      const partial = items.find((item) => {
        const textNode = item.querySelector('.text');
        const text = elementText(textNode || item);

        return text.includes(wanted) || wanted.includes(text);
      });

      if (partial) return partial;
    }

    return null;
  }

  function findShopListItem(shopName) {
    const dropdownItem = findShopItemInDropdown(shopName);

    if (dropdownItem) return dropdownItem;

    const directText = queryVisible(
      '.oui-typeahead-dropdown span.text, [class*="typeahead-dropdown"] span.text'
    ).find((el) => elementText(el) === norm(shopName));

    if (directText) {
      return directText.closest(
        '.oui-typeahead-dropdown-item, [class*="shopSelectMenuItem"]'
      ) || nearestClickable(directText);
    }

    const candidates = uniqElements(
      textCandidates(shopName, { exact: true })
        .concat(textCandidates(shopName, { exact: false }))
        .map(nearestClickable)
    );

    const inMenu = candidates.filter((el) => {
      const rect = getRect(el);

      if (!rect) return false;

      return rect.left < 460 &&
        rect.top > 55 &&
        rect.top < Math.min(window.innerHeight, 760);
    });

    return inMenu[0] || candidates[0] || null;
  }

  async function findShopListItemWithScroll(shopName) {
    let item = findShopListItem(shopName);

    if (item) return item;

    const dropdown = findShopDropdowns()[0];

    if (!dropdown) return null;

    dropdown.scrollTop = 0;
    dropdown.dispatchEvent(new Event('scroll', { bubbles: true }));

    await sleep(180);

    for (let i = 0; i < 12; i += 1) {
      item = findShopListItem(shopName);

      if (item) return item;

      const oldScrollTop = dropdown.scrollTop;

      dropdown.scrollTop += Math.max(
        80,
        Math.floor(dropdown.clientHeight * 0.8)
      );

      dropdown.dispatchEvent(new Event('scroll', { bubbles: true }));

      await sleep(220);

      if (dropdown.scrollTop === oldScrollTop) break;
    }

    return findShopListItem(shopName);
  }

  function findStoreSearchInput() {
    const selectors = [
      'input[placeholder*="关键字"]',
      'input[placeholder*="搜索"]',
      'input[placeholder*="请输入"]',
    ];

    for (const selector of selectors) {
      const input = queryVisible(selector).find((el) => {
        return el instanceof HTMLInputElement;
      });

      if (input) return input;
    }

    return null;
  }

  async function openStoreMenu() {
    let trigger = null;

    const icon = queryVisible(
      'i.anticon-angle-down, i.oui-canary-icon-angle-down, i[class*="treeTriangle"]'
    ).find((el) => {
      const rect = getRect(el);

      return rect && rect.top < 90 && rect.left < 460;
    });

    if (icon) {
      trigger = compactAncestorNearTopLeft(icon);
    }

    if (!trigger) {
      const selectorCandidates = [
        '[class*="shop"][class*="switch"]',
        '[class*="shop"][class*="name"]',
        '[class*="store"][class*="switch"]',
        '[class*="store"][class*="name"]',
        '[class*="seller"]',
        '[class*="merchant"]',
      ];

      for (const selector of selectorCandidates) {
        trigger = queryVisible(selector).find((el) => {
          const rect = getRect(el);

          return rect && rect.top < 90 && rect.left < 460;
        });

        if (trigger) break;
      }
    }

    if (!trigger) {
      const point = CONFIG.storeTriggerFallbackPoint;
      trigger = document.elementFromPoint(point.x, point.y);
    }

    await clickElement(trigger, '店铺下拉入口');

    await waitFor(
      () => findShopDropdowns()[0],
      '店铺下拉菜单',
      3000
    ).catch(() => null);

    await sleep(CONFIG.waitAfterOpenStoreMenuMs);
  }

  function scrollAllContainersToTop() {
    const scrollers = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...Array.from(document.querySelectorAll('div, main, section')),
    ].filter(Boolean);

    for (const el of scrollers) {
      if (el.scrollHeight > el.clientHeight + 20) {
        el.scrollTop = 0;
      }
    }

    window.scrollTo({
      top: 0,
      behavior: 'auto',
    });
  }

  async function selectShop(shopName) {
    scrollAllContainersToTop();

    await sleep(300);

    const currentShopName = getCurrentShopName(shopName);

    if (currentShopName === shopName) {
      updateStatus(`当前已是店铺：${shopName}`);
      state.lastShopName = shopName;
      await sleep(600);
      return;
    }

    updateStatus(`打开店铺列表：${shopName}`);

    await openStoreMenu();

    const input = findStoreSearchInput();

    if (input) {
      updateStatus(`搜索店铺：${shopName}`);
      await fillInput(input, shopName);
      await sleep(700);
    }

    const shopItem = await waitFor(
      () => findShopListItemWithScroll(shopName),
      `店铺：${shopName}`
    );

    updateStatus(`选择店铺：${shopName}`);

    await clickElement(shopItem, `店铺：${shopName}`);

    state.lastShopName = shopName;

    await waitFor(
      () => getCurrentShopName(shopName) === shopName,
      `店铺切换到：${shopName}`,
      12000
    );

    await sleep(CONFIG.waitAfterSelectShopMs);
  }

  async function select30Days() {
    updateStatus('切换 30 天');

    const dayButton = await waitFor(() => {
      const directButton = queryVisible(
        'button.ant-btn, button.oui-canary-btn, button'
      ).find((button) => {
        const rect = getRect(button);

        return rect &&
          rect.top < 320 &&
          ['30天', '近30天', '30 天'].includes(elementText(button));
      });

      if (directButton) return directButton;

      const directSpan = queryVisible('button span').find((span) => {
        const rect = getRect(span);

        return rect &&
          rect.top < 320 &&
          ['30天', '近30天', '30 天'].includes(elementText(span));
      });

      if (directSpan) {
        return directSpan.closest('button') || directSpan;
      }

      const candidates = uniqElements(
        textCandidates('30天', { exact: true })
          .concat(textCandidates('近30天', { exact: true }))
          .concat(textCandidates('30 天', { exact: true }))
          .map(nearestClickable)
      ).filter(isVisible);

      return candidates
        .filter((el) => {
          const rect = getRect(el);

          return rect && rect.top < 320;
        })
        .sort((a, b) => {
          const ar = getRect(a);
          const br = getRect(b);

          const aScore =
            (ar ? ar.left : 0) +
            (elementText(a) === '30天' ? 1000 : 0);

          const bScore =
            (br ? br.left : 0) +
            (elementText(b) === '30天' ? 1000 : 0);

          return bScore - aScore;
        })[0];
    }, '30天');

    await clickElement(dayButton, '30天');

    await sleep(CONFIG.waitAfterSelect30DaysMs);

    updateStatus('30天已选择');
  }

  function scrollAllContainersToBottom() {
    const scrollers = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...Array.from(document.querySelectorAll('div, main, section')),
    ].filter(Boolean);

    for (const el of scrollers) {
      if (el.scrollHeight > el.clientHeight + 20) {
        el.scrollTop = el.scrollHeight;
      }
    }

    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'auto',
    });
  }

  function downloadCandidateScore(el) {
    const rect = getRect(el);

    if (!rect) return -1;

    let score = rect.top + rect.left;

    const styleText = String(el.getAttribute('style') || '');
    const classText = String(el.className || '');

    let bg = '';

    try {
      bg = window.getComputedStyle(el).backgroundColor || '';
    } catch (_) {}

    if (rect.top > window.innerHeight * 0.45) score += 1000;
    if (rect.left > window.innerWidth * 0.45) score += 1000;

    if (
      /rgb\(61,\s*94,\s*255\)|#3d5eff/i.test(styleText) ||
      /rgb\(61,\s*94,\s*255\)/i.test(bg)
    ) {
      score += 1500;
    }

    if (/btn|button/i.test(classText)) score += 300;

    if (
      rect.width >= 24 &&
      rect.width <= 140 &&
      rect.height >= 20 &&
      rect.height <= 70
    ) {
      score += 300;
    }

    return score;
  }

  function clickableDownloadElement(el) {
    if (!el) return null;

    return el.closest('button, a[href], [role="button"]') || el;
  }

  function findDownloadButton() {
    const rightBottomDownload = queryVisible(
      'span, button, a, [role="button"], div'
    )
      .filter((el) => elementText(el) === '下载')
      .filter((el) => {
        const rect = getRect(el);

        if (!rect) return false;

        return rect.top > window.innerHeight * 0.45 &&
          rect.left > window.innerWidth * 0.45;
      })
      .sort((a, b) => {
        return downloadCandidateScore(b) - downloadCandidateScore(a);
      })[0];

    if (rightBottomDownload) {
      return clickableDownloadElement(rightBottomDownload);
    }

    const styledDownload = queryVisible(
      'span[style], button[style], a[style], div[style]'
    )
      .filter((el) => elementText(el) === '下载')
      .filter((el) => {
        return /rgb\(61,\s*94,\s*255\)|#3d5eff/i.test(
          String(el.getAttribute('style') || '')
        );
      })
      .sort((a, b) => {
        return downloadCandidateScore(b) - downloadCandidateScore(a);
      })[0];

    if (styledDownload) {
      return clickableDownloadElement(styledDownload);
    }

    const directDownload = queryVisible('span')
      .filter((el) => elementText(el) === '下载')
      .sort((a, b) => {
        const ar = getRect(a);
        const br = getRect(b);

        const aScore = ar ? ar.top * 2 + ar.left : 0;
        const bScore = br ? br.top * 2 + br.left : 0;

        return bScore - aScore;
      })[0];

    if (directDownload) {
      return clickableDownloadElement(directDownload);
    }

    const labels = ['下载', '导出', '下载数据'];

    const candidates = uniqElements(
      labels.flatMap((label) => {
        return textCandidates(label, { exact: false }).map(nearestClickable);
      })
    )
      .filter(isVisible)
      .filter((el) => {
        const rect = getRect(el);
        const text = elementText(el);

        return rect &&
          rect.width >= 24 &&
          rect.height >= 20 &&
          /下载|导出/.test(text);
      });

    return candidates.sort((a, b) => {
      const ar = getRect(a);
      const br = getRect(b);

      const aText = elementText(a);
      const bText = elementText(b);

      const aScore =
        (ar ? ar.top * 2 + ar.left : 0) +
        (/^下载$/.test(aText) ? 1000 : 0);

      const bScore =
        (br ? br.top * 2 + br.left : 0) +
        (/^下载$/.test(bText) ? 1000 : 0);

      return bScore - aScore;
    })[0] || null;
  }

  async function triggerDownload(shopName) {
    const id = `${state.batchId}|${shopName}`;
    const cached = await archiveDB('files', 'readonly', (store) => store.get(id));
    if (cached?.localSaved) {
      updateStatus(`已确认本次表格保存完成，跳过重复下载：${cached.filename}`);
      return;
    }
    const context = { id, shopName, date: currentDate(), controller: new AbortController(), captured: false };
    let timer;
    try {
      if (cached?.blob) {
        state.activeDownload = context;
        context.captured = true;
        await saveLocalDownload(cached, context.controller.signal);
        return;
      }
      updateStatus('查找右下角下载按钮');
      let downloadButton = findDownloadButton();
      if (!downloadButton) {
        scrollAllContainersToBottom();
        await sleep(CONFIG.waitAfterScrollBottomMs);
        downloadButton = await waitFor(findDownloadButton, '下载按钮');
      }
      const completion = new Promise((resolve, reject) => {
        context.resolve = resolve;
        context.reject = reject;
        context.controller.signal.addEventListener('abort', () => reject(new Error('下载已取消')), { once: true });
        timer = window.setTimeout(() => {
          reject(new Error('未确认表格下载完成；请检查登录状态、导出方式与下载权限'));
          context.controller.abort();
        }, 150000);
      });
      // 按钮点击有短暂异步等待，立即挂拒绝处理，防止中途停止造成未处理拒绝。
      completion.catch(() => {});
      state.activeDownload = context;
      updateStatus(`下载并核验：${buildDownloadFileName(shopName, context.date)}`);
      await clickElement(downloadButton, '下载按钮');
      const record = await completion;
      updateStatus(`本地下载完成，待统一归档：${record.filename}`);
      await refreshArchiveStatus();
    } finally {
      window.clearTimeout(timer);
      context.controller.abort();
      state.activeDownload = null;
    }
  }


  async function downloadShopOnce(shopName, index, total) {
    const saved = await archiveDB('files', 'readonly', (store) => store.get(`${state.batchId}|${shopName}`));
    if (saved?.localSaved) {
      updateStatus(`恢复已完成下载：${saved.filename}`);
      return;
    }
    writeBatchState({
      index: index - 1,
      currentShopName: shopName,
      phase: 'selectShop',
    });

    updateStatus(`[${index}/${total}] 切换店铺：${shopName}`);

    await selectShop(shopName);

    writeBatchState({
      index: index - 1,
      currentShopName: shopName,
      phase: 'shopSelected',
    });

    await randomStableWait(
      `[${index}/${total}] 店铺已切换：${shopName}`,
      3000,
      6000
    );

    updateStatus(`[${index}/${total}] 选择30天：${shopName}`);

    await select30Days();

    writeBatchState({
      index: index - 1,
      currentShopName: shopName,
      phase: 'daysSelected',
    });

    await randomStableWait(
      `[${index}/${total}] 30天已选择：${shopName}`,
      1500,
      3500
    );

    updateStatus(`[${index}/${total}] 下载：${shopName}`);

    await triggerDownload(shopName);

    writeBatchState({
      index: index - 1,
      currentShopName: shopName,
      phase: 'downloadSaved',
    });

    await randomStableWait(
      `[${index}/${total}] 表格已保存：${shopName}`,
      CONFIG.randomWaitMinMs,
      CONFIG.randomWaitMaxMs
    );
  }

  async function downloadShopWithRetry(shopName, index, total) {
    for (let attempt = 1; attempt <= CONFIG.maxRetryPerShop; attempt += 1) {
      if (state.stopRequested) {
        throw new Error('用户已停止');
      }

      try {
        updateStatus(
          `[${index}/${total}] ${shopName} 第 ${attempt} 次开始`
        );

        await downloadShopOnce(shopName, index, total);

        updateStatus(`✅ [${index}/${total}] ${shopName} 完成`);

        return true;
      } catch (error) {
        const message = error?.message || String(error);

        updateStatus(
          `❌ [${index}/${total}] ${shopName} 失败：${message}`,
          true
        );

        if (attempt < CONFIG.maxRetryPerShop) {
          await randomStableWait(
            `${shopName} 准备重试`,
            3000,
            7000
          );
        } else {
          updateStatus(
            `⚠️ ${shopName} 已达到最大重试次数，跳过`,
            true
          );

          return false;
        }
      }
    }

    return false;
  }

  async function runShopList(shops, startIndex = 0, isResume = false) {
    if (state.running) {
      updateStatus('当前已有任务正在运行', true);
      return;
    }

    if (state.archiving) {
      updateStatus('正在拷贝，请稍后开始下载', true);
      return;
    }
    state.running = true;
    state.stopRequested = false;

    removeCompletionPopup();
    setPanelRunning(true);

    let completed = 0;
    let failed = 0;
    let failures = [];

    try {
      if (!await hasArchivePermission()) {
        updateStatus('请先选择归档目录，或点击“补拷贝 / 授权续跑”恢复目录权限', true);
        return;
      }
      // 单店和批量共用持久化任务，店铺切换导致刷新时都能继续。
      if (!isResume) {
        startBatchState(shops, startIndex);
      } else {
        const batch = readBatchState();

        completed = Number(batch?.completed || 0);
        failures = Array.isArray(batch?.failures) ? batch.failures : [];
        failed = failures.length;

        writeBatchState({
          active: true,
          stopRequested: false,
        });
      }
      state.batchId = readBatchState().batchId;
      updateStatus(
        isResume
          ? (startIndex >= shops.length ? '继续归档表格' : `继续任务，从第 ${startIndex + 1}/${shops.length} 家开始`)
          : `开始任务，共 ${shops.length} 家店铺`
      );

      for (let i = startIndex; i < shops.length; i += 1) {
        if (state.stopRequested) break;

        const shopName = shops[i];

        writeBatchState({
          active: true, shops, index: i,
          currentShopName: shopName, phase: 'running',
        });

        const ok = await downloadShopWithRetry(
          shopName,
          i + 1,
          shops.length
        );

        if (ok) {
          completed += 1;
        } else {
          failed += 1;
          failures.push(`${shopName}: 失败`);
        }

        writeBatchState({
          active: !state.stopRequested, shops, index: i + 1,
          completed, failures, currentShopName: '', phase: 'waitingNext',
        });

        if (!state.stopRequested && i < shops.length - 1) {
          await randomStableWait('切换下一家店铺前', 2500, 6000);
        }
      }

      if (state.stopRequested) {
        stopBatchState();

        updateStatus(`已停止，已完成 ${completed}/${shops.length}`);
      } else {
        writeBatchState({ phase: 'archiving', active: true });
        const copied = await copyPendingFiles();
        clearBatchState();
        updateStatus(`处理完成：下载 ${completed} 家，失败 ${failed} 家；本次归档 ${copied} 份`);

        showCompletionPopup({
          completed,
          total: shops.length,
          failed,
        });
      }
    } catch (error) {
      updateStatus(`任务暂停：${error.message}。已取得表格保留在缓存，点击“补拷贝 / 授权续跑”重试。`, true);
    } finally {
      state.running = false;
      setPanelRunning(false);
    }
  }

  function resumePendingBatch() {
    const batch = readBatchState();

    if (!batch || !batch.active || batch.stopRequested) return;

    const shops = Array.isArray(batch.shops) && batch.shops.length
      ? batch.shops
      : SHOP_NAMES;

    let index = Number(batch.index || 0);

    if (!Number.isFinite(index)) index = 0;

    index = Math.max(0, Math.min(index, shops.length));

    // 最后一家下载后刷新也必须继续归档，不能直接清除任务。
    if (!batch.batchId) {
      writeBatchState({ active: false });
      updateStatus('检测到旧版任务，请重新点击下载；新版将核验下载并归档', true);
      return;
    }

    updateStatus(index >= shops.length
      ? '检测到待归档任务，即将继续拷贝表格'
      : `检测到未完成任务，${Math.round(CONFIG.autoResumeDelayMs / 1000)} 秒后从第 ${index + 1}/${shops.length} 家继续：${shops[index]}`);

    window.setTimeout(() => {
      const latest = readBatchState();

      if (!latest || !latest.active || latest.stopRequested || state.running) {
        return;
      }

      const latestShops = Array.isArray(latest.shops) && latest.shops.length
        ? latest.shops
        : shops;

      let latestIndex = Number(latest.index || 0);

      if (!Number.isFinite(latestIndex)) latestIndex = index;

      latestIndex = Math.max(0, Math.min(latestIndex, latestShops.length));

      runShopList(latestShops, latestIndex, true);
    }, CONFIG.autoResumeDelayMs);
  }

  async function init() {
    installPageDownloadRenameHook();
    createPanel();

    log(`脚本 v${VERSION} 已加载；GitHub 原路径支持篡改猴更新`);
    log('表格以店铺名称+北京时间日期命名；下载后统一拷贝到日期文件夹');
    log(`归档目标：${ARCHIVE_ROOT}（首次需手动选择此目录）`);
    try {
      state.archiveHandle = await archiveDB('settings', 'readonly', (store) => store.get('directory'));
      await refreshArchiveStatus();
      resumePendingBatch();
    } catch (error) {
      updateStatus(`无法读取归档缓存：${error.message}`, true);
    }
  }

  init();
})();

