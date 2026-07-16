// ==UserScript==
// @name         生市2.7.3
// @namespace    https://github.com/anysky911/WuLuLu
// @updateURL    https://raw.githubusercontent.com/anysky911/WuLuLu/main/sycm-market-rank-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/anysky911/WuLuLu/main/sycm-market-rank-helper.user.js
// @version      2.7.3
// @description  切换原生类目后即时记录参数，稳定加载并从下一未加载页续载导出表格
// @match        https://sycm.taobao.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const pendingCategories = names => names.map(name => ({ name, params: null }));

  const CHILDREN_LEVEL3 = {
    '帽子/围巾/口罩/手套/耳套/脚套': pendingCategories([
      '帽子',
      '围巾',
      '手套',
      '多件套 帽子、围巾、手套等组合',
      '防抓手套/护肘/护膝',
      '口罩',
      '耳套/耳暖',
      '袖套/儿童冰袖'
    ]),
    '外套/夹克/大衣': pendingCategories([
      '夹克/皮衣',
      '呢大衣',
      '普通外套',
      '风衣',
      '西服/小西装',
      '皮草/仿皮草'
    ]),
    '儿童旗袍/唐装/民族服装': pendingCategories([
      '唐装',
      '旗袍',
      '汉服'
    ]),
    '儿童家居服': pendingCategories([
      '家居袍/睡袍',
      '家居服连体衣',
      '家居服上装',
      '家居裤/睡裤',
      '家居服套装',
      '家居裙/睡裙',
      '浴袍'
    ]),
    '儿童内衣裤': [
      { name: '内衣套装', params: null },
      { name: '保暖上装', params: null },
      { name: '内裤', params: { parentCateId: '121380002', cateId: '121408006', cateFlag: '2' } },
      { name: '保暖裤', params: null },
      { name: '儿童日抛内裤', params: null }
    ],
    '裙子(新)': pendingCategories([
      '连衣裙',
      '半身裙'
    ]),
    '儿童泳装': pendingCategories([
      '泳帽',
      '泳衣裤'
    ]),
    '肚兜/肚围/护脐带': pendingCategories([
      '肚兜',
      '肚围/护脐带'
    ]),
    '羽绒服饰/羽绒内胆': pendingCategories([
      '羽绒连体衣',
      '羽绒马甲',
      '羽绒内胆',
      '羽绒服',
      '羽绒裤'
    ]),
    '儿童户外服': pendingCategories([
      '儿童冲锋衣',
      '儿童滑雪服',
      '儿童运动套装',
      '儿童抓绒衣',
      '儿童软壳裤',
      '儿童速干T恤',
      '儿童速干衬衫',
      '儿童运动裤',
      '儿童皮肤衣/防晒衣',
      '儿童软壳衣',
      '儿童冲锋裤',
      '儿童运动衣',
      '儿童速干裤',
      '儿童滑雪裤'
    ])
  };

  const CHILDREN_LEVEL2_NAMES = [
    '其它',
    '帽子/围巾/口罩/手套/耳套/脚套',
    '儿童袜子(0-16岁)',
    '卫衣/绒衫',
    '马甲',
    '衬衫',
    '披风/斗篷',
    '棉袄/棉服',
    '连身衣/爬服/哈衣',
    '毛衣/针织衫',
    '套装',
    '外套/夹克/大衣',
    '亲子装/亲子时装',
    'T恤',
    '裤子',
    '婴儿礼盒',
    '校服/园服',
    '反穿衣/罩衣',
    '儿童旗袍/唐装/民族服装',
    '儿童家居服',
    '背心吊带',
    '儿童内衣裤',
    '裙子(新)',
    '儿童配饰',
    '包包',
    '儿童演出服',
    '儿童泳装',
    '肚兜/肚围/护脐带',
    '发育内衣/抹胸',
    '儿童礼服',
    '羽绒服饰/羽绒内胆',
    '儿童户外服',
    '儿童牛仔',
    '儿童POLO衫',
    '儿童双肩包',
    '裤子（新）',
    '儿童羊绒衫'
  ];

  const CHILDREN_LEVEL2 = CHILDREN_LEVEL2_NAMES.map(name => {
    if (CHILDREN_LEVEL3[name]) return { name, children: CHILDREN_LEVEL3[name] };
    return { name, params: null };
  });

  const CATEGORY_TREE = [
    {
      name: '女装/女士精品',
      children: [
        { name: '半身裙', params: { parentCateId: '16', cateId: '1623', cateFlag: '2' } },
        { name: '毛衣', params: { parentCateId: '16', cateId: '162103', cateFlag: '2' } },
        { name: '牛仔裤', params: { parentCateId: '16', cateId: '162205', cateFlag: '2' } },
        { name: 'T恤', params: { parentCateId: '16', cateId: '50000671', cateFlag: '2' } },
        { name: '毛针织衫', params: { parentCateId: '16', cateId: '50000697', cateFlag: '2' } },
        { name: '套装/学生校服/工作制服', params: null },
        { name: '衬衫', params: null },
        { name: '蕾丝衫/雪纺衫', params: null },
        {
          name: '裤子',
          children: [
            { name: '休闲裤', params: null },
            { name: '打底裤', params: null },
            { name: '西装裤/正装裤', params: null },
            { name: '棉裤/羽绒裤', params: null },
            { name: '背带裤', params: null },
            { name: '皮裤', params: null },
            { name: '裙裤', params: null },
            { name: '时尚工装裤', params: { parentCateId: '1622', cateId: '202156538', cateFlag: '2' } },
            { name: '短裤', params: { parentCateId: '1622', cateId: '202174802', cateFlag: '2' } }
          ]
        }
      ]
    },
    {
      name: '童装/婴儿装/亲子装',
      children: CHILDREN_LEVEL2
    }
  ];

  const AUTO_RUN_KEY = 'sycm_auto_run_after_apply_v5';
  const TARGET_URL_KEY = 'sycm_auto_target_url_v3';
  const CATEGORY_CACHE_KEY = 'sycm_confirmed_category_params_v1';
  let categoryRecordTimer = 0;
  let lastCategoryRecordKey = '';

  const $ = (sel, root = document) => root.querySelector(sel);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtMonth = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  function getParams() {
    return new URLSearchParams(location.search);
  }

  function currentUrl() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function isVisible(el) {
    if (!el || el.closest('#sycm-helper-panel')) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isDisabled(el) {
    if (!el) return true;
    const cls = String(el.className || '');
    return el.disabled || el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true' || cls.includes('disabled');
  }

  function realClick(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    ['mouseover', 'mousedown', 'mouseup'].forEach(type => {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y
      }));
    });

    if (typeof el.click === 'function') {
      el.click();
    } else {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    return true;
  }

  function setStatus(text) {
    const el = $('#sycm-status');
    if (el) el.textContent = text;
  }

  function monthToDateRange(monthText) {
    const [year, month] = monthText.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return [fmtDate(start), fmtDate(end)];
  }

  function getMonthFromUrl() {
    const range = getParams().get('dateRange') || '';
    const start = range.split('|')[0];
    if (start && /^\d{4}-\d{2}/.test(start)) return start.slice(0, 7);
    return fmtMonth(new Date());
  }

  function getCurrentEndDate() {
    const range = getParams().get('dateRange');
    if (range && range.includes('|')) return range.split('|')[1];

    const d = new Date();
    d.setDate(d.getDate() - 1);
    return fmtDate(d);
  }

  function recentRange(days) {
    const end = new Date(getCurrentEndDate());
    const start = new Date(end);
    start.setDate(end.getDate() - days + 1);
    return [fmtDate(start), fmtDate(end)];
  }

  function upsertCategory(path, params) {
    if (!Array.isArray(path) || path.length < 2 || !params || !params.parentCateId || !params.cateId) return false;

    let level1 = CATEGORY_TREE.find(item => item.name === path[0]);
    if (!level1) {
      level1 = { name: path[0], children: [] };
      CATEGORY_TREE.push(level1);
    }

    let level2 = (level1.children || []).find(item => item.name === path[1]);
    if (!level2) {
      level2 = { name: path[1], params: null };
      level1.children.push(level2);
    }

    if (path.length >= 3) {
      if (!level2.children) level2.children = [];
      let level3 = level2.children.find(item => item.name === path[2]);
      if (!level3) {
        level3 = { name: path[2], params: null };
        level2.children.push(level3);
      }
      level3.params = params;
    } else {
      level2.params = params;
    }

    return true;
  }

  function loadRememberedCategories() {
    try {
      const saved = JSON.parse(localStorage.getItem(CATEGORY_CACHE_KEY) || '[]');
      if (!Array.isArray(saved)) return;
      saved.forEach(item => upsertCategory(item.path, item.params));
    } catch (error) {
      console.warn('[生意参谋助手] 读取已记住类目失败', error);
    }
  }

  function rememberCurrentCategory() {
    const p = getParams();
    const params = {
      parentCateId: p.get('parentCateId'),
      cateId: p.get('cateId'),
      cateFlag: p.get('cateFlag') || '2'
    };
    const headers = Array.from(document.querySelectorAll('.common-picker-header[title], .item-cate a[title], [data-ebase="CommonPicker"] a[title]'));
    const header = headers.find(item => {
      const title = item.getAttribute('title') || '';
      return title.split('>').map(part => part.trim()).filter(Boolean).length >= 2;
    });
    const path = header ? header.getAttribute('title').split('>').map(item => item.trim()).filter(Boolean) : [];

    if (!upsertCategory(path, params)) return false;

    const pathKey = path.join(' > ');
    const recordKey = `${pathKey}|${params.parentCateId}|${params.cateId}|${params.cateFlag}`;
    if (recordKey === lastCategoryRecordKey) return true;

    try {
      const saved = JSON.parse(localStorage.getItem(CATEGORY_CACHE_KEY) || '[]');
      const list = Array.isArray(saved) ? saved : [];
      const savedItem = list.find(item => Array.isArray(item.path) && item.path.join(' > ') === pathKey);
      const isSame = savedItem && savedItem.params &&
        savedItem.params.parentCateId === params.parentCateId &&
        savedItem.params.cateId === params.cateId &&
        savedItem.params.cateFlag === params.cateFlag;

      if (!isSame) {
        const next = list.filter(item => Array.isArray(item.path) && item.path.join(' > ') !== pathKey);
        next.push({ path, params });
        localStorage.setItem(CATEGORY_CACHE_KEY, JSON.stringify(next.slice(-100)));
      }
    } catch (error) {
      console.warn('[生意参谋助手] 保存当前类目失败', error);
    }

    lastCategoryRecordKey = recordKey;
    return true;
  }

  function scheduleCategoryRecord(delay = 500, force = false) {
    if (categoryRecordTimer && !force) return;
    clearTimeout(categoryRecordTimer);
    categoryRecordTimer = setTimeout(() => {
      categoryRecordTimer = 0;
      rememberCurrentCategory();
    }, delay);
  }

  function findCategoryByParams(parentCateId, cateId, cateFlag) {
    for (let i = 0; i < CATEGORY_TREE.length; i++) {
      const level1 = CATEGORY_TREE[i];

      for (let j = 0; j < (level1.children || []).length; j++) {
        const level2 = level1.children[j];

        if (level2.params &&
          level2.params.parentCateId === parentCateId &&
          level2.params.cateId === cateId &&
          level2.params.cateFlag === cateFlag) {
          return { level1Index: i, level2Index: j, level3Index: '' };
        }

        for (let k = 0; k < (level2.children || []).length; k++) {
          const level3 = level2.children[k];

          if (level3.params &&
            level3.params.parentCateId === parentCateId &&
            level3.params.cateId === cateId &&
            level3.params.cateFlag === cateFlag) {
            return { level1Index: i, level2Index: j, level3Index: k };
          }
        }
      }
    }

    return { level1Index: 0, level2Index: '', level3Index: '' };
  }

  function getSelectedCategory() {
    const l1 = CATEGORY_TREE[Number($('#sycm-level1').value)];
    const l2 = l1 && l1.children ? l1.children[Number($('#sycm-level2').value)] : null;
    const l3 = l2 && l2.children ? l2.children[Number($('#sycm-level3').value)] : null;

    if (l3) return { item: l3, path: `${l1.name} > ${l2.name} > ${l3.name}` };
    if (l2) return { item: l2, path: `${l1.name} > ${l2.name}` };
    return null;
  }

  function buildTargetUrl() {
    const selected = getSelectedCategory();

    if (!selected || !selected.item) {
      alert('请先选择类目');
      return '';
    }

    if (!selected.item.params) {
      alert(`这个类目还没有确认ID：${selected.path}\n请先在网页原本的“切换类目”里选择一次，把地址栏参数发我，我再补进去。`);
      return '';
    }

    const p = getParams();
    const dateType = $('#sycm-dateType').value;
    const cate = selected.item.params;

    p.set('activeKey', 'item');
    p.set('parentCateId', cate.parentCateId);
    p.set('cateId', cate.cateId);
    p.set('cateFlag', cate.cateFlag);
    p.set('dateType', dateType);

    if (dateType === 'month') {
      const [start, end] = monthToDateRange($('#sycm-month').value);
      p.set('dateRange', `${start}|${end}`);
    } else {
      p.set('dateRange', `${$('#sycm-startDate').value}|${$('#sycm-endDate').value}`);
    }

    return `${location.origin}${location.pathname}?${p.toString()}`;
  }

  function applyQuery(autoRun = false) {
    const url = buildTargetUrl();
    if (!url) return;

    if (autoRun) {
      localStorage.setItem(AUTO_RUN_KEY, '1');
      localStorage.setItem(TARGET_URL_KEY, url);
    }

    location.href = url;
  }

  function findButtonByText(text) {
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], span, div')).filter(el => {
      const value = (el.innerText || el.textContent || '').trim();
      return value === text && isVisible(el);
    });

    for (const el of candidates) {
      const clickable = el.matches('button, a, [role="button"]') ? el : el.closest('button, a, [role="button"]');
      if (clickable && isVisible(clickable)) return clickable;
    }

    return candidates[0] || null;
  }

  async function waitForButton(text, timeout = 15000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const btn = findButtonByText(text);
      if (btn && !isDisabled(btn)) return btn;
      await sleep(300);
    }

    return null;
  }

  async function waitForPageReadyAfterApply(timeout = 30000) {
    const targetUrl = localStorage.getItem(TARGET_URL_KEY) || '';
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const urlReady = !targetUrl || currentUrl() === targetUrl;
      const pageReady = !!findButtonByText('一键分析');

      if (urlReady && pageReady) return true;

      setStatus('页面刷新中，等待一键分析按钮出现...');
      await sleep(500);
    }

    return false;
  }

  function getActivePageNumber() {
    const activeList = Array.from(document.querySelectorAll('.ant-pagination-item-active')).filter(isVisible);
    const active = activeList[activeList.length - 1];
    if (!active) return 0;

    const text = (active.innerText || active.textContent || '').trim();
    return Number(text) || 0;
  }

  function getVisiblePaginationMaxPage() {
    const nums = Array.from(document.querySelectorAll('.ant-pagination-item, [class*="pagination"] li, [class*="pagination"] button, [class*="pagination"] a')).map(el => {
      if (!isVisible(el)) return 0;
      const text = (el.innerText || el.textContent || '').trim();
      return /^\d+$/.test(text) ? Number(text) : 0;
    }).filter(Boolean);

    return nums.length ? Math.max(...nums) : 0;
  }

  function getLoadedRowCount() {
    const textList = Array.from(document.querySelectorAll('span, div, p')).map(el => {
      if (!isVisible(el)) return '';
      return (el.innerText || el.textContent || '').trim();
    }).filter(Boolean);

    const counts = [];
    textList.forEach(text => {
      Array.from(text.matchAll(/共\s*(\d+)\s*行数据/g)).forEach(match => counts.push(Number(match[1]) || 0));
    });

    return counts.length ? Math.max(...counts) : 0;
  }

  function getLoadedPageCount(rows = getLoadedRowCount()) {
    const byRows = rows > 0 ? Math.ceil(rows / 10) : 0;
    const byActive = getActivePageNumber();
    const loadingPage = getLoadingPageNumber();
    const byLoading = loadingPage > 1 ? loadingPage - 1 : 0;

    return Math.max(byRows, byActive, byLoading);
  }

  function getLoadingPageNumber() {
    const textList = Array.from(document.querySelectorAll('span, div, p')).map(el => {
      if (!isVisible(el)) return '';
      return (el.innerText || el.textContent || '').trim();
    }).filter(Boolean);

    const pages = [];
    textList.forEach(text => {
      Array.from(text.matchAll(/正在获取第\s*(\d+)\s*页数据/g)).forEach(match => pages.push(Number(match[1]) || 0));
    });

    return pages.length ? Math.max(...pages) : 0;
  }

  function getVisibleLoadFailure() {
    const failureWords = ['加载失败', '获取失败', '请求失败', '网络异常', '服务异常', '请重试'];
    const candidates = Array.from(document.querySelectorAll('.ant-message, .ant-notification, [role="alert"], span, div, p'));

    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length > 100) continue;
      const matched = failureWords.find(word => text.includes(word));
      if (matched) return matched;
    }

    return '';
  }

  function getModalPaginationRoot() {
    const loadBtn = findButtonByText('加载全部');
    const roots = Array.from(document.querySelectorAll('ul.ant-pagination, .oui-pagination')).filter(isVisible);
    if (!roots.length) return null;
    if (!loadBtn) return roots[roots.length - 1];

    const buttonRect = loadBtn.getBoundingClientRect();
    return roots.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      const aDistance = Math.abs(aRect.top - buttonRect.top) + Math.abs(aRect.left - buttonRect.left);
      const bDistance = Math.abs(bRect.top - buttonRect.top) + Math.abs(bRect.left - buttonRect.left);
      return aDistance - bDistance;
    })[0];
  }

  function getModalActivePage(pagination = getModalPaginationRoot()) {
    if (!pagination) return 0;
    const active = pagination.querySelector('.ant-pagination-item-active');
    return active ? Number((active.innerText || active.textContent || '').trim()) || 0 : 0;
  }

  function getModalPageButton(page, pagination = getModalPaginationRoot()) {
    if (!pagination) return null;
    return Array.from(pagination.querySelectorAll('.ant-pagination-item')).find(item => {
      return Number((item.innerText || item.textContent || '').trim()) === page && isVisible(item);
    }) || null;
  }

  async function waitForModalPage(page, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (getModalActivePage() === page) return true;
      await sleep(200);
    }
    return false;
  }

  async function moveModalToPage(page) {
    for (let step = 0; step < 12; step++) {
      const pagination = getModalPaginationRoot();
      const active = getModalActivePage(pagination);
      if (!pagination || !active) return false;
      if (active === page) return true;

      const targetBtn = getModalPageButton(page, pagination);
      if (targetBtn) {
        realClick(targetBtn);
        return waitForModalPage(page);
      }

      if (page > active) {
        const jumpNext = pagination.querySelector('.ant-pagination-jump-next');
        const nextBtn = pagination.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)');
        const stepBtn = jumpNext && isVisible(jumpNext) ? jumpNext : nextBtn;
        if (!stepBtn || isDisabled(stepBtn)) return false;
        realClick(stepBtn);
        await sleep(300);
        continue;
      }

      return false;
    }

    return false;
  }

  async function resumeFromBreakpoint(rows) {
    const loadedPages = Math.ceil(rows / 10);
    const totalPages = getVisiblePaginationMaxPage();
    const nextPage = loadedPages + 1;

    if (!loadedPages || !totalPages || nextPage > totalPages) return '';

    setStatus(`检测到已保存 ${rows} 行，正在定位第 ${nextPage} 页后继续加载...`);
    const moved = await moveModalToPage(nextPage);
    if (!moved) return '';

    const loadBtn = findButtonByText('加载全部');
    if (loadBtn && !isDisabled(loadBtn)) {
      realClick(loadBtn);
      return `第 ${nextPage} 页续载`;
    }

    return '';
  }

  async function tryResumeLoading(force = false, rows = getLoadedRowCount()) {
    if (!force && isModalAutoLoading()) return '';

    if (rows > 0) {
      const breakpointAction = await resumeFromBreakpoint(rows);
      if (breakpointAction) return breakpointAction;
      return '';
    }

    const loadBtn = findButtonByText('加载全部');
    if (loadBtn && !isDisabled(loadBtn)) {
      realClick(loadBtn);
      return '加载全部';
    }

    const failure = getVisibleLoadFailure();
    const retryBtn = failure ? findButtonByText('重试') : null;
    if (retryBtn && !isDisabled(retryBtn)) {
      realClick(retryBtn);
      return '重试';
    }

    return '';
  }

  function isRankModalOpen() {
    if (findButtonByText('停止加载')) return true;
    if (findButtonByText('加载全部')) return true;
    if (findExportButton()) return true;

    return Array.from(document.querySelectorAll('span, div')).some(el => {
      if (!isVisible(el)) return false;
      const text = (el.innerText || el.textContent || '').trim();
      return text.includes('市场排行_商品');
    });
  }

  function isModalAutoLoading() {
    return !!findButtonByText('停止加载') || getLoadingPageNumber() > 0;
  }

  async function ensureModalLoadingStarted() {
    const rows = getLoadedRowCount();

    if (isRankModalOpen()) {
      if (rows >= 300) {
        setStatus('检测到弹窗已有300行数据，准备导出...');
        return true;
      }

      if (isModalAutoLoading()) {
        const loadingPage = getLoadingPageNumber();
        const loadedPages = getLoadedPageCount(rows);
        setStatus(`检测到已有加载任务：已加载约 ${loadedPages || '?'} 页，正在获取第 ${loadingPage || '?'} 页，继续等待...`);
        return true;
      }

      const action = await tryResumeLoading(true, rows);
      if (action) {
        setStatus(`检测到弹窗已有 ${rows || '?'} 行，正在${action}...`);
        return true;
      }

      if (rows > 0) {
        setStatus(`已保留 ${rows} 行数据，但未能定位下一未加载页；不会从第1页重跑。`);
        alert(`已检测到 ${rows} 行已加载数据，但没找到弹窗分页中的下一页。为避免从第1页重新加载，助手已停止本次操作。`);
        return false;
      }

      setStatus(`检测到弹窗已打开，已有 ${rows || '?'} 行，继续等待...`);
      return true;
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const analyzeBtn = findButtonByText('一键分析');
      if (!analyzeBtn) {
        setStatus('没找到绿色“一键分析”按钮');
        alert('没找到页面顶部绿色的“一键分析”按钮，请确认当前在市场排行页面。');
        return false;
      }

      setStatus(`正在点击顶部绿色“一键分析”（第 ${attempt} 次）...`);
      realClick(analyzeBtn);

      setStatus('等待分析弹窗里的“加载全部”...');
      const loadBtn = await waitForButton('加载全部', 5000);
      if (loadBtn) {
        setStatus('已确认分析弹窗，正在点击加载全部...');
        realClick(loadBtn);
        return true;
      }

      if (isRankModalOpen()) {
        setStatus('分析弹窗已打开，等待加载全部按钮可用...');
        const delayedLoadBtn = await waitForButton('加载全部', 10000);
        if (delayedLoadBtn) {
          setStatus('正在点击加载全部...');
          realClick(delayedLoadBtn);
          return true;
        }
      }

      await sleep(700);
    }

    setStatus('一键分析后未出现加载弹窗');
    alert('已连续点击顶部绿色“一键分析”，但没有出现“加载全部”弹窗。请确认该功能是否被页面权限或浏览器拦截。');
    return false;
  }

  async function waitForRows300(timeout = 720000) {
    const start = Date.now();
    let lastProgress = -1;
    let lastProgressAt = start;
    let lastResumeAt = 0;
    let resumeCount = 0;
    const maxResumeCount = 30;

    while (Date.now() - start < timeout) {
      try {
        const current = getActivePageNumber();
        const rows = getLoadedRowCount();
        const loadedPages = getLoadedPageCount(rows);
        const loadingPage = getLoadingPageNumber();
        const progress = Math.max(rows, loadedPages * 10, loadingPage * 10);

        if (progress > lastProgress) {
          lastProgress = progress;
          lastProgressAt = Date.now();
        }

        if (rows >= 300) {
          setStatus(`已检测到共${rows}行数据，已加载 ${loadedPages || 30} 页，准备导出表格...`);
          await sleep(1500);
          return true;
        }

        const now = Date.now();
        const stalled = now - lastProgressAt >= 15000;
        const failure = getVisibleLoadFailure();
        const canResume = resumeCount < maxResumeCount && now - lastResumeAt >= 5000;
        const activelyLoading = !!findButtonByText('停止加载');

        if (canResume && (failure || (stalled && !activelyLoading))) {
          const action = await tryResumeLoading(true, rows);
          if (action) {
            resumeCount += 1;
            lastResumeAt = now;
            lastProgressAt = now;
            setStatus(`第 ${resumeCount} 次自动续载：已完成约 ${loadedPages || current || '?'} 页，正在点击${action}...`);
            await sleep(1200);
            continue;
          }
        }

        const usedSeconds = Math.floor((now - start) / 1000);
        const loadingText = loadingPage ? `，正在获取第 ${loadingPage} 页` : '';
        const retryText = resumeCount ? `，已自动续载 ${resumeCount} 次` : '';
        const failureText = failure ? `，检测到${failure}` : '';
        setStatus(`加载中：已完成约 ${loadedPages || current || '?'} 页${loadingText}，共 ${rows || '?'} 行${retryText}${failureText}，已等待 ${usedSeconds}s...`);
      } catch (error) {
        console.warn('[生意参谋助手] 检查加载进度失败，继续重试', error);
        setStatus('读取加载进度时遇到页面变化，正在继续检查...');
      }

      await sleep(1000);
    }

    return false;
  }

  function findExportButton() {
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], span, div')).filter(el => {
      const text = (el.innerText || el.textContent || '').trim();
      return isVisible(el) && text.includes('导出表格');
    });

    for (const el of candidates) {
      const btn = el.closest('button, a, [role="button"]');
      if (btn && isVisible(btn) && !isDisabled(btn)) return btn;
    }

    return null;
  }

  async function waitForExportButton(timeout = 30000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const btn = findExportButton();
      if (btn) return btn;

      const rows = getLoadedRowCount();
      const pages = getLoadedPageCount(rows);
      setStatus(`已加载约 ${pages || '?'} 页、${rows || '?'} 行，等待导出表格按钮可用...`);
      await sleep(500);
    }

    return null;
  }

  async function exportTableAfterLoaded() {
    const rows = getLoadedRowCount();
    const pages = getLoadedPageCount(rows);
    setStatus(`已加载约 ${pages || 30} 页、${rows || 300} 行，准备点击导出表格...`);

    const exportBtn = await waitForExportButton();

    if (!exportBtn) {
      setStatus('没找到可用的导出表格');
      alert('已加载到300行数据，但没找到可用的“导出表格”按钮。');
      return;
    }

    realClick(exportBtn);
    setStatus('已点击导出表格，请查看浏览器下载栏');

    setTimeout(() => setStatus(''), 3000);
  }

  async function analyzeThenLoadAllAndExport() {
    const targetUrl = buildTargetUrl();
    if (!targetUrl) return;

    if (targetUrl !== currentUrl()) {
      setStatus('正在应用新的类目/时间...');
      applyQuery(true);
      return;
    }

    try {
      const started = await ensureModalLoadingStarted();
      if (!started) return;

      const finished = await waitForRows300();

      if (!finished) {
        setStatus('等待300行数据超时');
        alert('加载全部后等待“共300行数据”超时，请确认弹窗是否还在加载。');
        return;
      }

      await exportTableAfterLoaded();
    } catch (error) {
      const rows = getLoadedRowCount();
      const pages = getLoadedPageCount(rows);
      console.error('[生意参谋助手] 自动分析中断', error);
      setStatus(`运行中断：已完成约 ${pages || '?'} 页、${rows || '?'} 行`);
      alert(`自动分析运行中断，当前已完成约 ${pages || '?'} 页、${rows || '?'} 行。\n${error && error.message ? error.message : '页面状态发生变化，请再次点击一键分析继续。'}`);
    }
  }

  function createPanel() {
    if ($('#sycm-helper-panel')) return;

    const p = getParams();
    const dateType = p.get('dateType') || 'recent7';
    let [startDate, endDate] = (p.get('dateRange') || '').split('|');

    if (!startDate || !endDate || dateType === 'month') {
      [startDate, endDate] = recentRange(7);
    }

    const matched = findCategoryByParams(p.get('parentCateId'), p.get('cateId'), p.get('cateFlag') || '2');
    const monthValue = getMonthFromUrl();

    const panel = document.createElement('div');
    panel.id = 'sycm-helper-panel';
    panel.innerHTML = `
      <div class="sycm-title">
        <span>生意参谋助手</span>
        <button id="sycm-collapse">－</button>
      </div>

      <div class="sycm-body">
        <label>一级类目</label>
        <select id="sycm-level1"></select>

        <label>二级类目</label>
        <select id="sycm-level2"></select>

        <label>三级类目</label>
        <select id="sycm-level3"></select>

        <div class="sycm-param" id="sycm-param"></div>

        <label>时间类型</label>
        <select id="sycm-dateType">
          <option value="recent7">7天</option>
          <option value="recent30">30天</option>
          <option value="day">日</option>
          <option value="week">周</option>
          <option value="month">月</option>
        </select>

        <div id="sycm-date-box">
          <div class="sycm-row">
            <div>
              <label>开始日期</label>
              <input id="sycm-startDate" value="${startDate}">
            </div>
            <div>
              <label>结束日期</label>
              <input id="sycm-endDate" value="${endDate}">
            </div>
          </div>
        </div>

        <div id="sycm-month-box">
          <label>选择月份</label>
          <input id="sycm-month" type="month" value="${monthValue}">
          <div class="sycm-tip" id="sycm-month-tip"></div>
        </div>

        <div class="sycm-quick">
          <button data-type="recent7">7天</button>
          <button data-type="recent30">30天</button>
          <button data-type="day">日</button>
          <button data-type="week">周</button>
          <button data-type="month">月</button>
        </div>

        <div class="sycm-actions main">
          <button id="sycm-apply">应用</button>
          <button id="sycm-auto-export">一键分析+加载全部+导出</button>
        </div>

        <div class="sycm-status" id="sycm-status"></div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #sycm-helper-panel {
        position: fixed;
        right: 22px;
        bottom: 92px;
        width: 350px;
        z-index: 9999;
        background: #fff;
        border: 1px solid #d9e4ff;
        box-shadow: 0 8px 28px rgba(0,0,0,.18);
        border-radius: 8px;
        overflow: hidden;
        font-size: 13px;
        color: #1f2d3d;
      }
      #sycm-helper-panel .sycm-title {
        height: 38px;
        padding: 0 10px 0 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #1677ff;
        color: #fff;
        font-weight: 600;
      }
      #sycm-helper-panel .sycm-title button {
        border: none;
        background: transparent;
        color: #fff;
        font-size: 18px;
        cursor: pointer;
      }
      #sycm-helper-panel .sycm-body { padding: 12px; }
      #sycm-helper-panel label {
        display: block;
        margin: 8px 0 4px;
        color: #5f6b7a;
      }
      #sycm-helper-panel input,
      #sycm-helper-panel select {
        width: 100%;
        height: 30px;
        box-sizing: border-box;
        border: 1px solid #dcdfe6;
        border-radius: 5px;
        padding: 0 8px;
        outline: none;
      }
      #sycm-helper-panel .sycm-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      #sycm-helper-panel .sycm-quick,
      #sycm-helper-panel .sycm-actions {
        display: flex;
        gap: 6px;
        margin-top: 10px;
      }
      #sycm-helper-panel button {
        min-height: 30px;
        border-radius: 5px;
        border: 1px solid #c9ddff;
        background: #f3f8ff;
        color: #1677ff;
        cursor: pointer;
      }
      #sycm-helper-panel .sycm-quick button,
      #sycm-helper-panel .sycm-actions button {
        flex: 1;
      }
      #sycm-helper-panel .sycm-actions.main button {
        background: #1677ff;
        color: #fff;
        border-color: #1677ff;
      }
      #sycm-helper-panel .sycm-tip,
      #sycm-helper-panel .sycm-param,
      #sycm-helper-panel .sycm-status {
        margin-top: 6px;
        color: #6b7280;
        font-size: 12px;
        line-height: 1.5;
      }
    `;

    document.body.appendChild(style);
    document.body.appendChild(panel);

    function renderLevel1() {
      $('#sycm-level1').innerHTML = CATEGORY_TREE.map((item, index) => {
        return `<option value="${index}">${item.name}</option>`;
      }).join('');
    }

    function renderLevel2(selectedIndex = '') {
      const l1 = CATEGORY_TREE[Number($('#sycm-level1').value)];
      const children = l1 && l1.children ? l1.children : [];

      $('#sycm-level2').innerHTML =
        `<option value="">请选择二级类目</option>` +
        children.map((item, index) => {
          const suffix = !item.params && !item.children ? '（需原菜单确认）' : '';
          return `<option value="${index}">${item.name}${suffix}</option>`;
        }).join('');

      $('#sycm-level2').value = selectedIndex === '' ? '' : String(selectedIndex);
      renderLevel3();
    }

    function renderLevel3(selectedIndex = '') {
      const l1 = CATEGORY_TREE[Number($('#sycm-level1').value)];
      const l2 = l1 && l1.children ? l1.children[Number($('#sycm-level2').value)] : null;
      const children = l2 && l2.children ? l2.children : [];

      $('#sycm-level3').innerHTML =
        `<option value="">无/请选择三级类目</option>` +
        children.map((item, index) => {
          const suffix = !item.params ? '（需原菜单确认）' : '';
          return `<option value="${index}">${item.name}${suffix}</option>`;
        }).join('');

      $('#sycm-level3').value = selectedIndex === '' ? '' : String(selectedIndex);
      updateCategoryParam();
    }

    function updateCategoryParam() {
      const selected = getSelectedCategory();

      if (!selected || !selected.item) {
        $('#sycm-param').textContent = '';
        return;
      }

      if (!selected.item.params) {
        $('#sycm-param').textContent = `当前：${selected.path}；请先在网页原“切换类目”中选择一次，助手会自动记住ID`;
        return;
      }

      const cate = selected.item.params;
      $('#sycm-param').textContent =
        `当前：${selected.path}；参数：parentCateId=${cate.parentCateId}，cateId=${cate.cateId}，cateFlag=${cate.cateFlag}`;
    }

    function updateMonthTip() {
      const [s, e] = monthToDateRange($('#sycm-month').value);
      $('#sycm-month-tip').textContent = `实际提交：${s} 到 ${e}`;
    }

    function refreshTimeBox() {
      const type = $('#sycm-dateType').value;
      $('#sycm-month-box').style.display = type === 'month' ? 'block' : 'none';
      $('#sycm-date-box').style.display = type === 'month' ? 'none' : 'block';
      updateMonthTip();
    }

    function setDateType(type) {
      $('#sycm-dateType').value = type;

      if (type === 'recent7') {
        const [s, e] = recentRange(7);
        $('#sycm-startDate').value = s;
        $('#sycm-endDate').value = e;
      }

      if (type === 'recent30') {
        const [s, e] = recentRange(30);
        $('#sycm-startDate').value = s;
        $('#sycm-endDate').value = e;
      }

      if (type === 'day') {
        const e = getCurrentEndDate();
        $('#sycm-startDate').value = e;
        $('#sycm-endDate').value = e;
      }

      refreshTimeBox();
    }

    renderLevel1();
    $('#sycm-level1').value = String(matched.level1Index);
    renderLevel2(matched.level2Index);
    renderLevel3(matched.level3Index);

    $('#sycm-dateType').value = dateType;
    refreshTimeBox();

    $('#sycm-level1').addEventListener('change', () => renderLevel2());
    $('#sycm-level2').addEventListener('change', () => renderLevel3());
    $('#sycm-level3').addEventListener('change', updateCategoryParam);
    $('#sycm-dateType').addEventListener('change', e => setDateType(e.target.value));
    $('#sycm-month').addEventListener('change', updateMonthTip);
    $('#sycm-apply').addEventListener('click', () => applyQuery(false));
    $('#sycm-auto-export').addEventListener('click', analyzeThenLoadAllAndExport);

    panel.querySelectorAll('.sycm-quick button').forEach(btn => {
      btn.addEventListener('click', () => setDateType(btn.dataset.type));
    });

    $('#sycm-collapse').addEventListener('click', () => {
      const body = $('.sycm-body', panel);
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      $('#sycm-collapse').textContent = hidden ? '－' : '+';
    });
  }

  loadRememberedCategories();
  rememberCurrentCategory();
  createPanel();

  setTimeout(rememberCurrentCategory, 2000);

  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.common-picker-header, .common-picker-menu .tree-item')) {
      scheduleCategoryRecord(900, true);
    }
  }, true);

  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      scheduleCategoryRecord(700, true);
      return result;
    };
  });

  window.addEventListener('popstate', () => scheduleCategoryRecord(700, true));
  window.addEventListener('hashchange', () => scheduleCategoryRecord(700, true));

  setTimeout(async () => {
    if (localStorage.getItem(AUTO_RUN_KEY) === '1') {
      const ready = await waitForPageReadyAfterApply();

      if (!ready) {
        setStatus('页面刷新等待超时');
        alert('页面刷新后等待“一键分析”按钮超时，请手动再点一次。');
        localStorage.removeItem(AUTO_RUN_KEY);
        localStorage.removeItem(TARGET_URL_KEY);
        return;
      }

      localStorage.removeItem(AUTO_RUN_KEY);
      localStorage.removeItem(TARGET_URL_KEY);
      analyzeThenLoadAllAndExport();
    }
  }, 1200);

  new MutationObserver(() => {
    createPanel();
    scheduleCategoryRecord();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
