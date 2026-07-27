// ==UserScript==
// @name         TBD
// @namespace    http://tampermonkey.net/
// @version      2026-07-27
// @description  try to take over the world!
// @author       deycoesr@gmail.com
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
    const DOWNLOAD_COUNT = 100;

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
     * 过滤店铺名称，去除符号和空格
     * @param {string} shopName - 原始店铺名称
     * @returns {string} 过滤后的店铺名称
     */
    function filterShopName(shopName) {
        // 去除常见符号：括号、横线、空格等
        return shopName
            .replace(/[\s（）()[\]【】\-——_\-\/\\|！!？?。.，,、；;：:""''"'《》<>~`@#$%^&*+={}]/g, '');
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

    /**
     * 逐页滚动：每次下滑一页高度，间隔200ms，一直滑到底部
     */
    async function scrollPageByPage(breakCondition = () => true) {
        // 获取一屏的高度
        const viewHeight = window.innerHeight;
        let lastScrollTop = 0;

        while (true) {
            // 每次向下滚动 1 屏高度
            window.scrollBy({
                top: viewHeight,
                behavior: 'auto'
            });

            await sleep(500);

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
                        top: viewHeight,
                        behavior: 'auto'
                    });
                    await sleep(500);
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
        let shopName = filterShopName(document.querySelector("#shopExtra > div.slogo > a > strong").innerText);
        let nameIndex = 1;
        let cells = [...document.querySelector("#J_ShopSearchResult > div > div.J_TItems").children];
        cells = cells.slice(0, cells.findIndex(i => i.className === "pagination") || cells.length);
        cells = cells.flatMap(item => [...item.children]).filter(item => item.nodeName === "DL");
        let text = "ID,店铺,图片,链接,销量,日期,价格\n";
        let nowDate = new Date().getTime();
        let fileDate = getCustomDate();
        const priceReg = /discntPrice[:：]\s*(\d+\.?\d*)/;
        for (let i = 0; i < DOWNLOAD_COUNT; i++) {
            let cell = cells[i];
            let imgName = `${shopName}.${fileDate}.${nameIndex.toString().padStart(4, '0')}.jpg`;
            downloadImageByImg(cell.children[0]?.children[0]?.children[0]?.src, imgName);
            let salesVolume = formatToNumber(cell.children[2]?.children[1]?.children[2]?.children[0]?.innerText);
            const priceMatch = cell.childNodes[5].data.match(priceReg);
            const price = priceMatch ? Number(priceMatch[1]) : 0;
            let itemHref = cell.children[0].children[0].href;
            let itemId = (itemHref.match(/id=(\d+)/) || ['', ''])[1];
            text = text + `${itemId},${shopName},${imgName},${itemHref},${salesVolume},${nowDate},${price}\n`
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
            parent.click();
            await sleep(600);
        } else {
            return;
        }

        await scrollPageByPage(() => {
            document.querySelector('div[data-spm="product_shelf"]').childNodes[0].childElementCount <= DOWNLOAD_COUNT
        });
        let shopName = filterShopName(document.querySelector('p[class^="shopName"]').innerText);
        let nameIndex = 1;
        let cells = document.querySelector('div[data-spm="product_shelf"]').childNodes[0].childNodes;
        let text = "ID,店铺,图片,链接,销量,日期,价格\n";
        let nowDate = new Date().getTime();
        let fileDate = getCustomDate();
        for (let i = 0; i < DOWNLOAD_COUNT; i++) {
            let cell = cells[i];
            let imgName = `${shopName}.${fileDate}.${nameIndex.toString().padStart(4, '0')}.webp`;
            downloadImageByImg(cell.childNodes[0].src, imgName);

            const price = 0;

            let title = cell.childNodes[2].childNodes[0].innerText;
            let itemInfo = ITEM_INFO_MAP.get(title)
            if (itemInfo == null) {
                continue;
            }
            let itemHref = itemInfo.itemUrl;
            let itemId = itemInfo.itemId;
            let salesVolume = formatToNumber(itemInfo.vagueSold365);
            text = text + `${itemId},${shopName},${imgName},${itemHref},${salesVolume},${nowDate},${price}\n`
            nameIndex++;
            await sleep(300);
        }
        downloadTextFile(text, `${shopName}.${fileDate}_${shopName}_新品.csv`);
    }

})();
