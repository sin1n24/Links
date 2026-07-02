import { describe, it, expect } from 'vitest';
import { loadApp } from './helpers/loadApp.js';

const { Point, offsetFree, rad, deg, limit, sincos } = loadApp();

describe('rad/deg', () => {
    it('round-trips', () => {
        expect(deg(rad(90))).toBeCloseTo(90);
        expect(rad(180)).toBeCloseTo(Math.PI);
    });
});

describe('limit', () => {
    it('clamps into range', () => {
        expect(limit(5, 0, 10)).toBe(5);
        expect(limit(-5, 0, 10)).toBe(0);
        expect(limit(50, 0, 10)).toBe(10);
    });
});

describe('Point', () => {
    it('rota rotates around a center by radians (cal.h point::rota)', () => {
        const p = new Point(10, 0);
        const center = new Point(0, 0);
        const rotated = p.rota(center, Math.PI / 2);
        expect(rotated.x).toBeCloseTo(0);
        expect(rotated.y).toBeCloseTo(10);
    });

    it('dist matches Euclidean distance', () => {
        expect(new Point(0, 0).dist(new Point(3, 4))).toBeCloseTo(5);
    });

    it('__dir matches quadrant-aware atan (hecken.h graph panel usage)', () => {
        // dx>0,dy>0 -> Quadrant 1, plain atan
        expect(new Point(1, 1).__dir(new Point(0, 0))).toBeCloseTo(Math.PI / 4);
        // dx<0,dy>0 -> Quadrant 2: PI - atan
        expect(new Point(-1, 1).__dir(new Point(0, 0))).toBeCloseTo(Math.PI - Math.PI / 4);
        // dx<0,dy<0 -> Quadrant 3: -PI + atan
        expect(new Point(-1, -1).__dir(new Point(0, 0))).toBeCloseTo(-Math.PI + Math.PI / 4);
        // dx>0,dy<0 -> Quadrant 4: -atan
        expect(new Point(1, -1).__dir(new Point(0, 0))).toBeCloseTo(-Math.PI / 4);
    });
});

describe('offsetFree (Common/utility.h offset())', () => {
    it('offsetting by (0,0) returns datam unchanged', () => {
        const datam = new Point(5, 5), sub = new Point(0, 0);
        const result = offsetFree(datam, sub, new Point(0, 0), 10);
        expect(result.x).toBeCloseTo(5);
        expect(result.y).toBeCloseTo(5);
    });

    it('shift.y walks along the sub->datam direction, shift.x is perpendicular', () => {
        // datam directly above sub (dx=0, dy=-10 in this coordinate space's dy=datam.y-sub.y)
        const datam = new Point(0, -10), sub = new Point(0, 0);
        const conrod = 10;
        const along = offsetFree(datam, sub, new Point(0, 5), conrod);
        // Walking `shift.y` further along the same (sub->datam) direction
        // should move datam further from sub along that axis.
        expect(along.dist(sub)).toBeCloseTo(15);
    });
});

describe('sincos', () => {
    it('matches cos/sin', () => {
        const p = sincos(Math.PI / 2);
        expect(p.x).toBeCloseTo(0);
        expect(p.y).toBeCloseTo(1);
    });
});
