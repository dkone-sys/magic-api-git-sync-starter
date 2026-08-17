/**
 * MagicAPI Git 手动同步插件 - 编辑器注入脚本（magic-api-git-sync-starter）
 * 接入方式：magic-api.editor-config: classpath:magic-git-sync-editor.js
 * 编辑器页面加载时通过 /magic/web/config-js 执行本脚本。
 * 作用：
 *  1. MAGIC_EDITOR_CONFIG：编辑器官方配置项
 *  2. 注入"拉取"按钮到顶部图标工具栏（登录后工具栏才渲染，天然满足登录后显示）。
 *     定位策略：先按类名找工具栏容器，找不到则按视觉特征（页面上方的横向长条）识别；
 *     注入后自动检测可见性，不可见则固定定位到工具栏右端，保证可见。
 *     图标为 Git 拉取符号，用自身 id 的专属 CSS 复刻工具栏原生图标的尺寸/悬停背景（背景变深，
 *     颜色用编辑器主题变量），并按相邻图标实际位置做像素级对齐；
 *     鼠标悬停显示文字说明，点击同步时图标变蓝（不旋转）。
 *  3. 同步鉴权：复用编辑器登录态，从本地存储读取登录 token 放入 Magic-Token 请求头，
 *     与编辑器自身请求同一套校验，无需配置任何秘钥。
 */
var MAGIC_EDITOR_CONFIG = {
    title: 'magic-api'
};

(function () {
    if (window.__MAGIC_GIT_SYNC_INJECTED__) {
        return;
    }
    window.__MAGIC_GIT_SYNC_INJECTED__ = true;

    var syncing = false;
    var btn = null;
    var lastContainer = null;       // 缓存上次找到的容器，避免反复全页扫描
    var fixedMode = false;          // 容器内不可见时切换为固定定位
    var visibilityChecked = false;  // 可见性诊断只做一次
    var diagLogged = false;         // 诊断日志只打一次

    // Git 拉取符号：向下箭头 + 底部托盘，细线描边风格（与工具栏原生图标线宽一致）
    // 注：编辑器全局 CSS 有 .magic-icon>*{fill:...} 规则，会覆盖 fill 表现属性，故用内联 style 保证着色正确
    var SYNC_PATHS = '<path d="M8 2 v7.5" style="fill:none;stroke:currentColor" stroke-width="1.2" stroke-linecap="round"/>'
        + '<path d="M5 7 L8 10 L11 7" style="fill:none;stroke:currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<path d="M3.5 13.5 h9" style="fill:none;stroke:currentColor" stroke-width="1.2" stroke-linecap="round"/>';

    var BTN_TEXT = '拉取';
    var btnColor = ''; // 图标常态颜色（取自其他工具栏图标并加深，跟随主题）
    var tip = null; // 悬停文字提示

    // 将 rgb/rgba 颜色按比例加深（0~1，越小越深）
    function darken(color, factor) {
        var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
        if (!m) {
            return null;
        }
        return 'rgb(' + Math.round(m[1] * factor) + ',' + Math.round(m[2] * factor) + ',' + Math.round(m[3] * factor) + ')';
    }

    // 从本地存储读取编辑器登录 token（登录响应头 Magic-Token 由编辑器写入，键名含 token，前缀 magic-）
    function getMagicToken() {
        var fallback = '';
        try {
            var storages = [window.localStorage, window.sessionStorage];
            for (var s = 0; s < storages.length; s++) {
                var storage = storages[s];
                if (!storage) {
                    continue;
                }
                for (var i = 0; i < storage.length; i++) {
                    var key = storage.key(i);
                    if (!key || key.toLowerCase().indexOf('token') === -1) {
                        continue;
                    }
                    var value = storage.getItem(key);
                    if (!value) {
                        continue;
                    }
                    // 兼容整体存储登录响应的情况，尝试提取其中的 token 字段
                    if (value.charAt(0) === '{') {
                        try {
                            var obj = JSON.parse(value);
                            var t = (obj && (obj.token || (obj.data && obj.data.token))) || '';
                            if (!t) {
                                continue;
                            }
                            value = t;
                        } catch (e) {
                            // 非 JSON，直接用原值
                        }
                    }
                    // 优先取带 magic 前缀的键（编辑器固定存储格式），避免误读同源下其他应用的 token
                    if (key.toLowerCase().indexOf('magic') !== -1) {
                        return value;
                    }
                    if (!fallback) {
                        fallback = value;
                    }
                }
            }
        } catch (e) {
            // 存储不可用时返回空，由后端按未登录处理
        }
        return fallback;
    }

    // 专属样式：不用 magic-icon 类（会被编辑器全局规则 height:100% 等干扰），
    // 悬停背景用编辑器主题变量，效果与其他图标完全一致
    if (!document.getElementById('magic-git-sync-style')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'magic-git-sync-style';
        styleEl.innerHTML = '#magic-git-sync-btn{display:inline-block;width:18px;height:18px;cursor:pointer;'
            + 'border-radius:3px;flex-shrink:0;vertical-align:middle}'
            + '#magic-git-sync-btn:hover{background-color:var(--main-hover-icon-background-color,#f2f3f5)}';
        (document.head || document.body).appendChild(styleEl);
    }

    function showTip() {
        if (!btn || syncing) {
            return;
        }
        if (!tip) {
            tip = document.createElement('div');
            tip.style.cssText = 'position: fixed; z-index: 2147483647; padding: 4px 10px; background: #303133;'
                + ' color: #fff; font-size: 12px; border-radius: 4px; white-space: nowrap;'
                + ' box-shadow: 0 2px 8px rgba(0,0,0,.25); pointer-events: none;';
            document.body.appendChild(tip);
        }
        tip.innerText = BTN_TEXT;
        tip.style.display = 'block';
        var r = btn.getBoundingClientRect();
        tip.style.left = Math.max(4, r.left + r.width / 2 - tip.offsetWidth / 2) + 'px';
        tip.style.top = (r.bottom + 6) + 'px';
    }

    function hideTip() {
        if (tip) {
            tip.style.display = 'none';
        }
    }

    // ===================== 构建按钮（svg + 专属 id 样式，悬停背景由上方 CSS 提供） =====================
    function buildButton(host) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        el.id = 'magic-git-sync-btn';
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('viewBox', '0 0 16 16');
        el.innerHTML = SYNC_PATHS;
        el.title = BTN_TEXT;
        el.onmouseover = showTip;
        el.onmouseout = hideTip;
        el.onclick = doSync;
        // 从容器内的原生图标取常态颜色（自动适配明暗主题）；不复制类名与 scoped 属性，避免被全局规则干扰
        var nativeIcon = null;
        if (host) {
            var icons = host.querySelectorAll('.magic-icon');
            for (var n = 0; n < icons.length; n++) {
                if (icons[n].id !== 'magic-git-sync-btn') {
                    nativeIcon = icons[n];
                    break;
                }
            }
        }
        if (nativeIcon) {
            var fill = window.getComputedStyle(nativeIcon).fill;
            // 在相邻图标颜色基础上加深 40%，更醒目且与主题协调
            var darker = fill ? darken(fill, 0.6) : null;
            el.style.color = darker || fill;
        }
        if (!el.style.color) {
            el.style.color = '#4c5561';
        }
        if (!nativeIcon) {
            // 固定定位模式（不在工具栏内）时补一个间距
            el.style.margin = '0 2px';
        }
        btnColor = el.style.color;
        return el;
    }

    // 像素级对齐：完全克隆相邻原生图标的盒子（宽/高/顶部位置）
    function alignBtn(host) {
        if (!btn || !host) {
            return;
        }
        var neighbor = btn.previousElementSibling || btn.nextElementSibling;
        if (!neighbor || !neighbor.classList || !neighbor.classList.contains('magic-icon')) {
            // 相邻元素不是图标时，在容器内任找一个原生图标
            var icons = host.querySelectorAll('.magic-icon');
            neighbor = null;
            for (var i = 0; i < icons.length; i++) {
                if (icons[i].id !== 'magic-git-sync-btn') {
                    neighbor = icons[i];
                    break;
                }
            }
        }
        if (!neighbor) {
            return;
        }
        var nb = neighbor.getBoundingClientRect();
        // 尺寸照抄相邻图标，保证盒子完全一致
        btn.style.width = nb.width + 'px';
        btn.style.height = nb.height + 'px';
        var rb = btn.getBoundingClientRect();
        var cur = parseFloat(btn.style.marginTop) || 0;
        var fix = cur + nb.top - rb.top; // 顶部对齐
        btn.style.marginTop = Math.round(fix * 10) / 10 + 'px';
    }

    function elVisible(el) {
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) {
            return false;
        }
        var style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    // ===================== 定位工具栏容器 =====================
    function pickContainer() {
        // 策略1：按已知类名找（只排除 display:none 的实例）
        var selectors = ['.magic-toolbar-header-buttons', '.magic-toolbar-header', '.magic-toolbar'];
        for (var s = 0; s < selectors.length; s++) {
            var list = document.querySelectorAll(selectors[s]);
            for (var i = 0; i < list.length; i++) {
                var el = list[i];
                var r = el.getBoundingClientRect();
                if (r.width > 100 && r.height > 10 && r.top < 300 && elVisible(el)) {
                    return { el: el, by: 'class:' + el.className };
                }
            }
        }
        // 策略2：视觉特征——页面上方、横向、有一定高度的长条（工具栏）
        var best = null;
        var divs = document.querySelectorAll('div');
        for (var d = 0; d < divs.length; d++) {
            var div = divs[d];
            var rect = div.getBoundingClientRect();
            if (rect.top >= 0 && rect.top < 80 && rect.height > 24 && rect.height < 72
                && rect.width > window.innerWidth * 0.7 && div.childElementCount >= 3
                && elVisible(div)) {
                // 取最"薄"的一条，避免选到整个应用外壳
                if (!best || rect.height < best.getBoundingClientRect().height) {
                    best = div;
                }
            }
        }
        if (best) {
            return { el: best, by: 'bar:' + best.className };
        }
        return null;
    }

    function removeBtn() {
        if (btn && btn.parentElement) {
            btn.parentElement.removeChild(btn);
        }
    }

    // 固定定位：紧贴在工具栏右端
    function placeFixed(rect) {
        removeBtn();
        btn = buildButton(null);
        btn.style.cssText += ' position: fixed; z-index: 2147483647; margin: 0;'
            + ' top: ' + (rect.top + Math.max(0, (rect.height - 22) / 2)) + 'px;'
            + ' left: ' + (rect.right - 80) + 'px;';
        document.body.appendChild(btn);
        console.log('[git-sync] 已切换为固定定位，位于工具栏右端');
    }

    // ===================== 注入（幂等，Vue 重渲染后自动补挂） =====================
    function ensureInjected() {
        if (btn && btn.parentElement && !fixedMode) {
            return; // 已正常挂载
        }
        if (fixedMode && btn && btn.parentElement) {
            return; // 固定定位模式正常
        }
        var found = null;
        // 优先复用缓存的容器（避免每次都全页扫描 div 引发布局重排）
        if (lastContainer && document.body.contains(lastContainer) && elVisible(lastContainer)) {
            found = { el: lastContainer, by: 'cache' };
        } else {
            found = pickContainer();
        }
        if (!found) {
            if (!diagLogged) {
                diagLogged = true;
                console.warn('[git-sync] 未找到工具栏容器（未登录或页面尚未渲染完成）');
            }
            return;
        }
        if (fixedMode) {
            placeFixed(found.el.getBoundingClientRect());
            return;
        }
        removeBtn();
        btn = buildButton(found.el);
        found.el.appendChild(btn);
        lastContainer = found.el;
        console.log('[git-sync] 按钮已放入容器（' + found.by + '）');
        // 等布局稳定后按相邻图标校准垂直位置
        setTimeout(function () { alignBtn(found.el); }, 60);

        // 首次注入后诊断一次：按钮是否真的可见
        if (!visibilityChecked) {
            visibilityChecked = true;
            setTimeout(function () {
                if (!btn || !btn.parentElement) {
                    return;
                }
                var r = btn.getBoundingClientRect();
                var shown = r.width > 0 && r.height > 0 && window.getComputedStyle(btn).display !== 'none';
                if (!shown) {
                    console.warn('[git-sync] 容器内按钮不可见，切换为固定定位');
                    fixedMode = true;
                    placeFixed(found.el.getBoundingClientRect());
                } else {
                    console.log('[git-sync] 按钮可见，位置 left=' + Math.round(r.left) + ' top=' + Math.round(r.top));
                }
            }, 800);
        }
    }

    // ===================== 同步逻辑 =====================
    function showToast(text, isError) {
        var toast = document.createElement('div');
        toast.innerText = text;
        toast.style.cssText = 'position: fixed; top: 60px; right: 20px; z-index: 2147483647; padding: 10px 16px;'
            + ' background: ' + (isError ? '#f56c6c' : '#67c23a') + '; color: #fff; border-radius: 4px;'
            + ' font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,.2);';
        document.body.appendChild(toast);
        setTimeout(function () {
            if (toast.parentElement) {
                document.body.removeChild(toast);
            }
        }, 3000);
    }

    function doSync() {
        if (syncing) {
            return;
        }
        syncing = true;
        hideTip();
        btn.style.color = '#0075ff';
        btn.title = '拉取中...';
        // 页面位于 /magic/web/ 下，../git-sync 解析为 /magic/git-sync；
        // Magic-Token 为编辑器统一登录态请求头，后端与内置 /reload 同一套校验
        fetch('../git-sync', {
            method: 'POST',
            headers: { 'Magic-Token': getMagicToken() }
        }).then(function (resp) {
            return resp.json();
        }).then(function (data) {
            showToast(data.message, data.code !== 200);
        }).catch(function (err) {
            showToast('同步请求失败：' + err.message, true);
        }).finally(function () {
            syncing = false;
            if (btn) {
                btn.style.color = btnColor || '#707a86';
                btn.title = BTN_TEXT;
            }
        });
    }

    // ===================== 启动 =====================
    // 延迟首次注入，等编辑器把工具栏渲染出来
    setTimeout(ensureInjected, 500);
    // 编辑器（Monaco）会产生海量 DOM 变更，观察器回调必须节流，否则会拖慢页面
    var obTimer = null;
    var observer = new MutationObserver(function () {
        // 按钮还在就不做任何事；丢失时延迟 200ms 合并处理，避免频繁触发
        if (btn && btn.parentElement) {
            return;
        }
        if (obTimer) {
            return;
        }
        obTimer = setTimeout(function () {
            obTimer = null;
            if (!btn || !btn.parentElement) {
                ensureInjected();
            }
        }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[git-sync] magic-git-sync-editor.js 已加载（magic-api-git-sync-starter v1.0.0）');
})();
