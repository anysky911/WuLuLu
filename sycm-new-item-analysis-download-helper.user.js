// ==UserScript==
// @name         生意参谋新品分析下载助手-批量续跑修复版
// @namespace    https://github.com/anysky911/WuLuLu
// @version      0.6.1
// @description  生意参谋新品分析：批量选择店铺、切换30天、点击右下角下载，支持页面刷新后继续下一家
// @author       anysky911
// @homepageURL  https://github.com/anysky911/WuLuLu
// @supportURL   https://github.com/anysky911/WuLuLu/issues
// @updateURL    https://raw.githubusercontent.com/anysky911/WuLuLu/main/sycm-new-item-analysis-download-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/anysky911/WuLuLu/main/sycm-new-item-analysis-download-helper.user.js
// @match        https://sycm.taobao.com/cc/new_item_analysis*
// @match        https://sycm.taobao.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

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
    waitAfterDownloadClickMs: 2600,

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
  const DOWNLOAD_RENAME_EVENT = 'sycm-helper-set-download-filename';
  const BATCH_STATE_KEY = 'sycm-helper-batch-state-fixed-v6';

  const state = {
    running: false,
    stopRequested: false,
    currentDownloadFileName: '',
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
    return norm(name).replace(/[\\/:*?"<>|]/g, '_') || '生意参谋新品分析';
  }

  function buildDownloadFileName(shopName) {
    return `${sanitizeFileName(shopName)}.${CONFIG.fileExtension}`;
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
      <div class="sycm-helper-title">新品分析下载助手</div>

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

      await runShopList([shopName], 0, false, true);
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

      await runShopList(shops, 0, false, false);
    });

    panel.querySelector('.sycm-helper-stop').addEventListener('click', () => {
      state.stopRequested = true;
      stopBatchState();
      updateStatus('收到停止请求，当前步骤结束后停止');
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

  function looksLikeExportHref(href) {
    return /^blob:/i.test(href)
      || /^data:/i.test(href)
      || /\.(xls|xlsx)(?:[?#]|$)/i.test(href)
      || /download|export|excel|xls|xlsx/i.test(href);
  }

  function applyDownloadNameToAnchor(anchor, filename) {
    if (!anchor || !filename || !anchor.href || !looksLikeExportHref(anchor.href)) return;

    anchor.setAttribute('download', filename);
  }

  function applyDownloadNameToExistingAnchors(filename) {
    if (!filename) return;

    document.querySelectorAll('a[href]').forEach((anchor) => {
      applyDownloadNameToAnchor(anchor, filename);
    });
  }

  function setActiveDownloadFileName(shopName) {
    const filename = buildDownloadFileName(shopName);

    state.currentDownloadFileName = filename;
    applyDownloadNameToExistingAnchors(filename);

    document.dispatchEvent(
      new CustomEvent(DOWNLOAD_RENAME_EVENT, {
        detail: {
          filename,
          expiresAt: Date.now() + 30000,
        },
      })
    );

    return filename;
  }

  function installPageDownloadRenameHook() {
    if (document.documentElement.dataset.sycmDownloadRenameHook === '1') return;

    document.documentElement.dataset.sycmDownloadRenameHook = '1';

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    if (pageWindow.__SYCM_DOWNLOAD_RENAME_HOOK__) return;

    pageWindow.__SYCM_DOWNLOAD_RENAME_HOOK__ = true;

    let activeFileName = '';
    let expiresAt = 0;

    const active = () => activeFileName && Date.now() < expiresAt;

    const applyAnchor = (anchor) => {
      if (!active()) return;
      applyDownloadNameToAnchor(anchor, activeFileName);
    };

    document.addEventListener(DOWNLOAD_RENAME_EVENT, (event) => {
      const detail = event.detail || {};

      activeFileName = String(detail.filename || '');
      expiresAt = Number(detail.expiresAt || 0);

      applyDownloadNameToExistingAnchors(activeFileName);
    });

    document.addEventListener(
      'click',
      (event) => {
        const anchor =
          event.target &&
          event.target.closest &&
          event.target.closest('a[href]');

        applyAnchor(anchor);
      },
      true
    );

    const rawAnchorClick = pageWindow.HTMLAnchorElement.prototype.click;

    pageWindow.HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
      applyAnchor(this);
      return rawAnchorClick.apply(this, arguments);
    };

    const rawOpen = pageWindow.open;

    pageWindow.open = function patchedOpen(url, target, features) {
      if (active() && typeof url === 'string' && looksLikeExportHref(url)) {
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = activeFileName;
        anchor.style.display = 'none';

        document.documentElement.appendChild(anchor);
        rawAnchorClick.call(anchor);

        setTimeout(() => anchor.remove(), 1000);

        return null;
      }

      return rawOpen.apply(this, arguments);
    };

    new MutationObserver((mutations) => {
      if (!active()) return;

      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.target &&
          mutation.target.matches &&
          mutation.target.matches('a[href]')
        ) {
          applyAnchor(mutation.target);
        }

        for (const node of mutation.addedNodes || []) {
          if (!node || node.nodeType !== 1) continue;

          if (node.matches && node.matches('a[href]')) {
            applyAnchor(node);
          }

          if (node.querySelectorAll) {
            node.querySelectorAll('a[href]').forEach(applyAnchor);
          }
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });

    log('下载文件名 Hook 已启用');
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

  function getCurrentShopName() {
    for (const shopName of SHOP_NAMES) {
      const match = textCandidates(shopName, { exact: true }).find((el) => {
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

    const currentShopName = getCurrentShopName();

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
      () => getCurrentShopName() === shopName,
      `店铺切换到：${shopName}`,
      6000
    ).catch(() => null);

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

  function hintDownloadName(downloadEl, shopName) {
    const filename = setActiveDownloadFileName(shopName);

    const anchor =
      downloadEl.closest?.('a[href]') ||
      downloadEl.querySelector?.('a[href]');

    if (anchor) {
      applyDownloadNameToAnchor(anchor, filename);
    }

    return filename;
  }

  async function triggerDownload(shopName) {
    const filename = setActiveDownloadFileName(shopName);

    updateStatus('查找右下角下载按钮');

    let downloadButton = findDownloadButton();

    if (!downloadButton) {
      updateStatus('滚动到页面底部查找下载按钮');

      scrollAllContainersToBottom();

      await sleep(CONFIG.waitAfterScrollBottomMs);

      downloadButton = await waitFor(findDownloadButton, '下载按钮');
    }

    hintDownloadName(downloadButton, shopName);

    updateStatus(`触发下载：${filename}`);

    await clickElement(downloadButton, '下载按钮');

    await sleep(CONFIG.waitAfterDownloadClickMs);

    updateStatus(`已触发下载，建议文件名：${filename}`);
  }

  async function downloadShopOnce(shopName, index, total) {
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
      phase: 'downloadTriggered',
    });

    await randomStableWait(
      `[${index}/${total}] 下载已触发：${shopName}`,
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

  async function runShopList(shops, startIndex = 0, isResume = false, singleMode = false) {
    if (state.running) {
      updateStatus('当前已有任务正在运行', true);
      return;
    }

    state.running = true;
    state.stopRequested = false;

    removeCompletionPopup();
    setPanelRunning(true);

    let completed = 0;
    let failed = 0;
    let failures = [];

    if (!singleMode) {
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
    }

    try {
      updateStatus(
        isResume
          ? `继续任务，从第 ${startIndex + 1}/${shops.length} 家开始`
          : `开始任务，共 ${shops.length} 家店铺`
      );

      for (let i = startIndex; i < shops.length; i += 1) {
        if (state.stopRequested) break;

        const shopName = shops[i];

        if (!singleMode) {
          writeBatchState({
            active: true,
            shops,
            index: i,
            currentShopName: shopName,
            phase: 'running',
          });
        }

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

        if (!singleMode) {
          writeBatchState({
            active: true,
            shops,
            index: i + 1,
            completed,
            failures,
            currentShopName: '',
            phase: 'waitingNext',
          });
        }

        if (!state.stopRequested && i < shops.length - 1) {
          await randomStableWait('切换下一家店铺前', 2500, 6000);
        }
      }

      if (state.stopRequested) {
        if (!singleMode) {
          stopBatchState();
        }

        updateStatus(`已停止，已完成 ${completed}/${shops.length}`);
      } else {
        if (!singleMode) {
          clearBatchState();
        }

        updateStatus(
          `全部处理完成：成功 ${completed} 家，失败 ${failed} 家`
        );

        showCompletionPopup({
          completed,
          total: shops.length,
          failed,
        });
      }
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

    if (index >= shops.length) {
      clearBatchState();
      return;
    }

    const currentShopName = shops[index];

    updateStatus(
      `检测到未完成任务，${Math.round(CONFIG.autoResumeDelayMs / 1000)} 秒后从第 ${index + 1}/${shops.length} 家继续：${currentShopName}`
    );

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

      runShopList(latestShops, latestIndex, true, false);
    }, CONFIG.autoResumeDelayMs);
  }

  function init() {
    installPageDownloadRenameHook();
    createPanel();

    log('脚本已加载');
    log('本版已加入批量状态保存，页面刷新后会继续下一家');
    log('30天和下载按钮逻辑沿用你参考的正常版本');

    resumePendingBatch();
  }

  init();
})();
