// Links Web - DOM UI
//
// Replaces hecken.h's immediate-mode icon/value widgets (Common/icon.h,
// Common/value.h, hecken::initInterface/gui/drawHelp) with real DOM
// elements. The interaction model is kept deliberately close to the
// original rather than a generic "slider" UI: per the manual
// (https://signed.bufsiz.jp/Links.html, recovered via cp932 decode - see
// project notes) parameters are edited by hovering + scrolling the mouse
// wheel, middle-click cycles edit sensitivity (普通→多い→少ない→普通, i.e.
// mid->high->low->mid, value.h's `mode` enum), and double-click opens a
// direct numeric entry (Escape cancels). Toggle-style icons keep the
// original's "caption describes the action a click performs" convention.

class UI {
    constructor(sim, graphics, callbacks) {
        this.sim = sim;
        this.g = graphics;
        this.callbacks = callbacks;

        this.toolbar = document.getElementById('toolbar');
        this.hiddenModeRow = document.getElementById('hidden-mode-row');
        this.paramPanel = document.getElementById('param-panel');
        this.helpBar = document.getElementById('help-bar');
        this.logContainer = document.getElementById('log-container');
        this.modalOverlay = document.getElementById('modal-overlay');
        this.modalText = document.getElementById('modal-text');
        this.modalButtons = document.getElementById('modal-buttons');
        this.canvasWrap = document.getElementById('canvas-wrap');
        this.canvas = document.getElementById('main-canvas');
        this.fileInput = document.getElementById('file-input');
        this.dxfFileInput = document.getElementById('dxf-file-input');

        this._defaultHelpText = 'ヘルプ：アイコンをクリックし機能を呼び出すか、パラメータ上でホイールを回転させ値を変更して下さい';
        this._rowState = new Map(); // per-parameter wheel-sensitivity, keyed by row key
        this._toolbarRenderers = []; // rebuilt once, in _buildToolbar/_buildHiddenModeRow
        this._rowRenderers = []; // rebuilt every refreshParamPanel() call
        this._betaFeaturesVisible = false; // beta-features row starts collapsed every load (not persisted)

        this._buildDarkModeToggle();
        this._buildToolbar();
        this._buildHiddenModeRow();
        this._applyBetaFeaturesVisibility();
        this._buildFileIo();
        this.refreshParamPanel();
        this._setupDragDrop();
        this._setupShiftTracking();

        this.setHelp(null);
    }

    // --- dark mode (instruction doc §1/§2 - a single light/dark toggle
    // replaces the old free-form background-brightness slider, driving the
    // CSS theme and the canvas background together). ------------------------

    _buildDarkModeToggle() {
        const cfg = Config.load();
        this._setDarkMode(!!cfg.darkMode);
    }

    _setDarkMode(on) {
        document.body.classList.toggle('dark', on);
        this.sim.bgColor = on ? 0 : 255;
        this.g.backgroundColor = on ? 'rgb(0,0,0)' : 'rgb(255,255,255)';
        Config.save({ darkMode: on });
    }

    // --- logging / help bar -------------------------------------------------

    log(message) {
        const p = document.createElement('p');
        p.innerHTML = message;
        this.logContainer.appendChild(p);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
        while (this.logContainer.children.length > 100) this.logContainer.removeChild(this.logContainer.firstChild);
    }

    setHelp(text) {
        this.helpBar.textContent = text || this._defaultHelpText;
    }

    _formatNumber(v) {
        return Number.isFinite(v) ? v.toFixed(2) : String(v);
    }

    // --- modal dialog (replaces messageOK/messageYN/messageYNC) -------------

    /** Shows a modal with the given buttons; resolves with the clicked button's value. */
    showModal(text, buttons) {
        return new Promise((resolve) => {
            this.modalText.textContent = text;
            this.modalButtons.innerHTML = '';
            for (const b of buttons) {
                const btn = document.createElement('button');
                btn.className = 'icon-btn';
                btn.textContent = b.label;
                btn.addEventListener('click', () => {
                    this.modalOverlay.style.display = 'none';
                    resolve(b.value);
                });
                this.modalButtons.appendChild(btn);
            }
            this.modalOverlay.style.display = 'flex';
        });
    }

    showInfo(text) {
        return this.showModal(text, [{ label: 'OK', value: true }]);
    }

    showConfirm(text, yesLabel = 'はい', noLabel = 'いいえ') {
        return this.showModal(text, [{ label: yesLabel, value: true }, { label: noLabel, value: false }]);
    }

    /** Three-way Yes/No/Cancel, mirroring messageYNC's IDYES/IDNO/IDCANCEL. */
    showConfirmCancel(text) {
        return this.showModal(text, [
            { label: 'はい', value: 'yes' },
            { label: 'いいえ', value: 'no' },
            { label: 'キャンセル', value: 'cancel' },
        ]);
    }

    /**
     * Fallback for clipboard-API failures - shows the text in a selectable
     * textarea, mirroring the original's advice to copy it from cadcmd.txt
     * by hand when the clipboard icon didn't work (manual: "アイコンを押し
     * てもコマンド群がクリップボードにペーストされない場合は...").
     */
    showTextDump(text, introText) {
        return new Promise((resolve) => {
            this.modalText.textContent = introText;
            this.modalButtons.innerHTML = '';

            const textarea = document.createElement('textarea');
            textarea.readOnly = true;
            textarea.value = text;
            textarea.style.cssText = 'width:100%;height:180px;background:#111;color:#eee;border:1px solid #3a3a3a;border-radius:3px;font-size:11px;margin-bottom:10px;';
            this.modalText.after(textarea);
            textarea.addEventListener('focus', () => textarea.select());

            const closeBtn = document.createElement('button');
            closeBtn.className = 'icon-btn';
            closeBtn.textContent = '閉じる';
            closeBtn.addEventListener('click', () => {
                this.modalOverlay.style.display = 'none';
                textarea.remove();
                resolve();
            });
            this.modalButtons.appendChild(closeBtn);
            this.modalOverlay.style.display = 'flex';
            textarea.focus();
        });
    }

    // --- toolbar -------------------------------------------------------------

    /**
     * `icon`/`iconOn` are filenames under icons/ - the original app's own
     * toolbar bitmaps (icons/src/*.bmp, converted by icons/src/convert.py).
     * For toggle buttons the original swapped icon graphics the same way it
     * swapped caption text (see class header comment): `icon` shows while
     * inactive, `iconOn` while active - e.g. mdxf shows the "DXF" icon while
     * viewing the optimized curve (inviting a click to switch to DXF) and
     * the "optimize" icon while viewing DXF (hecken.h:706).
     */
    _makeButton(container, { text, help, onClick, toggleGetter, activeClass = 'active', icon, iconOn, emoji, emojiOn, disabledGetter }) {
        const btn = document.createElement('button');
        btn.className = 'icon-btn';
        btn.type = 'button';

        let img = null;
        if (icon) {
            img = document.createElement('img');
            img.className = 'icon-img';
            img.alt = '';
            btn.appendChild(img);
        }
        // No original bitmap exists for a couple of new (non-Win-app)
        // controls, e.g. the dark-mode toggle - an emoji glyph fills the
        // same "icon-only" slot instead so §4's icon-only rule still holds.
        let emojiSpan = null;
        if (emoji) {
            emojiSpan = document.createElement('span');
            emojiSpan.className = 'icon-img icon-emoji';
            btn.appendChild(emojiSpan);
        }
        const label = document.createElement('span');
        label.className = 'icon-label';
        btn.appendChild(label);

        const render = () => {
            const active = toggleGetter ? !!toggleGetter() : false;
            const name = typeof text === 'function' ? text() : text;
            label.textContent = name;
            if (toggleGetter) btn.classList.toggle(activeClass, active);
            // The native tooltip (what actually appears "when pointing at"
            // an icon) shows the short function name - the same text this
            // button used before icons hid it (see class header) - while
            // the persistent help bar below keeps the longer description.
            btn.title = name;
            if (img) img.src = `icons/${(active && iconOn) ? iconOn : icon}`;
            if (emojiSpan) emojiSpan.textContent = (active && emojiOn) ? emojiOn : emoji;
            if (disabledGetter) btn.disabled = !!disabledGetter();
        };
        render();
        btn.addEventListener('click', (e) => onClick(e, render));
        btn.addEventListener('pointerenter', () => this.setHelp(typeof help === 'function' ? help() : help));
        btn.addEventListener('pointerleave', () => this.setHelp(null));
        container.appendChild(btn);
        this._toolbarRenderers.push(render);
        return { el: btn, render };
    }

    _buildToolbar() {
        const sim = this.sim;

        this._makeButton(this.toolbar, {
            text: 'DXF読込', icon: 'new.png',
            help: 'DXF95/2000年形式で保存されたファイルのポリラインと円のみ読み込めます　回転の中心を原点に指定して下さい',
            onClick: () => this.callbacks.runDxfLoadFlow(),
        });
        this._makeButton(this.toolbar, {
            text: '開く', icon: 'open.png',
            help: '拡張子問わずLinksで保存したファイルのみ開けます。ドラッグ＆ドロップでも可能。',
            onClick: () => this.fileInput.click(),
        });
        this._makeButton(this.toolbar, {
            text: '上書き保存', icon: 'save.png',
            help: '保存してない場合は、名前を付けて保存をします',
            onClick: () => this.callbacks.saveFile(),
        });
        this._makeButton(this.toolbar, {
            text: '名前を付けて保存', icon: 'saveas.png',
            help: '拡張子は保存/読込みには関係無いので何でも構いません。',
            onClick: () => this.callbacks.saveFile(true),
        });

        this._makeButton(this.toolbar, {
            text: () => (sim.menu.mpara.value ? 'パラメータ表を隠す' : 'パラメータ表を表示'),
            icon: 'menuon.png', iconOn: 'close.png',
            help: 'パラメータ表は，数値をホイール回転などにより操作する表です　ダブルクリックで直接入力，ホイールクリックで回転時の増加量が変化します',
            toggleGetter: () => sim.menu.mpara.value,
            onClick: (e, render) => {
                sim.menu.mpara.value = !sim.menu.mpara.value;
                this.paramPanel.parentElement.style.display = sim.menu.mpara.value ? '' : 'none';
                render();
            },
        });
        this._makeButton(this.toolbar, {
            text: () => (sim.menu.mstop.value ? '停止' : '再生'),
            icon: 'start.png', iconOn: 'stop.png',
            help: '調整をする際には回転を停止させホイールで角度を変えると確認しやすいです',
            toggleGetter: () => sim.menu.mstop.value,
            onClick: (e, render) => { sim.menu.mstop.value = !sim.menu.mstop.value; render(); },
        });
        this._makeButton(this.toolbar, {
            text: () => (sim.menu.mturn.value ? '反時計回り' : '時計回り'),
            icon: 'lturn.png', iconOn: 'rturn.png',
            help: '回転方向を切替えます',
            toggleGetter: () => sim.menu.mturn.value,
            onClick: (e, render) => { sim.menu.mturn.value = !sim.menu.mturn.value; render(); },
        });
        this._makeButton(this.toolbar, {
            text: () => (sim.dxf ? '最適化曲線表示' : 'DXF表示'),
            // hecken.h:706 - icon follows the same "shows the action" convention
            // as the caption: DXF-icon while viewing the curve, opt-icon while viewing DXF.
            icon: 'dxf.png', iconOn: 'opt.png',
            help: '最適化曲線表示と読込んだDXF表示（読込んでない場合は何も表示されません）を切替えします',
            toggleGetter: () => sim.dxf,
            onClick: (e, render) => { sim.setDxfMode(!sim.dxf); this.refreshParamPanel(); render(); },
        });
        this._makeButton(this.toolbar, {
            text: 'リンクサイド変更', icon: 'lside.png', help: 'リンク機構を他の向きに変更する。',
            onClick: () => sim.toggleSide(),
        });

        this._makeButton(this.toolbar, {
            text: 'DXFファイルを出力', icon: 'pasteDXF.png',
            help: 'この画面と同じものがDXFファイルとして出力されます　Shiftを押しながらクリックすると脚のみが、Ctrlではシルエットが作図されます。',
            onClick: (e) => this.callbacks.exportDxf(e.shiftKey, e.ctrlKey),
        });

        this._makeButton(this.toolbar, {
            text: () => (sim.exist_frontleg_orbit || sim.exist_rearleg_orbit ? '端部軌道を隠す' : '端部軌道を表示'),
            icon: 'orbit.png',
            help: () => (sim.dxf
                ? '最適化曲線の端部軌道です。DXF表示中は表示対象がないため無効です。'
                : '最適化曲線の端部軌道を表示します'),
            toggleGetter: () => sim.exist_frontleg_orbit || sim.exist_rearleg_orbit,
            disabledGetter: () => sim.dxf,
            onClick: (e, render) => { sim.toggleBothLegOrbits(); render(); },
        });
        this._makeButton(this.toolbar, {
            text: '動画出力', icon: 'anime.png',
            help: '現在の描画範囲をそのままWebM動画として出力します',
            onClick: () => this.callbacks.startAnimationCapture(),
        });
        this._makeButton(this.toolbar, {
            text: () => (document.body.classList.contains('dark') ? 'ライトモード' : 'ダークモード'),
            emoji: '🌙', emojiOn: '☀',
            help: '画面配色をダーク/ライトで切替えます',
            toggleGetter: () => document.body.classList.contains('dark'),
            onClick: (e, render) => { this._setDarkMode(!document.body.classList.contains('dark')); render(); },
        });
        this._makeButton(this.toolbar, {
            text: () => (this._betaFeaturesVisible ? 'ベータ版機能を隠す' : 'ベータ版機能表示'),
            icon: 'property.png',
            help: 'アークスライダ/デュアルスライダ/ヴァーティカル/ダブルクランク等の試験的な機能と、AutoCADコマンド出力を表示します',
            toggleGetter: () => this._betaFeaturesVisible,
            onClick: (e, render) => {
                this._betaFeaturesVisible = !this._betaFeaturesVisible;
                this._applyBetaFeaturesVisibility();
                render();
            },
        });
    }

    _applyBetaFeaturesVisibility() {
        this.hiddenModeRow.classList.toggle('hidden', !this._betaFeaturesVisible);
    }

    _buildHiddenModeRow() {
        const sim = this.sim;
        this._makeButton(this.hiddenModeRow, {
            text: () => (sim.arcmode ? '通常モードへ' : 'アークスライダモードへ'),
            help: 'DXF読込時の確認文言のみ変わります（元のアプリでも機構計算自体は変わりません）',
            onClick: (e, render) => { sim.setArcMode(!sim.arcmode); render(); },
        });
        this._makeButton(this.hiddenModeRow, {
            text: () => (sim.menu.mdsmode.value ? '通常モードへ' : 'デュアルスライダモードへ'),
            onClick: (e, render) => { sim.setDualSliderMode(!sim.menu.mdsmode.value); this.refreshParamPanel(); render(); },
        });
        this._makeButton(this.hiddenModeRow, {
            text: () => (sim.menu.mvtmode.value ? '通常モードへ' : 'ヴァーティカルモードへ(不可逆)'),
            help: '最適化曲線の別アルゴリズムです　切替えるとシフト位置が上書きされます',
            onClick: (e, render) => { sim.setVerticalMode(!sim.menu.mvtmode.value); render(); },
        });
        this._makeButton(this.hiddenModeRow, {
            text: () => (sim.doublecrank ? '通常モードへ' : 'ダブルクランクモードへ'),
            onClick: (e, render) => { sim.setDoubleCrankMode(!sim.doublecrank); this.refreshParamPanel(); render(); },
        });
        this._makeButton(this.hiddenModeRow, {
            text: () => (sim.exist_maxmin_length ? '通常モードへ' : '長さ表示モードへ'),
            onClick: (e, render) => { sim.setMaxMinLengthMode(!sim.exist_maxmin_length); render(); },
        });
        this._makeButton(this.hiddenModeRow, { text: '脚前部軌道表示', onClick: () => sim.toggleFrontLegOrbit() });
        this._makeButton(this.hiddenModeRow, { text: '脚後部軌道表示', onClick: () => sim.toggleRearLegOrbit() });
        this._makeButton(this.hiddenModeRow, { text: '隠し軌道表示', onClick: () => sim.toggleSecretOrbit() });
        this._makeButton(this.hiddenModeRow, {
            text: 'AutoCADコマンドをコピー',
            help: 'AutoCADのコマンドラインに貼付けると，この画面と同じように作図されます　Shiftを押しながらクリックすると脚のみが、Ctrlではシルエットが作図されます。',
            onClick: (e) => this.callbacks.copyAutoCadCommand(e.shiftKey, e.ctrlKey),
        });
    }

    _buildFileIo() {
        this.fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            const text = await file.text();
            await this.callbacks.openFileText(text, file.name);
        });
    }

    // --- parameter panel -----------------------------------------------------

    _paramRowDefs() {
        const sim = this.sim, g = this.g;
        const rows = [];

        rows.push({ key: 'updown', label: '上下動', get: () => sim.updown, locked: true,
            help: '計算により求められた上下動です　これに限って編集はできません' });
        rows.push({ key: 'resol', label: '解円度', get: () => sim.resol, set: (v) => { sim.resol = v; }, magni: 1,
            help: '円一周辺りの計算回数です　多いほど精度と計算負荷が高くなります' });
        rows.push({ key: 'theta', label: '回転角度', get: () => sim.theta, set: (v) => { sim.theta = v; }, magni: 5,
            help: '現在の基準クランクの角度です　自動で変わりますが編集も可能です' });
        rows.push({ key: 'object', label: 'オブジェクト数', get: () => sim.object, set: (v) => { sim.object = v; }, magni: 1,
            help: 'オブジェクト（リンク）の数です　大量にすればシルエットが得られます' });
        rows.push({ key: 'scale', label: '表示倍率', get: () => g.scale, set: (v) => { g.scale = v; }, magni: 0.2,
            help: '表示倍率です　拡大しても計算の精度には関係しません' });
        rows.push({ key: 'tilt', label: '傾き', get: () => sim.tilt, set: (v) => { sim.tilt = v; }, magni: 1,
            help: 'リンク機構を一時的に傾けることができます　傾けたままで保存すると、その形状のまま保存されます' });
        rows.push({ key: 'roll', label: () => `毎分回転数${sim.timeover ? '(重い)' : ''}`, get: () => sim.roll, set: (v) => { sim.roll = v; }, magni: 1,
            help: '毎分回転数です　ゆっくりしたい場合は，停止して回転角度を変化させると便利です' });
        rows.push({ key: 'crankr', label: 'クランク半径', get: () => sim.crankr, set: (v) => { sim.crankr = v; }, magni: 1, focusKey: 'crankr',
            help: 'クランク半径です　大きくしすぎるとリンク機構が成立しづらくなります' });
        rows.push({ key: 'conrod', label: 'コンロッド長さ', get: () => sim.conrod, set: (v) => { sim.conrod = v; }, magni: 1, focusKey: 'conrod',
            help: 'コンロッド長さです　スライダリンクの場合は計算に影響しません' });
        rows.push({ key: 'leverr', label: () => (sim.leverr ? 'レバー長さ' : 'スライダ(レバー長さ)'), get: () => sim.leverr, set: (v) => { sim.leverr = v; }, magni: 1, focusKey: 'leverr',
            help: 'レバー長さです　０にするとスライダリンクに差し変わります' });

        if (!sim.doublecrank) {
            rows.push({ key: 'leverx', label: () => (sim.leverr ? 'レバーＸ座標' : 'スライダＸ座標'), get: () => sim.lever.x, set: (v) => { sim.lever.x = v; }, magni: 1, focusKey: 'leverx',
                help: 'レバー（スライダ）支点のX座標です　クランク中心が原点で，右が＋です' });
            rows.push({ key: 'levery', label: () => (sim.leverr ? 'レバーＹ座標' : 'スライダＹ座標'), get: () => sim.lever.y, set: (v) => { sim.lever.y = v; }, magni: 1, focusKey: 'levery',
                help: 'レバー（スライダ）支点のY座標です　クランク中心が原点で，下が＋です' });
        }

        rows.push({ key: 'shiftx', label: 'シフトＸ距離', get: () => sim.shift.x, set: (v) => { sim.shift.x = v; }, magni: 1, focusKey: 'shiftx',
            help: '軌道を表示する為にクランクからずらす距離のX成分です' });
        rows.push({ key: 'shifty', label: 'シフトＹ距離', get: () => sim.shift.y, set: (v) => { sim.shift.y = v; }, magni: 1, focusKey: 'shifty',
            help: '軌道を表示する為にクランクからずらす距離のY成分です' });

        if (!sim.dxf) {
            rows.push({ key: 'mini', label: '最適化曲線前幅', get: () => sim.mini, set: (v) => { sim.mini = v; }, magni: 2, focusKey: 'mini',
                help: '最適化曲線の前部の幅です　大きいと上下動が少なくなりやすくなります' });
            rows.push({ key: 'max', label: '最適化曲線後幅', get: () => sim.max, set: (v) => { sim.max = v; }, magni: 2, focusKey: 'max',
                help: '最適化曲線の後部の幅です　ピッチが大きいと繰り上がりの関係で変化しない場合があります' });
            rows.push({ key: 'step', label: '最適化曲線ピッチ', get: () => sim.step, set: (v) => { sim.step = v; }, magni: 1, focusKey: 'step',
                help: '最適化曲線の精度です　縞々部分の長さとも言えます' });
            rows.push({ key: 'height', label: '最適化曲線高さ', get: () => sim.height, set: (v) => { sim.height = v; }, magni: 1, focusKey: 'height',
                help: '最適化する際のクランク中心から地面までの距離です　距離が長いと足も大きくなります' });
        }

        if (sim.menu.mdsmode.value) {
            rows.push({ key: 'subconrod', label: 'サブコンロッド長さ', get: () => sim.subconrod, set: (v) => { sim.subconrod = v; }, magni: 1,
                help: '第2段リンクのコンロッド長さです' });
            rows.push({ key: 'subleverx', label: 'サブレバーＸ座標', get: () => sim.sublever.x, set: (v) => { sim.sublever.x = v; }, magni: 1,
                help: '第2段リンクの支点のX座標です' });
            rows.push({ key: 'sublevery', label: 'サブレバーＹ座標', get: () => sim.sublever.y, set: (v) => { sim.sublever.y = v; }, magni: 1,
                help: '第2段リンクの支点のY座標です' });
        }

        if (sim.doublecrank) {
            rows.push({ key: 'subcrankx', label: 'サブクランクＸ座標', get: () => sim.subcrank.x, set: (v) => { sim.subcrank.x = v; }, magni: 1,
                help: 'レバーを駆動するサブクランクのX座標です' });
            rows.push({ key: 'subcranky', label: 'サブクランクＹ座標', get: () => sim.subcrank.y, set: (v) => { sim.subcrank.y = v; }, magni: 1,
                help: 'レバーを駆動するサブクランクのY座標です' });
            rows.push({ key: 'subcrankr', label: 'サブクランク半径', get: () => sim.subcrankr, set: (v) => { sim.subcrankr = v; }, magni: 1,
                help: 'サブクランクの半径です' });
            rows.push({ key: 'thetaplus', label: 'サブクランク位相', get: () => sim.thetaplus, set: (v) => { sim.thetaplus = v; }, magni: 5,
                help: '基準クランクに対するサブクランクの角度差です' });
        }

        // Graph controls live at the bottom of the parameter panel
        // (instruction doc §6) instead of behind a toolbar icon: label,
        // target dropdown, and ON/OFF toggle share a single row so the
        // dropdown is always visible and reachable regardless of whether
        // the graph is currently shown.
        rows.push({
            key: 'graph', label: 'グラフ表示', type: 'toggle-select', rowClass: 'graph-toggle-row',
            options: [
                { value: GraphTarget.LEVERJOINT, label: 'レバー支点' },
                { value: GraphTarget.TOE, label: 'つま先' },
                { value: GraphTarget.GROUND, label: '接地点' },
                { value: GraphTarget.CRANKJOINT, label: 'クランク支点' },
                { value: GraphTarget.SUBCRANKJOINT, label: 'サブクランク支点' },
                { value: GraphTarget.SUBLEVERJOINT, label: 'サブレバー支点' },
                { value: GraphTarget.SUBTOE, label: 'サブつま先' },
            ],
            getSelect: () => sim.graph_mode, setSelect: (v) => { sim.graph_mode = v; }, focusKey: 'graph',
            getToggle: () => sim.menu.mgraph.value, setToggle: (v) => { sim.setGraphVisible(v); },
            help: '選択した点の速度・加速度をグラフとして画面下部に表示します',
        });

        return rows;
    }

    refreshParamPanel() {
        this.paramPanel.innerHTML = '';
        this._rowRenderers = [];
        for (const def of this._paramRowDefs()) {
            this.paramPanel.appendChild(this._buildParamRow(def));
        }
    }

    _buildParamRow(def) {
        const row = document.createElement('div');
        row.className = 'param-row' + (def.locked ? ' readonly' : '') + (def.rowClass ? ` ${def.rowClass}` : '');
        if (def.help) row.title = def.help;

        const label = document.createElement('label');
        row.appendChild(label);

        const sensitivity = document.createElement('span');
        sensitivity.className = 'sensitivity';
        if (!def.locked && def.type !== 'enum' && def.type !== 'toggle' && def.type !== 'toggle-select') {
            sensitivity.appendChild(document.createElement('i'));
            sensitivity.appendChild(document.createElement('i'));
            sensitivity.appendChild(document.createElement('i'));
            row.appendChild(sensitivity);
        }

        if (def.type === 'toggle') {
            label.textContent = typeof def.label === 'function' ? def.label() : def.label;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'icon-btn';
            const renderBtn = () => {
                const on = !!def.get();
                btn.textContent = on ? 'ON' : 'OFF';
                btn.classList.toggle('active', on);
            };
            renderBtn();
            btn.addEventListener('click', () => { def.set(!def.get()); renderBtn(); });
            row.appendChild(btn);
            this._rowRenderers.push(renderBtn);
            return row;
        }

        if (def.type === 'toggle-select') {
            // Label, target dropdown, and ON/OFF toggle share one row so the
            // dropdown stays reachable regardless of whether the graph is
            // currently shown (previously it only existed while shown).
            label.textContent = typeof def.label === 'function' ? def.label() : def.label;

            const select = document.createElement('select');
            for (const opt of def.options) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                select.appendChild(o);
            }
            select.value = def.getSelect();
            select.addEventListener('change', () => {
                def.setSelect(parseInt(select.value, 10));
                this.sim.rebirth = true;
            });
            row.appendChild(select);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'icon-btn';
            const renderBtn = () => {
                const on = !!def.getToggle();
                btn.textContent = on ? 'ON' : 'OFF';
                btn.classList.toggle('active', on);
            };
            renderBtn();
            btn.addEventListener('click', () => { def.setToggle(!def.getToggle()); renderBtn(); });
            row.appendChild(btn);

            this._rowRenderers.push(() => { select.value = def.getSelect(); renderBtn(); });
            this._wireFocus(row, def);
            return row;
        }

        if (def.type === 'enum') {
            const select = document.createElement('select');
            for (const opt of def.options) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                select.appendChild(o);
            }
            select.value = def.get();
            select.addEventListener('change', () => {
                def.set(parseInt(select.value, 10));
                this.sim.rebirth = true;
            });
            row.appendChild(select);
            this._rowRenderers.push(() => { select.value = def.get(); });
            this._wireFocus(row, def);
            return row;
        }

        const chip = document.createElement('span');
        chip.className = 'value-chip';
        row.appendChild(chip);

        const renderLabel = () => { label.textContent = typeof def.label === 'function' ? def.label() : def.label; };
        const renderValue = () => { chip.textContent = this._formatNumber(def.get()); };
        renderLabel(); renderValue();
        this._rowRenderers.push(() => { renderLabel(); renderValue(); });

        if (def.locked) return row;

        if (!this._rowState.has(def.key)) this._rowState.set(def.key, 'mid');
        const modeMagni = { mid: 1, high: 5, low: 0.2 };
        const modeCycle = { mid: 'high', high: 'low', low: 'mid' }; // value.h: mid->high->low->mid

        const updateSensitivity = () => {
            const mode = this._rowState.get(def.key);
            const count = mode === 'low' ? 1 : mode === 'mid' ? 2 : 3; // value.h:58-79
            [...sensitivity.children].forEach((el, idx) => el.classList.toggle('on', idx < count));
        };
        updateSensitivity();

        // The sensitivity indicator is its own click target for cycling
        // magnitude (mid->high->low->mid) - not a wheel target, so scrolling
        // while positioned over the dots still changes the value like the
        // rest of the row, not the sensitivity (middle-click anywhere in the
        // row still works too, kept as a power-user shortcut).
        sensitivity.addEventListener('click', (e) => {
            e.stopPropagation();
            this._rowState.set(def.key, modeCycle[this._rowState.get(def.key)]);
            updateSensitivity();
        });
        sensitivity.addEventListener('wheel', (e) => e.stopPropagation());

        const applyStep = (sign) => {
            const magni = def.magni ?? 1;
            def.set(def.get() + sign * magni * modeMagni[this._rowState.get(def.key)]);
            this.sim.rebirth = true;
            renderValue();
        };

        row.addEventListener('wheel', (e) => {
            e.preventDefault();
            applyStep(e.deltaY > 0 ? -1 : 1);
        }, { passive: false });

        // Touch-friendly alternative to wheel-scrolling - same step size and
        // sensitivity as the wheel (applyStep is shared by both).
        const plusBtn = document.createElement('button');
        plusBtn.type = 'button'; plusBtn.className = 'icon-btn step-btn'; plusBtn.textContent = '＋';
        plusBtn.addEventListener('click', (e) => { e.stopPropagation(); applyStep(1); });
        const minusBtn = document.createElement('button');
        minusBtn.type = 'button'; minusBtn.className = 'icon-btn step-btn'; minusBtn.textContent = 'ー';
        minusBtn.addEventListener('click', (e) => { e.stopPropagation(); applyStep(-1); });
        row.appendChild(plusBtn);
        row.appendChild(minusBtn);

        row.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                this._rowState.set(def.key, modeCycle[this._rowState.get(def.key)]);
                updateSensitivity();
            }
        });

        row.addEventListener('dblclick', () => {
            const input = document.createElement('input');
            input.type = 'number';
            input.step = 'any';
            input.value = def.get();
            chip.replaceWith(input);
            input.focus();
            input.select();

            // Enter triggers blur (which commits) rather than committing
            // directly, and `done` makes both paths idempotent - otherwise
            // Enter's commit followed by the resulting blur event each try
            // to replaceWith(chip), and the second one throws since `input`
            // is already detached by then.
            let done = false;
            const finish = (cancel) => {
                if (done) return;
                done = true;
                if (!cancel) {
                    const v = parseFloat(input.value);
                    if (Number.isFinite(v)) { def.set(v); this.sim.rebirth = true; }
                }
                input.replaceWith(chip);
                renderValue();
            };
            input.addEventListener('blur', () => finish(false));
            input.addEventListener('keydown', (e2) => {
                if (e2.key === 'Enter') input.blur();
                else if (e2.key === 'Escape') finish(true);
            });
        });

        this._wireFocus(row, def);
        return row;
    }

    _wireFocus(row, def) {
        if (def.focusKey) {
            row.addEventListener('pointerenter', () => { this.sim.focus[def.focusKey] = true; });
            row.addEventListener('pointerleave', () => { this.sim.focus[def.focusKey] = false; });
        }
    }

    // --- drag & drop (hecken::gui's GetDragFilePath handling, hecken.h:902-913) ---

    _setupDragDrop() {
        const wrap = this.canvasWrap;
        wrap.addEventListener('dragover', (e) => e.preventDefault());
        wrap.addEventListener('drop', async (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (!file) return;
            const proceed = await this.showConfirm(`[ ${file.name} ] を読込みますか宜しいでしょうか？\n現在のパラメータは保存されずに開かれます。`);
            if (proceed) {
                const text = await file.text();
                await this.callbacks.openFileText(text, file.name);
            }
        });
    }

    _setupShiftTracking() {
        window.addEventListener('keydown', (e) => { if (e.key === 'Shift') this.sim._shiftHeld = true; });
        window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.sim._shiftHeld = false; });
    }

    // --- per-frame refresh (theta/updown/etc change without user interaction) ---

    update() {
        for (const render of this._toolbarRenderers) render();
        for (const render of this._rowRenderers) render();
    }
}
