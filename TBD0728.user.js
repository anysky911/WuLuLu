// ==UserScript==
// @name         TBD0728
// @namespace    http://tampermonkey.net/
// @version      V01.1
// @description  try to take over the world!
// @updateURL    https://raw.githubusercontent.com/anysky911/WuLuLu/main/TBD0728.user.js
// @downloadURL  https://raw.githubusercontent.com/anysky911/WuLuLu/main/TBD0728.user.js
// @match        *://zuoxitz.tmall.com/*
// @match        *://banduxian.tmall.com/*
// @match        *://onmygame.tmall.com/*
// @match        *://mucmukn.tmall.com/*
// @match        *://amybaby123.taobao.com/*
// @match        *://shop116189128.taobao.com/*
// @match        *://shop246627726.taobao.com/*
// @match        *://ikarnow.tmall.com/*
// @match        *://moonkids.tmall.com/*
// @match        *://hanhanxiang.tmall.com/*
// @match        *://ovemy.tmall.com/*
// @match        *://xiaozhubite.tmall.com/*
// @match        *://rinagugu.tmall.com/*
// @match        *://mcticco.tmall.com/*
// @match        *://amencl.tmall.com/*
// @match        *://timmama.tmall.com/*
// @match        *://xbdkids.taobao.com/*
// @match        *://fanny-ann.taobao.com/*
// @match        *://shop105083648.taobao.com/*
// @match        *://natunakids.taobao.com/*
// @match        *://naiyoucream.taobao.com/*
// @match        *://moodytiger.tmall.com/*
// @match        *://shop61135432.taobao.com/*
// @match        *://youlanmuying.tmall.com/*
// @match        *://hope5746.taobao.com/*
// @match        *://naiyoucream.taobao.com/*
// @match        *://yoyoone.tmall.com/*
// @match        *://zhenyoufantongzhuang.tmall.com/*
// @match        *://q21my.tmall.com/*
// @match        *://xiaohubaoer.tmall.com/*
// @match        *://chopiyopi.tmall.com/*
// @match        *://claragirls.tmall.com/*
// @match        *://ellekids.tmall.com/*
// @match        *://littlenaive.tmall.com/*
// @match        *://opennunu.tmall.com/*
// @match        *://zhilechengzhangjitongzhuang.tmall.com/*
// @match        *://yuanyuangongzhu.tmall.com/*
// @match        *://detail.tmall.com/*
// @grant        GM_download
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';
    const ITEM_INFO_MAP = new Map();

    // ---------- 拦截 XHR ----------
    const realXHR = unsafeWindow.XMLHttpRequest;
    unsafeWindow.XMLHttpRequest = function () {
        const xhr = new realXHR();
        // 监听请求完成，打印响应
        xhr.addEventListener('readystatechange', function () {
            try {
                if (xhr.readyState === 4) {
                    // 获取响应头 Content-Type
                    const contentType = xhr.getResponseHeader('Content-Type');

                    // 判断是否为 JSON 类型
                    if (contentType && contentType.includes('application/json')) {
                        let responseJson = JSON.parse(xhr.responseText);
                        if (responseJson.api === "mtop.taobao.shop.simple.item.fetch") {
                            for (const datum of responseJson.data.data) {
                                ITEM_INFO_MAP.set(datum.title, datum);
                            }
                        }
                    }
                }
            } catch (e) { }
        });

        return xhr;
    };

    const BUTTON_EXIST_ID = "button-fasdfad21dj82198asd";
    // 下载次数
    const DOWNLOAD_COUNT = 60;

    setInterval(() => {
        if (!document.getElementById(BUTTON_EXIST_ID)) {
            let buttonGroup = document.querySelector(".mallSearch-form");
            if (buttonGroup) {
                appendBtn(buttonGroup, doBatchDownload);
            }
            let newIceContainer = document.querySelector("#ice-container > div > div > div");
            if (newIceContainer) {
                appendBtn(newIceContainer, doBatchDownloadNew);
            }
        }
    }, 200);

    function appendBtn(buttonGroup, clickFunc) {
        // 1. 先创建基础按钮
        let downloadBtn = document.createElement("button");
        downloadBtn.btnType = 0;
        downloadBtn.id = BUTTON_EXIST_ID;
        downloadBtn.originalInnerText = "下载前" + DOWNLOAD_COUNT;
        downloadBtn.innerText = downloadBtn.originalInnerText;

        downloadBtn.style.cssText = `
            position: fixed !important;
            top: 50px !important;
            right: 10px !important;
            z-index: 999999 !important;
            border: none !important;
            font-size: 14px !important;
            font-weight: bold !important;
        `;

        // 2. 克隆按钮（彻底清空所有默认/意外绑定的事件）
        const cleanBtn = downloadBtn.cloneNode(true);
        // 兜底清空所有内联事件（克隆已清空，保险起见）
        cleanBtn.onclick = null;
        cleanBtn.onmouseover = null;
        cleanBtn.onmouseout = null;
        cleanBtn.onfocus = null;
        cleanBtn.onblur = null;
        cleanBtn.onmousedown = null;
        cleanBtn.onmouseup = null;

        // 3. 仅绑定核心的点击下载逻辑（绑定到干净的按钮）
        cleanBtn.addEventListener('click', function (e) {
            e.stopPropagation(); // 阻止冒泡
            e.preventDefault(); // 阻止默认行为
            clickFunc.call(this, e);
        });

        // 4. 替换原按钮，添加到页面
        buttonGroup.append(cleanBtn);
    }

    /**
     * 异步睡眠函数（不阻塞页面）
     * @param {number} ms - 睡眠毫秒数（如 300 = 0.3秒）
     * @returns {Promise} - Promise对象，await后执行后续代码
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function downloadImageByImg(imgUrl, fileName = 'download.jpg') {
        return new Promise((resolve, reject) => {
            GM_download({
                url: imgUrl,
                name: fileName,
                onload: resolve,
                onerror: reject
            });
        });
    }

    function downloadTextFile(content, fileName, type = "text/csv; charset=utf-8") {
        // 1. 创建Blob对象（存储文本内容）
        const blob = new Blob([content], {
            type: type
        });
        // 2. 创建临时下载链接
        const blobUrl = URL.createObjectURL(blob);
        // 3. 调用修改后的GM_download（参数格式不变）
        GM_download({
            url: blobUrl,
            name: fileName
        });
    }

    function getCustomDate() {
        const now = new Date();

        // 月份（01~12）
        const month = String(now.getMonth() + 1).padStart(2, '0');
        // 日期（01~31）
        const day = String(now.getDate()).padStart(2, '0');
        // 年份后两位（2026 → 26）
        const yearShort = String(now.getFullYear()).slice(-2);

        // 拼接成 0405_26
        return `${month}${day}_${yearShort}`;
    }

    function getFormattedDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');

        return `${year}/${month}/${day}`;
    }

    /**
     * 逐页滚动：每次下滑一页高度，间隔200ms，一直滑到底部
     * 改成：真人随机滚动 + 随机停顿
     */
    async function scrollPageByPage(breakCondition = () => true) {
        // 获取一屏的高度
        const viewHeight = window.innerHeight;
        let lastScrollTop = 0;

        // 随机睡眠：人操作的停顿（200 - 800ms 随机）
        function randomSleep() {
            const ms = Math.floor(Math.random() * 600) + 200;
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        // 随机滚动距离：不是死板一屏，70% ~ 100% 屏高随机，更像人
        function getRandomScrollDistance() {
            return viewHeight * (0.7 + Math.random() * 0.3); // 0.7~1.0 倍屏高
        }

        while (true) {
            // 每次向下滚动【随机距离】，不是固定一屏
            window.scrollBy({
                top: getRandomScrollDistance(),
                behavior: 'auto' // 平滑滚动更像人
            });

            // 随机停顿
            await randomSleep();

            // 判断是否已经滑到底
            const currentScrollTop = document.documentElement.scrollTop || document.body.scrollTop;
            if (currentScrollTop === lastScrollTop) {
                break; // 无法再滚动，退出循环
            }
            lastScrollTop = currentScrollTop;

            if (!breakCondition()) {
                let totalCount = Math.ceil((document.documentElement.scrollHeight - currentScrollTop) / viewHeight) + 3
                for (let i = 0; i < totalCount; i++) {
                    window.scrollBy({
                        top: getRandomScrollDistance(),
                        behavior: 'auto'
                    });
                    await randomSleep();
                };
                break;
            }
        }
    }

    /**
     * 格式化带单位/加号的数字字符串为纯数字
     * 支持：+、百、千、万、百万
     * @param {string|number} str - 输入值，如 '100+', '5百', '12千', '1万', '100万'
     * @returns {number} 纯数字结果
     */
    function formatToNumber(str) {
        // 转字符串并去除首尾空格
        let value = String(str).trim();

        // 核心修改：只保留 数字、小数点、负号，其他所有字符全部删除
        value = value.replace(/[^\d]/g, '');

        // 处理 百万 → ×1000000
        if (value.includes('百万')) {
            return parseFloat(value.replace('百万', '')) * 1000000;
        }

        // 处理 万 → ×10000
        if (value.includes('万')) {
            return parseFloat(value.replace('万', '')) * 10000;
        }

        // 处理 千 → ×1000
        if (value.includes('千')) {
            return parseFloat(value.replace('千', '')) * 1000;
        }

        // 处理 百 → ×100
        if (value.includes('百')) {
            return parseFloat(value.replace('百', '')) * 100;
        }

        // 普通数字直接返回
        return parseFloat(value) || 0;
    }

    async function doBatchDownload() {
        await scrollPageByPage();

        // 店铺名判空
        const shopNameEl = document.querySelector("#shopExtra > div.slogo > a > strong");
        if (!shopNameEl) return;
        let shopName = shopNameEl.innerText.trim();
        if (!shopName) return;

        // 商品列表判空
        const itemsContainer = document.querySelector("#J_ShopSearchResult > div > div.J_TItems");
        if (!itemsContainer) return;

        let cells = [...itemsContainer.children]
            .flatMap(item => [...item.children])
            .filter(item => item.nodeName === "DL");

        if (!cells || cells.length === 0) return;

        let text = "ID,店铺,图片,链接,销量,日期,价格\n";
        let nowDate = getFormattedDate();
        let fileDate = getCustomDate();
        const priceReg = /discntPrice[:：]\s*(\d+\.?\d*)/;
        let nameIndex = 1;

        // 循环：遇到空 cell 直接停止
        for (let i = 0; i < DOWNLOAD_COUNT; i++) {
            let cell = cells[i];
            if (!cell) break; // 空了 → 停止整个循环

            // 图片节点
            const imgNode = cell.querySelectorAll(".photo img")[0];
            if (!imgNode || !imgNode.src) break;

            // 销量节点
            const salesNode = cell.children?.[2]?.children?.[1]?.children?.[2]?.children?.[0];
            let salesVolume = 0
            if (!salesNode === false) {
                salesVolume = formatToNumber(salesNode.innerText);
            };

            // 价格
            const priceMatch = cell.childNodes?.[5]?.data?.match(priceReg);
            const price = priceMatch ? Number(priceMatch[1]) : 0;

            // 链接
            const linkNode = cell.children?.[0]?.children?.[0];
            if (!linkNode || !linkNode.href) break;
            let itemHref = linkNode.href;

            let itemId = (itemHref.match(/id=(\d+)/) || ['', ''])[1];
            let imgName = `${shopName}.${fileDate}.${nameIndex.toString().padStart(4, '0')}.jpg`;

            downloadImageByImg(imgNode.src, imgName);
            text += `${itemId},${shopName},${imgName},${itemHref},${salesVolume},${nowDate},${price}\n`;

            nameIndex++;
            await sleep(300);
        }

        downloadTextFile(text, `${shopName}.${fileDate}_${shopName}_新品.csv`);
    }

    async function doBatchDownloadNew() {
        const targetSpan = [...document.querySelectorAll('span')].find(el => {
            return el.innerText.trim() === '新品';
        });

        if (targetSpan) {
            const parent = targetSpan.parentElement;
            if (parent) {
                parent.click();
                await sleep(600);
            }
        } else {
            return;
        }

        await scrollPageByPage(() => {
            return document.querySelector('div[data-spm="product_shelf"]')?.childNodes?.[0]?.childElementCount <= DOWNLOAD_COUNT;
        });

        // 店铺名判空
        const shopNameEl = document.querySelector('p[class^="shopName"]');
        if (!shopNameEl) return;
        let shopName = shopNameEl.innerText.trim();
        if (!shopName) return;
        shopName = shopName.replace(/\s+/g, '');

        // 商品列表容器判空
        const shelfContainer = document.querySelector('div[data-spm="product_shelf"]')?.childNodes?.[0];
        if (!shelfContainer) return;

        let cells = shelfContainer.childNodes;
        if (!cells || cells.length === 0) return;

        let text = "ID,店铺,图片,链接,销量,日期,价格\n";
        let nowDate = getFormattedDate();
        let fileDate = getCustomDate();
        let nameIndex = 1;

        // 循环：遇到空 cell 直接停止
        for (let i = 0; i < DOWNLOAD_COUNT; i++) {
            let cell = cells[i];
            if (!cell) break; // 空了 → 停止整个循环

            // 图片节点
            const imgNode = cell.childNodes?.[0]?.childNodes?.[0];
            if (!imgNode || !imgNode.src) break;

            // 标题节点
            const titleNode = cell.childNodes?.[2]?.childNodes?.[0];
            if (!titleNode) break;
            let title = titleNode.innerText;

            let itemInfo = ITEM_INFO_MAP.get(title);
            if (!itemInfo) continue;

            let itemHref = itemInfo.itemUrl;
            let itemId = itemInfo.itemId;
            let salesVolume = formatToNumber(itemInfo.vagueSold365);
            let imgName = `${shopName}.${fileDate}.${nameIndex.toString().padStart(4, '0')}.webp`;

            downloadImageByImg(imgNode.src, imgName);
            text += `${itemId},${shopName},${imgName},${itemHref},${salesVolume},${nowDate},0\n`;

            nameIndex++;
            await sleep(300);
        }

        downloadTextFile(text, `${shopName}.${fileDate}_${shopName}_新品.csv`);
    }

})();
