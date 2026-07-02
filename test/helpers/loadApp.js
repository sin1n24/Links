// Loads the plain <script>-tag source files (datatypes.js, dxf_io.js,
// simulation.js, ...) into one shared vm context, the same way a browser
// would via one global scope - so the production files need no ESM
// export/CJS module.exports shims added just for testing.
//
// graphics.js/config.js/ui.js/animation.js/main.js touch real DOM/Canvas/
// localStorage APIs that don't exist under Node, so they're intentionally
// left out here; those layers were verified by hand in a real browser (see
// project notes) rather than by this automated suite, which focuses on the
// pure-logic core: kinematics, DXF I/O, and scene persistence - exactly the
// code where a future edit is most likely to silently drift from the
// original C++'s behavior.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function loadApp() {
    const ctx = { window: {}, console, Math, Infinity, JSON, Object };
    vm.createContext(ctx);

    // The vendored UMD bundle takes the CommonJS branch (module.exports)
    // under Node instead of attaching to `window` (that branch only runs
    // in real browsers, where neither `exports` nor `module` exist) - see
    // vendor/dxf.umd.js's header comment.
    ctx.window.dxf = require(path.join(ROOT, 'vendor', 'dxf.umd.js'));

    const graphicsSrc = fs.readFileSync(path.join(ROOT, 'graphics.js'), 'utf8')
        .replace(/class Graphics[\s\S]*?\n}\n/, ''); // strip the DOM-dependent class, keep buildColorPalette()

    const combined = [
        graphicsSrc,
        fs.readFileSync(path.join(ROOT, 'datatypes.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'dxf_io.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'simulation.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'graph_panel.js'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'cad_export.js'), 'utf8'),
        'globalThis.__exports = { Point, Cyclo, sincos, rad, deg, limit, offsetFree, DxfIO, Hecken, Mode, GraphTarget, buildColorPalette };',
    ].join('\n');

    vm.runInContext(combined, ctx, { filename: 'app-bundle.js' });
    return ctx.__exports;
}

/** A minimal stand-in for graphics.js's Graphics class, sufficient for driving Hecken.proceed()/draw() in tests without a real <canvas>. */
class FakeGraphics {
    constructor(scale = 3) {
        this.scale = scale;
        this.backgroundColor = '#000';
        this.calls = { line: 0, dot: 0, circle: 0, pline: 0, pcircle: 0 };
        this.width = 800;
        this.height = 600;
    }
    getScale() { return this.scale; }
    setScale(s) { this.scale = s; }
    line() { this.calls.line++; }
    dot() { this.calls.dot++; }
    circle() { this.calls.circle++; }
    pline(points) { this.calls.pline++; }
    pcircle(cyclos) { this.calls.pcircle++; }
    lineScreen() {}
    circleScreen() {}
    boxScreen() {}
    textScreen() {}
}

module.exports = { loadApp, FakeGraphics };
