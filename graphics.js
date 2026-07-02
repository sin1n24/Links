// Links Web - Graphics Engine
//
// Ported from Common/graphic.h (world-space drawing with pan/zoom) plus the
// "raw screen space" DrawLine/DrawCircle/DrawFormatString calls that
// Links/hecken.h uses directly (bypassing the graphic class) for the graph
// panel and help bar (hecken.h:340-467). Those are exposed here as the
// *Screen() methods so simulation.js can mirror the original 1:1.

class Graphics {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.scale = 3.0;
        // Placeholder only - a <canvas> with no width/height attribute (ours
        // is sized by CSS/aspect-ratio) defaults to the browser's built-in
        // 300x150 before any layout happens, so centering on canvas.width/
        // height here put the origin near the top-left corner of the real,
        // much larger drawing surface. _setupResize() below measures the
        // actual CSS size synchronously and recenters once, immediately.
        this.center = new Point(canvas.width / 2, canvas.height / 2);
        this.backgroundColor = '#1e1e1e';
        this.wheelbtn = true; // middle-mouse drag pan, matches draw.centerDrag(true) in main.cpp

        // Mouse state, mirroring Common/graphic.h's graphic class fields.
        this.mouse = {
            vir: new Point(),   // world-space cursor position
            real: new Point(),  // screen-space (canvas pixel) cursor position
            l: false, c: false, r: false,   // currently held
            L: false, C: false, R: false,   // released this frame
            w: 0,                            // -1/0/1 wheel notch this frame
        };

        this._dragging = false;
        this._lastReal = new Point();
        this._resizeObserver = null;

        this._setupPointerHandlers();
        this._setupResize();
    }

    // --- frame bookkeeping -------------------------------------------------

    /** Reset one-frame flags; call once per animation frame before input is read. */
    updateMouseState() {
        this.mouse.L = false;
        this.mouse.C = false;
        this.mouse.R = false;
        this.mouse.w = 0;
    }

    setScale(s) { this.scale = s; }
    getScale() { return this.scale; }
    setCenter(p) { this.center = p; }
    getCenter() { return this.center; }

    // --- coordinate transforms ---------------------------------------------

    toScreen(p) {
        return new Point(this.center.x + p.x * this.scale, this.center.y + p.y * this.scale);
    }

    toVirtual(p) {
        return new Point((p.x - this.center.x) / this.scale, (p.y - this.center.y) / this.scale);
    }

    // --- input ---------------------------------------------------------------

    _setupResize() {
        // High-DPI backing store: keep canvas.width/height as CSS pixels for
        // all the drawing math above, but render crisply on retina displays.
        const applyDpr = () => {
            const dpr = window.devicePixelRatio || 1;
            const cssW = this.canvas.clientWidth || this.canvas.width;
            const cssH = this.canvas.clientHeight || this.canvas.height;
            if (this._cssW === cssW && this._cssH === cssH && this._dpr === dpr) return;
            this._cssW = cssW; this._cssH = cssH; this._dpr = dpr;
            this.canvas.width = Math.round(cssW * dpr);
            this.canvas.height = Math.round(cssH * dpr);
            this.canvas.style.width = cssW + 'px';
            this.canvas.style.height = cssH + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        applyDpr();
        // One-time recenter now that the real CSS size is known (see the
        // constructor's placeholder comment). Later resizes intentionally
        // don't recenter - that would yank the view out from under a user
        // who has already panned.
        this.center = new Point(this.width / 2, this.height / 2);
        window.addEventListener('resize', applyDpr);
        this._applyDpr = applyDpr;
    }

    /** CSS-pixel width/height (i.e. the logical drawing surface size). */
    get width() { return this._cssW || this.canvas.width; }
    get height() { return this._cssH || this.canvas.height; }

    _setupPointerHandlers() {
        const rectOf = () => this.canvas.getBoundingClientRect();

        this.canvas.addEventListener('pointermove', (e) => {
            const rect = rectOf();
            this.mouse.real.x = e.clientX - rect.left;
            this.mouse.real.y = e.clientY - rect.top;
            this.mouse.vir = this.toVirtual(this.mouse.real);

            if (this.wheelbtn && this.mouse.c) {
                const diff = this.mouse.real.subtract(this._lastReal);
                this.center = this.center.add(diff);
            }
            this._lastReal = this.mouse.real.clone();
        });

        this.canvas.addEventListener('pointerdown', (e) => {
            if (e.button === 0) this.mouse.l = true;
            if (e.button === 1) { this.mouse.c = true; e.preventDefault(); }
            if (e.button === 2) this.mouse.r = true;
            this.canvas.setPointerCapture(e.pointerId);
        });

        this.canvas.addEventListener('pointerup', (e) => {
            if (e.button === 0) { this.mouse.l = false; this.mouse.L = true; }
            if (e.button === 1) { this.mouse.c = false; this.mouse.C = true; }
            if (e.button === 2) { this.mouse.r = false; this.mouse.R = true; }
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const notch = e.deltaY > 0 ? -1 : 1;
            this.mouse.w = notch;

            // Zoom centered on the cursor: keep the world point under the
            // cursor fixed on screen while scale changes.
            const before = this.toVirtual(this.mouse.real);
            this.scale *= (1 + notch * 0.1);
            if (this.scale < 0.1) this.scale = 0.1;
            const after = this.toVirtual(this.mouse.real);
            this.center = this.center.add(after.subtract(before).multiply(this.scale));
        }, { passive: false });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // --- world-space drawing (Common/graphic.h) -----------------------------

    clear() {
        this.ctx.save();
        this.ctx.setTransform(this._dpr || 1, 0, 0, this._dpr || 1, 0, 0);
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.restore();
    }

    line(p1, p2, color) {
        const s1 = this.toScreen(p1), s2 = this.toScreen(p2);
        this.ctx.beginPath();
        this.ctx.moveTo(s1.x, s1.y);
        this.ctx.lineTo(s2.x, s2.y);
        this.ctx.strokeStyle = color;
        this.ctx.stroke();
    }

    dot(p, color) {
        const s = this.toScreen(p);
        this.ctx.fillStyle = color;
        this.ctx.fillRect(s.x, s.y, 1, 1);
    }

    circle(p, r, color, filled = false) {
        const s = this.toScreen(p);
        this.ctx.beginPath();
        this.ctx.arc(s.x, s.y, Math.max(0, r * this.scale), 0, 2 * Math.PI);
        if (filled) { this.ctx.fillStyle = color; this.ctx.fill(); }
        else { this.ctx.strokeStyle = color; this.ctx.stroke(); }
    }

    rect(p1, p2, color, filled = false) {
        const s1 = this.toScreen(p1), s2 = this.toScreen(p2);
        if (filled) { this.ctx.fillStyle = color; this.ctx.fillRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y); }
        else { this.ctx.strokeStyle = color; this.ctx.strokeRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y); }
    }

    // graphic::rectc(a, b, color, filled) - box centered on `a` with half-size `b`
    rectc(a, b, color, filled = false) {
        const bx = (b instanceof Point) ? b.x : b;
        const by = (b instanceof Point) ? b.y : b;
        this.rect(new Point(a.x - bx, a.y - by), new Point(2 * bx, 2 * by), color, filled);
    }

    // pline: draws a polyline honoring per-point `.heel` breaks. No terminal
    // sentinel is needed since JS arrays carry their own length (see
    // datatypes.js header comment).
    pline(points, color) {
        for (let i = 0; i < points.length - 1; i++) {
            // Defends against a sparse array with holes (e.g. `.length` set
            // past the last real element) - see simulation.js trace()'s
            // frontleg_orbit/rearleg_orbit guard for where that used to
            // happen and take the whole render loop down with it.
            if (!points[i]) continue;
            if (points[i].heel) { if (points[i + 1]) this.line(points[i], points[i + 1], color); }
            else this.dot(points[i], color);
        }
    }

    pcircle(cyclos, color) {
        for (const c of cyclos) this.circle(c.pos, c.r, color, false);
    }

    // --- screen-space drawing (raw DrawXxx calls in hecken.h, unaffected by
    // pan/zoom - used for the graph panel and the help/status bar). ---------

    lineScreen(x1, y1, x2, y2, color) {
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.strokeStyle = color;
        this.ctx.stroke();
    }

    circleScreen(x, y, r, color, filled = false) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, Math.max(0, r), 0, 2 * Math.PI);
        if (filled) { this.ctx.fillStyle = color; this.ctx.fill(); }
        else { this.ctx.strokeStyle = color; this.ctx.stroke(); }
    }

    boxScreen(x1, y1, x2, y2, color, filled = false) {
        if (filled) { this.ctx.fillStyle = color; this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1); }
        else { this.ctx.strokeStyle = color; this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); }
    }

    textScreen(x, y, color, text, font = '13px sans-serif') {
        this.ctx.fillStyle = color;
        this.ctx.font = font;
        this.ctx.textBaseline = 'top';
        this.ctx.fillText(text, x, y);
    }
}

/** hecken.h's 60-entry rainbow palette (hecken::hecken ctor, hecken.h:1319-1327). */
function buildColorPalette() {
    const colors = new Array(60);
    const x = 25;
    for (let i = 0; i < 10; i++) {
        colors[0 + i] = `rgb(${255 - 9 * x}, ${255 + (i - 9) * x}, 255)`;
        colors[10 + i] = `rgb(${255 - 9 * x}, 255, ${255 - i * x})`;
        colors[20 + i] = `rgb(${255 + (i - 9) * x}, 255, ${255 - 9 * x})`;
        colors[30 + i] = `rgb(255, ${255 - i * x}, ${255 - 9 * x})`;
        colors[40 + i] = `rgb(255, ${255 - 9 * x}, ${255 + (i - 9) * x})`;
        colors[50 + i] = `rgb(${255 - i * x}, ${255 - 9 * x}, 255)`;
    }
    return colors;
}
