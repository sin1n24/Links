import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, FakeGraphics } from './helpers/loadApp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Hecken, Mode, Point } = loadApp();

describe('Hecken defaults (hecken::init, hecken.h:934-967)', () => {
    it('matches the original constants', () => {
        const sim = new Hecken();
        expect(sim.crank).toMatchObject({ x: 0, y: 0 });
        expect(sim.crankr).toBe(25);
        expect(sim.lever).toMatchObject({ x: -50, y: -50 });
        expect(sim.leverr).toBe(50);
        expect(sim.conrod).toBe(50);
        expect(sim.shift).toMatchObject({ x: 0, y: 50 });
        expect(sim.object).toBe(3);
        expect(sim.resol).toBe(100);
        expect(sim.roll).toBe(15);
        expect(sim.mini).toBe(42);
        expect(sim.max).toBe(42);
        expect(sim.step).toBe(5);
        expect(sim.height).toBe(100);
        expect(sim.dxf).toBe(true);
        // hecken::hecken() ctor sets thetaplus=180 AFTER init() runs, once (hecken.h:1294)
        expect(sim.thetaplus).toBe(180);
    });

    it('primes optimizraw/orbit/updown once via the constructor, even while dxf=true', () => {
        const sim = new Hecken();
        expect(sim.optimizraw.length).toBeGreaterThan(0);
        expect(sim.orbit.length).toBe(sim.resol + 1);
        // No DXF part loaded and dxf=true means grounding() never runs, so
        // ground.y (and thus updown) stays exactly 0 - this matches the
        // original's actual behavior on a fresh, DXF-less instance, not a bug.
        expect(sim.updown).toBe(0);
    });
});

describe('correct() (hecken.h:916-932)', () => {
    let sim, g;
    beforeEach(() => { sim = new Hecken(); g = new FakeGraphics(); });

    it('clamps resol into [20, 1000]', () => {
        sim.resol = 5; sim.correct(g); expect(sim.resol).toBe(20);
        sim.resol = 5000; sim.correct(g); expect(sim.resol).toBe(1000);
    });
    it('clamps object into [1, 60] (colorlim)', () => {
        sim.object = 0; sim.correct(g); expect(sim.object).toBe(1);
        sim.object = 999; sim.correct(g); expect(sim.object).toBe(60);
    });
    it('floors roll at 10', () => {
        sim.roll = 1; sim.correct(g); expect(sim.roll).toBe(10);
    });
    it('replaces a zero conrod/subconrod with 1', () => {
        sim.conrod = 0; sim.subconrod = 0; sim.correct(g);
        expect(sim.conrod).toBe(1); expect(sim.subconrod).toBe(1);
    });
    it('clamps the Graphics scale (owned externally, not on Hecken - see file header)', () => {
        g.scale = 0.1; sim.correct(g); expect(g.scale).toBe(1);
    });
});

describe('get() kinematics (hecken.h:129-210)', () => {
    it('slider mode (leverr=0) drives leverjoint along the crank->lever direction at exactly `conrod` distance', () => {
        const sim = new Hecken();
        sim.leverr = 0;
        sim.get(0);
        expect(sim.lock).toBe(false);
        expect(sim.leverjoint.dist(sim.crankjoint)).toBeCloseTo(sim.conrod);
    });

    it('4-bar mode keeps crankjoint-leverjoint at conrod distance and leverjoint-lever at leverr distance', () => {
        const sim = new Hecken(); // default leverr=50, conrod=50
        sim.get(30);
        expect(sim.lock).toBe(false);
        expect(sim.leverjoint.dist(sim.crankjoint)).toBeCloseTo(sim.conrod, 5);
        expect(sim.leverjoint.dist(sim.lever)).toBeCloseTo(sim.leverr, 5);
    });

    it('locks when the 4-bar linkage geometry is impossible (crank+lever too far apart)', () => {
        const sim = new Hecken();
        sim.lever = new Point(-1000, -1000); // unreachable at these lengths
        sim.get(0);
        expect(sim.lock).toBe(true);
    });

    it('side flips which of the two circle-intersection solutions is used', () => {
        const a = new Hecken(); a.side = false; a.get(20);
        const b = new Hecken(); b.side = true; b.get(20);
        expect(Math.abs(a.leverjoint.y - b.leverjoint.y)).toBeGreaterThan(1e-6);
    });

    it('dual-slider mode computes a finite subleverjoint at subconrod distance from toe', () => {
        const sim = new Hecken();
        sim.mode = Mode.MDUALSLIDER;
        sim.subconrod = 40;
        sim.get(15);
        expect(Number.isFinite(sim.subleverjoint.x)).toBe(true);
        expect(sim.subleverjoint.dist(sim.toe)).toBeCloseTo(40, 5);
    });

    it('doublecrank mode drives `lever` itself from a subcrank each call (hecken.h:134-138)', () => {
        const sim = new Hecken();
        sim.doublecrank = true;
        sim.subcrank = new Point(60, 0);
        sim.subcrankr = 20;
        sim.thetaplus = 90;
        sim.get(0);
        // lever = subcrank + subcrankr * (cos(0+90deg), sin(0+90deg)) = (60,0)+(20*0,20*1)
        expect(sim.lever.x).toBeCloseTo(60);
        expect(sim.lever.y).toBeCloseTo(20);
    });
});

describe('grounding() (hecken.h:212-249)', () => {
    it('point overload: transforms a local shape by the datam/sub anchor pair and preserves point count and heel flags', () => {
        const sim = new Hecken();
        const raw = [new Point(1, 0, true), new Point(2, 0, false)];
        const ed = [];
        const optmax = sim.grounding(new Point(0, 0), new Point(0, 10), raw, ed, true);
        expect(ed).toHaveLength(2);
        expect(optmax).toBe(1);
        expect(ed[1].heel).toBe(false);
    });

    it('tracks the lowest world-Y point into `ground` unless locked or groundlock suppresses it', () => {
        const sim = new Hecken();
        sim.lock = false;
        sim.ground = new Point(0, -9999);
        const raw = [new Point(0, 100, true), new Point(0, 100, true)];
        sim.grounding(new Point(0, 0), new Point(1, 0), raw, [], false);
        expect(sim.ground.y).toBeGreaterThan(-9999);
    });

    it('groundlock=true suppresses ground tracking entirely', () => {
        const sim = new Hecken();
        sim.lock = false;
        sim.ground = new Point(0, -9999);
        const raw = [new Point(0, 100, true), new Point(0, 100, true)];
        sim.grounding(new Point(0, 0), new Point(1, 0), raw, [], true);
        expect(sim.ground.y).toBe(-9999);
    });
});

describe('trace()/sim()/sander() (hecken.h:475-687)', () => {
    it('trace() fills orbit with resol+1 points reflecting the toe path', () => {
        const sim = new Hecken();
        sim.trace();
        expect(sim.orbit).toHaveLength(sim.resol + 1);
    });

    it('sim() computes a finite updown for the default (dxf=false-capable) configuration', () => {
        const sim = new Hecken();
        sim.setDxfMode(false);
        sim.sander(sim.optimizraw);
        sim.trace();
        sim.sim();
        expect(Number.isFinite(sim.updown)).toBe(true);
        expect(sim.updown).toBeGreaterThanOrEqual(0);
    });

    it('sander() normal mode produces a leg envelope whose length depends only on mini/max/step, not resol', () => {
        const sim = new Hecken();
        sim.sander(sim.optimizraw);
        const lenA = sim.optimizraw.length;
        sim.resol = 500;
        sim.sander(sim.optimizraw);
        expect(sim.optimizraw.length).toBe(lenA);
    });

    it('sander() vertical mode forces shift to (<0, 0) (hecken.h:546-548)', () => {
        const sim = new Hecken();
        sim.shift = new Point(50, 50);
        sim.menu.mvtmode.value = true;
        sim.sander(sim.optimizraw);
        expect(sim.shift.x).toBeLessThan(0);
        expect(sim.shift.y).toBe(0);
    });
});

describe('leg-orbit toggle on a fresh (dxf=true, no DXF loaded) instance - UI overhaul instruction doc §8 regression', () => {
    // A fresh instance has dxf=true and no DXF part loaded, so `optimized`
    // stays empty (get() only ever populates it when dxf===false). Toggling
    // "端部軌道を表示" used to force frontleg_orbit/rearleg_orbit.length up
    // to resol+1 regardless, leaving every slot `undefined`; the next
    // pline() call then threw reading `undefined.heel`, and that exception
    // escaped proceed() and killed the requestAnimationFrame loop for good.
    it('trace() leaves the orbit arrays empty (not sparse) when optimized has no data', () => {
        const sim = new Hecken();
        sim.toggleBothLegOrbits();
        expect(sim.optimized).toHaveLength(0);
        sim.trace();
        expect(sim.frontleg_orbit).toHaveLength(0);
        expect(sim.rearleg_orbit).toHaveLength(0);
        expect(sim.frontleg_orbit.every((p) => p !== undefined)).toBe(true);
        expect(sim.rearleg_orbit.every((p) => p !== undefined)).toBe(true);
    });

    it('proceed() does not throw with front/rear leg orbits toggled on before any DXF part is loaded', () => {
        const sim = new Hecken();
        const g = new FakeGraphics();
        sim.toggleBothLegOrbits();
        expect(() => sim.proceed(g, 16)).not.toThrow();
        expect(() => sim.proceed(g, 16)).not.toThrow(); // a second frame, after rebirth has settled
    });

    it('toggling the orbit back off and on again still does not throw once real data exists', () => {
        const sim = new Hecken();
        const g = new FakeGraphics();
        sim.toggleBothLegOrbits(); // on, still no data
        sim.proceed(g, 16);
        sim.setDxfMode(false); // now optimized gets populated
        sim.proceed(g, 16);
        sim.toggleBothLegOrbits(); // off
        sim.proceed(g, 16);
        sim.toggleBothLegOrbits(); // on again, with real data this time
        expect(() => sim.proceed(g, 16)).not.toThrow();
        expect(sim.frontleg_orbit.length).toBe(sim.resol + 1);
    });
});

describe('proceed() rotation timing (instruction doc §3 bug #6 regression)', () => {
    it('advances theta proportionally to elapsed wall-clock time, not per-call', () => {
        const sim = new Hecken();
        const g = new FakeGraphics();
        sim.menu.mstop.value = true;
        sim.roll = 15; // 15 rpm -> 90 deg/sec
        sim.proceed(g, 1000);
        expect(sim.theta).toBeCloseTo(90, 5);
        sim.proceed(g, 2000);
        expect(sim.theta).toBeCloseTo(270, 5);
    });

    it('does not advance theta when stopped', () => {
        const sim = new Hecken();
        const g = new FakeGraphics();
        sim.menu.mstop.value = false;
        sim.proceed(g, 5000);
        expect(sim.theta).toBe(0);
    });

    it('reverses direction when mturn is toggled off', () => {
        const sim = new Hecken();
        const g = new FakeGraphics();
        sim.menu.mstop.value = true;
        sim.menu.mturn.value = false;
        sim.proceed(g, 1000);
        expect(sim.theta).toBeCloseTo(-90, 5);
    });
});

describe('scene persistence', () => {
    it('v2 JSON round-trips every parameter, including embedded DXF part data', () => {
        const sim = new Hecken();
        const g = new FakeGraphics();
        sim.crankr = 33.5;
        sim.mode = Mode.MDUALSLIDER;
        sim.menu.mdsmode.value = true;
        sim.conrodraw = [new Point(1, 2, true), new Point(3, 4, false)];
        sim.dxfconrod = true;
        sim.conrodDXF = 'part.dxf';

        const scene = sim.saveSceneV2(g);
        const sim2 = new Hecken();
        sim2.loadSceneV2(JSON.parse(JSON.stringify(scene)), g);

        expect(sim2.crankr).toBe(33.5);
        expect(sim2.mode).toBe(Mode.MDUALSLIDER);
        expect(sim2.dxfconrod).toBe(true);
        expect(sim2.conrodraw).toHaveLength(2);
        expect(sim2.conrodraw[1].heel).toBe(false);
        expect(sim2.conrodDXF).toBe('part.dxf');
    });

    it('legacy text format preserves an explicit 0 instead of falling back to a default (instruction doc §3 bug #2)', () => {
        const sim = new Hecken();
        const lines = [
            '100', '0', '3', '3', '0', '15', '1', '0',
            '25', '50', '0', // leverr = 0 (slider mechanism) - the historically-buggy field
            '-50', '-50', '0', '50',
            '100', '42', '42', '5',
            '0', '0', '0', '0', '0', '0', '20', '0', '0',
            '', '', '', '', '',
            'eof',
        ].join('\n');
        const result = sim.loadLegacyText(lines);
        expect(result.ok).toBe(true);
        expect(sim.leverr).toBe(0);
    });

    it('flags a malformed legacy file (missing eof) without throwing', () => {
        const sim = new Hecken();
        const result = sim.loadLegacyText('garbage\nnot a links file');
        expect(result.ok).toBe(false);
    });

    it('legacy load reports dangling DXF filenames it could not resolve on the web', () => {
        const sim = new Hecken();
        const fields = ['100', '0', '3', '3', '0', '15', '0', '0', '25', '50', '50', '-50', '-50', '0', '50', '100', '42', '42', '5', '0', '0', '0', '0', '0', '0', '20', '0', '0'];
        const lines = [...fields, 'leg.dxf', '', '', '', '', 'eof'].join('\n');
        const result = sim.loadLegacyText(lines);
        expect(result.danglingDxfNames).toEqual(['leg.dxf']);
        expect(sim.dxfconrod).toBe(false); // can't actually load it, just remembers the name
    });
});

describe('DXF part loading pipeline integration', () => {
    it('loadDxfPart parses a real DXF file and get() grounds it without producing NaN', () => {
        const sim = new Hecken();
        const dxfText = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_r12.dxf'), 'utf8');
        sim.loadDxfPart('conrod', dxfText, 'sample_r12.dxf');
        expect(sim.dxfconrod).toBe(true);
        expect(sim.conrodraw.length).toBeGreaterThan(0);

        sim.get(45);
        const hasNaN = sim.conroded.some((p) => Number.isNaN(p.x) || Number.isNaN(p.y));
        expect(hasNaN).toBe(false);
        expect(sim.conroded.length).toBe(sim.conrodraw.length);
    });

    it('clearDxfPart resets the part and its flag', () => {
        const sim = new Hecken();
        const dxfText = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_r12.dxf'), 'utf8');
        sim.loadDxfPart('lever', dxfText, 'x.dxf');
        sim.clearDxfPart('lever');
        expect(sim.dxflever).toBe(false);
        expect(sim.leverraw).toHaveLength(0);
    });
});

describe('CAD/DXF export (cad_export.js)', () => {
    it('buildCadOutput(false, true) produces a DXF document that DxfIO can re-parse', () => {
        const { DxfIO } = loadApp();
        const sim = new Hecken();
        const dxfText = sim.buildCadOutput(false, true);
        expect(() => DxfIO.read(dxfText)).not.toThrow();
        expect(dxfText.startsWith(' 0\nSECTION')).toBe(true);
        expect(dxfText.trim().endsWith('0\nEOF')).toBe(true);
    });

    it('buildLegOnlyOutput honors isDXF correctly (upstream saveCmdV bug fix, cad_export.js header)', () => {
        const sim = new Hecken();
        const cmdText = sim.buildLegOnlyOutput(false);
        const dxfText = sim.buildLegOnlyOutput(true);
        expect(cmdText).toContain('_pline');
        expect(dxfText).toContain('SECTION');
        expect(dxfText).not.toContain('_pline');
    });
});
