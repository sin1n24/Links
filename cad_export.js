// Links Web - AutoCAD command / DXF export
//
// Ported from hecken::saveCmd/saveCmdV (hecken.h:1105-1188) and the
// fline/fpoint/fcircle/fpline writers in dxf_io.js. Split out from
// simulation.js for organization, same rationale as graph_panel.js.
//
// One upstream bug is deliberately NOT reproduced here: saveCmdV(bool DXF)
// accepted a `DXF` flag but never actually used it (hecken.h:1173-1188 calls
// fpline()/fpoint() with no third argument, so they silently default to
// false) - meaning "DXF export + Shift" in the original produced AutoCAD
// command text instead of an actual DXF file, identical to "clipboard
// export + Shift", despite the button's tooltip promising a DXF file. Since
// that directly contradicts what the button claims to do (unlike the
// faithfully-reproduced quirks elsewhere, which are invisible/harmless),
// buildLegOnlyOutput() below honors `isDXF` correctly instead.

(function () {
    /**
     * hecken::saveCmd(maxObject, DXF) - hecken.h:1105-1171. Snapshots either
     * the current `object` frames (normal) or resol/5 evenly-spaced frames
     * of just the loaded DXF parts unioned in AutoCAD (`maxObject`, the
     * Ctrl-click "silhouette/interference check" variant - hecken.h:1112).
     * Mutates live get()-derived state as a side effect, exactly like the
     * original; proceed()'s per-frame get() loop (which runs unconditionally,
     * not gated by `rebirth`) naturally overwrites it again next frame, so
     * there's no lasting visual glitch, matching the original's timing.
     */
    Hecken.prototype.buildCadOutput = function (maxObject, isDXF) {
        const parts = [];

        if (maxObject) {
            const maxNum = Math.floor(this.resol / 5) || 1;
            for (let i = 0; i < maxNum; i++) {
                this.get(this.theta + i * 360 / maxNum, false);
                if (this.dxfconrod) parts.push(DxfIO.fpline(this.conroded, isDXF));
                if (this.dxflever && this.leverr) parts.push(DxfIO.fpline(this.levered, isDXF));
                if (this.dxfcrank) parts.push(DxfIO.fpline(this.cranked, isDXF));
                if (this.dxfsub && !(this.mode === Mode.MHECKEN || this.mode === Mode.MSLIDER)) parts.push(DxfIO.fpline(this.subed, isDXF));
            }
            if (!isDXF) parts.push('_region\nall\n\n_union\nall\n\n\n\n');
        } else {
            for (let i = 0; i < this.object; i++) {
                this.get(this.theta + i * 360 / this.object, false);

                if (!this.dxf || (!this.dxfconrod && !this.dxflever && !this.dxfcrank && !this.dxfsub)) {
                    parts.push(DxfIO.fpline(this.optimized, isDXF));
                    parts.push(DxfIO.fline(this.crank, this.crankjoint, isDXF));
                    parts.push(DxfIO.fline(this.leverjoint, this.crankjoint, isDXF));
                    parts.push(DxfIO.fline(this.crankjoint, this.toe, isDXF));
                    if (this.mode === Mode.MDUALSLIDER) parts.push(DxfIO.fline(this.subleverjoint, this.toe, isDXF));
                    if (this.leverr) parts.push(DxfIO.fline(this.lever, this.leverjoint, isDXF));
                } else {
                    if (this.dxfconrod) parts.push(DxfIO.fpline(this.conroded, isDXF));
                    if (this.dxflever && this.leverr) parts.push(DxfIO.fpline(this.levered, isDXF));
                    if (this.dxfcrank) parts.push(DxfIO.fpline(this.cranked, isDXF));
                    if (this.dxfsub && !(this.mode === Mode.MHECKEN || this.mode === Mode.MSLIDER)) parts.push(DxfIO.fpline(this.subed, isDXF));
                }
                if (this.exist_secret_orbit) parts.push(DxfIO.fpline(this.secret_orbited, isDXF));
            }

            parts.push(DxfIO.fcircle(this.crank, this.crankr, isDXF));
            if (this.shift.x || this.shift.y) parts.push(DxfIO.fpline(this.orbit, isDXF));
            parts.push(DxfIO.fcircle(this.lever, this.leverr || 1, isDXF));
            if (this.dxfbg) parts.push(DxfIO.fpline(this.bgraw, isDXF));
            if (this.shift.x || this.shift.y) {
                parts.push(DxfIO.fline(this.ground.add(new Point(0, 5)), this.ground.subtract(new Point(0, 5)), isDXF));
            }
        }

        return isDXF ? DxfIO.wrapDxfDocument(parts) : parts.join('');
    };

    /** hecken::saveCmdV - hecken.h:1173-1188 (the leg-only "part drawing" export, Shift-click). */
    Hecken.prototype.buildLegOnlyOutput = function (isDXF) {
        const parts = [
            DxfIO.fpline(this.optimizraw, isDXF),
            DxfIO.fpoint(this.lever.subtract(this.crank), isDXF),
        ];
        return isDXF ? DxfIO.wrapDxfDocument(parts) : parts.join('');
    };
})();
