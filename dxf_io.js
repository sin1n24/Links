// Links Web - DXF read/write
//
// Reading is delegated to the vendored `dxf` npm package (vendor/dxf.umd.js,
// window.dxf) instead of a hand-rolled parser. The original C++ parser
// (Common/dxf.h `dxff` class) could only read AC1012 (R12) 2D polylines and
// choked on AC1015+ lightweight polylines (LWPOLYLINE) - see §3 bug notes.
// The library handles POLYLINE, LWPOLYLINE, bulge (arc) segments and CIRCLE
// uniformly, which is a strict improvement with no loss of fidelity.
//
// Writing keeps the original's minimal hand-rolled emitter (Common/dxf.h
// fline/fpoint/fcircle/fpline, ~100 lines) since it's simpler than adding a
// write-capable dependency for a handful of entity types.
//
// Coordinate convention: like the original, Y is flipped between the app's
// internal space (Y-down, matches <canvas> pixel space) and DXF's native
// space (Y-up) only at the read/write boundary.

const DxfIO = (() => {

    /**
     * Parse DXF text into raw shape data for one "part" (conrod/lever/crank/
     * sub/background), mirroring what Common/dxf.h dxff::read() produced:
     * a point[] polyline buffer (with .heel breaks between disjoint
     * polylines) and a cyclo[] circle buffer.
     *
     * Multiple POLYLINE/LWPOLYLINE entities in one file are concatenated,
     * each terminated with heel=false so the renderer doesn't connect one
     * polyline's end to the next one's start (dxf.h polyline(), which set
     * `pline[linecntr-1].heel = false` per chunk).
     */
    function read(dxfText) {
        if (!window.dxf || !window.dxf.Helper) {
            throw new Error('DXF library (vendor/dxf.umd.js) is not loaded');
        }
        const { Helper, toPolylines } = window.dxf;
        const helper = new Helper(dxfText);
        const parsed = helper.parsed;

        const circleEntities = parsed.entities.filter(e => e.type === 'CIRCLE');
        const otherEntities = parsed.entities.filter(e => e.type !== 'CIRCLE');
        // toPolylines() would otherwise also sample circles into polylines;
        // we want true circles (see cyclo/grounding below), so they're
        // extracted directly from the raw entity list instead.
        const filteredParsed = Object.assign({}, parsed, { entities: otherEntities });
        const { polylines } = toPolylines(filteredParsed);

        const points = [];
        for (const pl of polylines) {
            if (pl.vertices.length === 0) continue;
            for (const v of pl.vertices) {
                points.push(new Point(v[0], -v[1], true));
            }
            points[points.length - 1].heel = false;
        }

        const circles = circleEntities.map(e => new Cyclo(new Point(e.x, -e.y), e.r || 1));

        return { points, circles };
    }

    // --- writing -------------------------------------------------------------
    // Ported line-for-line from Common/dxf.h fline/fpoint/fcircle/fpline and
    // the AutoCAD-command-string counterparts (the non-DXF branches).

    function fline(a, b, isDXF) {
        if (isDXF) {
            return ` 0\nLINE\n 8\n0\n 10\n${a.x}\n 20\n${-a.y}\n 30\n0.0\n 11\n${b.x}\n 21\n${-b.y}\n 31\n0.0\n`;
        }
        return `_line\n${a.x},${-a.y}\n${b.x},${-b.y}\n\n`;
    }

    function fpoint(a, isDXF) {
        if (isDXF) {
            return ` 0\nPOINT\n 8\n0\n 10\n${a.x}\n 20\n${-a.y}\n 30\n0.0\n`;
        }
        return `_point\n${a.x},${-a.y}\n\n`;
    }

    function fcircle(a, r, isDXF) {
        if (isDXF) {
            return ` 0\nCIRCLE\n 8\n0\n 10\n${a.x}\n 20\n${-a.y}\n 30\n0.0\n 40\n${r}\n`;
        }
        return `_circle\n${a.x},${-a.y}\n${r}\n`;
    }

    /**
     * fpline() - dxf.h:249-295, translated statement-for-statement. Emits one
     * or more POLYLINE/_pline blocks, opening a fresh block wherever `.heel`
     * is false (mid-array) and closing out at the last point (which in the
     * original was detected via a "pline[i]==pline[i+1]" terminal-duplicate
     * sentinel; here it's simply the last array index - see datatypes.js
     * header comment on why the sentinel isn't needed with JS arrays).
     * `dxfheel=true` forces every point to be treated as connected
     * (cfg.dxfheel, never exposed in the UI - kept for config-file fidelity).
     */
    function fpline(points, isDXF, dxfheel = false) {
        if (points.length === 0) return '';
        let out = isDXF
            ? ' 0\nPOLYLINE\n 8\n0\n 66\n1\n 10\n0.0\n 20\n0.0\n 30\n0.0\n'
            : '_pline\n';

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const isTerminal = (i === points.length - 1);

            if (isTerminal) {
                if (isDXF) {
                    out += ` 0\nVERTEX\n 8\n0\n 10\n${p.x}\n 20\n${-p.y}\n 30\n0.0\n 0\nSEQEND\n`;
                } else {
                    out += i ? `${p.x},${-p.y}\nc\n` : '\n\n';
                }
                break;
            }

            const heel = dxfheel || p.heel;
            if (heel) {
                out += isDXF
                    ? ` 0\nVERTEX\n 8\n0\n 10\n${p.x}\n 20\n${-p.y}\n 30\n0.0\n`
                    : `${p.x},${-p.y}\n`;
            } else if (isDXF) {
                out += ` 0\nVERTEX\n 8\n0\n 10\n${p.x}\n 20\n${-p.y}\n 30\n0.0\n 0\nSEQEND\n`;
                out += ' 0\nPOLYLINE\n 8\n0\n 66\n1\n 10\n0.0\n 20\n0.0\n 30\n0.0\n';
            } else {
                out += i ? `${p.x},${-p.y}\nc\n\n` : '\n\n\n';
            }
        }
        return out;
    }

    /** Wraps a list of already-built entity strings in a minimal DXF document. */
    function wrapDxfDocument(entityStrings) {
        return ' 0\nSECTION\n 2\nENTITIES\n' + entityStrings.join('') + ' 0\nENDSEC\n 0\nEOF\n';
    }

    return { read, fline, fpoint, fcircle, fpline, wrapDxfDocument };
})();
