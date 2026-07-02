// Links Web - graph/telemetry panel
//
// Ported from the `menu[mgraph]` block inside hecken::drawOnce()
// (hecken.h:340-406). Split into its own file (attached to Hecken.prototype)
// purely to keep simulation.js from growing even larger - it's still "part
// of" the Hecken class. Unlike the rest of drawOnce()/draw(), this section
// drew directly with DX's raw screen-space primitives rather than through
// the `graphic` class's pan/zoom transform, so it's ported using
// Graphics's *Screen() methods (see graphics.js) for the same effect: the
// panel stays fixed on screen regardless of canvas zoom/pan.
//
// The original's function-local `static` variables (persisting once across
// the whole program's lifetime, since exactly one `hecken` object ever
// existed) become lazily-initialized instance fields here instead.

(function () {
    const GRAPH_LINE_CAP = 500; // hecken.h:348 `line[500]`

    function currentTrackedPoint(sim) {
        switch (sim.graph_mode) {
            case GraphTarget.CRANKJOINT: return sim.crankjoint;
            case GraphTarget.LEVERJOINT: return sim.leverjoint;
            case GraphTarget.TOE: return sim.toe;
            case GraphTarget.GROUND: return sim.ground;
            case GraphTarget.SUBCRANKJOINT: return sim.subcrankjoint;
            case GraphTarget.SUBLEVERJOINT: return sim.subleverjoint;
            case GraphTarget.SUBTOE: return sim.subtoe;
            default: return sim.leverjoint;
        }
    }

    Hecken.prototype.drawGraphPanel = function (g) {
        const leverAngle = this.leverjoint.__dir(this.lever);
        const conrodAngle = this.crankjoint.__dir(this.leverjoint);
        const trackedNow = currentTrackedPoint(this).clone();

        if (this._graphOld === undefined) {
            // First-ever call: mirrors the C++ statics' initializer, which
            // ran exactly once for the program's single hecken instance.
            this._graphOld = trackedNow.clone();
            this._graphI = 0;
            this._graphMaxLeverAngle = leverAngle;
            this._graphMinLeverAngle = leverAngle;
            this._graphMaxConrodAngle = conrodAngle;
            this._graphMinConrodAngle = conrodAngle;
            this._graphMaxAcc = 0;
            this._graphMinAcc = 0;
            this._graphLine = [];
        }

        const acc = this._graphOld.dist(trackedNow) * 100;

        const datam = { x: Math.max(180, g.width - 450), y: Math.max(220, g.height - 100) };
        const color = 'rgb(200,200,200)', maxColor = 'rgb(100,200,100)', minColor = 'rgb(200,100,100)';

        if (this._shiftHeld) {
            let shift = -180, dim = 65;
            g.circleScreen(datam.x - shift, datam.y - dim, dim + 2, color, false);
            g.lineScreen(datam.x - shift, datam.y - dim, datam.x - shift + Math.cos(leverAngle) * dim, datam.y - dim + Math.sin(leverAngle) * dim, color);
            g.lineScreen(datam.x - shift, datam.y - dim, datam.x - shift + Math.cos(this._graphMinLeverAngle) * dim, datam.y - dim + Math.sin(this._graphMinLeverAngle) * dim, minColor);
            g.lineScreen(datam.x - shift, datam.y - dim, datam.x - shift + Math.cos(this._graphMaxLeverAngle) * dim, datam.y - dim + Math.sin(this._graphMaxLeverAngle) * dim, maxColor);

            shift = -330; dim = 65;
            g.circleScreen(datam.x - shift, datam.y - dim, dim + 2, color, false);
            g.lineScreen(datam.x - shift, datam.y - dim, datam.x - shift + Math.cos(conrodAngle) * dim, datam.y - dim + Math.sin(conrodAngle) * dim, color);
            g.lineScreen(datam.x - shift, datam.y - dim, datam.x - shift + Math.cos(this._graphMinConrodAngle) * dim, datam.y - dim + Math.sin(this._graphMinConrodAngle) * dim, minColor);
            g.lineScreen(datam.x - shift, datam.y - dim, datam.x - shift + Math.cos(this._graphMaxConrodAngle) * dim, datam.y - dim + Math.sin(this._graphMaxConrodAngle) * dim, maxColor);

            g.lineScreen(datam.x + 400, datam.y - 65 - 65 - 12, datam.x + 400 - acc, datam.y - 65 - 65 - 12, color);

            g.textScreen(datam.x, datam.y + 10, color, `速度 = Now[${acc.toFixed(2)}] Max[${this._graphMaxAcc.toFixed(2)}] Min[${this._graphMinAcc.toFixed(2)}]`);
            g.textScreen(datam.x, datam.y + 30, color, `レバー角度 = Band[${deg(this._graphMaxLeverAngle - this._graphMinLeverAngle).toFixed(2)}] Max[${deg(this._graphMaxLeverAngle).toFixed(2)}] Min[${deg(this._graphMinLeverAngle).toFixed(2)}]`);
            g.textScreen(datam.x, datam.y + 50, color, `コンロッド角度 = Band[${deg(this._graphMaxConrodAngle - this._graphMinConrodAngle).toFixed(2)}] Max[${deg(this._graphMaxConrodAngle).toFixed(2)}] Min[${deg(this._graphMinConrodAngle).toFixed(2)}]`);
            g.textScreen(datam.x, datam.y + 70, color, `最適化曲線 端部振上げ高さ = 後[${(this.height - this.min_reartleg_orbit).toFixed(2)}] 前[${(this.height - this.min_frontleg_orbit).toFixed(2)}]`);
        }

        if (this._graphI < this.resol && this._graphI < GRAPH_LINE_CAP - 1) this._graphLine[this._graphI++] = acc;
        else this._graphI = 0;
        for (let k = 0; k <= this._graphI - 2; k++) {
            g.lineScreen(k * 2, datam.y - 200 + this._graphLine[k], k * 2 + 2, datam.y - 200 + this._graphLine[k + 1], color);
        }

        if (!this.menu.mstop.value) {
            this._graphMaxLeverAngle = this._graphMinLeverAngle = leverAngle;
            this._graphMaxConrodAngle = this._graphMinConrodAngle = conrodAngle;
            this._graphMaxAcc = this._graphMinAcc = acc;
            this._graphI = 0;
        }
        if (this._graphMaxLeverAngle < leverAngle) this._graphMaxLeverAngle = leverAngle;
        if (this._graphMinLeverAngle > leverAngle) this._graphMinLeverAngle = leverAngle;
        if (this._graphMaxConrodAngle < conrodAngle) this._graphMaxConrodAngle = conrodAngle;
        if (this._graphMinConrodAngle > conrodAngle) this._graphMinConrodAngle = conrodAngle;
        if (this._graphMaxAcc < acc) this._graphMaxAcc = acc;
        if (this._graphMinAcc > acc) this._graphMinAcc = acc;

        this._graphOld = currentTrackedPoint(this).clone();
    };
})();
