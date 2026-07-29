// ==UserScript==
// @name         罗盘导出助手
// @namespace    https://github.com/anysky911/WuLuLu
// @version      1.0.13
// @description  批量设置并导出抖店罗盘搜索榜、直播榜、商品卡榜和短视频榜数据
// @author       anysky911
// @match        https://compass.jinritemai.com/*rank-product*
// @updateURL    https://raw.githubusercontent.com/anysky911/WuLuLu/main/compass-rank-export-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/anysky911/WuLuLu/main/compass-rank-export-assistant.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = '罗盘导出助手';
    const VERSION = '1.0.13';
    const STORAGE_KEY = 'compass-rank-export-assistant.settings.v1';
    const PANEL_ID = 'compass-rank-export-assistant-panel';
    const LOG_LIMIT = 220;
    const POLL_INTERVAL = 300;

    const RANKS = [
        {
            id: 'search',
            label: '搜索榜',
            keys: ['search', 'query', 'keyword'],
            stableSelectors: [
                '[data-node-key*="search" i]',
                '[data-key*="search" i]',
                '[data-tab*="search" i]',
                '[href*="rank-product"][href*="search" i]',
            ],
        },
        {
            id: 'live',
            label: '直播榜',
            keys: ['live', 'living'],
            stableSelectors: [
                '[data-node-key*="live" i]',
                '[data-key*="live" i]',
                '[data-tab*="live" i]',
                '[href*="rank-product"][href*="live" i]',
            ],
        },
        {
            id: 'card',
            label: '商品卡榜',
            keys: ['card', 'productcard', 'product-card', 'shelf'],
            stableSelectors: [
                '[data-node-key*="card" i]',
                '[data-key*="card" i]',
                '[data-tab*="card" i]',
                '[href*="rank-product"][href*="card" i]',
            ],
        },
        {
            id: 'video',
            label: '短视频榜',
            keys: ['video', 'shortvideo', 'short-video'],
            stableSelectors: [
                '[data-node-key*="video" i]',
                '[data-key*="video" i]',
                '[data-tab*="video" i]',
                '[href*="rank-product"][href*="video" i]',
            ],
        },
    ];

    const TIME_VALUE = {
        one: 'one',
        seven: 'seven',
        thirty: 'thirty',
        natural: 'more',
    };

    const state = {
        settings: null,
        running: false,
        stopRequested: false,
        abortController: null,
        panel: null,
        logs: [],
        lastValidStartDate: '',
    };

    function localDateISO(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function yesterdayISO() {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() - 1);
        return localDateISO(date);
    }

    function todayISO() {
        return localDateISO(new Date());
    }

    function defaultSettings() {
        const yesterday = yesterdayISO();
        return {
            timeMode: 'seven',
            startDate: yesterday,
            endDate: yesterday,
            sameDay: false,
            minPrice: '',
            maxPrice: '',
            categories: ['', '', ''],
            ranks: {
                search: true,
                live: true,
                card: true,
                video: true,
            },
            loadTimeoutSeconds: 30,
            stableWaitSeconds: 3,
            ui: {
                collapsed: false,
                left: null,
                top: 90,
            },
        };
    }

    function normalizeSettings(raw) {
        const defaults = defaultSettings();
        const value = raw && typeof raw === 'object' ? raw : {};
        const normalized = {
            ...defaults,
            ...value,
            categories: Array.isArray(value.categories)
                ? defaults.categories.map((fallback, index) => String(value.categories[index] ?? fallback))
                : defaults.categories,
            ranks: {...defaults.ranks, ...(value.ranks || {})},
            ui: {...defaults.ui, ...(value.ui || {})},
        };

        if (!Object.prototype.hasOwnProperty.call(TIME_VALUE, normalized.timeMode)) {
            normalized.timeMode = defaults.timeMode;
        }
        normalized.loadTimeoutSeconds = clampNumber(normalized.loadTimeoutSeconds, 5, 300, 30);
        normalized.stableWaitSeconds = clampNumber(normalized.stableWaitSeconds, 1, 60, 3);

        const maximumDate = yesterdayISO();
        if (!isISODate(normalized.startDate) || normalized.startDate > maximumDate) {
            normalized.startDate = maximumDate;
        }
        if (!isISODate(normalized.endDate) || normalized.endDate > maximumDate) {
            normalized.endDate = normalized.startDate;
        }
        if (normalized.sameDay) {
            normalized.endDate = normalized.startDate;
        } else if (normalized.endDate < normalized.startDate) {
            normalized.endDate = normalized.startDate;
        }
        return normalized;
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    }

    function isISODate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
            && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
    }

    function loadSettings() {
        try {
            return normalizeSettings(GM_getValue(STORAGE_KEY, defaultSettings()));
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] 读取配置失败，已使用默认配置`, error);
            return defaultSettings();
        }
    }

    function saveSettings() {
        try {
            GM_setValue(STORAGE_KEY, state.settings);
        } catch (error) {
            log(`配置保存失败：${error.message}`, 'error');
        }
    }

    function escapeHTML(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('section');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <style>
                #${PANEL_ID} {
                    --lp-blue: #1664ff;
                    --lp-border: #d9e0eb;
                    --lp-muted: #64748b;
                    position: fixed;
                    z-index: 2147483645;
                    width: 342px;
                    right: 18px;
                    top: 90px;
                    color: #162033;
                    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
                    background: #fff;
                    border: 1px solid var(--lp-border);
                    border-radius: 12px;
                    box-shadow: 0 10px 32px rgba(15, 23, 42, .20);
                    overflow: hidden;
                }
                #${PANEL_ID}, #${PANEL_ID} * { box-sizing: border-box; }
                #${PANEL_ID}.lp-collapsed { width: 214px; }
                #${PANEL_ID}.lp-collapsed .lp-body { display: none; }
                #${PANEL_ID} .lp-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 10px 12px;
                    color: #fff;
                    background: linear-gradient(135deg, #1358dc, #4d85ff);
                    cursor: move;
                    user-select: none;
                    touch-action: none;
                }
                #${PANEL_ID} .lp-title { font-weight: 700; letter-spacing: .2px; }
                #${PANEL_ID} .lp-version { margin-left: 5px; opacity: .78; font-size: 11px; }
                #${PANEL_ID} .lp-collapse {
                    width: 27px; height: 27px; border: 0; border-radius: 7px;
                    color: #fff; background: rgba(255,255,255,.16); cursor: pointer;
                }
                #${PANEL_ID} .lp-body { max-height: calc(100vh - 118px); overflow: auto; padding: 11px; }
                #${PANEL_ID} fieldset {
                    margin: 0 0 9px; padding: 9px; border: 1px solid var(--lp-border); border-radius: 9px;
                }
                #${PANEL_ID} legend { padding: 0 5px; color: #334155; font-weight: 650; }
                #${PANEL_ID} .lp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
                #${PANEL_ID} .lp-grid-4 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
                #${PANEL_ID} label { display: flex; align-items: center; gap: 5px; min-width: 0; }
                #${PANEL_ID} .lp-check-option {
                    min-height: 34px; padding: 6px 8px; color: #334155; background: #f8fafc;
                    border: 1px solid #d6dfeb; border-radius: 7px; cursor: pointer; user-select: none;
                }
                #${PANEL_ID} .lp-radio-option {
                    min-height: 34px; padding: 6px 8px; color: #334155; background: #f8fafc;
                    border: 1px solid #d6dfeb; border-radius: 7px; cursor: pointer; user-select: none;
                }
                #${PANEL_ID} .lp-check-option:has(input[type="checkbox"]:checked) {
                    color: #124fc7; background: #edf4ff; border-color: #80aaff; font-weight: 700;
                    box-shadow: inset 0 0 0 1px rgba(22, 100, 255, .08);
                }
                #${PANEL_ID} .lp-radio-option:has(input[type="radio"]:checked) {
                    color: #124fc7; background: #edf4ff; border-color: #80aaff; font-weight: 700;
                    box-shadow: inset 0 0 0 1px rgba(22, 100, 255, .08);
                }
                #${PANEL_ID} input[type="radio"] {
                    appearance: none !important; -webkit-appearance: none !important;
                    position: relative !important; display: inline-grid !important; place-content: center;
                    flex: 0 0 18px; width: 18px !important; height: 18px !important; margin: 0 2px 0 0 !important;
                    opacity: 1 !important; visibility: visible !important;
                    background: #fff !important; border: 2px solid #8da0ba !important; border-radius: 50% !important;
                    cursor: pointer;
                }
                #${PANEL_ID} input[type="radio"]::after {
                    content: ""; width: 8px; height: 8px; background: #fff; border-radius: 50%;
                    transform: scale(0); transition: transform .08s ease;
                }
                #${PANEL_ID} input[type="radio"]:checked {
                    background: var(--lp-blue) !important; border-color: var(--lp-blue) !important;
                }
                #${PANEL_ID} input[type="radio"]:checked::after { transform: scale(1); }
                #${PANEL_ID} input[type="radio"]:focus-visible {
                    outline: 3px solid rgba(22, 100, 255, .25); outline-offset: 2px;
                }
                #${PANEL_ID} input[type="checkbox"] {
                    appearance: none !important; -webkit-appearance: none !important;
                    position: relative !important; display: inline-grid !important; place-content: center;
                    flex: 0 0 18px; width: 18px !important; height: 18px !important; margin: 0 2px 0 0 !important;
                    opacity: 1 !important; visibility: visible !important;
                    background: #fff !important; border: 2px solid #8da0ba !important; border-radius: 5px !important;
                    cursor: pointer;
                }
                #${PANEL_ID} input[type="checkbox"]::after {
                    content: "✓"; color: #fff; font: 800 14px/1 sans-serif;
                    transform: scale(0); transition: transform .08s ease;
                }
                #${PANEL_ID} input[type="checkbox"]:checked {
                    background: var(--lp-blue) !important; border-color: var(--lp-blue) !important;
                }
                #${PANEL_ID} input[type="checkbox"]:checked::after { transform: scale(1); }
                #${PANEL_ID} input[type="checkbox"]:focus-visible {
                    outline: 3px solid rgba(22, 100, 255, .25); outline-offset: 2px;
                }
                #${PANEL_ID} .lp-stack { display: grid; gap: 6px; }
                #${PANEL_ID} .lp-field { display: grid; grid-template-columns: 68px 1fr; align-items: center; gap: 6px; }
                #${PANEL_ID} input[type="text"],
                #${PANEL_ID} input[type="number"],
                #${PANEL_ID} input[type="date"],
                #${PANEL_ID} select {
                    width: 100%; min-width: 0; height: 30px; padding: 4px 7px;
                    color: #1e293b; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px;
                }
                #${PANEL_ID} input:focus { outline: 2px solid rgba(22,100,255,.18); border-color: var(--lp-blue); }
                #${PANEL_ID} .lp-dates { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #dbe3ee; }
                #${PANEL_ID} .lp-dates[hidden] { display: none; }
                #${PANEL_ID} .lp-tip { margin: 6px 0 0; color: var(--lp-muted); font-size: 11px; }
                #${PANEL_ID} .lp-buttons { display: grid; grid-template-columns: 1fr 1.3fr .7fr; gap: 6px; }
                #${PANEL_ID} .lp-btn {
                    height: 33px; padding: 0 8px; border: 1px solid #b8c5d8; border-radius: 7px;
                    color: #29405f; background: #f8fafc; font-weight: 650; cursor: pointer;
                }
                #${PANEL_ID} .lp-btn:hover:not(:disabled) { filter: brightness(.98); border-color: #7c93b2; }
                #${PANEL_ID} .lp-btn:disabled { cursor: not-allowed; opacity: .52; }
                #${PANEL_ID} .lp-primary { color: #fff; background: var(--lp-blue); border-color: var(--lp-blue); }
                #${PANEL_ID} .lp-danger { color: #b42318; background: #fff7f6; border-color: #f4b5af; }
                #${PANEL_ID} .lp-status-line {
                    display: flex; align-items: center; justify-content: space-between; gap: 8px;
                    margin-top: 9px; color: #334155;
                }
                #${PANEL_ID} .lp-progress {
                    height: 7px; margin: 5px 0 8px; overflow: hidden; background: #e8edf5; border-radius: 999px;
                }
                #${PANEL_ID} .lp-progress > i {
                    display: block; width: 0; height: 100%; background: linear-gradient(90deg, #1768ff, #55a2ff);
                    transition: width .2s ease;
                }
                #${PANEL_ID} .lp-log {
                    height: 145px; overflow: auto; padding: 7px; color: #d8e3f1; background: #111827;
                    border-radius: 8px; font: 11px/1.45 Consolas, "SFMono-Regular", monospace;
                    white-space: pre-wrap; word-break: break-word;
                }
                #${PANEL_ID} .lp-log .error { color: #ff9b96; }
                #${PANEL_ID} .lp-log .warn { color: #ffd479; }
                #${PANEL_ID} .lp-log .success { color: #77e2a9; }
            </style>
            <header class="lp-header">
                <div class="lp-title">${SCRIPT_NAME}<span class="lp-version">v${VERSION}</span></div>
                <button type="button" class="lp-collapse" title="折叠/展开">−</button>
            </header>
            <div class="lp-body">
                <fieldset>
                    <legend>时间</legend>
                    <div class="lp-grid-4">
                        <label class="lp-radio-option"><input type="radio" name="lp-time" value="one">近1天</label>
                        <label class="lp-radio-option"><input type="radio" name="lp-time" value="seven">近7天</label>
                        <label class="lp-radio-option"><input type="radio" name="lp-time" value="thirty">近30天</label>
                        <label class="lp-radio-option"><input type="radio" name="lp-time" value="natural">自然日</label>
                    </div>
                    <div class="lp-dates">
                        <div class="lp-stack">
                            <label class="lp-field"><span>开始日期</span><input type="date" data-setting="startDate"></label>
                            <label class="lp-field"><span>结束日期</span><input type="date" data-setting="endDate"></label>
                            <label class="lp-check-option"><input type="checkbox" data-setting="sameDay">当天（开始与结束日期相同）</label>
                        </div>
                        <p class="lp-tip">罗盘通常不提供今天的完整榜单数据，日期最大为昨天。</p>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>价格</legend>
                    <div class="lp-grid">
                        <label class="lp-stack"><span>最低价</span><input type="number" min="0" step="0.01" data-setting="minPrice" placeholder="不限"></label>
                        <label class="lp-stack"><span>最高价</span><input type="number" min="0" step="0.01" data-setting="maxPrice" placeholder="不限"></label>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>三级行业类目</legend>
                    <div class="lp-stack">
                        <label class="lp-field">
                            <span>快捷选项</span>
                            <select data-category-preset>
                                <option value="">自定义 / 不设置</option>
                                <option value="服饰内衣|服装|童装">服饰内衣 / 服装 / 童装</option>
                            </select>
                        </label>
                        <label class="lp-field"><span>一级类目</span><input type="text" data-category="0" placeholder="如：服饰内衣"></label>
                        <label class="lp-field"><span>二级类目</span><input type="text" data-category="1" placeholder="输入完整名称"></label>
                        <label class="lp-field"><span>三级类目</span><input type="text" data-category="2" placeholder="输入完整名称"></label>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>榜单</legend>
                    <div class="lp-grid-4">
                        ${RANKS.map((rank) => `<label class="lp-check-option"><input type="checkbox" data-rank="${rank.id}">${rank.label}</label>`).join('')}
                    </div>
                </fieldset>
                <fieldset>
                    <legend>高级等待设置</legend>
                    <div class="lp-stack">
                        <label class="lp-field"><span>加载超时</span><span><input type="number" min="5" max="300" data-setting="loadTimeoutSeconds"> 秒</span></label>
                        <label class="lp-field"><span>稳定等待</span><span><input type="number" min="1" max="60" data-setting="stableWaitSeconds"> 秒</span></label>
                    </div>
                </fieldset>
                <div class="lp-buttons">
                    <button type="button" class="lp-btn lp-apply">应用设置</button>
                    <button type="button" class="lp-btn lp-primary lp-start">开始一键导出</button>
                    <button type="button" class="lp-btn lp-danger lp-stop" disabled>停止</button>
                </div>
                <div class="lp-status-line"><span>状态：<b class="lp-status">就绪</b></span><span class="lp-progress-text">0%</span></div>
                <div class="lp-progress"><i></i></div>
                <div class="lp-log" aria-live="polite"></div>
            </div>`;

        document.documentElement.appendChild(panel);
        state.panel = panel;
        hydratePanel();
        bindPanelEvents();
        applyStoredPanelPosition();
        log(`脚本 v${VERSION} 已加载`, 'success');
    }

    function hydratePanel() {
        const panel = state.panel;
        const settings = state.settings;
        panel.querySelector(`input[name="lp-time"][value="${settings.timeMode}"]`).checked = true;
        panel.querySelector('[data-setting="startDate"]').value = settings.startDate;
        panel.querySelector('[data-setting="endDate"]').value = settings.endDate;
        panel.querySelector('[data-setting="sameDay"]').checked = settings.sameDay;
        panel.querySelector('[data-setting="minPrice"]').value = settings.minPrice;
        panel.querySelector('[data-setting="maxPrice"]').value = settings.maxPrice;
        panel.querySelector('[data-setting="loadTimeoutSeconds"]').value = settings.loadTimeoutSeconds;
        panel.querySelector('[data-setting="stableWaitSeconds"]').value = settings.stableWaitSeconds;
        settings.categories.forEach((value, index) => {
            panel.querySelector(`[data-category="${index}"]`).value = value;
        });
        updateCategoryPresetUI();
        RANKS.forEach((rank) => {
            panel.querySelector(`[data-rank="${rank.id}"]`).checked = Boolean(settings.ranks[rank.id]);
        });
        panel.querySelectorAll('input[type="date"]').forEach((input) => {
            input.max = yesterdayISO();
        });
        state.lastValidStartDate = settings.startDate;
        updateNaturalDateVisibility();
        updateSameDayUI();
        panel.classList.toggle('lp-collapsed', settings.ui.collapsed);
        panel.querySelector('.lp-collapse').textContent = settings.ui.collapsed ? '+' : '−';
    }

    function bindPanelEvents() {
        const panel = state.panel;
        panel.addEventListener('change', handlePanelChange);
        panel.querySelector('.lp-apply').addEventListener('click', () => runApplyOnly());
        panel.querySelector('.lp-start').addEventListener('click', () => runBatchExport());
        panel.querySelector('.lp-stop').addEventListener('click', requestStop);
        panel.querySelector('.lp-collapse').addEventListener('click', (event) => {
            event.stopPropagation();
            state.settings.ui.collapsed = !state.settings.ui.collapsed;
            panel.classList.toggle('lp-collapsed', state.settings.ui.collapsed);
            event.currentTarget.textContent = state.settings.ui.collapsed ? '+' : '−';
            saveSettings();
        });
        bindDragging(panel.querySelector('.lp-header'));
    }

    function handlePanelChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;

        if (target.dataset.categoryPreset !== undefined) {
            const categories = target.value ? target.value.split('|') : ['', '', ''];
            state.settings.categories = categories;
            categories.forEach((value, index) => {
                state.panel.querySelector(`[data-category="${index}"]`).value = value;
            });
            log(
                target.value
                    ? `已选择行业类目快捷项：${categories.join(' / ')}。`
                    : '已切换为自定义类目，可手动填写或全部留空。'
            );
        } else if (target.name === 'lp-time') {
            state.settings.timeMode = target.value;
            updateNaturalDateVisibility();
        } else if (target.dataset.setting === 'startDate') {
            if (!acceptDateChange(target, true)) return;
            state.settings.startDate = target.value;
            state.lastValidStartDate = target.value;
            if (state.settings.sameDay) {
                state.settings.endDate = target.value;
                state.panel.querySelector('[data-setting="endDate"]').value = target.value;
            } else if (state.settings.endDate < target.value) {
                state.settings.endDate = target.value;
                state.panel.querySelector('[data-setting="endDate"]').value = target.value;
            }
        } else if (target.dataset.setting === 'endDate') {
            if (!acceptDateChange(target, false)) return;
            if (state.settings.sameDay) {
                target.value = state.settings.startDate;
                state.settings.endDate = state.settings.startDate;
            } else if (target.value < state.settings.startDate) {
                log('结束日期不能早于开始日期，已恢复为开始日期。', 'warn');
                target.value = state.settings.startDate;
                state.settings.endDate = state.settings.startDate;
            } else {
                state.settings.endDate = target.value;
            }
        } else if (target.dataset.setting === 'sameDay') {
            if (target.checked && state.settings.startDate >= todayISO()) {
                target.checked = false;
                log('“当天”模式不能使用今天；请先选择昨天或更早的开始日期。', 'error');
                return;
            }
            state.settings.sameDay = target.checked;
            if (target.checked) {
                state.settings.endDate = state.settings.startDate;
                state.panel.querySelector('[data-setting="endDate"]').value = state.settings.startDate;
            }
            updateSameDayUI();
        } else if (target.dataset.setting === 'minPrice' || target.dataset.setting === 'maxPrice') {
            state.settings[target.dataset.setting] = target.value;
        } else if (target.dataset.setting === 'loadTimeoutSeconds') {
            state.settings.loadTimeoutSeconds = clampNumber(target.value, 5, 300, 30);
            target.value = state.settings.loadTimeoutSeconds;
        } else if (target.dataset.setting === 'stableWaitSeconds') {
            state.settings.stableWaitSeconds = clampNumber(target.value, 1, 60, 3);
            target.value = state.settings.stableWaitSeconds;
        } else if (target.dataset.category !== undefined) {
            state.settings.categories[Number(target.dataset.category)] = normalizeText(target.value);
            target.value = state.settings.categories[Number(target.dataset.category)];
            updateCategoryPresetUI();
        } else if (target.dataset.rank) {
            state.settings.ranks[target.dataset.rank] = target.checked;
        }
        saveSettings();
    }

    function updateCategoryPresetUI() {
        const preset = state.panel?.querySelector('[data-category-preset]');
        if (!preset) return;
        const path = state.settings.categories.join('|');
        preset.value = Array.from(preset.options).some((option) => option.value === path) ? path : '';
    }

    function acceptDateChange(input, isStart) {
        const fallback = isStart ? state.lastValidStartDate : state.settings.endDate;
        if (!isISODate(input.value)) {
            input.value = fallback;
            log('日期格式无效，已恢复上一次有效日期。', 'error');
            return false;
        }
        if (input.value >= todayISO()) {
            input.value = fallback;
            log('不能选择今天或未来日期，已恢复上一次有效日期。', 'error');
            return false;
        }
        return true;
    }

    function updateNaturalDateVisibility() {
        state.panel.querySelector('.lp-dates').hidden = state.settings.timeMode !== 'natural';
    }

    function updateSameDayUI() {
        const endInput = state.panel.querySelector('[data-setting="endDate"]');
        endInput.disabled = state.settings.sameDay;
        endInput.title = state.settings.sameDay ? '当天模式下，结束日期自动跟随开始日期' : '';
    }

    function applyStoredPanelPosition() {
        const {left, top} = state.settings.ui;
        if (Number.isFinite(Number(left))) {
            state.panel.style.left = `${Math.max(0, Number(left))}px`;
            state.panel.style.right = 'auto';
        }
        if (Number.isFinite(Number(top))) {
            state.panel.style.top = `${Math.max(0, Number(top))}px`;
        }
        keepPanelInViewport();
    }

    function keepPanelInViewport() {
        const rect = state.panel.getBoundingClientRect();
        const left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - rect.width));
        const top = Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - 42));
        state.panel.style.left = `${left}px`;
        state.panel.style.top = `${top}px`;
        state.panel.style.right = 'auto';
    }

    function bindDragging(handle) {
        let drag = null;
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.target.closest('button')) return;
            const rect = state.panel.getBoundingClientRect();
            drag = {pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top};
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener('pointermove', (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const left = Math.min(Math.max(0, event.clientX - drag.offsetX), Math.max(0, window.innerWidth - state.panel.offsetWidth));
            const top = Math.min(Math.max(0, event.clientY - drag.offsetY), Math.max(0, window.innerHeight - 42));
            state.panel.style.left = `${left}px`;
            state.panel.style.top = `${top}px`;
            state.panel.style.right = 'auto';
        });
        const endDrag = (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            drag = null;
            const rect = state.panel.getBoundingClientRect();
            state.settings.ui.left = Math.round(rect.left);
            state.settings.ui.top = Math.round(rect.top);
            saveSettings();
        };
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
        window.addEventListener('resize', keepPanelInViewport);
    }

    function log(message, level = 'info') {
        const now = new Date();
        const stamp = now.toLocaleTimeString('zh-CN', {hour12: false});
        state.logs.push({stamp, message: String(message), level});
        if (state.logs.length > LOG_LIMIT) state.logs.splice(0, state.logs.length - LOG_LIMIT);
        console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${SCRIPT_NAME}] ${message}`);
        if (!state.panel) return;
        const logBox = state.panel.querySelector('.lp-log');
        logBox.innerHTML = state.logs
            .map((item) => `<div class="${item.level}">[${escapeHTML(item.stamp)}] ${escapeHTML(item.message)}</div>`)
            .join('');
        logBox.scrollTop = logBox.scrollHeight;
    }

    function setStatus(text) {
        if (state.panel) state.panel.querySelector('.lp-status').textContent = text;
    }

    function setProgress(completed, total, detail = '') {
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        state.panel.querySelector('.lp-progress > i').style.width = `${percent}%`;
        state.panel.querySelector('.lp-progress-text').textContent = detail ? `${percent}% · ${detail}` : `${percent}%`;
    }

    function setRunning(running) {
        state.running = running;
        state.panel.querySelector('.lp-apply').disabled = running;
        state.panel.querySelector('.lp-start').disabled = running;
        state.panel.querySelector('.lp-stop').disabled = !running;
    }

    function requestStop() {
        if (!state.running) return;
        state.stopRequested = true;
        state.abortController?.abort();
        setStatus('正在停止');
        log('已收到停止请求，将中止当前等待和后续榜单。', 'warn');
    }

    function assertRunning() {
        if (state.stopRequested || state.abortController?.signal.aborted) {
            throw new TaskStoppedError('任务已由用户停止');
        }
    }

    class TaskStoppedError extends Error {
        constructor(message) {
            super(message);
            this.name = 'TaskStoppedError';
        }
    }

    async function waitFor(getter, options) {
        const description = options.description;
        const timeoutMs = options.timeoutMs ?? state.settings.loadTimeoutSeconds * 1000;
        const intervalMs = options.intervalMs ?? POLL_INTERVAL;
        const predicate = options.predicate || ((value) => Boolean(value));
        const started = Date.now();
        let lastReason = '';

        while (Date.now() - started <= timeoutMs) {
            assertRunning();
            try {
                const value = await getter();
                if (predicate(value)) return value;
                if (value && typeof value === 'object' && value.reason) lastReason = value.reason;
            } catch (error) {
                if (error instanceof TaskStoppedError) throw error;
                lastReason = error.message;
            }
            await delay(intervalMs);
        }
        const seconds = (timeoutMs / 1000).toFixed(timeoutMs % 1000 ? 1 : 0);
        const suffix = lastReason ? `；最后一次检测：${lastReason}` : '';
        throw new Error(`等待「${description}」超时（已等待 ${seconds} 秒）${suffix}`);
    }

    function delay(milliseconds) {
        return new Promise((resolve, reject) => {
            const signal = state.abortController?.signal;
            if (signal?.aborted) {
                reject(new TaskStoppedError('任务已由用户停止'));
                return;
            }
            const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, milliseconds);
            const onAbort = () => {
                clearTimeout(timer);
                reject(new TaskStoppedError('任务已由用户停止'));
            };
            signal?.addEventListener('abort', onAbort, {once: true});
        });
    }

    async function tryWaitFor(getter, options) {
        try {
            return await waitFor(getter, options);
        } catch (error) {
            if (error instanceof TaskStoppedError) throw error;
            return null;
        }
    }

    function isVisible(element) {
        if (!(element instanceof Element) || !element.isConnected) return false;
        const view = element.ownerDocument.defaultView;
        const style = view.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isDisabled(element) {
        return Boolean(
            element.disabled
            || element.getAttribute('aria-disabled') === 'true'
            || element.getAttribute('data-disabled') === 'true'
            || /\b(disabled|is-disabled)\b/i.test(element.className || '')
        );
    }

    function closestClickable(element) {
        return element?.closest('button, a, label, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="gridcell"]')
            || element;
    }

    function clickElement(element, description, {scroll = true} = {}) {
        const target = closestClickable(element);
        if (!target) throw new Error(`${description}：DOM 元素不存在`);
        if (scroll) target.scrollIntoView({block: 'center', inline: 'center'});
        if (!isVisible(target)) throw new Error(`${description}：元素存在但不可见（${describeElement(target)}）`);
        if (isDisabled(target)) throw new Error(`${description}：元素处于禁用状态（${describeElement(target)}）`);
        target.focus?.({preventScroll: true});
        // 使用页面元素的原生 click，不构造带隔离环境 view 的 MouseEvent。
        target.click();
        return target;
    }

    function dispatchPageActivationSequence(
        element,
        description,
        {scroll = true, focus = true} = {}
    ) {
        if (!element) throw new Error(`${description}：DOM 元素不存在`);
        if (scroll) element.scrollIntoView({block: 'center', inline: 'center'});
        if (!isVisible(element)) throw new Error(`${description}：元素存在但不可见（${describeElement(element)}）`);
        if (isDisabled(element)) throw new Error(`${description}：元素处于禁用状态（${describeElement(element)}）`);
        if (focus) element.focus?.({preventScroll: true});

        const view = element.ownerDocument.defaultView;
        const rect = element.getBoundingClientRect();
        const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            button: 0,
        };
        if (typeof view.PointerEvent === 'function') {
            element.dispatchEvent(new view.PointerEvent('pointerdown', {
                ...common,
                buttons: 1,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
            }));
        }
        // 不设置 MouseEvent.view，避免把用户脚本隔离环境 window 传给 React。
        element.dispatchEvent(new view.MouseEvent('mousedown', {...common, buttons: 1}));
        if (typeof view.PointerEvent === 'function') {
            element.dispatchEvent(new view.PointerEvent('pointerup', {
                ...common,
                buttons: 0,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
            }));
        }
        element.dispatchEvent(new view.MouseEvent('mouseup', {...common, buttons: 0}));
        element.click();
        return element;
    }

    function dispatchPageHover(element, description, {scroll = true} = {}) {
        if (!element) throw new Error(`${description}：DOM 元素不存在`);
        if (scroll) element.scrollIntoView({block: 'center', inline: 'center'});
        if (!isVisible(element)) throw new Error(`${description}：元素存在但不可见（${describeElement(element)}）`);
        if (isDisabled(element)) throw new Error(`${description}：元素处于禁用状态（${describeElement(element)}）`);

        const view = element.ownerDocument.defaultView;
        const rect = element.getBoundingClientRect();
        const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            relatedTarget: null,
        };
        if (typeof view.PointerEvent === 'function') {
            element.dispatchEvent(new view.PointerEvent('pointerover', {
                ...common,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
            }));
            element.dispatchEvent(new view.PointerEvent('pointerenter', {
                ...common,
                bubbles: false,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
            }));
        }
        // React 的 onMouseEnter 由 mouseover/mouseout 事件系统合成；不设置 view。
        element.dispatchEvent(new view.MouseEvent('mouseover', common));
        element.dispatchEvent(new view.MouseEvent('mouseenter', {...common, bubbles: false}));
        return element;
    }

    function describeElement(element) {
        if (!element) return 'null';
        const tag = element.tagName?.toLowerCase() || 'unknown';
        const id = element.id ? `#${element.id}` : '';
        const classes = typeof element.className === 'string'
            ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
            : '';
        const attrs = ['role', 'data-key', 'data-node-key', 'data-testid', 'aria-label']
            .map((name) => element.getAttribute?.(name) ? `${name}="${element.getAttribute(name)}"` : '')
            .filter(Boolean)
            .join(' ');
        return `<${tag}${id}${classes}${attrs ? ` ${attrs}` : ''}>`;
    }

    function queryVisibleAll(selector, root = document) {
        try {
            return Array.from(root.querySelectorAll(selector)).filter(isVisible);
        } catch (error) {
            return [];
        }
    }

    function elementSignal(element) {
        if (!element) return '';
        const attributes = [
            'id', 'name', 'value', 'href', 'role', 'aria-label', 'title',
            'data-key', 'data-node-key', 'data-tab', 'data-value', 'data-testid', 'data-action',
        ];
        return normalizeText([
            ...attributes.map((name) => element.getAttribute?.(name) || ''),
            typeof element.className === 'string' ? element.className : '',
            element.textContent || '',
        ].join(' ')).toLowerCase();
    }

    function isActiveControl(element) {
        const target = closestClickable(element);
        const signal = `${elementSignal(element)} ${elementSignal(target?.parentElement)}`;
        return Boolean(
            element.checked
            || target?.getAttribute('aria-selected') === 'true'
            || target?.getAttribute('aria-checked') === 'true'
            || target?.getAttribute('data-state') === 'active'
            || /\b(active|selected|checked|is-active|is-selected)\b/i.test(signal)
        );
    }

    function selectedRanks() {
        return RANKS.filter((rank) => state.settings.ranks[rank.id]);
    }

    function validateSettings() {
        const ranks = selectedRanks();
        if (!ranks.length) throw new Error('请至少勾选一个榜单。');
        if (state.settings.timeMode === 'natural') {
            if (!isISODate(state.settings.startDate) || !isISODate(state.settings.endDate)) {
                throw new Error('自然日的开始日期和结束日期必须完整。');
            }
            if (state.settings.startDate >= todayISO() || state.settings.endDate >= todayISO()) {
                throw new Error('自然日不能选择今天或未来日期。');
            }
            if (state.settings.endDate < state.settings.startDate) {
                throw new Error('自然日结束日期不能早于开始日期。');
            }
        }
        const min = state.settings.minPrice === '' ? null : Number(state.settings.minPrice);
        const max = state.settings.maxPrice === '' ? null : Number(state.settings.maxPrice);
        if (min !== null && (!Number.isFinite(min) || min < 0)) throw new Error('最低价必须是非负数字。');
        if (max !== null && (!Number.isFinite(max) || max < 0)) throw new Error('最高价必须是非负数字。');
        if (min !== null && max !== null && min > max) throw new Error('最低价不能高于最高价。');
        const nonEmptyCategories = state.settings.categories.filter(Boolean);
        if (nonEmptyCategories.length > 0 && nonEmptyCategories.length < 3) {
            throw new Error('行业类目需填写完整的一级、二级、三级名称，或全部留空。');
        }
        return ranks;
    }

    async function withTask(task) {
        if (state.running) {
            log('已有任务正在运行。', 'warn');
            return;
        }
        try {
            validateSettings();
        } catch (error) {
            setStatus('配置有误');
            log(error.message, 'error');
            return;
        }

        state.stopRequested = false;
        state.abortController = new AbortController();
        setRunning(true);
        try {
            await task();
        } catch (error) {
            if (error instanceof TaskStoppedError) {
                setStatus('已停止');
                log('任务已停止。', 'warn');
            } else {
                setStatus('失败');
                log(`任务失败：${error.message}`, 'error');
                console.error(`[${SCRIPT_NAME}] 任务异常`, error);
            }
        } finally {
            setRunning(false);
            state.abortController = null;
        }
    }

    function runApplyOnly() {
        return withTask(async () => {
            const ranks = selectedRanks();
            const rank = findCurrentlyActiveRank(ranks) || ranks[0];
            setProgress(0, 1, rank.label);
            setStatus(`应用 ${rank.label}`);
            log(`“应用设置”将作用于${rank.label}。`);
            await applySettingsForRank(rank);
            setProgress(1, 1, rank.label);
            setStatus('设置已应用');
            log(`${rank.label}设置应用完成。`, 'success');
        });
    }

    function runBatchExport() {
        return withTask(async () => {
            const ranks = selectedRanks();
            setProgress(0, ranks.length);
            log(`开始一键导出，共 ${ranks.length} 个榜单：${ranks.map((rank) => rank.label).join('、')}`);

            for (let index = 0; index < ranks.length; index += 1) {
                assertRunning();
                const rank = ranks[index];
                setStatus(`处理 ${rank.label}`);
                setProgress(index, ranks.length, rank.label);
                log(`—— 开始处理 ${rank.label}（${index + 1}/${ranks.length}）——`);
                await applySettingsForRank(rank);
                await exportCurrentRank(rank);
                setProgress(index + 1, ranks.length, rank.label);
                log(`${rank.label}导出指令已提交。`, 'success');
            }
            setStatus('全部完成');
            setProgress(ranks.length, ranks.length, '完成');
            log('所有已勾选榜单均已完成导出。', 'success');
        });
    }

    async function applySettingsForRank(rank) {
        log(`[1/5] 切换到${rank.label}…`);
        await switchRank(rank);
        log(`[2/5] 设置时间…`);
        await setPageTime();
        log(`[3/5] 设置价格…`);
        await setPagePrice();
        log(`[4/5] 设置三级行业类目…`);
        await setPageCategory();
        log(`[5/5] 等待${rank.label}筛选结果稳定…`);
        await waitForStableResult(document, `${rank.label}筛选结果稳定`);
    }

    function rankCandidateScore(element, rank) {
        const signal = elementSignal(element);
        let score = 0;
        for (const key of rank.keys) {
            if (signal.includes(key.toLowerCase())) score += 12;
        }
        if (signal.includes(rank.label)) score += 5;
        if (element.matches?.('[role="tab"], [data-node-key], [data-key], [data-tab]')) score += 8;
        if (element.matches?.('a[href*="rank-product"]')) score += 6;
        if (isActiveControl(element)) score += 2;
        return score;
    }

    function findRankControl(rank) {
        const candidates = new Set();
        for (const selector of rank.stableSelectors) {
            queryVisibleAll(selector).forEach((element) => candidates.add(closestClickable(element)));
        }
        queryVisibleAll('[role="tab"], [data-node-key], [data-key], [data-tab], a[href*="rank-product"], button')
            .filter((element) => normalizeText(element.textContent).includes(rank.label))
            .forEach((element) => candidates.add(closestClickable(element)));
        return Array.from(candidates)
            .filter((element) => isVisible(element) && !state.panel.contains(element))
            .sort((a, b) => rankCandidateScore(b, rank) - rankCandidateScore(a, rank))[0] || null;
    }

    function findCurrentlyActiveRank(allowed = RANKS) {
        return allowed.find((rank) => {
            const element = findRankControl(rank);
            return element && isActiveControl(element);
        }) || null;
    }

    async function switchRank(rank) {
        const control = await waitFor(
            () => {
                const element = findRankControl(rank);
                return element || {reason: `未找到${rank.label}控件；已检查 role=tab、data-key/data-node-key、href 和可见按钮`};
            },
            {description: `${rank.label}切换控件`}
        );
        if (isActiveControl(control)) {
            log(`${rank.label}已处于选中状态，无需重复切换。`);
            return;
        }
        const previousURL = location.href;
        clickElement(control, `点击${rank.label}`);
        await waitFor(
            () => {
                const latest = findRankControl(rank);
                if (latest && isActiveControl(latest)) return latest;
                const lowerURL = location.href.toLowerCase();
                if (location.href !== previousURL && rank.keys.some((key) => lowerURL.includes(key))) return true;
                return {reason: `${rank.label}控件尚未呈现 active/selected/aria-selected 状态，URL 也未切换到对应榜单`};
            },
            {description: `${rank.label}切换生效`}
        );
        log(`已切换到${rank.label}。`, 'success');
    }

    async function setPageTime() {
        const mode = state.settings.timeMode;
        const pageValue = TIME_VALUE[mode];
        const radio = await waitFor(
            () => {
                const matches = Array.from(document.querySelectorAll(
                    `.ecom-radio-button-input[value="${pageValue}"]`
                ));
                const input = matches.find((element) => {
                    const wrapper = element.closest('label, .ecom-radio-button, [role="radio"]');
                    return isVisible(element) || isVisible(wrapper);
                });
                return input || {
                    reason: `未找到 .ecom-radio-button-input[value="${pageValue}"]，或输入节点及其 radio/label 包装均不可见`,
                };
            },
            {description: `时间选项 value="${pageValue}"`}
        );
        const clickable = radio.closest('label')
            || radio.closest('[role="radio"]')
            || radio.closest('.ecom-radio-button')
            || radio;
        if (!isActiveControl(radio) && !isActiveControl(clickable)) {
            clickElement(clickable, `选择时间 ${mode}`);
            await waitFor(
                () => isActiveControl(radio) || isActiveControl(clickable)
                    || {reason: `.ecom-radio-button-input[value="${pageValue}"] 尚未变为 checked/active`},
                {description: `时间选项 ${pageValue} 选中`}
            );
        }

        if (mode !== 'natural') {
            const label = {one: '近1天', seven: '近7天', thirty: '近30天'}[mode];
            log(`已通过稳定 value="${pageValue}" 选择${label}。`, 'success');
            return;
        }

        log('已选择“更多”，准备使用罗盘页面日期日历设置自然日。');
        const calendar = await openNaturalDateCalendar(radio);
        const reopenCalendar = () => openNaturalDateCalendar(radio);
        await selectDateFromCalendar(state.settings.startDate, calendar, '开始日期', reopenCalendar);
        const secondCalendar = getCalendarRoots()[0] || await openNaturalDateCalendar(radio);
        await selectDateFromCalendar(state.settings.endDate, secondCalendar, '结束日期', reopenCalendar);
        log(`已在罗盘日历中选择 ${state.settings.startDate} 至 ${state.settings.endDate}。`, 'success');
    }

    function getCalendarRoots() {
        const selectors = [
            '.ecom-date-picker-panel-container',
            '.ecom-picker-panel-container',
            '.ecom-date-picker-dropdown',
            '.ecom-dorami-date-picker-panel-with-border',
            '.ecom-dorami-date-picker-show-more-dropdown-panel-wrapper',
            '.aurora-picker-panel-container',
            '.aurora-picker-dropdown',
            '.aurora-date-picker-dropdown',
            '[class*="ecom-dorami-date-picker"][class*="panel"]',
            '[data-testid*="calendar" i]',
            '[data-testid*="date-picker" i]',
            '[class*="calendar"][class*="popup"]',
            '[class*="date-picker"][class*="dropdown"]',
            '[class*="picker"][class*="dropdown"]',
            '[role="dialog"]',
        ].join(',');
        return queryVisibleAll(selectors)
            .filter((root) => !state.panel.contains(root))
            .filter((root) => {
                const stableDateCell = root.querySelector(
                    '[data-date], [data-day], [datetime], [class*="calendar-cell"], [class*="picker-cell"], [class*="date-cell"], [role="gridcell"]'
                );
                if (stableDateCell) return true;
                const hasTableCell = Boolean(root.querySelector('td'));
                return hasTableCell && getDisplayedMonths(root).length > 0;
            })
            .filter((root, index, roots) =>
                !roots.some((child, childIndex) => childIndex !== index && root.contains(child))
            );
    }

    function calendarRootFingerprint(root) {
        if (!root || !root.isConnected || !isVisible(root)) return '';
        const months = getDisplayedMonths(root)
            .map((item) => `${item.year}-${String(item.month).padStart(2, '0')}`)
            .join('|');
        const cells = root.querySelectorAll(
            '[data-date], [data-day], [datetime], [class*="calendar-cell"], [class*="picker-cell"], [class*="date-cell"], [role="gridcell"], td'
        );
        const dateSignals = Array.from(cells).slice(0, 8).map((cell) =>
            normalizeText([
                cell.getAttribute('title'),
                cell.getAttribute('data-date'),
                cell.getAttribute('data-value'),
                cell.getAttribute('aria-label'),
                cell.textContent,
            ].filter(Boolean).join(' '))
        ).join('|');
        return `${months}#${cells.length}#${dateSignals}`;
    }

    async function waitForStableCalendar(description, timeoutMs = 3500) {
        const started = Date.now();
        let lastFingerprint = '';
        let stableSince = 0;
        let lastReason = '尚未检测到日期日历';

        while (Date.now() - started <= timeoutMs) {
            assertRunning();
            const root = getCalendarRoots()[0];
            const fingerprint = calendarRootFingerprint(root);
            if (!root || !fingerprint) {
                lastFingerprint = '';
                stableSince = 0;
                lastReason = '没有可见且包含日期格的稳定日历容器';
            } else if (fingerprint !== lastFingerprint) {
                lastFingerprint = fingerprint;
                stableSince = Date.now();
                lastReason = '日历刚出现或日期格仍在重绘';
            } else if (Date.now() - stableSince >= 600) {
                return root;
            } else {
                lastReason = `日历已连续稳定 ${((Date.now() - stableSince) / 1000).toFixed(1)} 秒`;
            }
            await delay(120);
        }
        throw new Error(`等待「${description}」超时（已等待 ${(timeoutMs / 1000).toFixed(1)} 秒）；最后一次检测：${lastReason}`);
    }

    async function tryWaitForStableCalendar(description, timeoutMs) {
        try {
            return await waitForStableCalendar(description, timeoutMs);
        } catch (error) {
            if (error instanceof TaskStoppedError) throw error;
            return null;
        }
    }

    function getDateTriggerNearTime(radio) {
        const section = radio.closest('form, [class*="filter"], [class*="condition"], section, main') || document;
        const candidates = queryVisibleAll([
            '[data-testid*="date" i]',
            '[data-testid*="calendar" i]',
            '[data-field*="date" i]',
            '[class*="range-picker"]',
            '[class*="date-picker"]',
            '[aria-haspopup="dialog"]',
            '[aria-haspopup="grid"]',
        ].join(','), section)
            .filter((element) => !element.closest(`#${PANEL_ID}`))
            .map(closestClickable)
            .filter((element, index, array) => element && array.indexOf(element) === index)
            .filter((element) => !element.matches('input[type="text"], input[type="date"]'));
        return candidates.find((element) => {
            const signal = elementSignal(element);
            return /date|calendar|range|picker|日期|日历/.test(signal);
        }) || candidates[0] || null;
    }

    function getNaturalDayMenuOption() {
        const popups = queryVisibleAll([
            '[role="menu"]',
            '[role="listbox"]',
            '.ecom-dropdown-menu',
            '[class*="popover"]',
            '[class*="dropdown"]',
        ].join(',')).filter((element) => !state.panel.contains(element));
        const candidates = popups.flatMap((popup) => queryVisibleAll(
            '[role="menuitem"], [role="option"], li, button, [data-value], [data-key]',
            popup
        ));
        return candidates
            .map((element) => {
                const signal = elementSignal(element);
                let score = 0;
                if (/(natural|custom|calendar|date-range|day-range)/i.test(signal)) score += 10;
                if (normalizeText(element.textContent).includes('自然日')) score += 5;
                return {element, score};
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)[0]?.element || null;
    }

    async function openNaturalDateCalendar(radio) {
        // 选择开始日期后 React 会重建整组时间控件，调用方保存的 radio
        // 可能已经脱离 DOM；每次重开日历都重新取得当前的 value="more"。
        const liveRadio = Array.from(
            document.querySelectorAll('.ecom-radio-button-input[value="more"]')
        ).find((input) => {
            const wrapper = input.closest('label')
                || input.closest('[role="radio"]')
                || input.closest('.ecom-radio-button')
                || input;
            return input.isConnected && isVisible(wrapper);
        });
        if (liveRadio) radio = liveRadio;

        const alreadyOpen = await tryWaitFor(
            () => {
                const root = getCalendarRoots()[0];
                return root && calendarRootFingerprint(root) ? root : null;
            },
            {description: '已打开的日期日历', timeoutMs: 500}
        );
        if (alreadyOpen) {
            const stableOpen = await tryWaitForStableCalendar('已打开的日期日历稳定', 1800);
            if (stableOpen) return stableOpen;
        }

        const direct = await tryWaitForStableCalendar('“更多”直接展示的日期日历稳定', 1800);
        if (direct) return direct;

        let menuOption = getNaturalDayMenuOption();
        if (!menuOption) {
            const moreTrigger = radio.closest('label')
                || radio.closest('[role="radio"]')
                || radio.closest('.ecom-radio-button')
                || radio;
            dispatchPageHover(moreTrigger, '悬停展开“更多”时间菜单');
            menuOption = await tryWaitFor(
                () => getNaturalDayMenuOption(),
                {description: '悬停“更多”后的自然日菜单项', timeoutMs: 1800}
            );
            if (menuOption) {
                log('已通过悬停展开“更多”时间菜单并定位到“自然日”。');
            }
        }
        if (!menuOption) {
            const moreTrigger = radio.closest('label')
                || radio.closest('[role="radio"]')
                || radio.closest('.ecom-radio-button')
                || radio;
            clickElement(moreTrigger, '展开“更多”时间菜单');
            menuOption = await tryWaitFor(
                () => getNaturalDayMenuOption(),
                {description: '“更多”菜单中的自然日选项', timeoutMs: 1600}
            );
            if (!menuOption) {
                if (!isVisible(moreTrigger) || isDisabled(moreTrigger) || isDisabled(radio)) {
                    throw new Error(
                        `“更多”时间菜单无法展开：外层控件不可见或已禁用（${describeElement(moreTrigger)}）`
                    );
                }
                moreTrigger.scrollIntoView({block: 'center', inline: 'center'});
                radio.focus?.({preventScroll: true});
                // Aurora/ecom 的二级菜单事件可能绑定在内部 input 上；
                // 原生 click 会向 React 正常冒泡，且不传隔离环境 window。
                radio.click();
                menuOption = await tryWaitFor(
                    () => getNaturalDayMenuOption(),
                    {description: '内部 radio 点击后的自然日菜单项', timeoutMs: 1800}
                );
            }
            if (!menuOption) {
                const eventTargets = [
                    moreTrigger,
                    moreTrigger.querySelector?.(
                        '.ecom-radio-button-label, [class*="radio-button-label"], [class*="radio-label"], span'
                    ),
                ].filter((element, index, array) =>
                    element && array.indexOf(element) === index && isVisible(element) && !isDisabled(element)
                );
                for (const target of eventTargets) {
                    dispatchPageActivationSequence(target, '通过完整事件序列展开“更多”时间菜单');
                    menuOption = await tryWaitFor(
                        () => getNaturalDayMenuOption(),
                        {description: '完整点击事件后的自然日菜单项', timeoutMs: 1200}
                    );
                    if (menuOption) break;
                }
            }
            if (menuOption) {
                log('已展开“更多”时间菜单并定位到“自然日”。');
            }
        }

        if (menuOption) {
            dispatchPageHover(menuOption, '悬停自然日菜单项', {scroll: false});
            dispatchPageActivationSequence(
                menuOption,
                '选择自然日菜单项',
                {scroll: false, focus: false}
            );
        } else {
            const trigger = getDateTriggerNearTime(radio);
            if (!trigger) {
                throw new Error(
                    '自然日日期日历定位失败：已再次点击 value="more" 展开二级菜单，但未找到自然日菜单项，也未找到带 date/calendar/range 稳定特征的日期触发器。'
                );
            }
            clickElement(trigger, '打开罗盘自然日日期日历');
            const optionAfterOpen = await tryWaitFor(
                () => getNaturalDayMenuOption(),
                {description: '自然日菜单项', timeoutMs: 1600}
            );
            if (optionAfterOpen && !getCalendarRoots()[0]) {
                dispatchPageHover(optionAfterOpen, '悬停自然日菜单项', {scroll: false});
                dispatchPageActivationSequence(
                    optionAfterOpen,
                    '选择自然日菜单项',
                    {scroll: false, focus: false}
                );
            }
        }

        return waitForStableCalendar('罗盘自然日日期日历稳定显示');
    }

    function dateRepresentations(isoDate) {
        const [year, month, day] = isoDate.split('-').map(Number);
        return [
            isoDate,
            `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
            `${year}/${month}/${day}`,
            `${year}年${month}月${day}日`,
            `${year}-${month}-${day}`,
        ];
    }

    function findDateCellByFullAttribute(root, isoDate) {
        const representations = dateRepresentations(isoDate);
        const elements = Array.from(root.querySelectorAll(
            '[title], [data-date], [data-value], [data-day], [datetime], [aria-label]'
        ));
        for (const element of elements) {
            const values = ['title', 'data-date', 'data-value', 'data-day', 'datetime', 'aria-label']
                .map((name) => element.getAttribute(name))
                .filter(Boolean);
            if (values.some((value) => representations.some((form) => String(value).includes(form)))) {
                return closestDateCell(element);
            }
        }
        return null;
    }

    function closestDateCell(element) {
        return element.closest(
            '[role="gridcell"], td, button, [class*="calendar-cell"], [class*="picker-cell"], [class*="date-cell"]'
        ) || element;
    }

    function isDateCellDisabled(cell) {
        const signal = elementSignal(cell);
        return isDisabled(cell)
            || cell.getAttribute('aria-selected') === 'false' && cell.getAttribute('aria-disabled') === 'true'
            || /\b(disabled|is-disabled|unavailable)\b/i.test(signal);
    }

    function monthKey(year, month) {
        return year * 12 + month - 1;
    }

    function parseMonthsFromText(text) {
        const value = normalizeText(text);
        const months = [];
        const chinesePattern = /(\d{4})\s*年\s*(\d{1,2})\s*月/g;
        const numericPattern = /(\d{4})\s*[-/.]\s*(\d{1,2})(?!\s*[-/.]\s*\d)/g;
        let match;
        while ((match = chinesePattern.exec(value))) {
            months.push({year: Number(match[1]), month: Number(match[2])});
        }
        while ((match = numericPattern.exec(value))) {
            months.push({year: Number(match[1]), month: Number(match[2])});
        }
        const englishMonths = 'january february march april may june july august september october november december'.split(' ');
        const englishPattern = new RegExp(`(${englishMonths.join('|')})\\s+(\\d{4})`, 'ig');
        while ((match = englishPattern.exec(value))) {
            months.push({year: Number(match[2]), month: englishMonths.indexOf(match[1].toLowerCase()) + 1});
        }
        return months.filter((item) => item.month >= 1 && item.month <= 12);
    }

    function getDisplayedMonths(root) {
        const headerNodes = Array.from(root.querySelectorAll([
            '[class*="header"]',
            '[class*="month"]',
            '[class*="year"]',
            '[aria-live]',
            'th[colspan]',
        ].join(','))).filter(isVisible);
        const found = [];
        for (const node of headerNodes) {
            parseMonthsFromText(`${node.textContent || ''} ${node.getAttribute('aria-label') || ''}`)
                .forEach((month) => found.push(month));
        }
        return found.filter((month, index, array) =>
            array.findIndex((item) => item.year === month.year && item.month === month.month) === index
        );
    }

    function calendarMonthSignature() {
        return getCalendarRoots()
            .flatMap((root) => getDisplayedMonths(root))
            .map((item) => `${item.year}-${String(item.month).padStart(2, '0')}`)
            .join('|');
    }

    function findDayCellWithinMonth(root, day) {
        const candidates = queryVisibleAll([
            '[role="gridcell"]',
            'td',
            '[class*="calendar-cell"]',
            '[class*="picker-cell"]',
            '[class*="date-cell"]',
        ].join(','), root);
        return candidates.find((cell) => {
            if (isDateCellDisabled(cell)) return false;
            if (/\b(outside|other-month|prev-month|next-month)\b/i.test(elementSignal(cell))) return false;
            const content = normalizeText(cell.textContent);
            return content === String(day) || normalizeText(cell.querySelector('button, span, div')?.textContent) === String(day);
        }) || null;
    }

    function findCalendarNavButton(direction) {
        const roots = getCalendarRoots();
        const stableSelectors = direction === 'next'
            ? ['[data-action*="next" i]', '[aria-label*="next" i]', '[class*="next"]', '[aria-label*="下个月"]']
            : ['[data-action*="prev" i]', '[aria-label*="prev" i]', '[aria-label*="previous" i]', '[class*="prev"]', '[aria-label*="上个月"]'];
        for (const root of roots) {
            for (const selector of stableSelectors) {
                const button = queryVisibleAll(selector, root)
                    .map(closestClickable)
                    .find((element) => element && !isDisabled(element));
                if (button) return button;
            }
        }
        return null;
    }

    async function selectDateFromCalendar(isoDate, initialRoot, label, reopenCalendar) {
        if (!isISODate(isoDate)) throw new Error(`${label} ${isoDate} 不是有效日期。`);
        const [targetYear, targetMonth, targetDay] = isoDate.split('-').map(Number);
        const targetMonthKey = monthKey(targetYear, targetMonth);
        let root = initialRoot;
        let reopenCount = 0;

        for (let attempt = 0; attempt < 48; attempt += 1) {
            assertRunning();
            let roots = getCalendarRoots();
            root = roots.includes(root) ? root : roots[0];
            if (!root) {
                const recovered = await tryWaitForStableCalendar(`${label}日期日历重绘后恢复`, 1800);
                if (recovered) {
                    roots = getCalendarRoots();
                    root = roots.includes(recovered) ? recovered : roots[0];
                }
            }
            if (!root) {
                if (typeof reopenCalendar === 'function' && reopenCount < 3) {
                    reopenCount += 1;
                    log(`${label}选择过程中日期日历被页面重绘关闭，正在自动重新打开（${reopenCount}/3）…`, 'warn');
                    root = await reopenCalendar();
                    continue;
                }
                throw new Error(`${label} ${isoDate} 定位失败：日期日历在选择过程中意外关闭。`);
            }

            for (const calendarRoot of roots) {
                const exactCell = findDateCellByFullAttribute(calendarRoot, isoDate);
                if (exactCell) {
                    if (isDateCellDisabled(exactCell)) {
                        throw new Error(`${label} ${isoDate} 的日期格存在但不可点击或已禁用（${describeElement(exactCell)}）。`);
                    }
                    // 日期面板通常渲染在 portal 中。对日期格调用 scrollIntoView
                    // 会把整个罗盘页面横向挪走，使下一次“更多”控件离开视口。
                    clickElement(exactCell, `选择${label} ${isoDate}`, {scroll: false});
                    log(`${label} ${isoDate}：通过完整日期属性定位并点击。`);
                    return;
                }
            }

            const monthRoots = roots.map((calendarRoot) => ({
                root: calendarRoot,
                months: getDisplayedMonths(calendarRoot),
            }));
            const allMonths = monthRoots.flatMap((item) => item.months);
            if (!allMonths.length) {
                throw new Error(
                    `${label} ${isoDate} 定位失败：完整日期属性未命中，且无法从已展开日历的 header/month/year 区域识别当前年月；为避免误点排行榜数字，已禁止全页按日号查找。`
                );
            }

            const matchingRoot = monthRoots.find((item) =>
                item.months.some((month) => month.year === targetYear && month.month === targetMonth)
            );
            if (matchingRoot) {
                const fallbackCell = findDayCellWithinMonth(matchingRoot.root, targetDay);
                if (!fallbackCell) {
                    throw new Error(
                        `${label} ${isoDate} 定位失败：日历已显示 ${targetYear}年${targetMonth}月，但只在该日历容器内按日号仍找不到可点击的 ${targetDay} 日日期格。`
                    );
                }
                clickElement(fallbackCell, `选择${label} ${isoDate}`, {scroll: false});
                log(`${label} ${isoDate}：在已确认年月的日历容器内按日号定位并点击。`);
                return;
            }

            const keys = allMonths.map((month) => monthKey(month.year, month.month));
            const direction = targetMonthKey < Math.min(...keys) ? 'prev' : 'next';
            const navButton = findCalendarNavButton(direction);
            if (!navButton) {
                throw new Error(
                    `${label} ${isoDate} 不在当前月份，且未找到可点击的${direction === 'prev' ? '上个月' : '下个月'}按钮（已检查 data-action、aria-label、prev/next class）。`
                );
            }
            const before = calendarMonthSignature();
            clickElement(navButton, `切换日历到${direction === 'prev' ? '上一个月' : '下一个月'}`);
            await waitFor(
                () => {
                    const after = calendarMonthSignature();
                    return after && after !== before
                        ? after
                        : {reason: `点击月份导航后年月标识仍为 ${before || '无法识别'}`};
                },
                {description: `日历月份切换（目标 ${targetYear}-${String(targetMonth).padStart(2, '0')}）`}
            );
        }
        throw new Error(`${label} ${isoDate} 定位失败：连续切换 48 次日历月份后仍未到达目标月份。`);
    }

    function findPriceInputs() {
        const stable = queryVisibleAll([
            'input[name*="price" i]',
            'input[data-field*="price" i]',
            'input[data-testid*="price" i]',
            '[data-field*="price" i] input',
            '[data-testid*="price" i] input',
            '[class*="price"] input',
        ].join(',')).filter((input) => input instanceof HTMLInputElement && !state.panel.contains(input));
        if (stable.length >= 2) return stable.slice(0, 2);

        const containers = queryVisibleAll('form, [class*="filter"], [class*="condition"], [class*="form-item"], section, main')
            .filter((container) => normalizeText(container.textContent).includes('价格'))
            .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
        for (const container of containers) {
            const inputs = queryVisibleAll('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"], input', container)
                .filter((input) => input instanceof HTMLInputElement && !state.panel.contains(input));
            if (inputs.length >= 2) return inputs.slice(0, 2);
        }
        return [];
    }

    function setNativeInputValue(input, value) {
        const view = input.ownerDocument.defaultView;
        const prototype = view.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) throw new Error(`无法取得页面 HTMLInputElement.value 原生 setter（${describeElement(input)}）`);
        setter.call(input, String(value));
        input.dispatchEvent(new view.Event('input', {bubbles: true}));
        input.dispatchEvent(new view.Event('change', {bubbles: true}));
        input.dispatchEvent(new view.Event('blur', {bubbles: true}));
    }

    async function setPagePrice() {
        const inputs = await waitFor(
            () => {
                const result = findPriceInputs();
                return result.length >= 2
                    ? result
                    : {reason: `只找到 ${result.length} 个价格输入框；已检查 name/data-field/data-testid/class 中的 price 及“价格”筛选容器`};
            },
            {description: '最低价和最高价输入框'}
        );
        const values = [state.settings.minPrice, state.settings.maxPrice];
        for (let index = 0; index < 2; index += 1) {
            const label = index === 0 ? '最低价' : '最高价';
            setNativeInputValue(inputs[index], values[index]);
            await waitFor(
                () => String(inputs[index].value) === String(values[index])
                    || {reason: `${label}输入框当前值为“${inputs[index].value}”，目标值为“${values[index]}”`},
                {description: `${label}写入验证`, timeoutMs: 3000}
            );
        }
        log(`价格已设置：最低价 ${values[0] || '不限'}，最高价 ${values[1] || '不限'}。`, 'success');
    }

    function findCategoryTrigger() {
        const trackedAuroraCascader = queryVisibleAll(
            '[data-btm="d189160"] .aurora-cascader, [data-btm="d189160"] [class*="aurora-cascader"]'
        ).find((element) => !state.panel.contains(element));
        if (trackedAuroraCascader) return trackedAuroraCascader;

        const auroraCombobox = queryVisibleAll(
            '.aurora-cascader [role="combobox"][aria-haspopup="listbox"], [class*="aurora-cascader"] [role="combobox"]'
        ).find((element) => !state.panel.contains(element));
        if (auroraCombobox) {
            return auroraCombobox.closest('.aurora-cascader, [class*="aurora-cascader"]')
                || auroraCombobox.closest('[class*="cascader"]')
                || auroraCombobox;
        }

        const stable = queryVisibleAll([
            '[data-field*="categor" i]',
            '[data-testid*="categor" i]',
            '[data-field*="industry" i]',
            '[data-testid*="industry" i]',
            '[class*="cascader"]',
        ].join(','))
            .filter((element) => !state.panel.contains(element))
            .map(closestClickable)
            .filter((element, index, array) => element && array.indexOf(element) === index);
        const strong = stable.find((element) => /categor|industry|cascader/.test(elementSignal(element)));
        if (strong) return strong;

        const containers = queryVisibleAll('[class*="form-item"], [class*="filter-item"], [class*="condition"], label, section')
            .filter((element) => /行业类目|商品类目|类目/.test(normalizeText(element.textContent)))
            .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
        for (const container of containers) {
            const trigger = queryVisibleAll(
                '[role="combobox"], button, [aria-haspopup], [class*="selector"], [class*="select"]',
                container
            ).map(closestClickable)[0];
            if (trigger) return trigger;
        }
        return null;
    }

    function getDisplayedCategoryPath(trigger = findCategoryTrigger()) {
        if (!trigger) return '';
        const root = trigger.matches?.('[class*="cascader"]')
            ? trigger
            : trigger.closest?.('[class*="cascader"]') || trigger.parentElement;
        const valueNode = root?.querySelector(
            '.aurora-select-content-value[title], [class*="select-content-value"][title], [class*="select-content-value"]'
        );
        return normalizeText(valueNode?.getAttribute('title') || valueNode?.textContent || '');
    }

    function categoryPathMatches(displayedPath, categories) {
        const compactDisplayed = normalizeText(displayedPath).replace(/\s*\/\s*/g, '/');
        const expected = categories.map(normalizeText).join('/');
        return compactDisplayed === expected;
    }

    function getVisibleCategoryPopups() {
        return queryVisibleAll([
            '[role="listbox"]',
            '[role="menu"]',
            '.ecom-cascader-dropdown',
            '[class*="cascader"][class*="dropdown"]',
            '[class*="cascader"][class*="menu"]',
            '[class*="select"][class*="dropdown"]',
        ].join(',')).filter((element) => !state.panel.contains(element));
    }

    function findCategoryOption(name, level) {
        const popups = getVisibleCategoryPopups();
        const preferredPopup = popups[level] || popups.at(-1);
        const roots = preferredPopup ? [preferredPopup, ...popups.filter((item) => item !== preferredPopup)] : [];
        for (const root of roots) {
            const candidates = queryVisibleAll(
                '[role="option"], [role="menuitem"], li, [data-value], [data-key], [class*="option"], [class*="menu-item"]',
                root
            );
            const exact = candidates.find((element) => {
                const text = normalizeText(element.textContent);
                const attributes = [
                    element.getAttribute('title'),
                    element.getAttribute('data-label'),
                    element.getAttribute('data-name'),
                    element.getAttribute('data-value'),
                ].filter(Boolean).map(normalizeText);
                return attributes.includes(name) || text === name;
            });
            if (exact) return exact;
        }
        return null;
    }

    async function setPageCategory() {
        const categories = state.settings.categories;
        if (!categories.some(Boolean)) {
            log('三级行业类目全部留空，本次不修改页面类目。');
            return;
        }
        const trigger = await waitFor(
            () => findCategoryTrigger() || {
                reason: '未找到带 category/industry/cascader 稳定特征，或位于“行业类目/商品类目/类目”筛选容器内的触发器',
            },
            {description: '行业类目级联选择器'}
        );
        const requestedPath = categories.join(' / ');
        const currentPath = getDisplayedCategoryPath(trigger);
        if (categoryPathMatches(currentPath, categories)) {
            log(`行业类目已是：${requestedPath}，无需重复选择。`);
            return;
        }
        clickElement(trigger, '打开行业类目级联选择器');
        await waitFor(
            () => getVisibleCategoryPopups().length > 0 || {
                reason: '点击类目触发器后，未出现可见 role=listbox/menu 或 cascader/select dropdown',
            },
            {description: '行业类目选项面板'}
        );

        for (let level = 0; level < 3; level += 1) {
            const name = categories[level];
            const option = await waitFor(
                () => findCategoryOption(name, level) || {
                    reason: `第 ${level + 1} 级可见类目选项中未找到精确名称“${name}”（已检查 title/data-label/data-name/data-value 和选项文本）`,
                },
                {description: `${level + 1}级类目“${name}”`}
            );
            clickElement(option, `选择${level + 1}级类目“${name}”`);
            if (level < 2) {
                await waitFor(
                    () => getVisibleCategoryPopups().length >= level + 2
                        || findCategoryOption(categories[level + 1], level + 1)
                        || {reason: `选择“${name}”后尚未出现下一级类目面板`},
                    {description: `${level + 2}级类目面板`}
                );
            }
        }
        await waitFor(
            () => {
                const displayedPath = getDisplayedCategoryPath();
                return categoryPathMatches(displayedPath, categories)
                    ? displayedPath
                    : {
                        reason: displayedPath
                            ? `Aurora 级联选择器当前 title 为“${displayedPath}”，目标为“${requestedPath}”`
                            : '尚未找到 .aurora-select-content-value[title] 或同类稳定路径显示节点',
                    };
            },
            {description: `行业类目路径“${requestedPath}”生效`}
        );
        log(`行业类目已设置并验证：${requestedPath}。`, 'success');
    }

    function hasVisibleLoading(root) {
        return queryVisibleAll([
            '.ecom-spin-spinning',
            '[aria-busy="true"]',
            '[data-loading="true"]',
            '[class*="table-loading"]',
            '[class*="spin-loading"]',
            '[class*="loading-mask"]',
        ].join(','), root).length > 0;
    }

    function findStableDataRoot(root) {
        const tables = queryVisibleAll('table, [role="table"], .ecom-table, [class*="data-table"], [class*="rank-table"]', root)
            .filter((element) => !state.panel.contains(element));
        if (tables.length) {
            return tables.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
        }
        return queryVisibleAll('main, [role="main"], [class*="rank-product"], [class*="content"]', root)
            .filter((element) => !state.panel.contains(element))
            .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0] || null;
    }

    function dataFingerprint(root) {
        const rows = root.querySelectorAll('tbody tr, [role="row"]').length;
        const text = normalizeText(root.textContent);
        return `${rows}|${text.length}|${text.slice(0, 500)}|${text.slice(-500)}`;
    }

    async function waitForStableResult(scope, description) {
        const timeoutMs = state.settings.loadTimeoutSeconds * 1000;
        const stableMs = state.settings.stableWaitSeconds * 1000;
        const started = Date.now();
        let lastFingerprint = '';
        let stableSince = 0;
        let lastReason = '尚未开始检测';

        while (Date.now() - started <= timeoutMs) {
            assertRunning();
            const dataRoot = findStableDataRoot(scope);
            if (!dataRoot) {
                lastReason = '未找到可见 table/role=table/ecom-table/rank-table 或主内容区';
                stableSince = 0;
            } else if (hasVisibleLoading(scope)) {
                lastReason = '仍检测到可见 loading/spinning/aria-busy 控件';
                stableSince = 0;
            } else {
                const fingerprint = dataFingerprint(dataRoot);
                if (fingerprint !== lastFingerprint) {
                    lastFingerprint = fingerprint;
                    stableSince = Date.now();
                    lastReason = '表格内容或行数刚刚发生变化';
                } else if (stableSince && Date.now() - stableSince >= stableMs) {
                    log(`${description}：连续 ${state.settings.stableWaitSeconds} 秒未检测到加载状态或表格变化。`, 'success');
                    return dataRoot;
                } else {
                    lastReason = `表格已稳定 ${((Date.now() - stableSince) / 1000).toFixed(1)} 秒，目标 ${state.settings.stableWaitSeconds} 秒`;
                }
            }
            await delay(POLL_INTERVAL);
        }
        throw new Error(`等待「${description}」超时（已等待 ${(timeoutMs / 1000).toFixed(0)} 秒）；最后一次检测：${lastReason}`);
    }

    function exportEntryScore(element) {
        const signal = elementSignal(element);
        let score = 0;
        if (/(data-action|data-testid).*(export|download)|export|download/.test(signal)) score += 14;
        if (/导出/.test(normalizeText(element.textContent))) score += 6;
        if (element.matches('button, [role="button"], a')) score += 4;
        if (isDisabled(element)) score -= 30;
        return score;
    }

    function findExportEntry() {
        const candidates = queryVisibleAll([
            '[data-action*="export" i]',
            '[data-testid*="export" i]',
            '[aria-label*="export" i]',
            '[class*="export"]',
            '[data-action*="download" i]',
            'button',
            'a',
            '[role="button"]',
        ].join(','))
            .filter((element) => !state.panel.contains(element))
            .filter((element) => /export|download|导出/i.test(elementSignal(element)))
            .map(closestClickable)
            .filter((element, index, array) => element && array.indexOf(element) === index);
        return candidates.sort((a, b) => exportEntryScore(b) - exportEntryScore(a))[0] || null;
    }

    function getVisibleDialogs() {
        return queryVisibleAll([
            '[role="dialog"]',
            '.ecom-modal',
            '[data-testid*="modal" i]',
            '[class*="modal"][class*="content"]',
            '[class*="dialog"]',
        ].join(','))
            .filter((element) => !state.panel.contains(element))
            .filter((element, index, array) => !array.some((other, otherIndex) =>
                otherIndex !== index && other.contains(element) && other.getBoundingClientRect().height < element.getBoundingClientRect().height
            ));
    }

    function dialogLooksLikeExport(dialog) {
        const signal = elementSignal(dialog);
        return /export|download|导出|下载/.test(signal)
            || Boolean(dialog.querySelector('table, [role="table"], [role="switch"], input[type="checkbox"]'));
    }

    function toggleScore(element) {
        const context = normalizeText(element.closest('label, [class*="form-item"], [class*="switch"], div')?.textContent);
        const signal = `${elementSignal(element)} ${context}`.toLowerCase();
        let score = 0;
        if (/load.?all|all.?data|加载全部|全部加载/.test(signal)) score += 16;
        if (element.matches('[role="switch"], input[type="checkbox"]')) score += 5;
        if (/load|all/.test(signal)) score += 3;
        return score;
    }

    function findLoadAllToggle(dialog) {
        const candidates = queryVisibleAll([
            '[data-testid*="load-all" i]',
            '[data-action*="load-all" i]',
            '[name*="loadAll" i]',
            '[role="switch"]',
            'input[type="checkbox"]',
            '[class*="switch"]',
        ].join(','), dialog)
            .map((element) => element.matches('input, [role="switch"], button') ? element : element.querySelector('input, [role="switch"], button') || element)
            .filter((element, index, array) => isVisible(element) && array.indexOf(element) === index)
            .map((element) => ({element, score: toggleScore(element)}))
            .filter((item) => item.score > 4)
            .sort((a, b) => b.score - a.score);
        return candidates[0]?.element || null;
    }

    function isToggleOn(element) {
        if (element instanceof HTMLInputElement) return element.checked;
        const target = closestClickable(element);
        const states = [
            element.getAttribute('aria-checked'),
            target?.getAttribute('aria-checked'),
            element.getAttribute('data-state'),
            target?.getAttribute('data-state'),
            element.getAttribute('data-checked'),
            target?.getAttribute('data-checked'),
        ].filter((value) => value !== null).map((value) => String(value).toLowerCase());
        if (states.some((value) => ['true', 'checked', 'on', 'active'].includes(value))) return true;
        return /\b(checked|active|on|is-checked)\b/i.test(`${element.className || ''} ${target?.className || ''}`);
    }

    function findModalExportButton(dialog) {
        const candidates = queryVisibleAll('button, [role="button"], a, [data-action], [data-testid]', dialog)
            .filter((element) => /export|download|导出|下载/i.test(elementSignal(element)))
            .map(closestClickable)
            .filter((element, index, array) => element && array.indexOf(element) === index)
            .map((element) => {
                const signal = elementSignal(element);
                let score = 0;
                if (/(data-action|data-testid).*(export|download)|export|download/.test(signal)) score += 14;
                if (/导出/.test(normalizeText(element.textContent))) score += 6;
                if (element.closest('[class*="footer"]')) score += 4;
                if (isDisabled(element)) score -= 20;
                return {element, score};
            })
            .sort((a, b) => b.score - a.score);
        return candidates[0]?.element || null;
    }

    function exportActionStarted(dialog, button, resourceCount) {
        if (!isVisible(dialog) || !dialog.isConnected) return true;
        if (isDisabled(button) || /loading|spinning/i.test(elementSignal(button))) return true;
        const toast = queryVisibleAll(
            '[role="alert"], .ecom-message, [class*="toast"], [class*="message"]'
        ).find((element) => /成功|已提交|导出中|下载|export|download/i.test(normalizeText(element.textContent)));
        if (toast) return true;
        const newResources = performance.getEntriesByType('resource').slice(resourceCount);
        return newResources.some((entry) => /export|download/i.test(entry.name));
    }

    async function exportCurrentRank(rank) {
        log(`查找${rank.label}页面的导出入口…`);
        const beforeDialogs = new Set(getVisibleDialogs());
        const entry = await waitFor(
            () => findExportEntry() || {
                reason: '未找到带 data-action/data-testid/aria-label/class 的 export/download 特征或“导出”文本的可点击控件',
            },
            {description: `${rank.label}导出入口`}
        );
        clickElement(entry, `点击${rank.label}导出入口`);

        const dialog = await waitFor(
            () => {
                const dialogs = getVisibleDialogs();
                const candidate = dialogs.find((item) => !beforeDialogs.has(item) && dialogLooksLikeExport(item))
                    || dialogs.find(dialogLooksLikeExport);
                return candidate || {
                    reason: '未发现真正可见且包含导出/download 特征、表格或加载开关的 role=dialog/ecom-modal',
                };
            },
            {description: `${rank.label}导出弹窗真正显示`}
        );
        log(`${rank.label}导出弹窗已显示。`);

        const toggle = findLoadAllToggle(dialog);
        if (toggle) {
            if (!isToggleOn(toggle)) {
                log('检测到“加载全部”默认关闭，正在主动开启…');
                clickElement(toggle, '开启加载全部');
                await waitFor(
                    () => isToggleOn(toggle)
                        || findLoadAllToggle(dialog) && isToggleOn(findLoadAllToggle(dialog))
                        || {reason: '加载全部开关尚未呈现 checked/active/aria-checked=true 状态'},
                    {description: '加载全部开关开启'}
                );
                log('“加载全部”已开启。', 'success');
            } else {
                log('“加载全部”已经开启。');
            }
        } else {
            log('导出弹窗未呈现“加载全部”开关；该页面版本可能直接加载全部，将继续用表格稳定性检测确认。', 'warn');
        }

        log('等待导出弹窗加载全部及表格稳定…');
        await waitForStableResult(dialog, `${rank.label}导出弹窗表格稳定`);

        const button = await waitFor(
            () => {
                const found = findModalExportButton(dialog);
                return found && !isDisabled(found)
                    ? found
                    : {reason: found ? `弹窗导出按钮仍不可点击（${describeElement(found)}）` : '弹窗内未找到 export/download/导出特征按钮'};
            },
            {description: `${rank.label}弹窗导出按钮可点击`}
        );
        const resourceCount = performance.getEntriesByType('resource').length;
        clickElement(button, `点击${rank.label}弹窗导出按钮`);
        await waitFor(
            () => exportActionStarted(dialog, button, resourceCount)
                || {reason: '弹窗仍显示、按钮未进入 loading/disabled、未出现成功提示，也未观察到 export/download 请求'},
            {description: `${rank.label}导出动作开始`}
        );
    }

    state.settings = loadSettings();
    createPanel();
})();
