// ==UserScript==
// @name         抖罗｜商榜批量导出助手
// @namespace    codex.douyin.compass
// @version      1.3.9
// @description  先应用筛选设置；导出弹窗默认关闭加载全部，首屏完成后再加载全部并导出。
// @author       Codex
// @match        https://compass.jinritemai.com/shop/chance/rank-product*
// @match        https://compass.jinritemai.com/*rank-product*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = '罗盘榜单批量导出';
  const SCRIPT_VERSION = '1.3.9';
  const HOST_ID = 'codex-compass-export-host';
  const STORAGE_KEY = 'codex_compass_export_config_v1';
  // “加载全部”在部分页面版本中会先异步写入扩展缓存，导出按钮却会立即可用。
  // 因此即使表格没有显示全部行，也必须至少等待这一段时间后才能导出。
  const MIN_LOAD_ALL_WAIT_MS = 30000;
  const RANK_TABS = ['搜索榜', '直播榜', '商品卡榜', '短视频榜'];
  const DEFAULT_CONFIG = {
    timeMode: 'seven',
    startDate: '',
    endDate: '',
    sameDay: false,
    minPrice: '0',
    maxPrice: '200',
    category1: '服饰内衣',
    category2: '服装',
    category3: '童装',
    tabs: [...RANK_TABS],
    loadTimeoutSec: 600,
    settleSec: 4,
  };

  class StopError extends Error {
    constructor() {
      super('任务已由用户停止');
      this.name = 'StopError';
    }
  }

  const runtime = {
    running: false,
    stopRequested: false,
    shadow: null,
    logBox: null,
    statusEl: null,
    progressEl: null,
    applyButton: null,
    startButton: null,
    stopButton: null,
    form: null,
    applying: false,
    appliedSignature: '',
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function xpathLiteral(value) {
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('"')) return `"${value}"`;
    return `concat(${value.split("'").map((part, index) =>
      `${index ? `,"'",` : ''}'${part}'`).join('')})`;
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest(`#${HOST_ID}`)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0;
  }

  function isDisabled(element) {
    if (!element) return true;
    const control = element.closest('button,[role="button"],label') || element;
    return Boolean(
      control.disabled ||
      control.getAttribute('aria-disabled') === 'true' ||
      /(^|\s)(disabled|is-disabled)(\s|$)/i.test(control.className || '')
    );
  }

  function visibleElementsByExactText(text, root = document) {
    const owner = root.ownerDocument || document;
    const result = owner.evaluate(
      `.//*[normalize-space(.)=${xpathLiteral(text)}]`,
      root,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const matches = [];
    for (let index = 0; index < result.snapshotLength; index += 1) {
      const element = result.snapshotItem(index);
      if (isVisible(element)) matches.push(element);
    }
    return matches.sort((a, b) => scoreTextTarget(b, text) - scoreTextTarget(a, text));
  }

  function scoreTextTarget(element, text) {
    let score = 0;
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role') || '';
    const directText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join('');
    if (normalizeText(directText) === text) score += 50;
    if (['button', 'label', 'a', 'li'].includes(tag)) score += 35;
    if (['button', 'tab', 'option', 'menuitem', 'switch'].includes(role)) score += 40;
    if (/btn|button|tab|item|option|entry/i.test(element.className || '')) score += 12;
    if (getComputedStyle(element).cursor === 'pointer') score += 10;
    if (element.children.length === 0) score += 5;
    return score;
  }

  function findExactText(text, root = document) {
    return visibleElementsByExactText(text, root)[0] || null;
  }

  function clickableTarget(element) {
    if (!element) return null;
    const explicit = element.closest('button,label,a,[role="button"],[role="tab"],[role="option"],[role="menuitem"],[role="switch"]');
    if (explicit && isVisible(explicit)) return explicit;
    let current = element;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      if (getComputedStyle(current).cursor === 'pointer') return current;
    }
    return element;
  }

  async function safeClick(element, description = '控件') {
    if (!element) throw new Error(`没有找到${description}`);
    const target = clickableTarget(element);
    if (!target || isDisabled(target)) throw new Error(`${description}不可点击`);
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    await sleep(160);
    // Tampermonkey 的隔离环境中 window 不是页面原生 Window 对象；把它作为
    // MouseEvent 的 view 传入会抛出“Failed to convert value to Window”。
    // click() 本身已足够触发页面监听，这里只保留不带 view 的标准鼠标事件。
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    target.click();
    await sleep(240);
  }

  function checkStopped() {
    if (runtime.stopRequested) throw new StopError();
  }

  async function waitFor(predicate, description, timeoutMs = 30000, intervalMs = 350) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
      checkStopped();
      try {
        const result = await predicate();
        if (result) return result;
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }
    const suffix = lastError ? `：${lastError.message}` : '';
    throw new Error(`等待${description}超时（${Math.round(timeoutMs / 1000)} 秒）${suffix}`);
  }

  function visibleBusyCount(root = document) {
    const selectors = [
      '[aria-busy="true"]',
      '.ecom-spin-spinning',
      '.aurora-spin-spinning',
      '.el-loading-mask',
      '[class*="loading-mask"]',
      '[class*="spin-spinning"]',
    ];
    return [...root.querySelectorAll(selectors.join(','))].filter(isVisible).length;
  }

  async function waitForPageReady(timeoutMs = 45000) {
    let quietSince = 0;
    await waitFor(() => {
      const busy = visibleBusyCount(document);
      if (busy === 0) {
        if (!quietSince) quietSince = Date.now();
        return Date.now() - quietSince >= 900;
      }
      quietSince = 0;
      return false;
    }, '榜单加载完成', timeoutMs, 300);
  }

  async function waitForRankControlsReady(timeoutMs = 30000) {
    // 切榜后 React 会先保留上一榜的筛选区，再异步替换成新榜的数据。
    // 只等 tab 变为 active 会让后续“应用设置”落到旧节点上。
    await waitFor(() => {
      const category = categoryControl();
      return exportEntryButton() && category && priceBlock() ? true : null;
    }, '新榜单筛选控件就绪', timeoutMs, 300);
    await sleep(1200);
    await waitForPageReady(timeoutMs);
  }

  function nativeSetValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fillInput(input, value, description) {
    if (!input) throw new Error(`没有找到${description}`);
    input.removeAttribute('readonly');
    input.focus();
    nativeSetValue(input, '');
    nativeSetValue(input, String(value));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    input.blur();
    await sleep(180);
  }

  function loadConfig() {
    try {
      const saved = GM_getValue(STORAGE_KEY, null);
      if (!saved) return structuredClone(DEFAULT_CONFIG);
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      // v1.3.9 将旧的“自定义日期”统一为“自然日”，避免两种日期范围模式混淆。
      const migrated = {
        ...parsed,
        timeMode: parsed?.timeMode === 'custom' ? 'naturalDay' : parsed?.timeMode,
      };
      return { ...structuredClone(DEFAULT_CONFIG), ...migrated };
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 读取配置失败`, error);
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  function saveConfig(config) {
    GM_setValue(STORAGE_KEY, JSON.stringify(config));
  }

  function formatTime() {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  }

  function appendLog(message, level = 'info') {
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    line.textContent = `${formatTime()}  ${message}`;
    runtime.logBox?.appendChild(line);
    if (runtime.logBox) runtime.logBox.scrollTop = runtime.logBox.scrollHeight;
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[method](`[${SCRIPT_NAME}] ${message}`);
  }

  function setStatus(text, type = 'idle') {
    if (!runtime.statusEl) return;
    runtime.statusEl.textContent = text;
    runtime.statusEl.dataset.type = type;
  }

  function setProgress(current, total, label) {
    if (!runtime.progressEl) return;
    const percent = total ? Math.round((current / total) * 100) : 0;
    runtime.progressEl.innerHTML = `<i style="width:${percent}%"></i><span>${escapeHtml(label)}</span>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function readFormConfig() {
    const data = new FormData(runtime.form);
    return {
      timeMode: data.get('timeMode'),
      startDate: data.get('startDate') || '',
      endDate: data.get('endDate') || '',
      sameDay: data.get('sameDay') === 'on',
      minPrice: String(data.get('minPrice') ?? '').trim(),
      maxPrice: String(data.get('maxPrice') ?? '').trim(),
      category1: String(data.get('category1') || '').trim(),
      category2: String(data.get('category2') || '').trim(),
      category3: String(data.get('category3') || '').trim(),
      tabs: data.getAll('tabs'),
      loadTimeoutSec: Number(data.get('loadTimeoutSec')) || DEFAULT_CONFIG.loadTimeoutSec,
      settleSec: Number(data.get('settleSec')) || DEFAULT_CONFIG.settleSec,
    };
  }

  function validateConfig(config) {
    if (!config.tabs.length) throw new Error('请至少勾选一个榜单');
    if (!config.category1 || !config.category2 || !config.category3) throw new Error('请填写完整的三级行业类目');
    const min = Number(config.minPrice);
    const max = Number(config.maxPrice);
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('价格必须是有效数字');
    if (min < 0 || max <= min) throw new Error('价格上限必须大于下限，且下限不能小于 0');
    if (['custom', 'naturalDay'].includes(config.timeMode)) {
      if (!config.startDate || !config.endDate) throw new Error('自然日需要通过日历选择开始和结束日期');
      if (config.startDate > config.endDate) throw new Error('开始日期不能晚于结束日期');
    }
    if (config.loadTimeoutSec < 30 || config.loadTimeoutSec > 1800) throw new Error('加载超时应为 30–1800 秒');
  }

  async function selectRankTab(tabName) {
    const target = visibleElementsByExactText(tabName)
      .map((element) => element.closest('[role="tab"]') || element)
      .find((element) => isVisible(element));
    if (!target) throw new Error(`没有找到“${tabName}”标签，请确认当前位于 商品 → 商品榜单 页面`);
    const alreadySelected = target.getAttribute('aria-selected') === 'true' || /active/i.test(target.className || '');
    if (!alreadySelected) {
      await safeClick(target, `${tabName}标签`);
      await waitFor(() => {
        const tab = visibleElementsByExactText(tabName)
          .map((element) => element.closest('[role="tab"]') || element)
          .find((element) => isVisible(element));
        return tab && (tab.getAttribute('aria-selected') === 'true' || /active/i.test(tab.className || ''));
      }, `${tabName}切换完成`, 20000);
    }
    await waitForPageReady();
    await waitForRankControlsReady();
  }

  function quickDateOption(timeMode) {
    // 罗盘的日期快捷项是 ecom-radio-button-input，而不是普通文字按钮。
    // 使用稳定的 value（one/seven/thirty）定位其外层 label，避免 React 嵌套文本导致的精确文案查找失败。
    const selector = '.ecom-tabs-extra-content .ecom-radio-button-input';
    const inputs = [...document.querySelectorAll(selector)]
      .filter((input) => input.value === timeMode)
      .map((input) => input.closest('label.ecom-radio-button-wrapper') || input.closest('label'))
      .filter(isVisible);
    return inputs[0] || null;
  }

  function quickDateIsSelected(target) {
    if (target?.classList?.contains('ecom-radio-button-wrapper-checked')) return true;
    for (let current = target; current && current !== document.body; current = current.parentElement) {
      if (
        current.getAttribute('aria-selected') === 'true' ||
        current.getAttribute('aria-checked') === 'true' ||
        /(^|\\s)(active|selected|checked|current)(\\s|$)/i.test(current.className || '')
      ) return true;
    }
    return false;
  }

  async function applyQuickDate(timeMode) {
    const labelMap = { one: '近1天', seven: '近7天', thirty: '近30天' };
    const labelText = labelMap[timeMode];
    const label = quickDateOption(timeMode);
    if (!label) {
      throw new Error(`没有找到日期选项“${labelText}”（value=${timeMode}）；请确认当前榜单页面已显示日期快捷栏`);
    }
    // 页面偶尔会保留其他 radio 的 checked 属性；以外层 checked 样式作为唯一的选中依据。
    const selected = quickDateIsSelected(label);
    if (!selected) {
      await safeClick(label, `日期选项${labelText}`);
      await waitFor(() => {
        const current = quickDateOption(timeMode);
        return Boolean(current && quickDateIsSelected(current));
      }, `日期切换为${labelText}`, 15000);
      await waitForPageReady();
    }
  }

  function dateCell(date) {
    const slashDate = date.replaceAll('-', '/');
    const selectors = [
      `[title="${CSS.escape(date)}"]`,
      `[title="${CSS.escape(slashDate)}"]`,
      `[data-date="${CSS.escape(date)}"]`,
      `[data-value="${CSS.escape(date)}"]`,
    ];
    return [...document.querySelectorAll(selectors.join(','))]
      .find((element) => isVisible(element) && !/disabled/i.test(element.className || '')) || null;
  }

  function visibleDateInputs() {
    return [...document.querySelectorAll('input')].filter((input) => {
      if (!isVisible(input)) return false;
      const hint = `${input.placeholder || ''} ${input.getAttribute('aria-label') || ''}`;
      return /(开始|结束|起始|日期|start|end)/i.test(hint) || /date/i.test(input.type || '');
    });
  }

  async function applyCustomDate(startDate, endDate, datePreset = null, allowInputFallback = true) {
    const moreText = quickDateOption('more') || findExactText('更多');
    if (!moreText) throw new Error('没有找到“更多”日期入口');
    await safeClick(moreText, '更多日期');
    await sleep(500);

    if (datePreset) {
      const preset = await waitFor(() => findExactText(datePreset), `日期模式“${datePreset}”出现`, 8000);
      await safeClick(preset.closest('label') || preset, `日期模式“${datePreset}”`);
      await sleep(300);
    }

    let startCell = dateCell(startDate);
    let endCell = dateCell(endDate);
    if (startCell && endCell) {
      await safeClick(startCell, `开始日期 ${startDate}`);
      await sleep(250);
      endCell = dateCell(endDate);
      await safeClick(endCell, `结束日期 ${endDate}`);
    } else if (allowInputFallback) {
      const inputs = await waitFor(() => {
        const candidates = visibleDateInputs();
        return candidates.length >= 2 ? candidates : null;
      }, '自定义日期输入框', 8000).catch(() => null);
      if (!inputs) {
        throw new Error('日期面板无法定位手动输入的日期；请确认已打开“更多 → 自然日/自定义日期”，或先在页面中手动选择日期后再执行');
      }
      const startInput = inputs.find((input) => /(开始|起始|start)/i.test(`${input.placeholder} ${input.getAttribute('aria-label')}`)) || inputs[0];
      const endInput = inputs.find((input) => /(结束|end)/i.test(`${input.placeholder} ${input.getAttribute('aria-label')}`)) || inputs[1];
      await fillInput(startInput, startDate, '开始日期输入框');
      await fillInput(endInput, endDate, '结束日期输入框');
    } else {
      throw new Error('自然日日期范围未出现在当前日历中；请用面板日期选择器选择同月日期，或先在罗盘日历中切换到目标月份后重试');
    }

    const confirm = findExactText('确定') || findExactText('确认');
    if (confirm && !isDisabled(confirm)) await safeClick(confirm, '日期确定按钮');
    else document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    await waitForPageReady();
  }

  async function applyDate(config) {
    if (config.timeMode === 'naturalDay') await applyCustomDate(config.startDate, config.endDate, '自然日', false);
    else if (config.timeMode === 'custom') await applyCustomDate(config.startDate, config.endDate);
    else await applyQuickDate(config.timeMode);
  }

  function categoryControl() {
    const labels = visibleElementsByExactText('行业类目');
    for (const label of labels) {
      let block = label.parentElement;
      for (let depth = 0; block && depth < 7; depth += 1, block = block.parentElement) {
        const control = [...block.querySelectorAll('.aurora-cascader,[class*="cascader"],[role="combobox"]')]
          .find(isVisible);
        if (control) return control;
      }
    }
    return null;
  }

  function currentCategoryText(control) {
    if (!control) return '';
    const titled = control.querySelector('[title]');
    return normalizeText(titled?.getAttribute('title') || control.textContent);
  }

  function findCategoryOption(text) {
    const selectors = [
      '[role="option"]',
      '[role="menuitem"]',
      '[class*="cascader-menu-item"]',
      '[class*="cascader-option"]',
      '.aurora-select-item',
    ];
    const candidates = [...document.querySelectorAll(selectors.join(','))]
      .filter(isVisible)
      .filter((element) => {
        const value = normalizeText(element.textContent);
        return value === text || value.startsWith(`${text} `);
      });
    return candidates.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).at(-1) || null;
  }

  async function applyCategory(config) {
    const path = [config.category1, config.category2, config.category3];
    let control = categoryControl();
    if (!control) throw new Error('没有找到行业类目下拉框');
    const expected = path.join(' / ');
    if (currentCategoryText(control).replace(/\s*\/\s*/g, ' / ') === expected) return;

    await safeClick(control, '行业类目下拉框');
    for (let index = 0; index < path.length; index += 1) {
      const name = path[index];
      const option = await waitFor(() => findCategoryOption(name), `类目“${name}”出现`, 12000);
      await safeClick(option, `类目“${name}”`);
      if (index < path.length - 1) await sleep(350);
    }

    await waitFor(() => {
      control = categoryControl();
      return currentCategoryText(control).replace(/\s*\/\s*/g, ' / ').includes(expected);
    }, `类目切换为${expected}`, 20000);
    await waitForPageReady();
  }

  function priceBlock() {
    const labels = visibleElementsByExactText('价格带');
    for (const label of labels) {
      let block = label.parentElement;
      for (let depth = 0; block && depth < 6; depth += 1, block = block.parentElement) {
        const text = normalizeText(block.textContent);
        if (text.includes('自定义') && text.length < 160) return block;
      }
    }
    return null;
  }

  function closestInputContainer(element) {
    let current = element;
    for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
      const inputs = [...current.querySelectorAll('input')].filter(isVisible);
      if (inputs.length >= 2) return current;
    }
    return null;
  }

  async function applyPrice(config) {
    const block = priceBlock();
    if (!block) throw new Error('没有找到价格带区域');
    const custom = findExactText('自定义', block);
    if (!custom) throw new Error('没有找到自定义价格入口');
    await safeClick(custom, '自定义价格');

    const title = await waitFor(() => findExactText('价格范围选择') || findExactText('价格区间选择'), '价格输入弹窗', 12000);
    const dialog = closestInputContainer(title);
    if (!dialog) throw new Error('价格弹窗中没有找到两个输入框');
    const inputs = [...dialog.querySelectorAll('input')].filter(isVisible);
    const minInput = inputs.find((input) => /(最小|最低|min)/i.test(input.placeholder || '')) || inputs[0];
    const maxInput = inputs.find((input) => /(最大|最高|max)/i.test(input.placeholder || '')) || inputs[1];
    await fillInput(minInput, config.minPrice, '最低价格输入框');
    await fillInput(maxInput, config.maxPrice, '最高价格输入框');

    const confirm = await waitFor(() => {
      const button = findExactText('确定', dialog) || findExactText('确认', dialog);
      return button && !isDisabled(button) ? button : null;
    }, '价格确定按钮可用', 10000);
    await safeClick(confirm, '价格确定按钮');
    await waitFor(() => !isVisible(title), '价格弹窗关闭', 10000);
    await waitForPageReady();
  }

  function exportEntryButton() {
    return visibleElementsByExactText('一键导出')
      .filter((element) => !element.closest(`#${HOST_ID}`))
      .sort((a, b) => {
        const aScore = /entry_btn_hand/i.test(a.className || '') ? 1 : 0;
        const bScore = /entry_btn_hand/i.test(b.className || '') ? 1 : 0;
        return bScore - aScore;
      })[0] || null;
  }

  function exportDialog() {
    // 导出扩展使用 Element UI 的全屏弹窗。不要依赖标题中的榜单文案或按钮精确文本，
    // 它们会随页面语言、榜单类型和扩展版本变化。
    const candidates = [...document.querySelectorAll('.el-dialog__wrapper .el-dialog,[role="dialog"].el-dialog')]
      .filter(isVisible)
      .filter((dialog) => dialog.querySelector('.dynamic-table,.bottom_pagination,table'))
      .filter((dialog) => dialog.querySelector('.bottom_pagination [role="switch"]'));
    return candidates.at(-1) || null;
  }

  function exportButtonInDialog(dialog) {
    if (!dialog) return null;
    const buttons = [...dialog.querySelectorAll('button.el-button,button')].filter(isVisible);
    return buttons.find((button) =>
      normalizeText(button.textContent).includes('导出表格') ||
      (button.querySelector('.el-icon-download') && !/caret-button/.test(button.className || '')),
    ) || null;
  }

  function loadAllLabel(dialog) {
    const container = dialog?.querySelector('.bottom_pagination .total_box:has([role="switch"])');
    return container?.querySelector('span') || findExactText('加载全部', dialog) || null;
  }

  async function openExportDialog(tabName) {
    const entry = await waitFor(exportEntryButton, '页面上的“一键导出”按钮', 20000);
    await safeClick(entry, '页面上的“一键导出”按钮');
    const result = await waitFor(() => {
      const dialog = exportDialog();
      const exportButton = exportButtonInDialog(dialog);
      if (!exportButton || !dialog) return null;
      const rows = dialog.querySelectorAll('tbody tr').length;
      return rows > 0 || dialog.querySelector('.bottom_pagination') ? { dialog, exportButton } : null;
    }, `${tabName}导出弹窗正常显示`, 90000);
    return result;
  }

  function totalRowsInDialog(dialog) {
    const match = normalizeText(dialog.textContent).match(/共\s*(\d+)\s*条/);
    return match ? Number(match[1]) : 0;
  }

  function exportPager(dialog) {
    return dialog.querySelector('.bottom_pagination .el-pager');
  }

  function pagerNumbers(dialog) {
    return [...(exportPager(dialog)?.querySelectorAll('li.number') || [])].filter(isVisible);
  }

  function initialExportPageReady(dialog) {
    const active = exportPager(dialog)?.querySelector('li.number.active');
    const rows = dialog.querySelectorAll('tbody tr').length;
    const loadLabel = loadAllLabel(dialog);
    // 不把“导出表格”按钮可用作为前置条件：部分导出扩展只有在“加载全部”
    // 已开启并完成缓存后才会启用该按钮，等待它会造成永远不点击开关的死锁。
    return Boolean(
      rows > 0 &&
      loadLabel &&
      (active || exportPager(dialog) || totalRowsInDialog(dialog) > 0)
    );
  }

  async function waitForInitialExportPage(dialog) {
    let readySince = 0;
    await waitFor(() => {
      if (!initialExportPageReady(dialog)) {
        readySince = 0;
        return false;
      }
      if (!readySince) readySince = Date.now();
      return Date.now() - readySince >= 1000;
    }, '导出弹窗的表格和“加载全部”控件出现', 90000, 300);
  }

  function dialogPageNumbers(dialog) {
    const elements = [...dialog.querySelectorAll('li,button,a,[role="button"]')].filter(isVisible);
    return elements.map((element) => {
      const value = normalizeText(element.textContent);
      return /^\d+$/.test(value) ? { element, page: Number(value) } : null;
    }).filter(Boolean);
  }

  function dialogActivePage(dialog) {
    const active = dialog.querySelector(
      '.ant-pagination-item-active,[aria-current="page"],[aria-selected="true"],[class*="pagination"] .active,[class*="pagination"] .selected',
    );
    const activeText = normalizeText(active?.textContent);
    if (/^\d+$/.test(activeText)) return Number(activeText);
    const marked = dialogPageNumbers(dialog).find(({ element }) =>
      /(^|\s)(active|selected|current)(\s|$)/i.test(element.className || ''),
    );
    return marked?.page || 0;
  }

  function dialogLastPage(dialog, totalRows, visibleRows) {
    const byTotal = totalRows > 0 && visibleRows > 0 ? Math.ceil(totalRows / visibleRows) : 0;
    const byButtons = Math.max(0, ...dialogPageNumbers(dialog).map(({ page }) => page));
    return Math.max(byTotal, byButtons);
  }

  function loadAllSwitch(dialog, label) {
    const exactSwitch = dialog.querySelector('.bottom_pagination .total_box [role="switch"]');
    if (exactSwitch && isVisible(exactSwitch)) return exactSwitch;
    const elementSwitch = dialog.querySelector('.bottom_pagination .total_box .el-switch,.bottom_pagination .total_box [class*="switch"]');
    if (elementSwitch && isVisible(elementSwitch)) return elementSwitch;
    const direct = label.closest('[role="switch"],label,.el-switch,[class*="switch"]')?.querySelector?.('[role="switch"],input[type="checkbox"],[class*="switch"]');
    if (direct && isVisible(direct)) return direct;
    let current = label.parentElement;
    for (let depth = 0; current && current !== dialog && depth < 5; depth += 1, current = current.parentElement) {
      const toggle = [...current.querySelectorAll('[role="switch"],input[type="checkbox"],[class*="switch"]')]
        .find(isVisible);
      if (toggle) return toggle;
    }
    return null;
  }

  function switchIsOn(toggle) {
    if (!toggle) return false;
    const input = toggle.matches('input') ? toggle : toggle.querySelector('input[type="checkbox"]');
    return Boolean(
      input?.checked ||
      toggle.getAttribute('aria-checked') === 'true' ||
      /is-checked|checked|active|open/i.test(toggle.className || '')
    );
  }

  async function enableLoadAll(dialog) {
    const label = loadAllLabel(dialog);
    if (!label) throw new Error('导出弹窗中没有找到“加载全部”');
    const toggle = loadAllSwitch(dialog, label);
    const initialRows = dialog.querySelectorAll('tbody tr').length;
    const initialTotal = totalRowsInDialog(dialog);
    if (!toggle) throw new Error('没有找到“加载全部”开关');
    if (!switchIsOn(toggle)) {
      await safeClick(toggle || label, '加载全部开关');
      await waitFor(() => switchIsOn(loadAllSwitch(dialog, label) || toggle), '加载全部开关已开启', 8000);
    }
    // 给页面事件循环一次机会，避免把刚点击开关后的初始界面当成完成状态。
    await sleep(800);
    return {
      label,
      toggle: loadAllSwitch(dialog, label) || toggle,
      initialRows,
      initialTotal,
      startedAt: Date.now(),
    };
  }

  function loadSignature(dialog, toggle, exportButton) {
    const rows = dialog.querySelectorAll('tbody tr').length;
    const busy = visibleBusyCount(dialog);
    const text = normalizeText(dialog.textContent);
    const progress = text.match(/(?:加载|已获取|进度)[^%]{0,30}(?:\d+\s*%|\d+\s*\/\s*\d+)/)?.[0] || '';
    return [rows, busy, progress, switchIsOn(toggle), isDisabled(exportButton), text.length].join('|');
  }

  async function waitForLoadAll(dialog, toggle, exportButton, config, loadState = {}) {
    const timeoutMs = config.loadTimeoutSec * 1000;
    let lastSignature = '';
    let lastReportedRows = -1;

    return waitFor(() => {
      const total = totalRowsInDialog(dialog);
      const rows = dialog.querySelectorAll('tbody tr').length;
      const busy = visibleBusyCount(dialog);
      const signature = loadSignature(dialog, toggle, exportButton);
      lastSignature = signature;
      if (rows !== lastReportedRows) {
        lastReportedRows = rows;
        if (total) setStatus(`加载全部：${Math.min(rows, total)}/${total} 行`, 'running');
      }

      const toggleReady = !toggle || switchIsOn(toggle);
      const buttonReady = !isDisabled(exportButton);
      const allRowsVisible = total > 0 && rows >= total;
      const pages = pagerNumbers(dialog);
      const nonActivePages = pages.filter((page) => !page.classList.contains('active'));
      // 插件后台依次预加载页码。加载完成的页会带 read-only（同时显示橙点）；
      // 当前活动页仍保持 active，不会跳到最后一页，因此不能拿 active 页码判断完成。
      const allPagesCached = nonActivePages.length > 0 && nonActivePages.every((page) => page.classList.contains('read-only'));

      if (pages.length > 1) {
        const cached = nonActivePages.filter((page) => page.classList.contains('read-only')).length;
        setStatus(`加载全部：已缓存 ${cached}/${nonActivePages.length} 个分页标记`, 'running');
      }

      return toggleReady && buttonReady && busy === 0 && (allRowsVisible || allPagesCached);
    }, '全部数据加载完成（等待分页缓存）', timeoutMs, 500);
  }

  function candidateCloseControl(dialog) {
    const dialogRect = dialog.getBoundingClientRect();
    const candidates = [...dialog.querySelectorAll('button,[role="button"],[aria-label],[class*="close"],svg')]
      .filter(isVisible)
      .map((element) => element.closest('button,[role="button"]') || element)
      .filter((element, index, array) => array.indexOf(element) === index)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width <= 70 && rect.height <= 70 && rect.top <= dialogRect.top + 90 && rect.left >= dialogRect.right - 140;
      })
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    return candidates[0] || null;
  }

  async function closeExportDialog(dialog) {
    const close = candidateCloseControl(dialog);
    if (close) await safeClick(close, '导出弹窗关闭按钮');
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    const closed = await waitFor(() => !isVisible(dialog), '导出弹窗关闭', 8000).catch(() => false);
    if (!closed) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      const closedAfterEscape = await waitFor(() => !isVisible(dialog), '导出弹窗关闭', 5000).catch(() => false);
      if (!closedAfterEscape) {
        appendLog('导出已触发，但弹窗未自动关闭；保留弹窗以免中断后续下载。', 'warn');
        return false;
      }
    }
    return true;
  }

  async function exportOneTab(tabName, config) {
    appendLog(`切换到 ${tabName}`);
    setStatus(`正在设置 ${tabName}`, 'running');
    await selectRankTab(tabName);

    appendLog('设置日期范围');
    await applyDate(config);
    appendLog(`设置类目：${config.category1} / ${config.category2} / ${config.category3}`);
    await applyCategory(config);
    appendLog(`设置价格：¥${config.minPrice}–¥${config.maxPrice}`);
    await applyPrice(config);

    setStatus(`正在打开 ${tabName} 导出弹窗`, 'running');
    appendLog('点击页面“一键导出”');
    const { dialog, exportButton } = await openExportDialog(tabName);
    setStatus('正在等待导出弹窗控件出现', 'running');
    appendLog('弹窗已显示；发现首屏数据与“加载全部”后立即开启，不等待导出按钮');
    await waitForInitialExportPage(dialog);
    appendLog('首屏控件已就绪，立即开启“加载全部”');
    const loadState = await enableLoadAll(dialog);
    await waitForLoadAll(dialog, loadState.toggle, exportButton, config, loadState);

    checkStopped();
    appendLog('全部数据已就绪，点击“导出表格”', 'success');
    setStatus(`正在导出 ${tabName}`, 'running');
    await safeClick(exportButton, '导出表格按钮');
    await sleep(1800);
    await closeExportDialog(dialog);
  }

  function configSignature(config) {
    return JSON.stringify({
      timeMode: config.timeMode,
      startDate: config.startDate,
      endDate: config.endDate,
      sameDay: config.sameDay,
      minPrice: config.minPrice,
      maxPrice: config.maxPrice,
      category1: config.category1,
      category2: config.category2,
      category3: config.category3,
      tabs: config.tabs,
    });
  }

  function activeRankTab() {
    return RANK_TABS.find((tabName) => visibleElementsByExactText(tabName)
      .map((element) => element.closest('[role="tab"]') || element)
      .some((element) => isVisible(element) && (
        element.getAttribute('aria-selected') === 'true' || /active/i.test(element.className || '')
      ))) || null;
  }

  async function applySettings() {
    if (runtime.running || runtime.applying) return;
    const config = readFormConfig();
    try {
      validateConfig(config);
    } catch (error) {
      setStatus(error.message, 'error');
      appendLog(error.message, 'error');
      return;
    }

    runtime.applying = true;
    runtime.applyButton.disabled = true;
    try {
      const activeTab = activeRankTab();
      const tabName = config.tabs.includes(activeTab) ? activeTab : config.tabs[0];
      setStatus(`正在应用设置到 ${tabName}`, 'running');
      appendLog(`应用设置：${tabName}`);
      await selectRankTab(tabName);
      await applyDate(config);
      await applyCategory(config);
      await applyPrice(config);
      saveConfig(config);
      runtime.appliedSignature = configSignature(config);
      setStatus(`设置已应用：${tabName} 已刷新`, 'success');
      appendLog('设置已应用，请确认筛选条件后开始导出', 'success');
    } catch (error) {
      setStatus(`应用设置失败：${error.message}`, 'error');
      appendLog(`应用设置失败：${error.message}`, 'error');
      console.error(error);
    } finally {
      runtime.applying = false;
      runtime.applyButton.disabled = false;
    }
  }

  async function runBatch() {
    if (runtime.running) return;
    const config = readFormConfig();
    try {
      validateConfig(config);
    } catch (error) {
      setStatus(error.message, 'error');
      appendLog(error.message, 'error');
      return;
    }

    if (runtime.appliedSignature !== configSignature(config)) {
      const message = '请先点击“应用设置”，等待页面筛选条件刷新后再开始导出。';
      setStatus(message, 'warn');
      appendLog(message, 'warn');
      return;
    }

    const entry = exportEntryButton();
    if (!entry) {
      const message = '未检测到页面“一键导出”。请确认截图中的导出扩展已启用，并刷新罗盘页面。';
      setStatus(message, 'error');
      appendLog(message, 'error');
      return;
    }

    saveConfig(config);
    runtime.running = true;
    runtime.stopRequested = false;
    runtime.applyButton.disabled = true;
    runtime.startButton.disabled = true;
    runtime.stopButton.disabled = false;
    [...runtime.form.elements].forEach((control) => { if (control !== runtime.stopButton) control.disabled = true; });
    appendLog(`开始任务，共 ${config.tabs.length} 个榜单`, 'success');

    try {
      for (let index = 0; index < config.tabs.length; index += 1) {
        checkStopped();
        const tabName = config.tabs[index];
        setProgress(index, config.tabs.length, `${index + 1}/${config.tabs.length} · ${tabName}`);
        appendLog(`—— ${index + 1}/${config.tabs.length} ${tabName} ——`);
        await exportOneTab(tabName, config);
        setProgress(index + 1, config.tabs.length, `${index + 1}/${config.tabs.length} · ${tabName} 已完成`);
      }
      setStatus('全部榜单已导出', 'success');
      appendLog('全部任务完成。请检查浏览器下载列表。', 'success');
      try {
        GM_notification({ title: SCRIPT_NAME, text: `${config.tabs.length} 个榜单已全部导出`, timeout: 6000 });
      } catch (_) { /* 通知权限不是必需项 */ }
    } catch (error) {
      if (error instanceof StopError) {
        setStatus('任务已停止', 'warn');
        appendLog('任务已由用户停止', 'warn');
      } else {
        setStatus(`执行失败：${error.message}`, 'error');
        appendLog(`执行失败：${error.message}`, 'error');
        console.error(error);
      }
    } finally {
      runtime.running = false;
      [...runtime.form.elements].forEach((control) => { control.disabled = false; });
      runtime.applyButton.disabled = false;
      runtime.startButton.disabled = false;
      runtime.stopButton.disabled = true;
      updateCustomDateVisibility();
    }
  }

  function stopBatch() {
    if (!runtime.running) return;
    runtime.stopRequested = true;
    runtime.stopButton.disabled = true;
    setStatus('正在安全停止…', 'warn');
    appendLog('收到停止请求，将在当前等待点停止', 'warn');
  }

  function updateCustomDateVisibility() {
    const mode = runtime.form?.elements.timeMode?.value;
    const row = runtime.shadow?.querySelector('.custom-date-row');
    if (row) row.hidden = mode !== 'naturalDay';
    updateSameDayDates();
  }

  function todayIsoDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function updateSameDayDates() {
    const form = runtime.form;
    if (!form) return;
    const enabled = Boolean(form.elements.sameDay?.checked) && form.elements.timeMode?.value === 'naturalDay';
    const start = form.elements.startDate;
    const end = form.elements.endDate;
    if (!start || !end) return;
    if (enabled) {
      const today = todayIsoDate();
      start.value = today;
      end.value = today;
    }
    start.readOnly = enabled;
    end.readOnly = enabled;
    start.setAttribute('aria-disabled', String(enabled));
    end.setAttribute('aria-disabled', String(enabled));
  }

  function populateForm(config) {
    const form = runtime.form;
    form.elements.timeMode.value = config.timeMode;
    form.elements.startDate.value = config.startDate;
    form.elements.endDate.value = config.endDate;
    form.elements.sameDay.checked = Boolean(config.sameDay);
    form.elements.minPrice.value = config.minPrice;
    form.elements.maxPrice.value = config.maxPrice;
    form.elements.category1.value = config.category1;
    form.elements.category2.value = config.category2;
    form.elements.category3.value = config.category3;
    form.elements.loadTimeoutSec.value = config.loadTimeoutSec;
    form.elements.settleSec.value = config.settleSec;
    [...form.querySelectorAll('input[name="tabs"]')].forEach((checkbox) => {
      checkbox.checked = config.tabs.includes(checkbox.value);
    });
    updateCustomDateVisibility();
  }

  function enableDragging(host, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startTop = 0;
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      const rect = host.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const right = Math.max(8, Math.min(window.innerWidth - 330, startRight - (event.clientX - startX)));
      const top = Math.max(8, Math.min(window.innerHeight - 60, startTop + (event.clientY - startY)));
      host.style.right = `${right}px`;
      host.style.top = `${top}px`;
      host.style.bottom = 'auto';
    });
    handle.addEventListener('pointerup', () => { dragging = false; });
  }

  function mountPanel() {
    if (document.getElementById(HOST_ID)) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:18px;top:180px;z-index:2147483647;width:380px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    runtime.shadow = shadow;

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel { color:#172033; background:#fff; border:1px solid #d8e1f0; border-radius:14px; box-shadow:0 14px 44px rgba(19,38,74,.22); overflow:hidden; font-size:13px; }
        .head { height:50px; display:flex; align-items:center; gap:10px; padding:0 14px; color:#fff; background:linear-gradient(135deg,#295cff,#5a79ff); cursor:move; user-select:none; }
        .head strong { flex:1; font-size:15px; letter-spacing:.2px; }
        .head small { opacity:.78; font-size:11px; }
        .icon-btn { width:28px; height:28px; border:0; border-radius:8px; color:#fff; background:rgba(255,255,255,.16); cursor:pointer; font-size:17px; }
        .body { padding:12px 14px 14px; max-height:calc(100vh - 250px); overflow:auto; }
        .panel.collapsed .body { display:none; }
        .section { border:1px solid #e5eaf3; border-radius:10px; padding:10px; margin-bottom:9px; }
        .section-title { color:#647089; font-size:11px; font-weight:700; margin:0 0 7px; text-transform:uppercase; letter-spacing:.5px; }
        .field { display:grid; grid-template-columns:66px 1fr; align-items:center; gap:8px; margin:7px 0; }
        .field > label { color:#4f5b70; }
        .row { display:flex; align-items:center; gap:7px; }
        input,select { width:100%; height:32px; border:1px solid #ccd5e5; border-radius:7px; padding:0 8px; color:#172033; background:#fff; outline:none; font:inherit; }
        input[type="date"] { color-scheme:light; cursor:pointer; font-family:"Segoe UI","Microsoft YaHei",Arial,sans-serif; font-size:13px; font-weight:400; }
        input[type="date"]::-webkit-datetime-edit { font-family:"Segoe UI","Microsoft YaHei",Arial,sans-serif; font-weight:400; }
        input:focus,select:focus { border-color:#4771ff; box-shadow:0 0 0 2px rgba(71,113,255,.12); }
        input:disabled,select:disabled { color:#7b8495; background:#f3f5f8; }
        .sep { color:#9aa4b5; flex:0 0 auto; }
        .tabs { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
        .check { display:flex; align-items:center; gap:7px; min-height:31px; padding:0 8px; border:1px solid #e2e7f0; border-radius:7px; cursor:pointer; }
        .check input { width:15px; height:15px; accent-color:#315ff4; }
        .same-day-check { grid-column:2; margin-top:0; }
        details { margin-top:6px; color:#69758b; }
        summary { cursor:pointer; user-select:none; }
        .actions { display:grid; grid-template-columns:1fr 1fr 70px; gap:8px; margin-top:10px; }
        button.action { height:36px; border:0; border-radius:8px; cursor:pointer; font:600 13px inherit; }
        .apply { color:#2447a8; background:#e9efff; }
        .start { color:#fff; background:#315ff4; }
        .stop { color:#cf3e48; background:#fff0f1; }
        button:disabled { cursor:not-allowed; opacity:.48; }
        .status { margin:10px 0 7px; padding:8px 9px; border-radius:8px; color:#536079; background:#f2f5fa; line-height:1.45; }
        .status[data-type="running"] { color:#224fc8; background:#edf3ff; }
        .status[data-type="success"] { color:#15734c; background:#eaf8f1; }
        .status[data-type="warn"] { color:#986000; background:#fff7df; }
        .status[data-type="error"] { color:#bc2d3b; background:#ffedef; }
        .progress { position:relative; height:24px; overflow:hidden; border-radius:7px; background:#eef1f6; }
        .progress i { position:absolute; inset:0 auto 0 0; width:0; background:#dce6ff; transition:width .25s; }
        .progress span { position:relative; display:block; padding:3px 8px; color:#536079; text-align:center; line-height:18px; }
        .logs { height:92px; margin-top:8px; padding:7px 8px; overflow:auto; border-radius:8px; color:#647089; background:#111827; font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace; }
        .log-line.success { color:#72e3b1; }
        .log-line.warn { color:#ffd479; }
        .log-line.error { color:#ff8792; }
        .hint { margin-top:7px; color:#8a94a6; font-size:11px; line-height:1.45; }
        [hidden] { display:none !important; }
      </style>
      <section class="panel">
        <header class="head">
          <strong>罗盘榜单批量导出</strong>
          <small>v${SCRIPT_VERSION}</small>
          <button class="icon-btn collapse" title="折叠/展开">−</button>
        </header>
        <div class="body">
          <form>
            <div class="section">
              <p class="section-title">筛选条件</p>
              <div class="field">
                <label for="timeMode">时间</label>
                <select id="timeMode" name="timeMode">
                  <option value="one">近1天</option>
                  <option value="seven">近7天</option>
                  <option value="thirty">近30天</option>
                  <option value="naturalDay">自然日（通过日历选择）</option>
                </select>
              </div>
              <div class="field custom-date-row" hidden>
                <label>日期范围</label>
                <div class="row"><input name="startDate" type="date" title="点击日历图标选择开始日期"><span class="sep">至</span><input name="endDate" type="date" title="点击日历图标选择结束日期"></div>
                <label class="check same-day-check"><input type="checkbox" name="sameDay"><span>当天（开始与结束日期相同）</span></label>
              </div>
              <div class="field">
                <label>价格</label>
                <div class="row"><input name="minPrice" type="number" min="0" step="0.01" placeholder="最低价"><span class="sep">—</span><input name="maxPrice" type="number" min="0" step="0.01" placeholder="最高价"></div>
              </div>
              <div class="field">
                <label>行业类目</label>
                <div class="row"><input name="category1" placeholder="一级"><span class="sep">/</span><input name="category2" placeholder="二级"><span class="sep">/</span><input name="category3" placeholder="三级"></div>
              </div>
            </div>
            <div class="section">
              <p class="section-title">榜单标签页</p>
              <div class="tabs">
                ${RANK_TABS.map((tab) => `<label class="check"><input type="checkbox" name="tabs" value="${tab}"><span>${tab}</span></label>`).join('')}
              </div>
              <details>
                <summary>高级等待设置</summary>
                <div class="field"><label>加载超时</label><div class="row"><input name="loadTimeoutSec" type="number" min="30" max="1800"><span class="sep">秒</span></div></div>
                <div class="field"><label>稳定判定</label><div class="row"><input name="settleSec" type="number" min="3" max="30"><span class="sep">秒</span></div></div>
              </details>
            </div>
            <div class="actions">
              <button class="action apply" type="button">应用设置</button>
              <button class="action start" type="button">开始一键导出</button>
              <button class="action stop" type="button" disabled>停止</button>
            </div>
          </form>
          <div class="status" data-type="idle">等待开始</div>
          <div class="progress"><i></i><span>0/0 · 尚未运行</span></div>
          <div class="logs" aria-live="polite"></div>
          <div class="hint">依赖页面现有的“一键导出”扩展；运行时请保持当前标签页打开，并允许该站点下载多个文件。</div>
        </div>
      </section>`;

    runtime.form = shadow.querySelector('form');
    runtime.logBox = shadow.querySelector('.logs');
    runtime.statusEl = shadow.querySelector('.status');
    runtime.progressEl = shadow.querySelector('.progress');
    runtime.applyButton = shadow.querySelector('.apply');
    runtime.startButton = shadow.querySelector('.start');
    runtime.stopButton = shadow.querySelector('.stop');

    populateForm(loadConfig());
    runtime.form.elements.timeMode.addEventListener('change', updateCustomDateVisibility);
    runtime.form.elements.sameDay.addEventListener('change', updateSameDayDates);
    runtime.form.addEventListener('change', () => {
      if (!runtime.running && !runtime.applying) {
        saveConfig(readFormConfig());
        runtime.appliedSignature = '';
        setStatus('设置已变更，请先应用设置', 'warn');
      }
    });
    runtime.applyButton.addEventListener('click', applySettings);
    runtime.startButton.addEventListener('click', runBatch);
    runtime.stopButton.addEventListener('click', stopBatch);
    shadow.querySelector('.collapse').addEventListener('click', () => {
      const panel = shadow.querySelector('.panel');
      panel.classList.toggle('collapsed');
      shadow.querySelector('.collapse').textContent = panel.classList.contains('collapsed') ? '+' : '−';
    });
    enableDragging(host, shadow.querySelector('.head'));
    appendLog('面板已就绪');
  }

  function boot() {
    if (document.body) mountPanel();
    else window.addEventListener('DOMContentLoaded', mountPanel, { once: true });
  }

  boot();
})();
