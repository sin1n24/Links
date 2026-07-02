// Links Web - Data Structures
//
// Ported from Common/cal.h (point, cyclo) and parts of Common/utility.h
// (rad/deg/offset). The original C++ used fixed-size arrays (point::lim=1000,
// cyclo::lim=100) with a "repeated final point" / "r==0" sentinel to mark the
// end of data, because C arrays have no length. In this port we use ordinary
// JS arrays (array.length is the bound), so those sentinels are dropped -
// this is a pure implementation-detail simplification with no behavioral
// difference for the user.

/** deg -> rad, matches Common/utility.h rad() */
function rad(deg) {
    return deg * 2 * Math.PI / 360;
}
/** rad -> deg, matches Common/utility.h deg() */
function deg(radians) {
    return radians * 360 / (2 * Math.PI);
}

/** Clamp helper, matches the two limit() overloads in Links/hecken.h */
function limit(now, mini, maxi) {
    if (now > maxi) return maxi;
    if (now < mini) return mini;
    return now;
}

class Point {
    constructor(x = 0, y = 0, heel = true) {
        this.x = x;
        this.y = y;
        // heel === true: a line should be drawn from this point to the next
        // one in the same polyline. heel === false marks a break (the next
        // point, if any, starts a new disconnected segment).
        this.heel = heel;
    }

    set(x, y, heel = true) {
        this.x = x;
        this.y = y;
        this.heel = heel;
        return this;
    }

    clone() {
        return new Point(this.x, this.y, this.heel);
    }

    add(other) {
        return new Point(this.x + other.x, this.y + other.y);
    }

    subtract(other) {
        return new Point(this.x - other.x, this.y - other.y);
    }

    multiply(scalar) {
        return new Point(this.x * scalar, this.y * scalar);
    }

    divide(scalar) {
        if (scalar === 0) return new Point();
        return new Point(this.x / scalar, this.y / scalar);
    }

    equals(other) {
        return this.x === other.x && this.y === other.y;
    }

    dist(other) {
        return Math.hypot(this.x - other.x, this.y - other.y);
    }

    // point::dist(a, hit) - "is other within hit units" (cal.h:38), used
    // nowhere performance critical; kept for parity with the original API.
    within(other, hit) {
        return Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2) <= Math.pow(hit, 2);
    }

    // Rotates this point around `center` by `angle` radians. cal.h point::rota
    rota(center, angle) {
        const d = this.subtract(center);
        const newX = center.x + d.x * Math.cos(angle) - d.y * Math.sin(angle);
        const newY = center.y + d.x * Math.sin(angle) + d.y * Math.cos(angle);
        return new Point(newX, newY, this.heel);
    }

    // point::dir(sub) - cal.h:88. Used by hecken::trace() (secret_orbit) and
    // hecken::sander() (slope). NOT the same formula as __dir below.
    dir(sub) {
        const dx = this.x - sub.x, dy = this.y - sub.y;
        let d = Math.atan(dy / dx);
        if (dx < 0 && dy < 0) d += Math.PI;
        else if (dx > 0 && dy < 0) d -= 2 * Math.PI;
        else if (dx < 0 && dy > 0) d -= Math.PI;
        return d;
    }

    // point::_dir(sub) - cal.h:99. Present in the original but never called;
    // ported for API parity in case future work wires it up.
    _dir(sub) {
        const dx = this.x - sub.x, dy = this.y - sub.y;
        let d = Math.atan(Math.abs(dy) / Math.abs(dx));
        if (dx > 0 && dy > 0) d = d;
        else if (dx < 0 && dy > 0) d = Math.PI - d;
        else if (dx < 0 && dy < 0) d = d;
        else if (dx > 0 && dy < 0) d = Math.PI - d;
        else d = 0;
        return d;
    }

    // point::__dir(sub) - cal.h:112. Used for the graph panel's lever/conrod
    // angle readout (hecken.h:346).
    __dir(sub) {
        const dx = this.x - sub.x, dy = this.y - sub.y;
        let d = Math.atan(Math.abs(dy) / Math.abs(dx));
        if (dx > 0 && dy > 0) d = d;
        else if (dx < 0 && dy > 0) d = Math.PI - d;
        else if (dx < 0 && dy < 0) d = -Math.PI + d;
        else if (dx > 0 && dy < 0) d = -d;
        else d = 0;
        return d;
    }

    // point::on(a, hit) - cal.h:76-80. Used by value.js hit-testing (a param
    // row's clickable bounding box). `hit` may be a number or a Point.
    on(a, hit) {
        const hx = (hit instanceof Point) ? hit.x : hit;
        const hy = (hit instanceof Point) ? hit.y : hit;
        if (this.x > a.x + hx || this.x < a.x || this.y > a.y + hy || this.y < a.y) return false;
        return true;
    }

    // point::offset(sub, shift) - cal.h:56-64 (2-arg form: conrod is the
    // distance between this point and sub, computed automatically).
    offset(sub, shift) {
        const conrod = this.dist(sub);
        return offsetFree(this, sub, shift, conrod);
    }
}

/**
 * Free function offset(datam, sub, shift, conrod) - Common/utility.h:116-123
 * and the near-identical Common/cal.h point::offset(sub,shift,conrod) member.
 * This is THE core linkage-geometry primitive: it takes `shift`, a vector
 * expressed in the local frame of the (sub -> datam) segment (shift.y = along
 * that segment, shift.x = perpendicular to it), and returns the world-space
 * point obtained by walking that offset from `datam`.
 *
 * If conrod is 0, it's computed as hypot(datam, sub) (utility.h behavior).
 */
function offsetFree(datam, sub, shift, conrod) {
    const c = conrod || datam.dist(sub) || 1;
    return new Point(
        datam.x + (shift.y * (datam.x - sub.x) + shift.x * (datam.y - sub.y)) / c,
        datam.y + (shift.y * (datam.y - sub.y) - shift.x * (datam.x - sub.x)) / c
    );
}

/** sincos(angle) - cal.h:127-131 */
function sincos(angle) {
    return new Point(Math.cos(angle), Math.sin(angle));
}

class Cyclo {
    constructor(pos = new Point(), r = 0) {
        this.pos = pos;
        this.r = r;
    }

    clone() {
        return new Cyclo(this.pos.clone(), this.r);
    }

    set(pos, r) {
        this.pos = pos;
        this.r = r;
        return this;
    }
}
