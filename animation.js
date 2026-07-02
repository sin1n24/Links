// Links Web - animation export
//
// Replaces hecken::saveAnime (hecken.h:1190-1238), which asked the user to
// mark a rectangle with two clicks and then wrote `resol` sequentially
// numbered bitmaps into a BmpAnime/ folder for an external GIF-assembly
// tool. The manual itself notes this feature was added for a paper
// submission requirement and that "animated GIFs are now banned in
// competition anyway, so there's probably no demand for this" - given that
// admission, this port swaps the bitmap-sequence + external-tool workflow
// for a single WebM file recorded directly in the browser (MediaRecorder),
// which needs no extra dependency and no external assembly step. The
// two-click rectangle selection gesture itself is kept as-is.

const AnimationCapture = (() => {
    function normalizeRect(a, b) {
        return {
            x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
            w: Math.max(1, Math.abs(a.x - b.x)), h: Math.max(1, Math.abs(a.y - b.y)),
        };
    }

    /** Two-click rectangle picker over `container` (CSS pixel space), Escape cancels. */
    function pickRectangle(container, rectEl) {
        return new Promise((resolve) => {
            let p1 = null;

            const toLocal = (e) => {
                const r = container.getBoundingClientRect();
                return { x: e.clientX - r.left, y: e.clientY - r.top };
            };
            const onDown = (e) => {
                const p = toLocal(e);
                if (!p1) {
                    p1 = p;
                    rectEl.style.display = 'block';
                    Object.assign(rectEl.style, { left: `${p.x}px`, top: `${p.y}px`, width: '0px', height: '0px' });
                } else {
                    const rect = normalizeRect(p1, p);
                    cleanup();
                    resolve(rect);
                }
            };
            const onMove = (e) => {
                if (!p1) return;
                const norm = normalizeRect(p1, toLocal(e));
                Object.assign(rectEl.style, { left: `${norm.x}px`, top: `${norm.y}px`, width: `${norm.w}px`, height: `${norm.h}px` });
            };
            const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
            function cleanup() {
                container.removeEventListener('pointerdown', onDown);
                container.removeEventListener('pointermove', onMove);
                window.removeEventListener('keydown', onKey);
                rectEl.style.display = 'none';
            }
            container.addEventListener('pointerdown', onDown);
            container.addEventListener('pointermove', onMove);
            window.addEventListener('keydown', onKey);
        });
    }

    /**
     * Records exactly one revolution (60000/roll ms, matching the resol
     * frames-per-revolution the original sampled) of the selected canvas
     * region to a WebM blob. Temporarily forces rotation on if it was
     * stopped, restoring the previous state afterward.
     */
    async function recordRegion(canvas, sim, rect, dpr) {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = Math.round(rect.w * dpr);
        cropCanvas.height = Math.round(rect.h * dpr);
        const cropCtx = cropCanvas.getContext('2d');

        const wasRunning = sim.menu.mstop.value;
        sim.menu.mstop.value = true;

        let raf;
        const copyFrame = () => {
            cropCtx.drawImage(
                canvas,
                Math.round(rect.x * dpr), Math.round(rect.y * dpr), Math.round(rect.w * dpr), Math.round(rect.h * dpr),
                0, 0, cropCanvas.width, cropCanvas.height
            );
            raf = requestAnimationFrame(copyFrame);
        };
        raf = requestAnimationFrame(copyFrame);

        const stream = cropCanvas.captureStream(30);
        const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
            .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

        const durationMs = Math.max(500, 60000 / sim.roll);

        const blob = await new Promise((resolve) => {
            recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
            recorder.start();
            setTimeout(() => recorder.stop(), durationMs);
        });

        cancelAnimationFrame(raf);
        sim.menu.mstop.value = wasRunning;

        return blob;
    }

    /** Full flow: prompt, pick rectangle, record, trigger a download. */
    async function run({ canvas, canvasWrap, selectRectEl, sim, graphics, ui }) {
        ui.log('保存範囲を2回のクリックで示してください。キャンセルはEscキーです。');
        const rect = await pickRectangle(canvasWrap, selectRectEl);
        if (!rect || rect.w < 4 || rect.h < 4) {
            ui.log('アニメーション出力をキャンセルしました。');
            return;
        }
        ui.log('録画中… (1回転分)');
        const dpr = window.devicePixelRatio || 1;
        const blob = await recordRegion(canvas, sim, rect, dpr);

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'links-animation.webm';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        ui.log('アニメーションをWebM動画として出力しました。');
    }

    return { run };
})();
