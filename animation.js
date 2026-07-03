// Links Web - animation export
//
// Replaces hecken::saveAnime (hecken.h:1190-1238), which asked the user to
// mark a rectangle with two clicks and then wrote `resol` sequentially
// numbered bitmaps into a BmpAnime/ folder for an external GIF-assembly
// tool. The manual itself notes this feature was added for a paper
// submission requirement and that "animated GIFs are now banned in
// competition anyway, so there's probably no demand for this" - given that
// admission, this port swaps the bitmap-sequence + external-tool workflow
// for a single WebM file recorded directly from the canvas (MediaRecorder).
//
// The original's two-click rectangle selection is dropped in favor of just
// recording the canvas as currently drawn (no separate crop step, no crop
// canvas or per-frame copy loop needed) - simpler, and the user can already
// pan/zoom the view to frame whatever they want before recording.

const AnimationCapture = (() => {
    /**
     * Records exactly one revolution (60000/roll ms, matching the resol
     * frames-per-revolution the original sampled) of the canvas exactly as
     * currently drawn/framed to a WebM blob. Temporarily forces rotation on
     * if it was stopped, restoring the previous state afterward.
     */
    async function recordCanvas(canvas, sim) {
        if (!window.MediaRecorder) {
            throw new Error('このブラウザは動画録画(MediaRecorder)に対応していません。');
        }

        const wasRunning = sim.menu.mstop.value;
        sim.menu.mstop.value = true;

        try {
            const stream = canvas.captureStream(30);
            if (!stream) throw new Error('captureStream() が利用できませんでした。');

            const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
                .find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                throw new Error('このブラウザで再生可能な動画形式(WebM)に対応していません。');
            }

            const recorder = new MediaRecorder(stream, { mimeType });
            const chunks = [];
            recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

            const durationMs = Math.max(500, 60000 / sim.roll);

            const blob = await new Promise((resolve, reject) => {
                recorder.onerror = (e) => reject(e.error || new Error('録画中にエラーが発生しました。'));
                recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
                recorder.start();
                setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, durationMs);
            });

            if (blob.size === 0) {
                throw new Error('録画データが空でした（タブが非表示/最小化中だった可能性があります）。タブを表示したまま再度お試し下さい。');
            }

            return blob;
        } finally {
            sim.menu.mstop.value = wasRunning;
        }
    }

    /** Full flow: record the current canvas, trigger a single-file download. */
    async function run({ canvas, sim, ui }) {
        ui.log('録画中… (1回転分)');

        let blob;
        try {
            blob = await recordCanvas(canvas, sim);
        } catch (e) {
            ui.log(`動画の録画に失敗しました: ${e.message}`);
            return;
        }

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'links-animation.webm';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        ui.log(`動画(WebM, ${(blob.size / 1024).toFixed(0)}KB)を出力しました。`);
    }

    return { run };
})();
