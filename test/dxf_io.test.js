import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { loadApp } from './helpers/loadApp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Point, DxfIO } = loadApp();

const FIXTURES = path.join(__dirname, 'fixtures');
const r12 = fs.readFileSync(path.join(FIXTURES, 'sample_r12.dxf'), 'utf8');
const r2000 = fs.readFileSync(path.join(FIXTURES, 'sample_r2000.dxf'), 'utf8');

describe('DxfIO.read', () => {
    it('reads AC1012 (R12) POLYLINE with a bulge arc, plus a CIRCLE', () => {
        const { points, circles } = DxfIO.read(r12);
        expect(points.length).toBeGreaterThan(30); // bulge gets sampled into many segments
        expect(circles).toHaveLength(1);
        expect(circles[0].r).toBeCloseTo(2.5);
        // Y is flipped between DXF's native (Y-up) and the app's internal
        // (Y-down) space - see dxf_io.js header.
        expect(circles[0].pos.y).toBeCloseTo(-5);
    });

    it('reads AC1015 (R2000) LWPOLYLINE with a bulge arc - the original hand-rolled parser could not do this (instruction doc bug #5)', () => {
        const { points, circles } = DxfIO.read(r2000);
        expect(points.length).toBeGreaterThan(30);
        expect(circles).toHaveLength(1);
    });

    it('marks the last point of each polyline with heel=false to break connectivity', () => {
        const { points } = DxfIO.read(r12);
        expect(points[points.length - 1].heel).toBe(false);
    });

    it('coerces a zero-radius circle to 1 (dxf.h pl_circle: `r?r:1`)', () => {
        const dxf = [
            '  0', 'SECTION', '  2', 'ENTITIES',
            '  0', 'CIRCLE', ' 10', '0.0', ' 20', '0.0', ' 40', '0.0',
            '  0', 'ENDSEC', '  0', 'EOF', '',
        ].join('\n');
        const { circles } = DxfIO.read(dxf);
        expect(circles[0].r).toBe(1);
    });
});

describe('DxfIO writers (Common/dxf.h fline/fpoint/fcircle/fpline)', () => {
    it('fline emits an AutoCAD command by default and a DXF LINE entity when isDXF', () => {
        const a = new Point(1, 2), b = new Point(3, 4);
        expect(DxfIO.fline(a, b, false)).toBe('_line\n1,-2\n3,-4\n\n');
        const dxf = DxfIO.fline(a, b, true);
        expect(dxf).toContain('LINE');
        expect(dxf).toContain('\n 20\n-2\n'); // Y flipped on write too
    });

    it('fcircle flips Y and includes the radius', () => {
        expect(DxfIO.fcircle(new Point(1, 2), 5, false)).toBe('_circle\n1,-2\n5\n');
    });

    it('DXF mode reopens a fresh POLYLINE entity at a heel=false break, matching dxf.h:281-284', () => {
        const pts = [new Point(0, 0, true), new Point(1, 0, false), new Point(2, 0, true), new Point(3, 0, true)];
        const dxf = DxfIO.fpline(pts, true);
        expect(dxf.split('POLYLINE').length - 1).toBe(2);
    });

    it('AutoCAD command mode does NOT reopen "_pline" at a heel=false break (dxf.h:281-292 has no re-open in the non-DXF branch - a real quirk of the original, only reproducible as a single fpline() call per DXF part)', () => {
        const pts = [new Point(0, 0, true), new Point(1, 0, false), new Point(2, 0, true), new Point(3, 0, true)];
        const cmd = DxfIO.fpline(pts, false);
        expect(cmd.split('_pline\n').length - 1).toBe(1);
        // the break still closes out the first segment with a "c" (close) command
        expect(cmd).toContain('c\n\n');
    });

    it('a document built by fpline/fline/fcircle round-trips through DxfIO.read', () => {
        const pts = [new Point(0, 0, true), new Point(10, 0, true), new Point(10, 10, true), new Point(0, 10, true), new Point(0, 0, true)];
        const doc = DxfIO.wrapDxfDocument([
            DxfIO.fpline(pts, true),
            DxfIO.fcircle(new Point(5, 5), 2, true),
        ]);
        const parsed = DxfIO.read(doc);
        expect(parsed.circles).toHaveLength(1);
        expect(parsed.points.length).toBeGreaterThan(0);
    });
});
