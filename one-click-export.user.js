// ==UserScript==
// @name         一键导出
// @namespace    https://github.com/anysky911/WuLuLu
// @version      1.0.0
// @description  自动完成抖店罗盘当前榜单的一键导出、加载全部、等待表格稳定和导出表格
// @author       anysky911
// @match        https://compass.jinritemai.com/*rank-product*
// @updateURL    https://raw.githubusercontent.com/anysky911/WuLuLu/main/one-click-export.user.js
// @downloadURL  https://raw.githubusercontent.com/anysky911/WuLuLu/main/one-click-export.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = '一键导出';
    const VERSION = '1.0.0';
    const PANEL_ID = 'compass-one-click-export-panel';
    const STORAGE_KEY = 'compass-one-click-export.settings.v1';
    const POLL_INTERVAL = 300;
    const LOG_LIMIT = 220;

    const state = {
        running: false,
        stopRequested: false,
        abortController: null,
        panel: null,
        logs: [],
        settings: loadSettings(),
    };

    class TaskStoppedError extends Error {
        constructor(message) {
            super(message);
            this.name = 'TaskStoppedError';
        }
    }

    function defaults() {
        return {
            loadTimeoutSeconds: 60,
            stableWaitSeconds: 3,
            collapsed: false,
            left: null,
            top: 100,
        };
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    }

    function loadSettings() {
        const fallback = defaults();
        try {
            const raw = GM_getValue(STORAGE_KEY, fallback);
            return {
                ...fallback,
                ...(raw && typeof raw === 'object' ? raw : {}),
                loadTimeoutSeconds: clampNumber(raw?.loadTimeoutSeconds, 10, 300, fallback.loadTimeoutSeconds),
                stableWaitSeconds: clampNumber(raw?.stableWaitSeconds, 1, 30, fallback.stableWaitSeconds),
            };
        } catch (error) {
            console.warn(`[${SCRIPT_NAME}] 读取配置失败，已使用默认配置。`, error);
            return fallback;
        }
    }

    function saveSettings() {
        try {
            GM_setValue(STORAGE_KEY, state.settings);
        } catch (error) {
            log(`保存配置失败：${error.message}`, 'error');
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
                    --oce-blue: #1664ff;
                    --oce-border: #dbe3ef;
                    position: fixed;
                    top: 100px;
                    right: 18px;
                    z-index: 2147483645;
                    width: 330px;
                    color: #182230;
                    background: #fff;
                    border: 1px solid var(--oce-border);
                    border-radius: 12px;
                    box-shadow: 0 12px 36px rgba(30, 50, 80, .20);
                    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
                    overflow: hidden;
                }
                #${PANEL_ID} * { box-sizing: border-box; }
                #${PANEL_ID} .oce-head {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 11px 12px;
                    color: #fff;
                    background: linear-gradient(135deg, #1664ff, #4e8cff);
                    cursor: move;
                    user-select: none;
                }
                #${PANEL_ID} .oce-title { flex: 1; font-size: 15px; font-weight: 700; }
                #${PANEL_ID} .oce-version { font-size: 11px; opacity: .85; }
                #${PANEL_ID} .oce-collapse {
                    width: 28px;
                    height: 28px;
                    color: #fff;
                    background: rgba(255,255,255,.18);
                    border: 0;
                    border-radius: 7px;
                    cursor: pointer;
                    font-size: 16px;
                }
                #${PANEL_ID}.collapsed .oce-body { display: none; }
                #${PANEL_ID} .oce-body { padding: 12px; }
                #${PANEL_ID} .oce-note {
                    margin-bottom: 10px;
                    padding: 9px 10px;
                    color: #355072;
                    background: #f2f7ff;
                    border-radius: 8px;
                }
                #${PANEL_ID} details {
                    margin-bottom: 10px;
                    padding: 8px 9px;
                    border: 1px solid var(--oce-border);
                    border-radius: 8px;
                }
                #${PANEL_ID} summary { cursor: pointer; font-weight: 600; }
                #${PANEL_ID} .oce-settings {
                    display: grid;
                    grid-template-columns: 1fr 88px;
                    gap: 7px 9px;
                    align-items: center;
                    margin-top: 9px;
                }
                #${PANEL_ID} input[type="number"] {
                    width: 100%;
                    height: 30px;
                    padding: 0 7px;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                }
                #${PANEL_ID} .oce-actions {
                    display: grid;
                    grid-template-columns: 1fr 78px;
                    gap: 8px;
                    margin-bottom: 8px;
                }
                #${PANEL_ID} button { font: inherit; }
                #${PANEL_ID} .oce-start,
                #${PANEL_ID} .oce-stop,
                #${PANEL_ID} .oce-log-export {
                    min-height: 38px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 700;
                }
                #${PANEL_ID} .oce-start {
                    color: #fff;
                    background: var(--oce-blue);
                    border: 1px solid var(--oce-blue);
                }
                #${PANEL_ID} .oce-stop,
                #${PANEL_ID} .oce-log-export {
                    color: #334155;
                    background: #fff;
                    border: 1px solid #cbd5e1;
                }
                #${PANEL_ID} .oce-log-export { width: 100%; margin-bottom: 9px; }
                #${PANEL_ID} button:disabled { opacity: .45; cursor: not-allowed; }
                #${PANEL_ID} .oce-status-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    margin-bottom: 6px;
                    font-weight: 600;
                }
                #${PANEL_ID} .oce-progress {
                    height: 7px;
                    margin-bottom: 9px;
                    overflow: hidden;
                    background: #e8eef7;
                    border-radius: 999px;
                }
                #${PANEL_ID} .oce-progress > i {
                    display: block;
                    width: 0;
                    height: 100%;
                    background: var(--oce-blue);
                    transition: width .2s ease;
                }
                #${PANEL_ID} .oce-log {
                    height: 170px;
                    padding: 8px;
                    overflow: auto;
                    color: #dbeafe;
                    background: #101827;
                    border-radius: 8px;
                    font: 12px/1.5 Consolas, "Microsoft YaHei", monospace;
                    word-break: break-word;
                }
                #${PANEL_ID} .oce-log .success { color: #86efac; }
                #${PANEL_ID} .oce-log .warn { color: #fde68a; }
                #${PANEL_ID} .oce-log .error { color: #fca5a5; }
            </style>
            <div class="oce-head">
                <span class="oce-title">${SCRIPT_NAME}</span>
                <span class="oce-version">v${VERSION}</span>
                <button type="button" class="oce-collapse" title="折叠/展开">−</button>
            </div>
            <div class="oce-body">
                <div class="oce-note">导出当前页面榜单：点击页面“一键导出” → 开启“加载全部” → 等待表格稳定 → 点击“导出表格”。</div>
                <details>
                    <summary>等待设置</summary>
                    <div class="oce-settings">
                        <label for="oce-timeout">页面加载超时（秒）</label>
                        <input id="oce-timeout" type="number" min="10" max="300" step="1" value="${state.settings.loadTimeoutSeconds}">
                        <label for="oce-stable">稳定等待（秒）</label>
                        <input id="oce-stable" type="number" min="1" max="30" step="1" value="${state.settings.stableWaitSeconds}">
                    </div>
                </details>
                <div class="oce-actions">
                    <button type="button" class="oce-start">开始一键导出</button>
                    <button type="button" class="oce-stop" disabled>停止</button>
                </div>
                <button type="button" class="oce-log-export">导出日志</button>
                <div class="oce-status-row">
                    <span class="oce-status">就绪</span>
                    <span class="oce-progress-text">0%</span>
                </div>
                <div class="oce-progress"><i></i></div>
                <div class="oce-log" aria-live="polite"></div>
            </div>
        `;
        document.documentElement.appendChild(panel);
        state.panel = panel;

        panel.classList.toggle('collapsed', Boolean(state.settings.collapsed));
        panel.querySelector('.oce-collapse').textContent = state.settings.collapsed ? '+' : '−';
        panel.querySelector('.oce-collapse').addEventListener('click', () => {
            state.settings.collapsed = !state.settings.collapsed;
            panel.classList.toggle('collapsed', state.settings.collapsed);
            panel.querySelector('.oce-collapse').textContent = state.settings.collapsed ? '+' : '−';
            saveSettings();
        });
        panel.querySelector('.oce-start').addEventListener('click', startExport);
        panel.querySelector('.oce-stop').addEventListener('click', requestStop);
        panel.querySelector('.oce-log-export').addEventListener('click', exportDiagnosticLog);
        panel.querySelector('#oce-timeout').addEventListener('change', (event) => {
            state.settings.loadTimeoutSeconds = clampNumber(event.target.value, 10, 300, 60);
            event.target.value = state.settings.loadTimeoutSeconds;
            saveSettings();
        });
        panel.querySelector('#oce-stable').addEventListener('change', (event) => {
            state.settings.stableWaitSeconds = clampNumber(event.target.value, 1, 30, 3);
            event.target.value = state.settings.stableWaitSeconds;
            saveSettings();
        });

        bindDragging(panel.querySelector('.oce-head'));
        applyStoredPanelPosition();
        log(`脚本 v${VERSION} 已加载。`);
    }

    function bindDragging(handle) {
        let drag = null;
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.target.closest('button')) return;
            const rect = state.panel.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
            };
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener('pointermove', (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const left = Math.min(
                Math.max(0, event.clientX - drag.offsetX),
                Math.max(0, window.innerWidth - state.panel.offsetWidth)
            );
            const top = Math.min(
                Math.max(0, event.clientY - drag.offsetY),
                Math.max(0, window.innerHeight - 42)
            );
            state.panel.style.left = `${left}px`;
            state.panel.style.top = `${top}px`;
            state.panel.style.right = 'auto';
        });
        const stopDragging = (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            drag = null;
            const rect = state.panel.getBoundingClientRect();
            state.settings.left = Math.round(rect.left);
            state.settings.top = Math.round(rect.top);
            saveSettings();
        };
        handle.addEventListener('pointerup', stopDragging);
        handle.addEventListener('pointercancel', stopDragging);
        window.addEventListener('resize', keepPanelInViewport);
    }

    function applyStoredPanelPosition() {
        if (Number.isFinite(Number(state.settings.left))) {
            state.panel.style.left = `${Math.max(0, Number(state.settings.left))}px`;
            state.panel.style.right = 'auto';
        }
        if (Number.isFinite(Number(state.settings.top))) {
            state.panel.style.top = `${Math.max(0, Number(state.settings.top))}px`;
        }
        keepPanelInViewport();
    }

    function keepPanelInViewport() {
        if (!state.panel) return;
        const rect = state.panel.getBoundingClientRect();
        const left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - rect.width));
        const top = Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - 42));
        state.panel.style.left = `${left}px`;
        state.panel.style.top = `${top}px`;
        state.panel.style.right = 'auto';
    }

    function log(message, level = 'info') {
        const stamp = new Date().toLocaleTimeString('zh-CN', {hour12: false});
        const item = {stamp, message: String(message), level};
        state.logs.push(item);
        if (state.logs.length > LOG_LIMIT) state.logs.splice(0, state.logs.length - LOG_LIMIT);
        console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${SCRIPT_NAME}] ${message}`);
        if (!state.panel) return;
        const box = state.panel.querySelector('.oce-log');
        box.insertAdjacentHTML(
            'beforeend',
            `<div class="${escapeHTML(level)}">[${escapeHTML(stamp)}] ${escapeHTML(message)}</div>`
        );
        while (box.children.length > LOG_LIMIT) box.firstElementChild?.remove();
        box.scrollTop = box.scrollHeight;
    }

    function exportDiagnosticLog() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        log('正在导出诊断日志。');
        const content = [
            `${SCRIPT_NAME} 诊断日志`,
            `脚本版本: ${VERSION}`,
            `导出时间: ${new Date().toLocaleString('zh-CN', {hour12: false})}`,
            `页面地址: ${location.href}`,
            `页面标题: ${document.title}`,
            `任务状态: ${state.running ? '运行中' : '未运行'}`,
            `配置: ${JSON.stringify(state.settings)}`,
            '',
            '--- 日志 ---',
            ...state.logs.map((item) => `[${item.stamp}] [${item.level}] ${item.message}`),
        ].join('\n');
        const blobURL = URL.createObjectURL(new Blob([content], {type: 'text/plain;charset=utf-8'}));
        const link = document.createElement('a');
        link.href = blobURL;
        link.download = `一键导出-诊断日志-${timestamp}.txt`;
        link.style.display = 'none';
        document.documentElement.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobURL), 1000);
    }

    function setStatus(text) {
        state.panel.querySelector('.oce-status').textContent = text;
    }

    function setProgress(completed, total, detail = '') {
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        state.panel.querySelector('.oce-progress > i').style.width = `${percent}%`;
        state.panel.querySelector('.oce-progress-text').textContent = detail ? `${percent}% · ${detail}` : `${percent}%`;
    }

    function setRunning(running) {
        state.running = running;
        state.panel.querySelector('.oce-start').disabled = running;
        state.panel.querySelector('.oce-stop').disabled = !running;
        state.panel.querySelector('#oce-timeout').disabled = running;
        state.panel.querySelector('#oce-stable').disabled = running;
    }

    function requestStop() {
        if (!state.running) return;
        state.stopRequested = true;
        state.abortController?.abort();
        setStatus('正在停止');
        log('已收到停止请求，正在中止当前等待。', 'warn');
    }

    function assertRunning() {
        if (state.stopRequested || state.abortController?.signal.aborted) {
            throw new TaskStoppedError('任务已由用户停止');
        }
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

    async function waitFor(getter, options) {
        const timeoutMs = options.timeoutMs ?? state.settings.loadTimeoutSeconds * 1000;
        const intervalMs = options.intervalMs ?? POLL_INTERVAL;
        const started = Date.now();
        let lastReason = '';

        while (Date.now() - started <= timeoutMs) {
            assertRunning();
            try {
                const value = await getter();
                if (value && typeof value === 'object' && typeof value.reason === 'string') {
                    lastReason = value.reason;
                } else if (value) {
                    return value;
                }
            } catch (error) {
                if (error instanceof TaskStoppedError) throw error;
                lastReason = error.message;
            }
            await delay(intervalMs);
        }
        const seconds = (timeoutMs / 1000).toFixed(timeoutMs % 1000 ? 1 : 0);
        const suffix = lastReason ? `；最后一次检测：${lastReason}` : '';
        throw new Error(`等待「${options.description}」超时（已等待 ${seconds} 秒）${suffix}`);
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
            element?.disabled
            || element?.getAttribute?.('aria-disabled') === 'true'
            || element?.getAttribute?.('data-disabled') === 'true'
            || /\b(disabled|is-disabled)\b/i.test(element?.className || '')
        );
    }

    function closestClickable(element) {
        if (!element || typeof element.closest !== 'function') return null;
        return element.closest([
            'button',
            'a',
            'label',
            '[role="button"]',
            '[role="switch"]',
            '[data-action]',
            '[data-testid]',
        ].join(',')) || element;
    }

    function describeElement(element) {
        if (!element) return 'null';
        const tag = element.tagName?.toLowerCase() || 'unknown';
        const id = element.id ? `#${element.id}` : '';
        const classes = typeof element.className === 'string'
            ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
            : '';
        const attributes = ['role', 'data-testid', 'data-action', 'aria-label']
            .map((name) => element.getAttribute?.(name) ? `${name}="${element.getAttribute(name)}"` : '')
            .filter(Boolean)
            .join(' ');
        return `<${tag}${id}${classes}${attributes ? ` ${attributes}` : ''}>`;
    }

    function clickElement(element, description) {
        const target = closestClickable(element);
        if (!target) throw new Error(`${description}：DOM 元素不存在`);
        target.scrollIntoView({block: 'center', inline: 'center'});
        if (!isVisible(target)) throw new Error(`${description}：元素存在但不可见（${describeElement(target)}）`);
        if (isDisabled(target)) throw new Error(`${description}：元素处于禁用状态（${describeElement(target)}）`);
        target.focus?.({preventScroll: true});
        target.click();
        return target;
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
            'data-key', 'data-testid', 'data-action', 'data-state',
        ];
        return normalizeText([
            ...attributes.map((name) => element.getAttribute?.(name) || ''),
            typeof element.className === 'string' ? element.className : '',
            element.textContent || '',
        ].join(' ')).toLowerCase();
    }

    function exportEntryScore(element) {
        const signal = elementSignal(element);
        const text = normalizeText(element.textContent);
        let score = 0;
        if (text === '一键导出') score += 100;
        if (/(data-action|data-testid).*(export|download)|export|download/.test(signal)) score += 14;
        if (/导出/.test(text)) score += 6;
        if (element.matches('button, [role="button"], a')) score += 4;
        if (isDisabled(element)) score -= 40;
        return score;
    }

    function findExportEntry() {
        const stableCandidates = queryVisibleAll([
            '[data-action*="export" i]',
            '[data-testid*="export" i]',
            '[aria-label*="export" i]',
            '[class*="export" i]',
            '[data-action*="download" i]',
            'button',
            'a',
            '[role="button"]',
        ].join(','));
        const exactTextCandidates = queryVisibleAll('div, span')
            .filter((element) => normalizeText(element.textContent) === '一键导出');
        const candidates = [...stableCandidates, ...exactTextCandidates]
            .filter((element) => !state.panel.contains(element))
            .filter((element) => (
                /export|download|导出/i.test(elementSignal(element))
                || normalizeText(element.textContent) === '一键导出'
            ))
            .map(closestClickable)
            .filter((element, index, array) => (
                element
                && !isDisabled(element)
                && array.indexOf(element) === index
            ));
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
            .filter((element) => !state.panel.contains(element));
    }

    function getExportSurfaceCandidates() {
        const candidates = [...getVisibleDialogs()];
        const anchors = queryVisibleAll('button, [role="button"], label, span, div')
            .filter((element) => ['加载全部', '导出表格'].includes(normalizeText(element.textContent)));

        for (const anchor of anchors) {
            for (let node = anchor.parentElement, depth = 0;
                node && node !== document.body && depth < 9;
                node = node.parentElement, depth += 1) {
                if (isVisible(node) && !state.panel.contains(node)) candidates.push(node);
            }
        }
        return candidates.filter((element, index, array) => array.indexOf(element) === index);
    }

    function exportSurfaceScore(surface) {
        const signal = elementSignal(surface);
        let score = 0;
        if (/加载全部/.test(signal)) score += 36;
        if (/导出表格/.test(signal)) score += 36;
        if (surface.querySelector('table, [role="table"], .ecom-table, [class*="data-table"]')) score += 18;
        if (/export|download|导出|下载/.test(signal)) score += 8;
        if (surface.matches('[role="dialog"], .ecom-modal, [class*="dialog"]')) score += 4;
        return score;
    }

    function findExportSurface(beforeSurfaces) {
        const ranked = getExportSurfaceCandidates()
            .map((element) => ({
                element,
                score: exportSurfaceScore(element),
                isNew: !beforeSurfaces.has(element),
            }))
            .filter((item) => item.score >= 36)
            .sort((a, b) => (b.isNew - a.isNew) || (b.score - a.score));
        return ranked[0]?.element || null;
    }

    function toggleScore(element) {
        const context = normalizeText(
            element.closest?.('label, [class*="form-item"], [class*="switch"], [class*="toggle"], div')?.textContent
        );
        const signal = `${elementSignal(element)} ${context}`.toLowerCase();
        let score = 0;
        if (/load.?all|all.?data|加载全部|全部加载/.test(signal)) score += 16;
        if (element.matches?.('[role="switch"], input[type="checkbox"]')) score += 5;
        if (/load|all/.test(signal)) score += 3;
        return score;
    }

    function findLoadAllToggle(root) {
        const scope = root || document.body;
        const stableCandidates = Array.from(scope.querySelectorAll([
            '[data-testid*="load-all" i]',
            '[data-action*="load-all" i]',
            '[name*="loadAll" i]',
            '[role="switch"]',
            'input[type="checkbox"]',
            '[class*="switch" i]',
            '[class*="toggle" i]',
        ].join(',')))
            .map((element) => (
                element.matches('input, [role="switch"], button')
                    ? element
                    : element.querySelector('input, [role="switch"], button') || element
            ))
            .filter((element, index, array) => array.indexOf(element) === index)
            .map((element) => ({element, score: toggleScore(element)}))
            .filter((item) => item.score > 4)
            .sort((a, b) => b.score - a.score);

        for (const item of stableCandidates) {
            if (isVisible(item.element)) return item.element;
            for (let node = item.element.parentElement; node && node !== scope.parentElement; node = node.parentElement) {
                if (isVisible(node) && toggleScore(node) > 4) return node;
            }
        }

        const label = queryVisibleAll('label, span, div', scope)
            .find((element) => normalizeText(element.textContent) === '加载全部');
        if (!label) return null;

        const selector = '[role="switch"], [class*="switch" i], [class*="toggle" i], input[type="checkbox"]';
        for (let row = label.parentElement; row && row !== scope.parentElement; row = row.parentElement) {
            const control = row.querySelector(selector);
            if (!control) continue;
            for (let target = control; target && target !== row.parentElement; target = target.parentElement) {
                if (isVisible(target)) return target;
            }
        }
        return null;
    }

    function isToggleOn(element) {
        if (!element) return false;
        if (element instanceof HTMLInputElement) return element.checked;
        const nestedInput = element.querySelector?.('input[type="checkbox"]');
        if (nestedInput instanceof HTMLInputElement) return nestedInput.checked;
        const target = closestClickable(element);
        const states = [
            element.getAttribute?.('aria-checked'),
            target?.getAttribute?.('aria-checked'),
            element.getAttribute?.('data-state'),
            target?.getAttribute?.('data-state'),
            element.getAttribute?.('data-checked'),
            target?.getAttribute?.('data-checked'),
        ].filter((value) => value !== null && value !== undefined)
            .map((value) => String(value).toLowerCase());
        if (states.some((value) => ['true', 'checked', 'on', 'active'].includes(value))) return true;
        return /\b(checked|active|on|is-checked)\b/i.test(`${element.className || ''} ${target?.className || ''}`);
    }

    function findExportWorkspaceFromToggle(toggle, fallbackSurface) {
        for (let node = toggle; node && node !== document.body; node = node.parentElement) {
            if (!isVisible(node) || state.panel.contains(node)) continue;
            const hasTable = node.querySelector('table, [role="table"], .ecom-table, [class*="data-table"], [class*="rank-table"]');
            const hasExportButton = queryVisibleAll('button, [role="button"], a', node)
                .some((element) => normalizeText(element.textContent) === '导出表格');
            if (hasTable && hasExportButton) return node;
        }
        return fallbackSurface;
    }

    function hasVisibleLoading(root) {
        return queryVisibleAll([
            '.ecom-spin-spinning',
            '[aria-busy="true"]',
            '[data-loading="true"]',
            '[class*="table-loading" i]',
            '[class*="spin-loading" i]',
            '[class*="loading-mask" i]',
            '[class*="loading"][class*="mask" i]',
        ].join(','), root).length > 0;
    }

    function findStableDataRoot(root) {
        const tables = queryVisibleAll(
            'table, [role="table"], .ecom-table, [class*="data-table"], [class*="rank-table"]',
            root
        ).filter((element) => !state.panel.contains(element));
        if (tables.length) {
            return tables.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
        }
        return queryVisibleAll('[class*="table"], main, [role="main"], [class*="content"]', root)
            .filter((element) => !state.panel.contains(element))
            .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0] || null;
    }

    function dataFingerprint(root) {
        if (!root) return '';
        const rows = root.querySelectorAll('tbody tr, [role="row"]').length;
        const text = normalizeText(root.textContent);
        return `${rows}|${text.length}|${text.slice(0, 500)}|${text.slice(-500)}`;
    }

    async function waitForStableResult(scope, description, baselineFingerprint = '') {
        const timeoutMs = state.settings.loadTimeoutSeconds * 1000;
        const stableMs = state.settings.stableWaitSeconds * 1000;
        const changeGraceMs = Math.min(5000, Math.max(1500, timeoutMs / 4));
        const started = Date.now();
        let lastFingerprint = '';
        let stableSince = 0;
        let changeObserved = !baselineFingerprint;
        let lastReason = '尚未开始检测';

        while (Date.now() - started <= timeoutMs) {
            assertRunning();
            const dataRoot = findStableDataRoot(scope);
            if (!dataRoot) {
                lastReason = '未找到可见表格或数据区域';
                stableSince = 0;
            } else if (hasVisibleLoading(scope)) {
                lastReason = '仍检测到可见的加载状态';
                stableSince = 0;
                changeObserved = true;
            } else {
                const fingerprint = dataFingerprint(dataRoot);
                if (baselineFingerprint && fingerprint !== baselineFingerprint) changeObserved = true;
                if (fingerprint !== lastFingerprint) {
                    lastFingerprint = fingerprint;
                    stableSince = Date.now();
                    lastReason = '表格内容或行数刚刚发生变化';
                } else if (!changeObserved && Date.now() - started < changeGraceMs) {
                    lastReason = '正在等待“加载全部”触发表格变化';
                } else if (stableSince && Date.now() - stableSince >= stableMs) {
                    log(`${description}：连续 ${state.settings.stableWaitSeconds} 秒未检测到加载状态或表格变化。`, 'success');
                    return dataRoot;
                } else {
                    const seconds = stableSince ? ((Date.now() - stableSince) / 1000).toFixed(1) : '0.0';
                    lastReason = `表格已稳定 ${seconds} 秒，目标 ${state.settings.stableWaitSeconds} 秒`;
                }
            }
            await delay(POLL_INTERVAL);
        }
        throw new Error(
            `等待「${description}」超时（已等待 ${(timeoutMs / 1000).toFixed(0)} 秒）；最后一次检测：${lastReason}`
        );
    }

    function findModalExportButton(root) {
        const exactText = queryVisibleAll('button, [role="button"], a, div, span', root)
            .filter((element) => normalizeText(element.textContent) === '导出表格');
        const stable = queryVisibleAll(
            'button, [role="button"], a, [data-action], [data-testid]',
            root
        ).filter((element) => /export|download|导出|下载/i.test(elementSignal(element)));
        const candidates = [...exactText, ...stable]
            .map(closestClickable)
            .filter((element, index, array) => element && array.indexOf(element) === index)
            .map((element) => {
                const text = normalizeText(element.textContent);
                const signal = elementSignal(element);
                let score = 0;
                if (text === '导出表格') score += 100;
                if (/(data-action|data-testid).*(export|download)|export|download/.test(signal)) score += 14;
                if (/导出/.test(text)) score += 6;
                if (element.closest('[class*="footer"]')) score += 4;
                if (text === '一键导出') score -= 100;
                if (isDisabled(element)) score -= 40;
                return {element, score};
            })
            .sort((a, b) => b.score - a.score);
        return candidates[0]?.element || null;
    }

    function exportActionStarted(surface, button, resourceCount) {
        if (!isVisible(surface) || !surface.isConnected) return true;
        if (!button.isConnected || isDisabled(button) || /loading|spinning/i.test(elementSignal(button))) return true;
        const toast = queryVisibleAll(
            '[role="alert"], .ecom-message, [class*="toast"], [class*="message"]'
        ).find((element) => /成功|已提交|导出中|下载|export|download/i.test(normalizeText(element.textContent)));
        if (toast) return true;
        return performance.getEntriesByType('resource')
            .slice(resourceCount)
            .some((entry) => /export|download/i.test(entry.name));
    }

    async function runExport() {
        log('[1/4] 查找并点击页面“一键导出”入口…');
        setProgress(0, 4, '查找入口');
        const beforeSurfaces = new Set(getExportSurfaceCandidates());
        const entry = await waitFor(
            () => findExportEntry() || {
                reason: '未找到带 export/download 特征或文字为“一键导出”的可点击控件',
            },
            {description: '页面“一键导出”入口'}
        );
        clickElement(entry, '点击页面“一键导出”入口');
        setProgress(1, 4, '已点击一键导出');

        const surface = await waitFor(
            () => findExportSurface(beforeSurfaces) || {
                reason: '未发现包含“加载全部”“导出表格”或数据表格的可见导出区域',
            },
            {description: '导出弹窗或导出页面真正显示'}
        );
        log('[2/4] 导出区域已显示。', 'success');
        setProgress(2, 4, '导出区域已显示');

        let toggle = findLoadAllToggle(surface) || findLoadAllToggle(document.body);
        const workspace = toggle
            ? findExportWorkspaceFromToggle(toggle, surface)
            : surface;
        const initialRoot = findStableDataRoot(workspace);
        const initialFingerprint = dataFingerprint(initialRoot);

        if (toggle && !isToggleOn(toggle)) {
            log('[3/4] 检测到“加载全部”默认关闭，正在开启…');
            clickElement(toggle, '开启“加载全部”');
            await waitFor(
                () => {
                    const current = findLoadAllToggle(workspace) || findLoadAllToggle(document.body);
                    return current && isToggleOn(current)
                        ? current
                        : {reason: '重新定位后的开关尚未呈现 checked/active/aria-checked=true 状态'};
                },
                {description: '“加载全部”开关开启'}
            );
            log('“加载全部”已开启。', 'success');
        } else if (toggle) {
            log('“加载全部”已经开启。');
        } else {
            log('未找到“加载全部”开关；该页面版本可能直接加载全部，将继续检测表格稳定。', 'warn');
        }

        log('[3/4] 等待加载完成及表格稳定…');
        await waitForStableResult(workspace, '导出表格稳定', toggle ? initialFingerprint : '');
        setProgress(3, 4, '表格已稳定');

        const button = await waitFor(
            () => {
                const found = findModalExportButton(workspace)
                    || findModalExportButton(surface)
                    || findModalExportButton(document.body);
                return found && !isDisabled(found)
                    ? found
                    : {
                        reason: found
                            ? `“导出表格”按钮仍不可点击（${describeElement(found)}）`
                            : '未找到文字为“导出表格”或带 export/download 特征的按钮',
                    };
            },
            {description: '“导出表格”按钮可点击'}
        );

        log('[4/4] 点击“导出表格”…');
        const resourceCount = performance.getEntriesByType('resource').length;
        clickElement(button, '点击“导出表格”');
        const confirmed = await tryWaitFor(
            () => exportActionStarted(surface, button, resourceCount)
                || {reason: '尚未观察到按钮 loading、成功提示、弹窗关闭或 export/download 请求'},
            {description: '导出动作开始', timeoutMs: Math.min(10000, state.settings.loadTimeoutSeconds * 1000)}
        );
        if (confirmed) {
            log('已确认导出动作开始。', 'success');
        } else {
            log('已点击“导出表格”，但页面未提供可观察的确认信号，请检查浏览器下载记录。', 'warn');
        }
        setProgress(4, 4, '导出已触发');
    }

    async function startExport() {
        if (state.running) return;
        state.stopRequested = false;
        state.abortController = new AbortController();
        setRunning(true);
        setStatus('正在导出');
        setProgress(0, 4, '准备');
        log('开始执行当前榜单一键导出。');

        try {
            await runExport();
            setStatus('导出已触发');
            log('当前榜单一键导出流程完成。', 'success');
        } catch (error) {
            if (error instanceof TaskStoppedError) {
                setStatus('已停止');
                log(error.message, 'warn');
            } else {
                setStatus('任务失败');
                log(`任务失败：${error.message}`, 'error');
            }
        } finally {
            setRunning(false);
            state.abortController = null;
        }
    }

    createPanel();
})();
