// Links Web - DXF File Parser

class DxfParser {
    constructor() {
        this.lines = [];
        this.lineIndex = 0;
        this.ver = 0;
        this.already10 = false;
        this.alreadyPoly = false;
    }

    // Simulates C++ ifstream's getline
    getline() {
        if (this.lineIndex >= this.lines.length) {
            return null; // EOF
        }
        return this.lines[this.lineIndex++].trim();
    }

    parse(dxfString) {
        console.log("Parsing DXF data...");
        this.lines = dxfString.split('\n');
        this.lineIndex = 0;

        const polylines = [];
        const circles = [];

        let currentPolyline = [];

        while (this.lineIndex < this.lines.length) {
            const line = this.getline();
            if (line === null) break;

            if (line === '$ACADVER') this.version();
            if (line === 'AcDbCircle') {
                const circle = this.pl_circle();
                if (circle) circles.push(circle);
            }
            if (line === 'AcDb2dPolyline' || line === 'AcDbPolyline' || this.alreadyPoly) {
                const poly = this.polyline();
                if (poly) polylines.push(poly);
            }
        }

        console.log("DXF parsing complete.");
        // For this app, we merge all polylines into one and return that.
        const finalPoints = polylines.flat();
        return { points: finalPoints, circles: circles };
    }

    version() {
        this.getline(); // Group code 1
        const verStr = this.getline(); // AC1012 or AC1015
        if (verStr === 'AC1012') this.ver = 2012;
        else if (verStr === 'AC1015') this.ver = 2015;
        else this.ver = 0;
    }

    // Reads a point (group codes 10, 20, 30)
    read123(pt) {
        let line;
        while (!this.already10) {
            line = this.getline();
            if (line === null || line === 'SEQEND' || line === 'ENDSEC') return false;
            if (line === 'AcDb2dPolyline' || line === 'AcDbPolyline') {
                this.alreadyPoly = true;
                return false;
            }
            if (line === ' 10' || line === '10') break;
        }
        this.already10 = false;

        pt.x = parseFloat(this.getline());
        this.getline(); // Group code 20
        pt.y = -parseFloat(this.getline()); // Y is inverted in the original

        if (this.ver === 2012) {
            this.getline(); // Group code 30
            this.getline(); // Z value (ignored)
        }
        return true;
    }

    pl_circle() {
        const center = new Point();
        if (!this.read123(center)) return null;

        this.getline(); // Group code 40
        const radius = parseFloat(this.getline());
        return new Cyclo(center, radius || 1);
    }

    polyline() {
        this.alreadyPoly = false;
        const points = [];
        let line;

        while (true) {
            line = this.getline();
            if (line === null || line === 'SEQEND') break;
            if (line !== 'VERTEX') continue;

            const pt = new Point();
            if (this.read123(pt)) {
                pt.heel = true;
                points.push(pt);
                line = this.getline(); // Check for next group code
                this.already10 = (line === ' 10' || line === '10');
            } else {
                break;
            }
        }
        if (points.length > 0) {
            // In C++, the last point is duplicated to mark the end.
            // Here, we can just use the array as is.
        }
        return points;
    }
}
