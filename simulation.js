// Links Web - Simulation Logic
//
// Faithful port of Links/hecken.h (the `hecken` class - crank/lever/conrod
// linkage kinematics, DXF-part grounding, optimization-curve "sanding", and
// scene persistence). Line references like "hecken.h:129" point at the
// original C++ so behavior can be cross-checked against ground truth.
//
// Architecture differences from the original (all in Common/*.h too):
//   - The original used fixed 1000/100-element C arrays with a repeated-
//     point / r==0 sentinel to mark "end of data". Here we use ordinary JS
//     arrays (array.length is the bound) - see datatypes.js header comment.
//   - The original polled mouse/keyboard state once per frame inside an
//     immediate-mode `gui()` (hecken.h:803-914) to decide which flags to
//     flip. Web UI is DOM/event driven instead (ui.js), so state changes
//     (toggle a mode, click a button) happen directly via small setter
//     methods below instead of being re-derived every frame. The one
//     genuinely per-frame side effect in the original gui() - correct()'s
//     clamping - is still called every frame from proceed().
//   - `scale` (the "表示倍率" parameter) is owned by the Graphics object
//     (graphics.js) rather than duplicated on Hecken, to avoid two sources
//     of truth fighting over the canvas zoom level (see notes on correct()).

const Mode = { MHECKEN: 0, MSLIDER: 1, MDUALHECKEN: 2, MDUALSLIDER: 3, MDUALCRANK: 4 };

// hecken.h:7 group enum, used to pick which point the graph panel tracks.
// gsubcrankjoint/gsubtoe are reachable menu choices in the original but the
// points they'd track (subcrankjoint/subtoe) are never actually computed
// anywhere in hecken.h - an incomplete upstream feature, kept as literal
// (always-origin) fields below for parity rather than "fixed".
const GraphTarget = {
    LEVERJOINT: 0, TOE: 1, GROUND: 2, CRANKJOINT: 3,
    SUBCRANKJOINT: 4, SUBLEVERJOINT: 5, SUBTOE: 6, LIM: 7,
};

class Hecken {
    constructor() {
        this.logger = () => {};
        this.colorPalette = buildColorPalette(); // hecken.h:1319-1327, see graphics.js
        this.init();
        // hecken::hecken() ctor sets thetaplus AFTER init() (hecken.h:1294) -
        // init() itself never touches it, including on a later re-init from
        // a failed file load (hecken.h:1090), so this assignment happens
        // exactly once here rather than inside init().
        this.thetaplus = 180;

        this.ground = new Point(0, 0);
        this.rebirth = true;

        this.get(0);
        this.sander(this.optimizraw);
        this.trace();
        this.sim();
    }

    setLogger(fn) { this.logger = fn; }

    // --- hecken::init(), hecken.h:934-967 -----------------------------------
    init() {
        this.crank = new Point(0, 0);
        this.crankr = 25;
        this.lever = new Point(-50, -50);
        this.leverr = 50;
        this.conrod = 50;
        this.theta = 0;
        this.shift = new Point(0, 50);
        this.tilt = 0;
        this.object = 3;
        this.resol = 100;
        this.roll = 15;
        this.mini = 42;
        this.max = 42;
        this.step = 5;
        this.height = 100;
        this.side = false;
        this.dxf = true;
        this.dxfcrank = false;
        this.dxflever = false;
        this.dxfconrod = false;
        this.dxfsub = false;
        this.dxfbg = false;
        this.doublecrank = false;
        this.exist_graph = false;
        this.arcmode = false;
        // hecken::init() itself sets `mode = mslider` (hecken.h:948), but
        // that value never survives to any frame the user actually sees:
        // gui() unconditionally resyncs `mode = menu[mdsmode].get() ?
        // mdualslider : mhecken` every single frame (hecken.h:895),
        // starting with the very first proceed() call, before that first
        // frame is ever rendered. So the *real* resting default - what a
        // fresh instance behaves as - is MHECKEN, not MSLIDER. Since this
        // port replaced that per-frame poll with the explicit
        // setDualSliderMode() setter below (see class header), the
        // constructor must set the value gui() would have converged to,
        // or a freshly loaded page would silently run slider kinematics
        // instead of 4-bar kinematics whenever leverr > 0.
        // MSLIDER/MDUALHECKEN/MDUALCRANK are therefore never assigned
        // anywhere and exist only for 1:1 comparison against hecken.h;
        // `leverr === 0` is what actually produces slider-style kinematics
        // (hecken.h:146), matching the manual: "レバーの長さを0に設定すると
        // スライダリンクとして認識".
        this.mode = Mode.MHECKEN;
        this.tiltold = 0;

        this.exist_frontleg_orbit = false;
        this.exist_rearleg_orbit = false;
        this.exist_secret_orbit = false;
        this.exist_maxmin_length = false;
        this.min_frontleg_orbit = Infinity;
        this.min_reartleg_orbit = Infinity;

        // Sub-mechanism (dual slider / double crank) state. subcrankr has no
        // sane original default - the C++ member was simply never
        // initialized anywhere (a latent bug: uninitialized stack double).
        // We pick 25 (same as crankr) as a deliberate, visually-sane value
        // rather than reproducing "whatever garbage happened to be on the
        // stack". subconrod similarly relies on correct()'s `if(!subconrod)
        // subconrod=1` clamp, which we DO reproduce (see correct()).
        this.subcrank = new Point(0, 0);
        this.subcrankr = 25;
        this.subconrod = 0;
        this.subleverr = 0; // declared upstream but never wired to any kinematics (see hecken.h notes on initInterface) - kept unused for parity.
        this.sublever = new Point(0, 20);
        this.subshift = new Point(0, 0); // serialized in legacy save files but otherwise unused upstream too.

        this.conrodDXF = ''; this.leverDXF = ''; this.crankDXF = ''; this.subDXF = ''; this.bgDXF = '';

        // DXF-loaded raw shapes (point[]/cyclo[] pairs) per part.
        this.conrodraw = []; this.conroden = [];
        this.leverraw = []; this.leveren = [];
        this.crankraw = []; this.cranken = [];
        this.subraw = []; this.suben = [];
        this.bgraw = []; this.bgen = [];

        // Grounded (world-space) outputs of the above, refreshed every get().
        this.conroded = []; this.conrodened = [];
        this.levered = []; this.leverened = [];
        this.cranked = []; this.crankened = [];
        this.subed = []; this.subened = [];

        // Optimization-curve buffers.
        this.optimizraw = [];
        this.optimized = [];
        this.optmax = 0;

        // Orbits.
        this.orbit = [];
        this.frontleg_orbit = [];
        this.rearleg_orbit = [];
        this.secret_orbit = [];
        this.secret_orbited = [];

        // Reckoned joints.
        this.crankjoint = new Point();
        this.leverjoint = new Point();
        this.toe = new Point();
        this.subleverjoint = new Point();
        // Declared in hecken.h but never assigned by any code path (a graph
        // target option that was never wired up, see GraphTarget comment) -
        // kept permanently at the origin for parity.
        this.subcrankjoint = new Point();
        this.subtoe = new Point();

        this.updown = 0;
        this.lock = false;
        this.timeover = false;

        // Menu toggle state (hecken.h's icon-based mstop/mturn/mpara/etc,
        // hecken.h:690-737). One-shot "push button" actions (open/save/new/
        // AutoCAD export/DXF export/side-switch/animation/resolution-cycle/
        // orbit toggles) are plain method calls from ui.js instead - DOM
        // clicks are naturally one-shot, so there's no need to reproduce the
        // per-frame edge-detection the original needed for its polled icons.
        this.menu = {
            mstop: { value: false },     // rotation running
            mturn: { value: true },      // true = clockwise (hecken.h round=360 convention)
            mpara: { value: true },      // parameter panel visible
            mstatus: { value: true },    // help bar visible
            mdxf: { value: true },       // true = show DXF parts, false = show optimized curve
            mdsmode: { value: false },   // dual-slider mode
            mvtmode: { value: false },   // vertical-mode optimization curve
            mdcmode: { value: false },   // double-crank mode
            mmmlmode: { value: false },  // show max/min length readout
            marcmode: { value: false },  // arc-slider DXF-load prompt wording only (hecken.h never wires more)
            mgraph: { value: false },    // graph panel visible
        };

        // Parameter-row hover focus, driving the white highlight in draw()/
        // drawOnce() (table[x].getFocus() in the original). Set by ui.js on
        // pointerenter/pointerleave of each parameter row.
        this.focus = {
            crankr: false, conrod: false, leverr: false, leverx: false, levery: false,
            shiftx: false, shifty: false, mini: false, max: false, step: false,
            height: false, graph: false,
        };

        this.graph_mode = GraphTarget.LEVERJOINT;

        // config.ini's BGcolor (Common/config.h) - never exposed via any
        // icon/parameter row in the original app (config.ini had to be
        // hand-edited), so config.js exposes it as a real setting instead.
        // Drives both the canvas background and the "gray" guide-line color
        // threshold below (hecken.h:86-87, 296-299).
        if (this.bgColor === undefined) this.bgColor = 0;

        this.name = '';
        this.rebirth = true;
    }

    /** hecken.h:86-87 / 296-299 - guide-line gray, chosen for subtle contrast against either a dark or light background. */
    grayColor() {
        return this.bgColor > 128 ? 'rgb(200,200,200)' : 'rgb(50,50,50)';
    }

    // --- hecken::correct(), hecken.h:916-932 --------------------------------
    // Called once per frame from proceed(). `g` is passed in so the display
    // scale (owned by Graphics, see file header) can be clamped alongside
    // everything else, exactly like the original clamping `scale` in place.
    correct(g) {
        this.resol = limit(this.resol, 20, 1000);
        if (this.roll < 10) this.roll = 10;
        this.object = limit(this.object, 1, 60); // colorlim = 60, hecken.h:13
        if (this.step <= 0) this.step = 1;
        if (!this.conrod) this.conrod = 1;
        if (!this.subconrod) this.subconrod = 1;
        if (this.thetaplus % 360 === 0) this.thetaplus += 0.0001;
        if (g.scale < 1) g.scale = 1;
        this.graph_mode = limit(this.graph_mode, 0, GraphTarget.LIM);
    }

    // --- hecken::get(deg, groundlock), hecken.h:129-210 ---------------------
    get(deg, groundlock = false) {
        const a = rad(deg);
        this.crankjoint.x = this.crank.x + this.crankr * Math.cos(a);
        this.crankjoint.y = this.crank.y + this.crankr * Math.sin(a);

        if (this.doublecrank) {
            const a2 = rad(deg + this.thetaplus);
            this.lever.x = this.subcrank.x + this.subcrankr * Math.cos(a2);
            this.lever.y = this.subcrank.y + this.subcrankr * Math.sin(a2);
        }

        const dix = this.crankjoint.x - this.lever.x;
        const diy = this.crankjoint.y - this.lever.y;
        const part = Math.hypot(dix, diy);

        if (!this.leverr || this.mode === Mode.MSLIDER) {
            this.leverjoint.x = this.crankjoint.x - this.conrod * dix / part;
            this.leverjoint.y = this.crankjoint.y - this.conrod * diy / part;
            this.lock = false;
        } else {
            const cosI = dix / part, sinI = (this.side ? 1 : -1) * diy / part;
            const cosO = (this.leverr ** 2 - this.conrod ** 2 - part ** 2) / (-2 * this.conrod * part);
            const valid = 1.0 > cosO ** 2;
            const sinO = valid ? Math.sqrt(1.0 - cosO ** 2) : 0;
            this.lock = !valid;
            this.leverjoint.x = this.crankjoint.x - (cosO * cosI + sinO * sinI) * this.conrod;
            this.leverjoint.y = this.crankjoint.y + (this.side ? 1 : -1) * (sinO * cosI - cosO * sinI) * this.conrod;
        }

        this.toe = offsetFree(this.crankjoint, this.leverjoint, this.shift, this.conrod);

        if (this.mode === Mode.MDUALSLIDER || this.mode === Mode.MDUALHECKEN) {
            const dsx = this.toe.x - this.sublever.x;
            const dsy = this.toe.y - this.sublever.y;
            const parts = Math.hypot(dsx, dsy);

            if (!this.leverr || this.mode === Mode.MDUALSLIDER) {
                this.subleverjoint.x = this.toe.x - this.subconrod * dsx / parts;
                this.subleverjoint.y = this.toe.y - this.subconrod * dsy / parts;
            } else {
                const cosI = dsx / parts, sinI = (this.side ? 1 : -1) * dsy / parts;
                const cosO = (this.subleverr ** 2 - this.subconrod ** 2 - parts ** 2) / (-2 * this.subconrod * parts);
                const valid = 1.0 > cosO ** 2;
                const sinO = valid ? Math.sqrt(1.0 - cosO ** 2) : 0;
                this.lock = !valid;
                this.subleverjoint.x = this.toe.x - (cosO * cosI + sinO * sinI) * this.subconrod;
                this.subleverjoint.y = this.toe.y + (this.side ? 1 : -1) * (sinO * cosI - cosO * sinI) * this.subconrod;
            }
        }

        if (this.dxf) {
            if (this.dxfconrod) {
                this.grounding(this.crankjoint, this.leverjoint, this.conrodraw, this.conroded, groundlock);
                this.groundingCyclo(this.crankjoint, this.leverjoint, this.conroden, this.conrodened, groundlock);
            }
            if (this.dxflever) {
                this.grounding(this.lever, this.leverjoint, this.leverraw, this.levered, groundlock);
                this.groundingCyclo(this.lever, this.leverjoint, this.leveren, this.leverened, groundlock);
            }
            if (this.dxfcrank) {
                this.grounding(this.crank, this.crankjoint, this.crankraw, this.cranked, groundlock);
                this.groundingCyclo(this.crank, this.crankjoint, this.cranken, this.crankened, groundlock);
            }
            if (this.dxfsub && !(this.mode === Mode.MHECKEN || this.mode === Mode.MSLIDER)) {
                this.grounding(this.toe, this.subleverjoint, this.subraw, this.subed, groundlock);
                this.groundingCyclo(this.toe, this.subleverjoint, this.suben, this.subened, groundlock);
            }
        } else {
            if (this.mode === Mode.MDUALSLIDER) {
                this.optmax = this.grounding(this.toe, this.subleverjoint, this.optimizraw, this.optimized, groundlock);
            } else {
                this.optmax = this.grounding(this.crankjoint, this.leverjoint, this.optimizraw, this.optimized, groundlock);
            }
        }

        if (this.exist_secret_orbit) {
            this.grounding(this.crankjoint, this.leverjoint, this.secret_orbit, this.secret_orbited, groundlock);
        }
    }

    // --- hecken::grounding (point[] overload), hecken.h:212-230 -------------
    // Transforms a part's local-frame shape `raw` into world space anchored
    // between `datam` and `sub`, tracking the lowest world-Y point reached
    // (`this.ground`) unless locked or `groundlock` suppresses it. Returns
    // the index of the last point (== "optmax" in the original, which used
    // to scan for a terminal sentinel - here it's simply raw.length-1).
    grounding(datam, sub, raw, ed, groundlock) {
        ed.length = 0;
        const dist = datam.dist(sub);
        for (const rp of raw) {
            const p = offsetFree(datam, sub, rp, dist);
            p.heel = rp.heel;
            if (this.ground.y < p.y && !this.lock && !groundlock) {
                this.ground = p.clone();
            }
            ed.push(p);
        }
        return ed.length - 1;
    }

    // --- hecken::grounding (cyclo[] overload), hecken.h:231-249 -------------
    groundingCyclo(datam, sub, raw, ed, groundlock) {
        ed.length = 0;
        const dist = datam.dist(sub);
        for (const rc of raw) {
            const pos = offsetFree(datam, sub, rc.pos, dist);
            if (this.ground.y < pos.y && !this.lock && !groundlock) {
                this.ground = pos.clone();
            }
            ed.push(new Cyclo(pos, rc.r));
        }
        return ed.length - 1;
    }

    // --- hecken::draw(), hecken.h:251-291 ------------------------------------
    draw(g, color, gray) {
        const focused = '#ffffff';
        const f = this.focus;

        g.line(this.crank, this.crankjoint, f.crankr ? focused : (this.dxfcrank ? gray : color));
        if (this.lock) return;

        g.line(this.leverjoint, this.crankjoint, f.conrod ? focused : (this.dxfconrod ? gray : color));
        g.line(this.crankjoint, this.toe, (f.shiftx || f.shifty) ? focused : (this.dxfconrod ? gray : color));
        if (this.mode === Mode.MDUALSLIDER) g.line(this.subleverjoint, this.toe, this.dxfsub ? gray : color);
        if (this.leverr) g.line(this.lever, this.leverjoint, f.leverr ? focused : (this.dxflever ? gray : color));
        if (this.doublecrank) g.line(this.subcrank, this.lever, this.dxfconrod ? gray : color);

        if (this.dxf) {
            let c = color;
            if (this.object === 1) c = 'rgb(255,0,0)';
            if (this.dxfconrod) { g.pline(this.conroded, c); g.pcircle(this.conrodened, c); }
            if (this.object === 1) c = 'rgb(0,0,255)';
            if (this.dxflever && this.leverr) { g.pline(this.levered, c); g.pcircle(this.leverened, c); }
            if (this.object === 1) c = 'rgb(0,255,0)';
            if (this.dxfcrank) { g.pline(this.cranked, c); g.pcircle(this.crankened, c); }
            if (this.object === 1) c = 'rgb(0,255,255)';
            if (this.dxfsub && !(this.mode === Mode.MHECKEN || this.mode === Mode.MSLIDER)) { g.pline(this.subed, c); g.pcircle(this.subened, c); }
        } else {
            g.pline(this.optimized, color);
            if (this.menu.mpara.value) {
                if (f.mini && this.optimized.length) g.line(this.optimized[0], this.crankjoint, focused);
                if (f.max && this.optimized.length) g.line(this.optimized[this.optmax], this.crankjoint, focused);
                if (f.step) for (let i = 0; i < this.optmax; i += 2) g.line(this.optimized[i], this.optimized[i + 1], focused);
            }
        }

        if (this.exist_secret_orbit) g.pline(this.secret_orbited, gray);
    }

    // --- hecken::drawOnce(), hecken.h:294-410 --------------------------------
    // The graph panel and help bar from the original live in graph.js /
    // ui.js (DOM) respectively rather than here - see file header.
    drawOnce(g, first, gray) {
        if (first) {
            g.circle(this.crank, this.crankr, gray, false);
            if (this.shift.x || this.shift.y) g.pline(this.orbit, gray);
            if (this.doublecrank) g.circle(this.subcrank, this.subcrankr, gray, false);
            if (this.leverr) g.circle(this.lever, this.leverr, gray, false);
            if (this.dxfbg) { g.pline(this.bgraw, gray); g.pcircle(this.bgen, gray); }
            if (this.exist_secret_orbit) g.pline(this.secret_orbit, gray);
            if (this.exist_frontleg_orbit) g.pline(this.frontleg_orbit, gray);
            if (this.exist_rearleg_orbit) g.pline(this.rearleg_orbit, gray);
        } else {
            if (this.object > 1) {
                g.line(new Point(-1024, this.ground.y), new Point(1024, this.ground.y), gray);
                g.line(this.ground.add(new Point(0, 5)), this.ground.subtract(new Point(0, 5)), gray);
            }
            this.ground = new Point(0, 0);

            if (this.menu.mpara.value) {
                const focused = '#ffffff';
                // hecken.h:325-326 also highlights `crank` via tcrankx/
                // tcranky, but those table rows are never initialized in
                // initInterface (crank position isn't user-editable - see
                // hecken.h:934, crank is hardcoded to the origin) so that
                // branch can never trigger and isn't reproduced here.
                // No `!doublecrank` guard needed: ui.js only attaches hover
                // listeners to rows it actually renders, and tleverx/tlevery
                // are hidden whenever doublecrank is on (see ui.js panel
                // visibility rules, mirroring initInterface's `.mun()`).
                if (this.focus.leverx || this.focus.levery) {
                    g.circle(this.lever, 6 / g.getScale(), focused, true);
                }
                if (this.focus.height) g.line(new Point(0, 0), new Point(0, this.height), focused);
                if (this.focus.graph) {
                    g.circle(this._graphTargetPoint(), 6 / g.getScale(), focused, true);
                }
            }
        }
    }

    _graphTargetPoint() {
        switch (this.graph_mode) {
            case GraphTarget.CRANKJOINT: return this.crankjoint;
            case GraphTarget.LEVERJOINT: return this.leverjoint;
            case GraphTarget.TOE: return this.toe;
            case GraphTarget.SUBCRANKJOINT: return this.subcrankjoint;
            case GraphTarget.SUBLEVERJOINT: return this.subleverjoint;
            case GraphTarget.SUBTOE: return this.subtoe;
            case GraphTarget.GROUND: return this.ground;
            default: return this.leverjoint;
        }
    }

    // --- hecken::trace(), hecken.h:475-503 -----------------------------------
    trace() {
        this.min_frontleg_orbit = Infinity;
        this.min_reartleg_orbit = Infinity;
        const optmax = this.optimized.length - 1;

        for (let i = 0; i <= this.resol; i++) {
            this.get(this.theta + i * 360 / this.resol, true);

            const o = this.toe.clone(); o.heel = !this.lock;
            this.orbit[i] = o;

            if (this.exist_frontleg_orbit && this.optimized.length) {
                const p = this.optimized[0].clone(); p.heel = !this.lock;
                this.frontleg_orbit[i] = p;
                if (this.min_frontleg_orbit > this.optimized[0].y) this.min_frontleg_orbit = this.optimized[0].y;
            }
            if (this.exist_rearleg_orbit && this.optimized.length) {
                this.rearleg_orbit[i] = this.optimized[optmax].clone();
                // hecken.h:491 sets `.heel` on rearleg_orbit[optmax] every
                // iteration rather than rearleg_orbit[i] - looks like an
                // upstream typo, kept verbatim for Win-parity (harmless: it
                // only affects one connectivity flag in a rarely-shown
                // debug overlay).
                if (this.rearleg_orbit[optmax]) this.rearleg_orbit[optmax].heel = !this.lock;
                if (this.min_reartleg_orbit > this.optimized[optmax].y) this.min_reartleg_orbit = this.optimized[optmax].y;
            }
            if (this.exist_secret_orbit) {
                const p = this.sublever.rota(this.crankjoint, -this.crankjoint.dir(this.leverjoint) + Math.PI / 2).subtract(this.crankjoint);
                p.heel = !this.lock;
                this.secret_orbit[i] = p;
            }
        }
        this.orbit.length = this.resol + 1;
        if (this.exist_frontleg_orbit) this.frontleg_orbit.length = this.resol + 1;
        if (this.exist_rearleg_orbit) this.rearleg_orbit.length = this.resol + 1;
        if (this.exist_secret_orbit) this.secret_orbit.length = this.resol + 1;
    }

    // --- hecken::sim(), hecken.h:505-530 -------------------------------------
    sim() {
        let maxY = 0, miniY = 100000;
        let len = 0, lmax = 0, lmini = 100000;

        for (let i = 0; i <= this.resol; i++) {
            for (let o = 0; o < this.object; o++) {
                this.get(this.theta + i * 360 / this.resol + o * 360 / this.object, false);
            }
            if (maxY < this.ground.y) maxY = this.ground.y;
            if (miniY > this.ground.y) miniY = this.ground.y;

            len = this.toe.dist(this.sublever);
            if (lmax < len) lmax = len;
            if (lmini > len) lmini = len;

            this.ground = new Point(0, 0);
        }
        this.updown = maxY - miniY;

        // hecken.h's exist_maxmin_length branch blocked the whole app for
        // 100ms to flash a debug string (clsDx/printfDx/WaitTimer). The web
        // port just exposes the text for ui.js to show in a readout instead
        // of blocking anything.
        this.maxMinLengthText = this.exist_maxmin_length
            ? `mini=${lmini.toFixed(3)}, max=${lmax.toFixed(3)}, len=${len.toFixed(3)}`
            : null;
    }

    // --- hecken::sander(), hecken.h:537-687 ----------------------------------
    // Only the two reachable branches (menu[mvtmode] on/off) are ported; the
    // three large commented-out alternate algorithms in the original (dead
    // code even upstream) are not reproduced.
    sander(raw) {
        const len = [];
        raw.length = 0;

        const dualmode = (this.mode === Mode.MDUALSLIDER || this.mode === Mode.MDUALHECKEN);

        if (this.menu.mvtmode.value) {
            // "Vertical mode" - hecken.h:544-575. Forces the shift so the
            // toe traces out to the side rather than centered.
            if (this.shift.x >= 0) this.shift.x = -100;
            this.shift.y = 0;

            for (let i = 0; i <= this.resol; i++) {
                this.get(this.theta + i * 360 / this.resol, true);
                const dx = this.toe.x - this.crankjoint.x;
                const dy = this.toe.y - this.crankjoint.y;
                const a = dy / dx;

                let legCnt = 0;
                for (let lineCnt = this.mini; lineCnt <= this.max; lineCnt += this.step) {
                    const dist = Math.hypot(dx, dy);
                    const xw = this.toe.x - lineCnt * dy / dist;
                    const yw = this.toe.y + lineCnt * dx / dist;
                    const b = yw - xw * a;
                    const xv = (this.crank.y + this.height - b) / a;
                    const yv = this.crank.y + this.height;
                    const gLen = Math.hypot(xw - xv, yw - yv) - dist;

                    if (raw[legCnt] === undefined) raw[legCnt] = new Point(10000, 10000);
                    if (raw[legCnt].x > gLen) raw[legCnt].x = gLen;
                    raw[legCnt].y = -lineCnt;
                    raw[legCnt].heel = true;
                    legCnt++;
                }
            }
        } else {
            for (let i = 0; i <= this.resol; i++) {
                this.get(this.theta + i * 360 / this.resol, true);

                const tempLeverjoint = dualmode ? this.subleverjoint : this.leverjoint;
                const tempConrod = dualmode ? this.subconrod : this.conrod;
                const slope = tempLeverjoint.dir(dualmode ? this.toe : this.crankjoint);

                let legCnt = 0;
                const miniRad = this.mini * Math.PI / 180;
                const maxRad = this.max * Math.PI / 180;
                const stepRad = this.step * Math.PI / 180;
                for (let lineAng = slope + Math.PI * 0.5 + miniRad; lineAng <= slope + Math.PI * 1.5 - maxRad; lineAng += stepRad) {
                    const length = (this.crank.x + this.height - tempLeverjoint.y) / Math.sin(lineAng);

                    if (len[legCnt] === undefined) len[legCnt] = 10000;
                    if (length < len[legCnt] && length > 0) {
                        len[legCnt] = length;
                        const p = sincos(lineAng - slope - Math.PI / 2).multiply(length);
                        p.y -= tempConrod;
                        raw[legCnt] = p;
                    } else if (raw[legCnt] === undefined) {
                        raw[legCnt] = new Point(10000, 10000);
                    }
                    raw[legCnt].heel = true;
                    legCnt++;
                }
            }
        }
    }

    // --- tilt application, hecken.h:92-101 (part of proceed()) --------------
    _applyTiltDelta() {
        if (this.tilt !== this.tiltold) {
            const delta = rad(this.tilt - this.tiltold);
            this.lever = this.lever.rota(this.crank, delta);
            this.sublever = this.sublever.rota(this.crank, delta);
            this.bgraw = this.bgraw.map((p) => {
                const r = p.rota(this.crank, delta);
                r.heel = p.heel;
                return r;
            });
        }
        this.tiltold = this.tilt;
    }

    // --- hecken::proceed(), hecken.h:83-127 ----------------------------------
    // `dtMs` is real elapsed time since the previous frame. The original
    // advanced theta by a fixed `360/resol` degrees per *frame* and relied on
    // WaitTimer(60000/roll/resol) throttling the frame rate to make that
    // correspond to `roll` RPM. requestAnimationFrame has no such throttle,
    // so instead we compute the angular speed directly from roll (deg/ms)
    // and multiply by actual elapsed time - see instruction doc §3 bug #6.
    proceed(g, dtMs) {
        this._applyTiltDelta();

        if (this.menu.mstop.value) {
            const degPerMs = (this.roll * 360) / 60000;
            this.theta = (this.theta + (this.menu.mturn.value ? 1 : -1) * degPerMs * dtMs) % 360;
        }

        const gray = this.grayColor();

        this.drawOnce(g, true, gray);
        for (let i = 0; i < this.object; i++) {
            this.get(this.theta + i * 360 / this.object);
            this.draw(g, this.colorPalette[Math.floor(i * 60 / this.object) % 60], gray);
        }
        this.drawOnce(g, false, gray);

        if (this.menu.mgraph.value && this.drawGraphPanel) this.drawGraphPanel(g);

        // hecken.h calls correct() once per frame from inside gui(), which
        // itself runs from drawOnce(false) - i.e. after this frame's own
        // draw loop above, so any clamping only takes visible effect from
        // the next frame onward. Matched here for timing fidelity.
        this.correct(g);

        if (this.rebirth) {
            this.trace();
            if (!this.dxf) this.sander(this.optimizraw);
            this.sim();
            this.rebirth = false;
            if (this.onRebirth) this.onRebirth();
        }

        // Cosmetic equivalent of hecken.h's `timeover` (whether the frame
        // took longer than the target interval) - purely informational.
        this.timeover = dtMs > 50;
    }

    // --- state-change setters (replace per-frame gui() polling) -------------
    // Each mirrors the corresponding line in hecken.h:866-897, including the
    // "only rebirth if the flag actually changed" guard.

    setDxfMode(value) {
        if (this.dxf !== value) this.rebirth = true;
        this.dxf = value;
    }
    setDualSliderMode(value) {
        this.menu.mdsmode.value = value;
        this.mode = value ? Mode.MDUALSLIDER : Mode.MHECKEN;
        this.rebirth = true;
    }
    setDoubleCrankMode(value) {
        this.menu.mdcmode.value = value;
        this.doublecrank = value;
        this.rebirth = true;
    }
    setVerticalMode(value) {
        this.menu.mvtmode.value = value;
        this.rebirth = true;
    }
    setMaxMinLengthMode(value) {
        this.menu.mmmlmode.value = value;
        this.exist_maxmin_length = value;
        this.rebirth = true;
    }
    setGraphVisible(value) {
        if (this.menu.mgraph.value !== value) this.rebirth = true;
        this.menu.mgraph.value = value;
        this.exist_graph = value;
    }
    setArcMode(value) { this.menu.marcmode.value = value; this.arcmode = value; }
    toggleSide() { this.side = !this.side; this.rebirth = true; }
    toggleFrontLegOrbit() { this.exist_frontleg_orbit = !this.exist_frontleg_orbit; this.rebirth = true; }
    toggleRearLegOrbit() { this.exist_rearleg_orbit = !this.exist_rearleg_orbit; this.rebirth = true; }
    toggleSecretOrbit() { this.exist_secret_orbit = !this.exist_secret_orbit; this.rebirth = true; }
    toggleBothLegOrbits() {
        this.exist_frontleg_orbit = !this.exist_frontleg_orbit;
        this.exist_rearleg_orbit = !this.exist_rearleg_orbit;
        this.rebirth = true;
    }

    // --- DXF part loading (replaces hecken::loadDXF, hecken.h:1240-1281) ----
    // Reads are delegated to dxf_io.js/DxfIO (vendored `dxf` package) - see
    // that file's header for why this is a strict improvement over the
    // original's hand-rolled parser (which couldn't read LWPOLYLINE/DXF2000).
    loadDxfPart(part, dxfText, filename = '') {
        const { points, circles } = DxfIO.read(dxfText);
        switch (part) {
            case 'conrod': this.conrodraw = points; this.conroden = circles; this.dxfconrod = true; this.conrodDXF = filename; break;
            case 'lever': this.leverraw = points; this.leveren = circles; this.dxflever = true; this.leverDXF = filename; break;
            case 'crank': this.crankraw = points; this.cranken = circles; this.dxfcrank = true; this.crankDXF = filename; break;
            case 'sub': this.subraw = points; this.suben = circles; this.dxfsub = true; this.subDXF = filename; break;
            case 'bg': this.bgraw = points; this.bgen = circles; this.dxfbg = true; this.bgDXF = filename; break;
            default: throw new Error(`unknown DXF part: ${part}`);
        }
        this.rebirth = true;
    }
    clearDxfPart(part) {
        switch (part) {
            case 'conrod': this.conrodraw = []; this.conroden = []; this.dxfconrod = false; this.conrodDXF = ''; break;
            case 'lever': this.leverraw = []; this.leveren = []; this.dxflever = false; this.leverDXF = ''; break;
            case 'crank': this.crankraw = []; this.cranken = []; this.dxfcrank = false; this.crankDXF = ''; break;
            case 'sub': this.subraw = []; this.suben = []; this.dxfsub = false; this.subDXF = ''; break;
            case 'bg': this.bgraw = []; this.bgen = []; this.dxfbg = false; this.bgDXF = ''; break;
        }
        this.rebirth = true;
    }

    // --- scene persistence ---------------------------------------------------
    // See instruction doc §5.2: a new JSON format (v2) carries the full
    // parameter set plus embedded DXF text (Win's "path to a DXF file on
    // disk" has no web equivalent); the legacy tab-separated format from
    // hecken.h:969-1103 is still understood for reading old files, extended
    // here to actually restore ALL fields (the original itself only ever
    // wrote/read 33 of them - sub-mechanism fields included below were
    // always part of the legacy format; doublecrank/thetaplus/orbit toggles
    // never were, see the field list note below).

    /** Builds a v2 JSON scene object. `scale` is read from `g` since Graphics owns it. */
    saveSceneV2(g) {
        return {
            format: 'links-web', version: 2,
            params: {
                resol: this.resol, theta: this.theta, object: this.object, scale: g.scale, tilt: this.tilt, roll: this.roll,
                dxf: this.dxf, side: this.side,
                crankr: this.crankr, conrod: this.conrod, leverr: this.leverr,
                lever: { x: this.lever.x, y: this.lever.y }, shift: { x: this.shift.x, y: this.shift.y },
                height: this.height, mini: this.mini, max: this.max, step: this.step,
                subcrankr: this.subcrankr, subcrank: { x: this.subcrank.x, y: this.subcrank.y },
                subconrod: this.subconrod, subleverr: this.subleverr,
                sublever: { x: this.sublever.x, y: this.sublever.y }, subshift: { x: this.subshift.x, y: this.subshift.y },
                thetaplus: this.thetaplus,
                doublecrank: this.doublecrank,
                dualSlider: this.menu.mdsmode.value,
                verticalMode: this.menu.mvtmode.value,
                arcMode: this.arcmode,
                graphMode: this.graph_mode,
                existFrontLegOrbit: this.exist_frontleg_orbit,
                existRearLegOrbit: this.exist_rearleg_orbit,
                existSecretOrbit: this.exist_secret_orbit,
                existMaxMinLength: this.exist_maxmin_length,
            },
            dxf: {
                conrod: this.conrodDXF ? { name: this.conrodDXF, points: this.conrodraw, circles: this.conroden } : null,
                lever: this.leverDXF ? { name: this.leverDXF, points: this.leverraw, circles: this.leveren } : null,
                crank: this.crankDXF ? { name: this.crankDXF, points: this.crankraw, circles: this.cranken } : null,
                sub: this.subDXF ? { name: this.subDXF, points: this.subraw, circles: this.suben } : null,
                bg: this.bgDXF ? { name: this.bgDXF, points: this.bgraw, circles: this.bgen } : null,
            },
        };
    }

    loadSceneV2(obj, g) {
        const p = obj.params;
        this.resol = p.resol; this.theta = p.theta; this.object = p.object; this.tilt = p.tilt; this.roll = p.roll;
        if (g) g.scale = p.scale;
        this.dxf = !!p.dxf; this.side = !!p.side;
        this.crankr = p.crankr; this.conrod = p.conrod; this.leverr = p.leverr;
        this.lever = new Point(p.lever.x, p.lever.y);
        this.shift = new Point(p.shift.x, p.shift.y);
        this.height = p.height; this.mini = p.mini; this.max = p.max; this.step = p.step;
        this.subcrankr = p.subcrankr; this.subcrank = new Point(p.subcrank.x, p.subcrank.y);
        this.subconrod = p.subconrod; this.subleverr = p.subleverr;
        this.sublever = new Point(p.sublever.x, p.sublever.y);
        this.subshift = new Point(p.subshift.x, p.subshift.y);
        this.thetaplus = p.thetaplus;
        this.doublecrank = !!p.doublecrank;
        this.menu.mdsmode.value = !!p.dualSlider;
        this.mode = this.menu.mdsmode.value ? Mode.MDUALSLIDER : Mode.MHECKEN;
        this.menu.mvtmode.value = !!p.verticalMode;
        this.arcmode = !!p.arcMode;
        this.graph_mode = p.graphMode ?? GraphTarget.LEVERJOINT;
        this.exist_frontleg_orbit = !!p.existFrontLegOrbit;
        this.exist_rearleg_orbit = !!p.existRearLegOrbit;
        this.exist_secret_orbit = !!p.existSecretOrbit;
        this.exist_maxmin_length = !!p.existMaxMinLength;
        this.menu.mmmlmode.value = this.exist_maxmin_length;

        const parts = ['conrod', 'lever', 'crank', 'sub', 'bg'];
        const flags = { conrod: 'dxfconrod', lever: 'dxflever', crank: 'dxfcrank', sub: 'dxfsub', bg: 'dxfbg' };
        const rawKey = { conrod: 'conrodraw', lever: 'leverraw', crank: 'crankraw', sub: 'subraw', bg: 'bgraw' };
        const enKey = { conrod: 'conroden', lever: 'leveren', crank: 'cranken', sub: 'suben', bg: 'bgen' };
        const nameKey = { conrod: 'conrodDXF', lever: 'leverDXF', crank: 'crankDXF', sub: 'subDXF', bg: 'bgDXF' };
        for (const part of parts) {
            const d = obj.dxf && obj.dxf[part];
            if (d) {
                this[rawKey[part]] = d.points.map((pt) => new Point(pt.x, pt.y, pt.heel));
                this[enKey[part]] = d.circles.map((c) => new Cyclo(new Point(c.pos.x, c.pos.y), c.r));
                this[flags[part]] = true;
                this[nameKey[part]] = d.name;
            } else {
                this[rawKey[part]] = []; this[enKey[part]] = []; this[flags[part]] = false; this[nameKey[part]] = '';
            }
        }

        this.tiltold = this.tilt; // avoid replaying a tilt delta on the next frame
        this.rebirth = true;
    }

    /** Legacy tab-separated format - hecken::save(), hecken.h:969-1017. */
    saveLegacyText(g) {
        const lines = [
            [this.resol, '解像度'], [this.theta, '回転角度'], [this.object, 'オブジェクト数'], [g.scale, '表示倍率'],
            [this.tilt, '傾き'], [this.roll, '毎分回転数'],
            [this.dxf ? 1 : 0, 'DXFファイル表示'], [this.side ? 1 : 0, 'リンクサイド'],
            [this.crankr, 'クランク半径'], [this.conrod, 'コンロッド長さ'], [this.leverr, 'レバー長さ'],
            [this.lever.x, 'レバーX座標'], [this.lever.y, 'レバーY座標'],
            [this.shift.x, 'シフトX方向'], [this.shift.y, 'シフトY方向'],
            [this.height, '最適化曲線高さ'], [this.mini, '最適化曲線前幅'], [this.max, '最適化曲線後幅'], [this.step, '最適化曲線ピッチ'],
            [this.subcrankr, 'サブクランク半径'], [this.subcrank.x, 'サブクランクX座標'], [this.subcrank.y, 'サブクランクY座標'],
            [this.subconrod, 'サブコンロッド長さ'], [this.subleverr, 'サブレバー長さ'],
            [this.sublever.x, 'サブレバーX座標'], [this.sublever.y, 'サブレバーY座標'],
            [this.subshift.x, 'サブシフトX方向'], [this.subshift.y, 'サブシフトY方向'],
        ];
        let out = lines.map(([v, label]) => `${v}\t${label}\n`).join('');
        out += `${this.conrodDXF}\tコンロッド用DXFファイル\n`;
        out += `${this.leverDXF}\tレバー用DXFファイル\n`;
        out += `${this.crankDXF}\tクランク用DXFファイル\n`;
        out += `${this.subDXF}\tサブ用DXFファイル\n`;
        out += `${this.bgDXF}\tバックグラウンド用DXFファイル\n`;
        out += 'eof';
        return out;
    }

    /**
     * Legacy tab-separated format reader - hecken::open(), hecken.h:1020-1103.
     * Fixed vs. the original web port: numeric fields used `value || default`
     * which silently replaced any real 0 (e.g. a slider mechanism's leverr=0)
     * with the field's default - see instruction doc §3 bug #2. This reader
     * uses `Number.isFinite` instead so 0 is preserved. DXF file *paths* in
     * the legacy format can't be resolved on the web (no filesystem access),
     * so they're read as informational filenames only, logged as a warning.
     */
    loadLegacyText(text) {
        const rawLines = text.split(/\r\n|\r|\n/);
        const num = (i, def = 0) => {
            const v = parseFloat((rawLines[i] || '').split('\t')[0]);
            return Number.isFinite(v) ? v : def;
        };
        let i = 0;
        this.resol = num(i++, 100); this.theta = num(i++, 0); this.object = num(i++, 3);
        const scale = num(i++, 3); this.tilt = num(i++, 0); this.roll = num(i++, 15);
        this.dxf = !!num(i++, 1); this.side = !!num(i++, 0);
        this.crankr = num(i++, 25); this.conrod = num(i++, 50); this.leverr = num(i++, 50);
        this.lever = new Point(num(i++, -50), num(i++, -50));
        this.shift = new Point(num(i++, 0), num(i++, 50));
        this.height = num(i++, 100); this.mini = num(i++, 42); this.max = num(i++, 42); this.step = num(i++, 5);
        this.subcrankr = num(i++, 25);
        this.subcrank = new Point(num(i++, 0), num(i++, 0));
        this.subconrod = num(i++, 0); this.subleverr = num(i++, 0);
        this.sublever = new Point(num(i++, 0), num(i++, 20));
        this.subshift = new Point(num(i++, 0), num(i++, 0));

        const dxfNames = [];
        for (let k = 0; k < 5; k++) dxfNames.push((rawLines[i++] || '').split('\t')[0] || '');
        const eofLine = (rawLines[i] || '').trim();

        // A legacy file's DXF part paths refer to files on the original
        // author's disk and can't be loaded here - clear part flags rather
        // than pretend they're present, and let the caller warn the user.
        this.conrodraw = []; this.conroden = []; this.dxfconrod = false; this.conrodDXF = dxfNames[0];
        this.leverraw = []; this.leveren = []; this.dxflever = false; this.leverDXF = dxfNames[1];
        this.crankraw = []; this.cranken = []; this.dxfcrank = false; this.crankDXF = dxfNames[2];
        this.subraw = []; this.suben = []; this.dxfsub = false; this.subDXF = dxfNames[3];
        this.bgraw = []; this.bgen = []; this.dxfbg = false; this.bgDXF = dxfNames[4];

        this.tiltold = this.tilt;
        this.rebirth = true;

        return {
            ok: eofLine === 'eof',
            scale,
            danglingDxfNames: dxfNames.filter(Boolean),
        };
    }
}
