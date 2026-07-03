// Links Web - Main Entry Point
//
// Bootstraps Graphics/Hecken/UI and runs the animation loop. Replaces
// Links/main.cpp's WinMain: the original threw away real elapsed time and
// paced rotation purely by frame count (see simulation.js's proceed() for
// why that broke down once ported to requestAnimationFrame - instruction
// doc §3 bug #6), so this loop measures actual delta time and lets
// Hecken.proceed() do time-based rotation instead.

window.onload = () => {
    const canvas = document.getElementById('main-canvas');
    if (!canvas) { console.error('Canvas element not found!'); return; }

    const graphics = new Graphics(canvas);
    const sim = new Hecken();
    let fileHandle = null; // File System Access API handle for "overwrite same file"

    const logMessage = (message) => {
        ui.log(message);
        console.log(message);
    };

    function downloadText(text, filename, mime) {
        const blob = new Blob([text], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    async function copyToClipboardWithFallback(text, label) {
        try {
            await navigator.clipboard.writeText(text);
            logMessage(`${label}をクリップボードにコピーしました。AutoCADのコマンドラインに貼り付けてください。`);
        } catch (e) {
            await ui.showTextDump(text, `クリップボードへのコピーに失敗しました。以下のテキストを手動でコピーして、AutoCADのコマンドラインに貼り付けてください。（${label}）`);
        }
    }

    async function openFileText(text, filename) {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { /* not JSON - try the legacy Win format below */ }

        if (parsed && parsed.format === 'links-web') {
            sim.loadSceneV2(parsed, graphics);
            sim.name = filename;
            ui.refreshParamPanel();
            document.title = `Links Web β  [ ${filename} ]`;
            logMessage(`[ ${filename} ] を読み込みました。`);
            return;
        }

        const result = sim.loadLegacyText(text);
        ui.refreshParamPanel();
        if (!result.ok) {
            await ui.showInfo('ファイル書式エラー\nLinksで保存したファイルか確認して下さい。');
            return;
        }
        graphics.scale = result.scale;
        sim.name = filename;
        document.title = `Links Web β  [ ${filename} ]`;
        logMessage(`[ ${filename} ] を読み込みました（旧Win版形式）。`);
        if (result.danglingDxfNames.length) {
            logMessage(`旧形式ファイルが参照するDXFファイル（${result.danglingDxfNames.join('、')}）はパスを解決できないため読み込まれていません。「DXF読込」ボタンから読み込み直してください。`);
        }
    }

    async function saveFile(forceDialog = false) {
        const scene = sim.saveSceneV2(graphics);
        const json = JSON.stringify(scene, null, 1);

        if (!forceDialog && fileHandle) {
            try {
                const writable = await fileHandle.createWritable();
                await writable.write(json);
                await writable.close();
                logMessage(`[ ${fileHandle.name} ] に上書き保存しました。`);
                return;
            } catch (e) {
                logMessage('前回のファイルへの上書きに失敗したため、保存先を選び直します。');
            }
        }

        if (window.showSaveFilePicker) {
            try {
                fileHandle = await window.showSaveFilePicker({
                    suggestedName: sim.name || 'scene.links',
                    types: [{ description: 'Links files', accept: { 'application/json': ['.links', '.json'] } }],
                });
                const writable = await fileHandle.createWritable();
                await writable.write(json);
                await writable.close();
                sim.name = fileHandle.name;
                document.title = `Links Web β  [ ${fileHandle.name} ]`;
                logMessage(`[ ${fileHandle.name} ] に保存しました。`);
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
                logMessage('ファイル保存ダイアログを利用できないため、ダウンロードします。');
            }
        }

        const filename = (sim.name || 'scene.links').replace(/\.(json)$/i, '.links');
        downloadText(json, filename.endsWith('.links') ? filename : `${filename}.links`, 'application/json');
        logMessage(`[ ${filename} ] としてダウンロードしました。`);
    }

    async function runDxfLoadFlow() {
        await ui.showInfo('各種DXFファイルを読み込みます。\nいいえで空のファイルを読み込み、キャンセルで現在のままになります。');

        const pickDxfFile = () => new Promise((resolve) => {
            const input = ui.dxfFileInput;
            const onChange = () => {
                input.removeEventListener('change', onChange);
                const file = input.files[0];
                input.value = '';
                resolve(file || null);
            };
            input.addEventListener('change', onChange);
            input.click();
        });

        const promptPart = async (partKey, promptText) => {
            const answer = await ui.showConfirmCancel(promptText);
            if (answer === 'yes') {
                const file = await pickDxfFile();
                if (file) {
                    const text = await file.text();
                    try {
                        sim.loadDxfPart(partKey, text, file.name);
                        logMessage(`[ ${file.name} ] を読み込みました。`);
                    } catch (e) {
                        logMessage(`DXFの読み込みに失敗しました: ${e.message}`);
                    }
                }
            } else if (answer === 'no') {
                sim.clearDxfPart(partKey);
            }
            // 'cancel' leaves this part untouched and still moves on to the
            // next part's prompt - matches hecken::loadDXF (hecken.h:1240-1281),
            // which has no early-return on IDCANCEL.
        };

        await promptPart('conrod', 'コンロッド用DXFファイルを読み込みますか？');
        await promptPart('lever', sim.arcmode ? 'アークスライダ軌道用DXFファイルを読込みますか？' : 'レバー用DXFファイルを読み込みますか？');
        await promptPart('crank', 'クランク用DXFファイルを読み込みますか？');
        if (sim.mode === Mode.MDUALSLIDER) await promptPart('sub', 'サブ用DXFファイルを読み込みますか？');
        await promptPart('bg', 'バックグラウンド用DXFファイルを読み込みますか？');

        ui.refreshParamPanel();
    }

    async function copyAutoCadCommand(shiftKey, ctrlKey) {
        const text = shiftKey ? sim.buildLegOnlyOutput(false) : sim.buildCadOutput(!!ctrlKey, false);
        await copyToClipboardWithFallback(text, 'AutoCADコマンド');
    }

    async function exportDxf(shiftKey, ctrlKey) {
        const text = shiftKey ? sim.buildLegOnlyOutput(true) : sim.buildCadOutput(!!ctrlKey, true);
        downloadText(text, 'links.dxf', 'application/dxf');
        logMessage('DXFファイルを出力しました。');
    }

    async function startAnimationCapture() {
        await AnimationCapture.run({ canvas, sim, ui });
    }

    const ui = new UI(sim, graphics, {
        openFileText, saveFile, runDxfLoadFlow, copyAutoCadCommand, exportDxf, startAnimationCapture,
    });
    sim.setLogger(logMessage);

    // Debug/support handle - not used internally, just a convenience for
    // inspecting state from the browser console.
    window._links = { sim, graphics, ui };

    logMessage('Links Web アプリケーションを開始しました。');
    logMessage(
        '本ウェブアプリは開発中のβ版につき、一部機能が未実装や不安定です。全ての機能を使いたい場合はWin版をご利用頂き、' +
        '使い方についても<a href="https://signed.bufsiz.jp/Links.html" target="_blank" rel="noopener">Win版の取説</a>をご覧下さい。' +
        'なおWin版の開発は停止しており今後追加機能実装の予定はありません。'
    );

    const autosaved = Config.loadAutosave();
    if (autosaved) {
        ui.showConfirm('前回の作業状態が保存されています。復元しますか？').then((yes) => {
            if (yes) {
                sim.loadSceneV2(autosaved, graphics);
                ui.refreshParamPanel();
                logMessage('前回の状態を復元しました。');
            } else {
                Config.clearAutosave();
            }
        });
    }

    let lastTime = performance.now();
    let autosaveAccumMs = 0;
    const AUTOSAVE_INTERVAL_MS = 8000;

    function gameLoop(now) {
        const dt = Math.min(now - lastTime, 100); // clamp large gaps (backgrounded tab) so rotation doesn't jump
        lastTime = now;

        try {
            graphics.updateMouseState();
            graphics.clear();
            sim.proceed(graphics, dt);
            ui.update();

            autosaveAccumMs += dt;
            if (autosaveAccumMs > AUTOSAVE_INTERVAL_MS) {
                autosaveAccumMs = 0;
                Config.saveAutosave(sim.saveSceneV2(graphics));
            }
        } catch (e) {
            // A single bad frame (e.g. a state combination that trips up a
            // renderer edge case) shouldn't take down the whole app - without
            // this, an uncaught exception here stops requestAnimationFrame
            // from ever being called again, and the page just freezes with
            // whatever was left on the canvas (see instruction doc §8).
            console.error('frame error (recovered):', e);
        }

        requestAnimationFrame(gameLoop);
    }
    requestAnimationFrame(gameLoop);
};
