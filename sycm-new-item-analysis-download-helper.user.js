// ==UserScript==
// @name         生意参谋新品分析下载助手-批量续跑修复版
// @namespace    https://github.com/anysky911/WuLuLu
// @version      0.8.0
// @description  新品/商品排行双标签：独立目录、店铺、时间筛选和记录；支持拖动、最小化、批量续跑及校验归档
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
  const VERSION = '0.8.0';
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
  const PAGE_DEFS = {
    new: { label: '新品', path: '/cc/new_item_analysis' },
    rank: { label: '排行', path: '/cc/item_rank' },
  };
  const TIME_MODES = {
    realtime: ['实时', '实时数据'], recent7: ['7天', '近7天'], recent30: ['30天', '近30天'],
    day: ['日', '按日'], week: ['周', '按周'], month: ['月', '按月'], custom: ['自定义'],
  };
  const PROFILE_KEY = 'sycm-helper-profiles-v8';
  const LAYOUT_KEY = 'sycm-helper-layout-v8';
  const OWNER_KEY = 'sycm-helper-task-owner-v8';
  const BATCH_STATE_KEY = 'sycm-helper-batch-state-v8';

  function loadJSON(key, fallback, storage = localStorage) {
    try { return JSON.parse(storage.getItem(key)) || fallback; } catch (_) { return fallback; }
  }
  function defaultFilter() { return { mode: 'recent30', start: '', end: '', range: '' }; }
  function makeProfile(saved = {}) {
    return {
      shopName: saved.shopName ?? SHOP_NAMES[0], shops: saved.shops ?? SHOP_NAMES.join('\n'),
      filter: { ...defaultFilter(), ...saved.filter, mode: TIME_MODES[saved.filter?.mode] ? saved.filter.mode : 'recent30' },
      directoryOpen: saved.directoryOpen !== false, recordsOpen: saved.recordsOpen === true,
      logs: Array.isArray(saved.logs) ? saved.logs.slice(-120) : [],
      status: saved.status || '等待操作', platformUrl: saved.platformUrl || '', error: false, archiveHandle: null, records: [],
    };
  }
  const savedProfiles = loadJSON(PROFILE_KEY, {});
  const profiles = { new: makeProfile(savedProfiles.new), rank: makeProfile(savedProfiles.rank) };
  const layout = { x: null, y: null, minimized: false, viewPage: 'new', ...loadJSON(LAYOUT_KEY, {}) };
  const state = {
    running: false, stopRequested: false, activeDownload: null, archiving: false,
    batchId: '', lastShopName: '', taskPage: null, taskFilter: null, taskDirectory: null,
    filterBusy: false, viewPage: PAGE_DEFS[layout.viewPage] ? layout.viewPage : 'new',
    get archiveHandle() { return state.taskDirectory || profiles[workPage()].archiveHandle; },
    set archiveHandle(handle) { profiles[workPage()].archiveHandle = handle; },
  };
  function workPage() { return state.taskPage || state.viewPage; }
  function recordPage(record) { return record.pageId || 'new'; }
  function recordsForPage(records, pageId) { return records.filter((record) => recordPage(record) === pageId); }
  function saveProfiles() {
    const saved = {};
    for (const pageId of Object.keys(PAGE_DEFS)) {
      const { shopName, shops, filter, directoryOpen, recordsOpen, logs, status, platformUrl } = profiles[pageId];
      saved[pageId] = { shopName, shops, filter, directoryOpen, recordsOpen, logs, status, platformUrl };
    }
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(saved)); } catch (error) { console.error('配置保存失败', error); }
  }
  function saveLayout() {
    layout.viewPage = state.viewPage;
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (_) {}
  }


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

  function readBatchState(pageId = workPage()) {
    return loadJSON(`${BATCH_STATE_KEY}:${pageId}`, null, sessionStorage);
  }
  function writeBatchState(patch, pageId = workPage()) {
    const next = { ...(readBatchState(pageId) || {}), ...patch, pageId, updatedAt: Date.now() };
    sessionStorage.setItem(`${BATCH_STATE_KEY}:${pageId}`, JSON.stringify(next));
    return next;
  }
  function clearBatchState(pageId = workPage()) {
    sessionStorage.removeItem(`${BATCH_STATE_KEY}:${pageId}`);
    if (sessionStorage.getItem(OWNER_KEY) === pageId) sessionStorage.removeItem(OWNER_KEY);
  }
  function startBatchState(shops, startIndex = 0, pageId = workPage()) {
    return writeBatchState({
      active: true, batchId: crypto.randomUUID(), shops, index: startIndex, completed: 0,
      failures: [], stopRequested: false, startedAt: Date.now(), phase: 'start',
      filter: { ...profiles[pageId].filter },
    }, pageId);
  }
  function stopBatchState(pageId = workPage()) { writeBatchState({ active: false, stopRequested: true }, pageId); }
  async function getCachedRecord(shopName, pageId = workPage()) {
    const id = `${pageId}|${state.batchId}|${shopName}`;
    let record = await archiveDB('files', 'readonly', (store) => store.get(id));
    if (!record && pageId === 'new') {
      record = await archiveDB('files', 'readonly', (store) => store.get(`${state.batchId}|${shopName}`));
    }
    return record && recordPage(record) === pageId ? record : null;
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
      el.closest(`#${COMPLETE_POPUP_ID}`) || el.closest('#sycm-helper-panel')
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

  function log(message, isError = false, pageId = workPage()) {
    const entry = { text: `[${new Date().toLocaleTimeString()}] ${message}`, error: isError };
    profiles[pageId].logs.push(entry);
    profiles[pageId].logs = profiles[pageId].logs.slice(-120);
    saveProfiles();
    (isError ? console.error : console.log)(`[SYCM ${PAGE_DEFS[pageId].label}]`, message);
    if (state.viewPage === pageId) renderLogs();
  }
  function updateStatus(message, isError = false, pageId = workPage()) {
    profiles[pageId].status = message;
    profiles[pageId].error = isError;
    log(message, isError, pageId);
    renderTaskState();
  }
  function renderLogs() {
    const box = document.querySelector(`#${PANEL_ID} .sycm-helper-log`);
    if (!box) return;
    box.replaceChildren(...profiles[state.viewPage].logs.map((entry) => {
      const div = document.createElement('div');
      div.textContent = entry.text;
      div.style.color = entry.error ? '#d93025' : '#33415c';
      return div;
    }));
    box.scrollTop = box.scrollHeight;
  }
  function renderTaskState() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const pageId = state.viewPage, profile = profiles[pageId];
    const busy = state.running || state.archiving || state.filterBusy || Boolean(state.taskPage);
    panel.querySelector('.sycm-helper-status').textContent = profile.status;
    panel.querySelector('.sycm-helper-status').dataset.error = String(profile.error);
    panel.querySelector('.sycm-task-info').textContent = state.taskPage
      ? `${PAGE_DEFS[state.taskPage].label}任务${busy ? '运行中' : '处理中'}；可切换查看，下载按原任务继续` : '';
    for (const selector of ['.sycm-helper-run-one', '.sycm-helper-run-all', '.sycm-helper-copy', '.sycm-apply-filter']) {
      panel.querySelector(selector).disabled = busy;
    }
    panel.querySelector('.sycm-helper-stop').disabled = !busy || state.taskPage !== pageId;
    panel.querySelector('.sycm-helper-pick-folder').disabled = busy && state.taskPage === pageId;
    panel.querySelectorAll('.sycm-filter-edit').forEach((el) => { el.disabled = busy && state.taskPage === pageId; });
    renderTimeControls();
  }
  function setPanelRunning() { renderTaskState(); }
  function renderProfile() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const profile = profiles[state.viewPage];
    panel.querySelectorAll('[role="tab"]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.page === state.viewPage));
      button.tabIndex = button.dataset.page === state.viewPage ? 0 : -1;
    });
    panel.querySelector('.sycm-helper-body').setAttribute('aria-labelledby', `sycm-tab-${state.viewPage}`);
    panel.querySelector('.sycm-helper-input').value = profile.shopName;
    panel.querySelector('.sycm-helper-shop-list').value = profile.shops;
    panel.querySelector('.sycm-start-date').value = profile.filter.start;
    panel.querySelector('.sycm-end-date').value = profile.filter.end;
    panel.querySelector('.sycm-directory').open = profile.directoryOpen;
    panel.querySelector('.sycm-records').open = profile.recordsOpen;
    renderArchiveState(state.viewPage);
    renderLogs();
    renderTaskState();
  }
  function switchPage(pageId, navigate = true) {
    if (!PAGE_DEFS[pageId]) return;
    state.viewPage = pageId;
    saveLayout();
    renderProfile();
    // 空闲时同步平台页面；任务运行时只切视图，不能改变任务的数据来源。
    if (navigate && !state.running && !state.archiving && !state.filterBusy && !state.taskPage) {
      applyVisibleFilter(0, pageId);
    }
  }
  function renderArchiveState(pageId) {
    if (state.viewPage !== pageId) return;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const profile = profiles[pageId], pending = profile.records.filter((record) => !record.archived).length;
    panel.querySelector('.sycm-directory summary').textContent =
      `所选目录：${profile.archiveHandle?.name || '未选择'} · 待拷贝 ${pending} 份`;
    panel.querySelector('.sycm-helper-archive-status').textContent =
      `${PAGE_DEFS[pageId].label}独立目录：${profile.archiveHandle?.name || '请点击选择归档目录'}\n` +
      `目录内按拷贝日期建立文件夹。浏览器仅提供目录名，请在选择器中确认完整路径。`;
    const list = panel.querySelector('.sycm-record-list');
    list.replaceChildren(...profile.records.slice(-30).reverse().map((record) => {
      const item = document.createElement('div');
      item.textContent = `${record.archived ? '已归档' : '待拷贝'} · ${record.archiveDate ? record.archiveDate + '/' : ''}` +
        `${record.archiveName || record.filename} · ${record.filter?.range || '旧版未记录统计范围'}`;
      return item;
    }));
    if (!list.children.length) list.textContent = '暂无归档记录';
  }
  function setMinimized(minimized) {
    layout.minimized = minimized;
    const panel = document.getElementById(PANEL_ID);
    panel.classList.toggle('sycm-minimized', minimized);
    panel.querySelector('.sycm-minimize').textContent = minimized ? '恢复' : '缩小';
    panel.querySelector('.sycm-minimize').setAttribute('aria-expanded', String(!minimized));
    clampPanelPosition();
    saveLayout();
  }
  function clampPanelPosition() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || layout.x === null || layout.y === null) return;
    const rect = panel.getBoundingClientRect();
    layout.x = Math.max(0, Math.min(layout.x, Math.max(0, window.innerWidth - rect.width)));
    layout.y = Math.max(0, Math.min(layout.y, Math.max(0, window.innerHeight - Math.min(rect.height, 70))));
    panel.style.left = `${layout.x}px`;
    panel.style.top = `${layout.y}px`;
    panel.style.transform = 'none';
  }
  function installPanelDrag(panel) {
    const header = panel.querySelector('.sycm-header');
    let drag = null;
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button, input, a, select')) return;
      const rect = panel.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      layout.x = event.clientX - drag.x;
      layout.y = event.clientY - drag.y;
      clampPanelPosition();
    });
    const end = () => { if (drag) { drag = null; saveLayout(); } };
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
    header.addEventListener('lostpointercapture', end);
    window.addEventListener('resize', () => { clampPanelPosition(); saveLayout(); });
  }
  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="sycm-header">
        <div class="sycm-tabs" role="tablist" aria-label="数据页面">
          <button id="sycm-tab-new" role="tab" data-page="new" aria-controls="sycm-page-body">新品</button>
          <span class="sycm-helper-title">下载助手 v${VERSION}</span>
          <button id="sycm-tab-rank" role="tab" data-page="rank" aria-controls="sycm-page-body">排行</button>
        </div>
        <button class="sycm-minimize" type="button" aria-controls="sycm-page-body">缩小</button>
      </div>
      <div class="sycm-task-info" role="status"></div>
      <div class="sycm-helper-body" id="sycm-page-body" role="tabpanel">
        <div class="sycm-time-options" role="radiogroup" aria-label="时间筛选">
          ${Object.entries(TIME_MODES).map(([key, labels]) => `<button type="button" role="radio" data-mode="${key}" aria-checked="false">${labels[0]}</button>`).join('')}
        </div>
        <div class="sycm-custom-dates" hidden>
          <label>开始<input class="sycm-start-date sycm-filter-edit" type="date"></label>
          <label>结束<input class="sycm-end-date sycm-filter-edit" type="date"></label>
        </div>
        <div class="sycm-time-actions">
          <button class="sycm-prev" type="button" aria-label="上一统计区间">‹</button>
          <button class="sycm-apply-filter" type="button">应用筛选 / 打开页面</button>
          <button class="sycm-next" type="button" aria-label="下一统计区间">›</button>
        </div>
        <div class="sycm-current-range"></div>
        <input class="sycm-helper-input" type="text" placeholder="单店店铺名" aria-label="单店店铺名">
        <div class="sycm-helper-buttons">
          <button class="sycm-helper-run-one" type="button">下载单店</button>
          <button class="sycm-helper-run-all" type="button">一键下载列表</button>
          <button class="sycm-helper-stop" type="button">停止</button>
          <button class="sycm-helper-clear" type="button">清空日志</button>
        </div>
        <details class="sycm-directory">
          <summary>所选目录：未选择</summary>
          <div class="sycm-helper-archive-status"></div>
          <div class="sycm-helper-buttons">
            <button class="sycm-helper-pick-folder" type="button">选择归档目录</button>
            <button class="sycm-helper-copy" type="button">补拷贝 / 授权续跑</button>
          </div>
        </details>
        <textarea class="sycm-helper-shop-list" placeholder="每行一个店铺名" aria-label="店铺列表"></textarea>
        <details class="sycm-records"><summary>归档记录（当前页最近30份）</summary><div class="sycm-record-list"></div></details>
        <div class="sycm-helper-status" role="status"></div>
        <div class="sycm-helper-log" aria-label="当前页面处理日志"></div>
      </div>`;
    document.documentElement.appendChild(panel);
    panel.querySelectorAll('[role="tab"]').forEach((button) => {
      button.addEventListener('click', () => switchPage(button.dataset.page));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const next = state.viewPage === 'new' ? 'rank' : 'new';
        switchPage(next);
        panel.querySelector(`[data-page="${next}"]`).focus();
      });
    });
    panel.querySelector('.sycm-minimize').addEventListener('click', () => setMinimized(!layout.minimized));
    for (const [selector, key] of [['.sycm-helper-input', 'shopName'], ['.sycm-helper-shop-list', 'shops']]) {
      panel.querySelector(selector).addEventListener('input', (event) => { profiles[state.viewPage][key] = event.target.value; saveProfiles(); });
    }
    panel.querySelectorAll('[role="radio"]').forEach((button) => button.addEventListener('click', () => {
      const pageId = state.viewPage;
      if (state.taskPage === pageId) return;
      profiles[pageId].filter = { ...defaultFilter(), mode: button.dataset.mode };
      saveProfiles();
      renderProfile();
    }));
    for (const [selector, key] of [['.sycm-start-date', 'start'], ['.sycm-end-date', 'end']]) {
      panel.querySelector(selector).addEventListener('change', (event) => {
        profiles[state.viewPage].filter[key] = event.target.value;
        profiles[state.viewPage].filter.range = '';
        saveProfiles(); renderTimeControls();
      });
    }
    panel.querySelector('.sycm-apply-filter').addEventListener('click', () => applyVisibleFilter());
    panel.querySelector('.sycm-prev').addEventListener('click', () => applyVisibleFilter(-1));
    panel.querySelector('.sycm-next').addEventListener('click', () => applyVisibleFilter(1));
    panel.querySelector('.sycm-helper-run-one').addEventListener('click', () => {
      const pageId = state.viewPage, name = norm(profiles[pageId].shopName);
      if (!name) return updateStatus('请先输入店铺名', true, pageId);
      runShopList([name], 0, false, pageId);
    });
    panel.querySelector('.sycm-helper-run-all').addEventListener('click', () => {
      const pageId = state.viewPage;
      const shops = [...new Set(profiles[pageId].shops.split('\n').map(norm).filter(Boolean))];
      if (!shops.length) return updateStatus('店铺列表为空', true, pageId);
      runShopList(shops, 0, false, pageId);
    });
    panel.querySelector('.sycm-helper-pick-folder').addEventListener('click', () => chooseArchiveDirectory(state.viewPage));
    panel.querySelector('.sycm-helper-copy').addEventListener('click', () => authorizeAndCopy(state.viewPage));
    panel.querySelector('.sycm-helper-stop').addEventListener('click', () => {
      if (state.taskPage !== state.viewPage) return;
      state.stopRequested = true;
      stopBatchState(state.viewPage);
      state.activeDownload?.controller.abort();
      updateStatus('收到停止请求；已取得表格保留，可补拷贝', false, state.viewPage);
    });
    panel.querySelector('.sycm-helper-clear').addEventListener('click', () => {
      profiles[state.viewPage].logs = []; saveProfiles(); renderLogs();
    });
    for (const [selector, key] of [['.sycm-directory', 'directoryOpen'], ['.sycm-records', 'recordsOpen']]) {
      const details = panel.querySelector(selector);
      details.querySelector('summary').addEventListener('click', (event) => {
        event.preventDefault();
        details.open = !details.open;
        profiles[state.viewPage][key] = details.open;
        saveProfiles();
      });
    }
    installPanelDrag(panel);
    renderProfile();
    setMinimized(layout.minimized);
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

  async function hasArchivePermission(pageId = workPage()) {
    const handle = state.taskPage === pageId && state.taskDirectory ? state.taskDirectory : profiles[pageId].archiveHandle;
    return handle && await handle.queryPermission({ mode: 'readwrite' }) === 'granted';
  }
  async function refreshArchiveStatus(pageId = workPage()) {
    const records = await archiveDB('files', 'readonly', (store) => store.getAll());
    profiles[pageId].records = recordsForPage(records, pageId).map(({ blob, ...record }) => record)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    renderArchiveState(pageId);
  }
  async function chooseArchiveDirectory(pageId = state.viewPage) {
    if (state.taskPage === pageId) return updateStatus('本页任务运行中，结束后可以更换目录', true, pageId);
    try {
      if (typeof pageWindow.showDirectoryPicker !== 'function') throw new Error('请使用支持目录授权的 Chrome 或 Edge 浏览器');
      // 每页有单独的 picker ID 和持久化句柄；选择结果永远写回发起选择的页。
      const handle = await pageWindow.showDirectoryPicker({ id: `sycm-archive-${pageId}`, mode: 'readwrite' });
      await archiveDB('settings', 'readwrite', (store) => store.put(handle, `directory:${pageId}`));
      profiles[pageId].archiveHandle = handle;
      await refreshArchiveStatus(pageId);
      updateStatus(`${PAGE_DEFS[pageId].label}归档目录已选择：${handle.name}。另一页目录保持独立`, false, pageId);
    } catch (error) {
      updateStatus(error.name === 'AbortError' ? '已取消选择目录' : error.message, true, pageId);
    }
  }
  async function authorizeAndCopy(pageId = state.viewPage) {
    if (state.running || state.archiving || state.filterBusy || state.taskPage) return updateStatus('已有任务正在运行，请稍候', true, pageId);
    const handle = profiles[pageId].archiveHandle;
    if (!handle) return chooseArchiveDirectory(pageId);
    state.taskPage = pageId; state.taskDirectory = handle; state.stopRequested = false;
    let resume = null;
    renderTaskState();
    try {
      if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('尚未获得此页目录的写入权限');
      if (state.stopRequested) throw new Error('用户已停止');
      const copied = await copyPendingFiles(pageId);
      updateStatus(`补拷贝完成：${copied} 份`, false, pageId);
      const batch = readBatchState(pageId);
      if (batch?.active && !batch.stopRequested && batch.batchId) resume = batch;
    } catch (error) {
      updateStatus(`拷贝未完成：${error.message}；缓存已保留，可重试`, true, pageId);
    } finally {
      state.taskPage = null; state.taskDirectory = null; renderTaskState();
    }
    if (resume) await runShopList(resume.shops, resume.index || 0, true, pageId);
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

  async function copyPendingFiles(pageId = workPage()) {
    if (state.archiving) throw new Error('正在归档，请稍候');
    state.archiving = true;
    let copied = 0;
    try {
      if (!await hasArchivePermission(pageId)) throw new Error('请点击“补拷贝 / 授权续跑”授予此页目录写入权限');
      const handle = state.taskPage === pageId && state.taskDirectory ? state.taskDirectory : profiles[pageId].archiveHandle;
      const records = await archiveDB('files', 'readonly', (store) => store.getAll());
      for (const record of recordsForPage(records, pageId).filter((item) => !item.archived)) {
        if (state.stopRequested) throw new Error('用户已停止');
        if (!record.blob?.size) throw new Error(`缓存表格为空：${record.filename}`);
        // 首次归档按拷贝当天建目录；重试沿用已记录的日期。
        if (!record.archiveDate) {
          record.archiveDate = currentDate();
          await archiveDB('files', 'readwrite', (store) => store.put(record));
        }
        updateStatus(`正在归档：${record.archiveDate} / ${record.filename}`, false, pageId);
        const directory = await handle.getDirectoryHandle(record.archiveDate, { create: true });
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
      await refreshArchiveStatus(pageId);
      renderTaskState();
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
      const snapshot = platformSnapshot();
      if (!onPlatformPage(context.pageId) || snapshot?.mode !== context.filter.mode || snapshot?.range !== context.filter.range) {
        context.reject(new Error('导出期间平台页面或统计范围被改变，已取消，避免错误归类'));
        context.controller.abort();
        return true;
      }
      const source = blobs.has(url) ? Promise.resolve(blobs.get(url)) : fetchExportBlob(url, context);
      blobs.clear();
      (async () => {
        const blob = await source;
        const extension = await spreadsheetExtension(blob);
        if (context.controller.signal.aborted) throw new Error('下载已取消');
        const record = {
          id: context.id, pageId: context.pageId, shopName: context.shopName, date: context.date,
          filter: { ...context.filter }, createdAt: Date.now(),
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

  class NavigationPending extends Error {}
  const FILTER_ACTION_KEY = 'sycm-helper-filter-action-v8';
  function onPlatformPage(pageId) { return location.pathname.replace(/\/$/, '') === PAGE_DEFS[pageId].path; }
  function ensurePlatformPage(pageId) {
    if (onPlatformPage(pageId)) return;
    let url = new URL(PAGE_DEFS[pageId].path, location.origin);
    const saved = profiles[pageId].platformUrl;
    if (saved) {
      const candidate = new URL(saved, location.origin);
      if (candidate.origin === location.origin && candidate.pathname === PAGE_DEFS[pageId].path) url = candidate;
    }
    updateStatus(`正在打开${PAGE_DEFS[pageId].label}平台页面，刷新后继续`, false, pageId);
    location.assign(url.href);
    throw new NavigationPending();
  }
  function disabledControl(element) {
    return !element || element.disabled || element.hasAttribute('disabled') ||
      element.getAttribute('aria-disabled') === 'true' || /disabled/i.test(String(element.className));
  }
  function timeLabel(element) {
    return elementText(element).replace(/\s/g, '').replace(/[?？ⓘ]/g, '');
  }
  function modeForElement(element) {
    return Object.keys(TIME_MODES).find((key) => TIME_MODES[key].includes(timeLabel(element)));
  }
  function timeControls(root) {
    const controls = {};
    for (const el of queryVisible('button, a, [role="button"], [role="tab"], span, label', root)) {
      const mode = modeForElement(el);
      if (!mode) continue;
      const control = el.closest('button, a, [role="button"], [role="tab"]') || el;
      if (root.contains(control) && !controls[mode]) controls[mode] = control;
    }
    return controls;
  }
  function findTimeToolbar() {
    const seeds = queryVisible('button, a, [role="button"], [role="tab"], span').filter((el) => {
      const rect = getRect(el);
      return rect?.top < 450 && modeForElement(el);
    });
    for (const seed of seeds) {
      let root = seed.parentElement;
      for (let depth = 0; root && depth < 5 && root !== document.body; depth += 1, root = root.parentElement) {
        if (elementText(root).length > 1500) break;
        if (Object.keys(timeControls(root)).length >= 3) return root;
      }
    }
    return null;
  }
  function datePairs(text) {
    return Array.from(String(text).matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g),
      (match) => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
  }
  function readPlatformRange(toolbar) {
    let root = toolbar;
    for (let depth = 0; root && depth < 4 && root !== document.body; depth += 1, root = root.parentElement) {
      const text = elementText(root);
      if (text.length > 2500) break;
      const dates = datePairs(text);
      if (dates.length >= 2) return { start: dates[0], end: dates[1], range: `${dates[0]} ~ ${dates[1]}` };
      if (dates.length === 1) return { start: dates[0], end: dates[0], range: dates[0] };
    }
    return null;
  }
  function selectedTimeMode(toolbar, controls) {
    for (const [mode, element] of Object.entries(controls)) {
      let current = element;
      for (let depth = 0; current && current !== toolbar && depth < 3; depth += 1, current = current.parentElement) {
        if (current.getAttribute('aria-pressed') === 'true' || current.getAttribute('aria-selected') === 'true' ||
            current.getAttribute('aria-checked') === 'true' ||
            /(?:^|[\s_-])(active|selected|checked|primary)(?:$|[\s_-])/i.test(String(current.className))) return mode;
      }
    }
    const type = new URL(location.href).searchParams.get('dateType');
    return Object.hasOwn(TIME_MODES, type) ? type : ({ today: 'realtime', range: 'custom' }[type] || '');
  }
  function findTimeArrow(toolbar, direction) {
    if (!toolbar) return null;
    let root = toolbar;
    // 箭头可能与时间按钮组为相邻节点，只向上扩展到同一时间工具栏。
    if (root.parentElement && elementText(root.parentElement).length < 1500) root = root.parentElement;
    const regex = direction < 0 ? /上一|向前|previous|prev|left|angle-left|‹|〈|«/i : /下一|向后|next|right|angle-right|›|〉|»/i;
    return queryVisible('button, a, [role="button"]', root).find((el) => {
      if (modeForElement(el)) return false;
      const description = [el.getAttribute('aria-label'), el.getAttribute('title'), String(el.className),
        elementText(el), ...Array.from(el.querySelectorAll('i, svg, span')).map((child) =>
          `${child.getAttribute('data-icon') || ''} ${child.getAttribute('aria-label') || ''} ${child.getAttribute('class') || ''}`)].join(' ');
      return regex.test(description);
    }) || null;
  }
  function platformSnapshot() {
    const toolbar = findTimeToolbar();
    if (!toolbar) return null;
    const controls = timeControls(toolbar);
    return { toolbar, controls, mode: selectedTimeMode(toolbar, controls), ...readPlatformRange(toolbar) };
  }
  function validateFilter(filter) {
    if (!TIME_MODES[filter.mode]) throw new Error('不支持的时间类型');
    if (filter.mode !== 'custom') return;
    for (const value of [filter.start, filter.end]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
          new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('请输入有效的开始日期和结束日期');
    }
    if (filter.start > filter.end) throw new Error('开始日期不能晚于结束日期');
  }
  function renderTimeControls() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const profile = profiles[state.viewPage], filter = profile.filter;
    const snapshot = onPlatformPage(state.viewPage) ? platformSnapshot() : null;
    const busy = state.running || state.archiving || state.filterBusy || Boolean(state.taskPage);
    panel.querySelectorAll('[role="radio"]').forEach((button) => {
      const mode = button.dataset.mode;
      button.setAttribute('aria-checked', String(mode === filter.mode));
      button.disabled = (state.taskPage === state.viewPage) || Boolean(snapshot && (!snapshot.controls[mode] || disabledControl(snapshot.controls[mode])));
      button.title = snapshot && !snapshot.controls[mode] ? '当前平台页面不支持此时间类型' : '';
    });
    panel.querySelector('.sycm-custom-dates').hidden = filter.mode !== 'custom';
    panel.querySelector('.sycm-current-range').textContent = snapshot?.range
      ? `平台统计时间：${snapshot.range}${filter.range && snapshot.range !== filter.range ? `；本页已保存：${filter.range}` : ''}`
      : (filter.range ? `本页已保存统计时间：${filter.range}` : '统计时间：待应用筛选后读取平台');
    for (const [selector, direction] of [['.sycm-prev', -1], ['.sycm-next', 1]]) {
      const arrow = snapshot && findTimeArrow(snapshot.toolbar, direction);
      panel.querySelector(selector).disabled = busy || !snapshot || snapshot.mode !== filter.mode ||
        !filter.range || snapshot.range !== filter.range || ['realtime', 'custom'].includes(filter.mode) || disabledControl(arrow);
    }
  }
  async function waitPlatformReady(mode, expected = null) {
    let previous = '', stableSince = 0;
    return waitFor(() => {
      const snapshot = platformSnapshot();
      if (!snapshot || snapshot.mode !== mode || !snapshot.range) return null;
      if (expected && (snapshot.start !== expected.start || snapshot.end !== expected.end)) return null;
      const loading = queryVisible('[aria-busy="true"], .ant-spin-spinning, .oui-canary-spin-spinning').length > 0;
      if (loading) { stableSince = 0; return null; }
      const signature = `${snapshot.mode}:${snapshot.range}`;
      if (signature !== previous || !stableSince) { previous = signature; stableSince = Date.now(); return null; }
      return Date.now() - stableSince >= 1000 ? snapshot : null;
    }, '平台时间筛选生效及数据加载', 20000);
  }
  async function applyCustomDates(filter) {
    const inputs = await waitFor(() => {
      const all = queryVisible('input').filter((el) => /date|日期|开始|结束|起始|截止|start|end/i.test(
        [el.type, el.placeholder, el.getAttribute('aria-label'), el.className, el.closest('[class*="picker"]')?.className].join(' ')));
      const start = all.find((el) => /开始|起始|start/i.test(`${el.placeholder} ${el.getAttribute('aria-label')}`));
      const end = all.find((el) => /结束|截止|end/i.test(`${el.placeholder} ${el.getAttribute('aria-label')}`));
      if (start && end && start !== end) return [start, end];
      return all.length === 2 ? all : null;
    }, '平台自定义日期输入框');
    await fillInput(inputs[0], filter.start);
    await fillInput(inputs[1], filter.end);
    inputs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    inputs[1].blur();
    const scopes = queryVisible('[role="dialog"], [class*="picker-dropdown"], [class*="calendar"], [class*="date-picker"]');
    const confirm = scopes.flatMap((root) => queryVisible('button, a, [role="button"]', root))
      .find((el) => /^(确定|确认|应用|查询)$/.test(elementText(el)) && !disabledControl(el));
    if (confirm) await clickElement(confirm, '确认自定义日期');
  }
  async function stepNativePeriod(direction, mode) {
    const before = platformSnapshot();
    if (!before || ['custom', 'realtime'].includes(mode)) throw new Error('此时间类型不支持左右切换');
    const arrow = findTimeArrow(before.toolbar, direction);
    if (disabledControl(arrow)) throw new Error('平台当前不允许切换该统计区间');
    await clickElement(arrow, direction < 0 ? '上一统计区间' : '下一统计区间');
    await waitFor(() => { const after = platformSnapshot(); return after?.range && after.range !== before.range; }, '统计区间变化');
    return waitPlatformReady(mode);
  }
  async function applyPlatformFilter(pageId, requested) {
    validateFilter(requested);
    ensurePlatformPage(pageId);
    const snapshot = await waitFor(platformSnapshot, '平台时间筛选工具栏');
    const control = snapshot.controls[requested.mode];
    if (disabledControl(control)) throw new Error(`当前${PAGE_DEFS[pageId].label}页面不支持“${TIME_MODES[requested.mode][0]}”`);
    const customNeedsApply = requested.mode === 'custom' &&
      (snapshot.mode !== 'custom' || snapshot.start !== requested.start || snapshot.end !== requested.end);
    if (snapshot.mode !== requested.mode || customNeedsApply) await clickElement(control, TIME_MODES[requested.mode][0]);
    if (customNeedsApply) await applyCustomDates(requested);
    let actual = await waitPlatformReady(requested.mode, requested.mode === 'custom' ? requested : null);
    // 保存的是实际平台日期。切店或刷新后用原平台箭头恢复，不猜测周/月计算规则。
    if (requested.range && requested.mode !== 'custom' && requested.mode !== 'realtime') {
      const visited = new Set();
      for (let steps = 0; actual.range !== requested.range && steps < 100; steps += 1) {
        if (visited.has(actual.range)) throw new Error('平台区间无法恢复到所选日期，请重新应用筛选');
        visited.add(actual.range);
        actual = await stepNativePeriod(actual.start > requested.start ? -1 : 1, requested.mode);
      }
      if (actual.range !== requested.range) throw new Error('所选统计区间超出平台可切换范围');
    }
    const confirmed = { mode: requested.mode, start: actual.start, end: actual.end, range: actual.range };
    profiles[pageId].filter = confirmed;
    profiles[pageId].platformUrl = location.href;
    saveProfiles();
    if (state.viewPage === pageId) renderProfile();
    return confirmed;
  }
  async function applyVisibleFilter(direction = 0, pageId = state.viewPage) {
    if (state.running || state.archiving || state.filterBusy) return;
    state.filterBusy = true; state.taskPage = pageId; state.stopRequested = false;
    renderTaskState();
    try {
      validateFilter(profiles[pageId].filter);
      const pending = loadJSON(FILTER_ACTION_KEY, null, sessionStorage);
      // 箭头触发整页刷新时只确认结果，不能再点击同一箭头造成多走一个区间。
      if (pending?.pageId === pageId && pending.phase === 'nativeStep' && onPlatformPage(pageId)) {
        const actual = await waitPlatformReady(pending.mode);
        if (actual.range === pending.previousRange) throw new Error('平台区间没有变化，请重新操作箭头');
        profiles[pageId].filter = { mode: pending.mode, start: actual.start, end: actual.end, range: actual.range };
        profiles[pageId].platformUrl = location.href;
        saveProfiles();
        updateStatus(`统计区间已恢复：${actual.range}`, false, pageId);
        return;
      }
      sessionStorage.setItem(FILTER_ACTION_KEY, JSON.stringify({ pageId, direction }));
      ensurePlatformPage(pageId);
      const applied = await applyPlatformFilter(pageId, { ...profiles[pageId].filter });
      if (direction) {
        sessionStorage.setItem(FILTER_ACTION_KEY, JSON.stringify({ pageId, direction, phase: 'nativeStep', mode: applied.mode, previousRange: applied.range }));
        const actual = await stepNativePeriod(direction, applied.mode);
        profiles[pageId].filter = { mode: applied.mode, start: actual.start, end: actual.end, range: actual.range };
        profiles[pageId].platformUrl = location.href;
        saveProfiles();
      }
      updateStatus(`筛选已应用：${TIME_MODES[profiles[pageId].filter.mode][0]} · ${profiles[pageId].filter.range}`, false, pageId);
    } catch (error) {
      if (error instanceof NavigationPending) return;
      updateStatus(`筛选未应用：${error.message}；未开始下载`, true, pageId);
    } finally {
      if (onPlatformPage(pageId)) sessionStorage.removeItem(FILTER_ACTION_KEY);
      state.filterBusy = false; state.taskPage = null;
      renderTaskState();
    }
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
    const pageId = workPage();
    const id = `${pageId}|${state.batchId}|${shopName}`;
    const cached = await getCachedRecord(shopName, pageId);
    if (cached?.localSaved) {
      updateStatus(`已确认本次表格保存完成，跳过重复下载：${cached.filename}`);
      return;
    }
    const context = { id, pageId, shopName, filter: { ...state.taskFilter }, date: currentDate(), controller: new AbortController(), captured: false };
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
      const snapshot = platformSnapshot();
      if (!onPlatformPage(pageId) || snapshot?.mode !== context.filter.mode || snapshot?.range !== context.filter.range) {
        throw new Error('平台页面或时间范围发生变化，已取消本次下载，防止数据串用');
      }
      updateStatus(`下载并核验：${buildDownloadFileName(shopName, context.date)} · ${context.filter.range}`);
      await clickElement(downloadButton, '下载按钮');
      const record = await completion;
      updateStatus(`本地下载完成，待统一归档：${record.filename}`);
      await refreshArchiveStatus();
    } finally {
      window.clearTimeout(timer);
      context.controller.abort();
      if (state.activeDownload === context) state.activeDownload = null;
    }
  }


  async function downloadShopOnce(shopName, index, total) {
    const saved = await getCachedRecord(shopName);
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

    updateStatus(`[${index}/${total}] 应用${TIME_MODES[state.taskFilter.mode][0]}：${shopName}`);
    state.taskFilter = await applyPlatformFilter(workPage(), state.taskFilter);
    writeBatchState({ filter: { ...state.taskFilter } });

    writeBatchState({
      index: index - 1,
      currentShopName: shopName,
      phase: 'daysSelected',
    });

    await randomStableWait(
      `[${index}/${total}] 统计范围已确认：${state.taskFilter.range}`,
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
        if (error instanceof NavigationPending || state.stopRequested) throw error;
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

  async function runShopList(shops, startIndex = 0, isResume = false, pageId = state.viewPage) {
    if (state.running || state.archiving || state.filterBusy || state.taskPage) {
      updateStatus('同一平台页面一次运行一个任务；当前任务结束后再启动此页', true, pageId);
      return;
    }
    state.running = true; state.stopRequested = false; state.taskPage = pageId;
    state.taskDirectory = profiles[pageId].archiveHandle;
    removeCompletionPopup(); renderTaskState();
    let completed = 0, failures = [];
    try {
      if (!await hasArchivePermission(pageId)) {
        updateStatus('请先为本页选择归档目录，或点击“补拷贝 / 授权续跑”恢复目录权限', true, pageId);
        return;
      }
      if (!isResume) { validateFilter(profiles[pageId].filter); startBatchState(shops, startIndex, pageId); }
      const batch = readBatchState(pageId);
      if (!batch?.batchId || batch.pageId !== pageId) throw new Error('未找到属于本页的任务');
      completed = Number(batch.completed || 0);
      failures = Array.isArray(batch.failures) ? batch.failures : [];
      state.batchId = batch.batchId;
      state.taskFilter = { ...(batch.filter || profiles[pageId].filter) };
      writeBatchState({ active: true, stopRequested: false }, pageId);
      sessionStorage.setItem(OWNER_KEY, pageId);
      if (startIndex < shops.length) ensurePlatformPage(pageId);
      updateStatus(isResume ? '继续此页未完成任务' : `开始${PAGE_DEFS[pageId].label}任务，共 ${shops.length} 家店铺`, false, pageId);
      for (let index = startIndex; index < shops.length; index += 1) {
        if (state.stopRequested) break;
        writeBatchState({ index, currentShopName: shops[index], phase: 'running' }, pageId);
        const ok = await downloadShopWithRetry(shops[index], index + 1, shops.length);
        if (state.stopRequested) break;
        if (ok) completed += 1;
        else failures.push(`${shops[index]}: 失败`);
        writeBatchState({ index: index + 1, completed, failures, currentShopName: '', phase: 'waitingNext' }, pageId);
        if (index < shops.length - 1) await randomStableWait('切换下一家店铺前', 2500, 6000);
      }
      if (state.stopRequested) {
        stopBatchState(pageId);
        updateStatus(`已停止，已完成 ${completed}/${shops.length}`, false, pageId);
      } else {
        writeBatchState({ phase: 'archiving', active: true }, pageId);
        const copied = await copyPendingFiles(pageId);
        clearBatchState(pageId);
        updateStatus(`处理完成：下载 ${completed} 家，失败 ${failures.length} 家；本次归档 ${copied} 份`, false, pageId);
        // 完成提示留在任务所属页，避免另一页的操作被弹层打断。
        if (state.viewPage === pageId && !layout.minimized) showCompletionPopup({ completed, total: shops.length, failed: failures.length });
      }
    } catch (error) {
      if (!(error instanceof NavigationPending)) {
        updateStatus(state.stopRequested ? '任务已停止；缓存和进度已保留' :
          `任务暂停：${error.message}。本页缓存已保留，可点击“补拷贝 / 授权续跑”重试。`, true, pageId);
      }
    } finally {
      state.running = false; state.taskPage = null; state.taskFilter = null; state.taskDirectory = null;
      renderTaskState();
    }
  }
  function resumePendingBatch() {
    const owner = sessionStorage.getItem(OWNER_KEY);
    const candidates = owner && PAGE_DEFS[owner] ? [owner] : Object.keys(PAGE_DEFS);
    const pageId = candidates.find((id) => { const batch = readBatchState(id); return batch?.active && !batch.stopRequested; });
    if (!pageId) return false;
    const batch = readBatchState(pageId);
    if (!batch.batchId || !Array.isArray(batch.shops) || !batch.shops.length) {
      stopBatchState(pageId); updateStatus('任务数据不完整，请在本页重新开始', true, pageId); return false;
    }
    updateStatus(`检测到${PAGE_DEFS[pageId].label}未完成任务，即将恢复`, false, pageId);
    window.setTimeout(() => {
      const latest = readBatchState(pageId);
      if (!latest?.active || latest.stopRequested || state.running || state.archiving || state.filterBusy) return;
      const index = Math.max(0, Math.min(Number(latest.index) || 0, latest.shops.length));
      runShopList(latest.shops, index, true, pageId);
    }, CONFIG.autoResumeDelayMs);
    return true;
  }
  async function init() {
    installPageDownloadRenameHook();
    // v0.7.0 数据只继承到新品页；排行从独立目录和记录开始。
    try {
      for (const pageId of Object.keys(PAGE_DEFS)) {
        profiles[pageId].archiveHandle = await archiveDB('settings', 'readonly', (store) => store.get(`directory:${pageId}`));
      }
      if (!profiles.new.archiveHandle) {
        profiles.new.archiveHandle = await archiveDB('settings', 'readonly', (store) => store.get('directory'));
        if (profiles.new.archiveHandle) await archiveDB('settings', 'readwrite', (store) => store.put(profiles.new.archiveHandle, 'directory:new'));
      }
      const legacy = loadJSON('sycm-helper-batch-state-fixed-v6', null, sessionStorage);
      if (legacy?.batchId && !sessionStorage.getItem('sycm-helper-v7-migrated')) {
        if (!readBatchState('new')) writeBatchState({ ...legacy, filter: defaultFilter() }, 'new');
        sessionStorage.setItem('sycm-helper-v7-migrated', '1');
      }
      createPanel();
      for (const pageId of Object.keys(PAGE_DEFS)) await refreshArchiveStatus(pageId);
      log(`v${VERSION} 已加载：两页独立目录、筛选、记录和日志；旧版数据归入新品页`, false, 'new');
      if (!resumePendingBatch()) {
        const pending = loadJSON(FILTER_ACTION_KEY, null, sessionStorage);
        if (pending && PAGE_DEFS[pending.pageId] && onPlatformPage(pending.pageId)) {
          applyVisibleFilter(pending.direction || 0, pending.pageId);
        }
      }
      window.setInterval(() => { if (!layout.minimized) renderTimeControls(); }, 1500);
    } catch (error) {
      createPanel(); updateStatus(`初始化失败：${error.message}`, true, state.viewPage);
    }
  }


  addStyle(`
    #${PANEL_ID} { width: 390px; max-width: calc(100vw - 12px); max-height: calc(100vh - 12px); padding: 10px; }
    #${PANEL_ID} [hidden] { display: none !important; }
    #${PANEL_ID} .sycm-header { display: flex; align-items: center; gap: 6px; cursor: move; touch-action: none; user-select: none; }
    #${PANEL_ID} .sycm-tabs { display: flex; align-items: center; flex: 1; justify-content: space-between; gap: 6px; }
    #${PANEL_ID} .sycm-helper-title { font-size: 14px; margin: 0; white-space: nowrap; }
    #${PANEL_ID} [role="tab"] { padding: 0 9px; background: #edf2fa; color: #33415c; }
    #${PANEL_ID} [role="tab"][aria-selected="true"] { background: #2f6bff; color: white; }
    #${PANEL_ID} .sycm-minimize { padding: 0 7px; background: #edf2fa; color: #33415c; }
    #${PANEL_ID} .sycm-helper-body { max-height: calc(100vh - 100px); overflow-y: auto; margin-top: 8px; padding: 0 2px; }
    #${PANEL_ID}.sycm-minimized .sycm-helper-body { display: none; }
    #${PANEL_ID} .sycm-task-info { font-size: 11px; color: #11624b; margin: 4px 0; }
    #${PANEL_ID} .sycm-task-info:empty { display: none; }
    #${PANEL_ID} .sycm-time-options { display: flex; flex-wrap: wrap; gap: 3px; }
    #${PANEL_ID} .sycm-time-options button { font-size: 12px; flex: 1; min-width: 34px; padding: 0 5px; height: 29px; background: #eef2f8; color: #33415c; }
    #${PANEL_ID} [role="radio"][aria-checked="true"] { background: #e0ebff; color: #1859df; box-shadow: inset 0 0 0 1px #6f99ff; }
    #${PANEL_ID} .sycm-custom-dates { display: flex; gap: 6px; margin-top: 6px; }
    #${PANEL_ID} .sycm-custom-dates label { flex: 1; min-width: 0; font-size: 12px; }
    #${PANEL_ID} .sycm-custom-dates input { display: block; width: 100%; box-sizing: border-box; height: 29px; }
    #${PANEL_ID} .sycm-time-actions { display: grid; grid-template-columns: 30px 1fr 30px; gap: 5px; margin-top: 5px; }
    #${PANEL_ID} .sycm-current-range { font-size: 12px; margin: 6px 0; color: #4d5a70; }
    #${PANEL_ID} .sycm-directory, #${PANEL_ID} .sycm-records { margin: 6px 0; padding: 5px; border: 1px solid #dbe3ef; border-radius: 5px; }
    #${PANEL_ID} summary { cursor: pointer; font-size: 12px; overflow-wrap: anywhere; }
    #${PANEL_ID} .sycm-helper-archive-status { white-space: pre-wrap; }
    #${PANEL_ID} .sycm-helper-shop-list { height: 100px; }
    #${PANEL_ID} .sycm-helper-log { height: 125px; }
    #${PANEL_ID} .sycm-record-list { max-height: 150px; overflow-y: auto; font-size: 11px; overflow-wrap: anywhere; }
    #${PANEL_ID} .sycm-record-list div { padding: 4px 0; border-bottom: 1px solid #edf1f7; }
  `);


  init();
})();

