(function() {
    function boundingBoxAroundPolyCoords(coords) {
        var xAll = [], yAll = [];
        for (var i = 0; coords[0].length > i; i++) {
            xAll.push(coords[0][i][1]);
            yAll.push(coords[0][i][0]);
        }
        xAll = xAll.sort(function(a, b) {
            return a - b;
        });
        yAll = yAll.sort(function(a, b) {
            return a - b;
        });
        return [ [ xAll[0], yAll[0] ], [ xAll[xAll.length - 1], yAll[yAll.length - 1] ] ];
    }
    function pnpoly(x, y, coords) {
        var vert = [ [ 0, 0 ] ];
        for (var i = 0; coords.length > i; i++) {
            for (var j = 0; coords[i].length > j; j++) vert.push(coords[i][j]);
            vert.push([ 0, 0 ]);
        }
        var inside = false;
        for (var i = 0, j = vert.length - 1; vert.length > i; j = i++) vert[i][0] > y != vert[j][0] > y && (vert[j][1] - vert[i][1]) * (y - vert[i][0]) / (vert[j][0] - vert[i][0]) + vert[i][1] > x && (inside = !inside);
        return inside;
    }
    var gju = {};
    "undefined" != typeof module && module.exports && (module.exports = gju);
    gju.lineStringsIntersect = function(l1, l2) {
        var intersects = [];
        for (var i = 0; l1.coordinates.length - 2 >= i; ++i) for (var j = 0; l2.coordinates.length - 2 >= j; ++j) {
            var a1 = {
                x: l1.coordinates[i][1],
                y: l1.coordinates[i][0]
            }, a2 = {
                x: l1.coordinates[i + 1][1],
                y: l1.coordinates[i + 1][0]
            }, b1 = {
                x: l2.coordinates[j][1],
                y: l2.coordinates[j][0]
            }, b2 = {
                x: l2.coordinates[j + 1][1],
                y: l2.coordinates[j + 1][0]
            }, ua_t = (b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x), ub_t = (a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x), u_b = (b2.y - b1.y) * (a2.x - a1.x) - (b2.x - b1.x) * (a2.y - a1.y);
            if (0 != u_b) {
                var ua = ua_t / u_b, ub = ub_t / u_b;
                ua >= 0 && 1 >= ua && ub >= 0 && 1 >= ub && intersects.push({
                    type: "Point",
                    coordinates: [ a1.x + ua * (a2.x - a1.x), a1.y + ua * (a2.y - a1.y) ]
                });
            }
        }
        0 == intersects.length && (intersects = false);
        return intersects;
    };
    gju.pointInBoundingBox = function(point, bounds) {
        return !(point.coordinates[1] < bounds[0][0] || point.coordinates[1] > bounds[1][0] || point.coordinates[0] < bounds[0][1] || point.coordinates[0] > bounds[1][1]);
    };
    gju.pointInPolygon = function(p, poly) {
        var coords = "Polygon" == poly.type ? [ poly.coordinates ] : poly.coordinates;
        var insideBox = false;
        for (var i = 0; coords.length > i; i++) gju.pointInBoundingBox(p, boundingBoxAroundPolyCoords(coords[i])) && (insideBox = true);
        if (!insideBox) return false;
        var insidePoly = false;
        for (var i = 0; coords.length > i; i++) pnpoly(p.coordinates[1], p.coordinates[0], coords[i]) && (insidePoly = true);
        return insidePoly;
    };
    gju.numberToRadius = function(number) {
        return number * Math.PI / 180;
    };
    gju.numberToDegree = function(number) {
        return 180 * number / Math.PI;
    };
    gju.drawCircle = function(radiusInMeters, centerPoint, steps) {
        var center = [ centerPoint.coordinates[1], centerPoint.coordinates[0] ], dist = radiusInMeters / 1e3 / 6371, radCenter = [ gju.numberToRadius(center[0]), gju.numberToRadius(center[1]) ], steps = steps || 15, poly = [ [ center[0], center[1] ] ];
        for (var i = 0; steps > i; i++) {
            var brng = 2 * Math.PI * i / steps;
            var lat = Math.asin(Math.sin(radCenter[0]) * Math.cos(dist) + Math.cos(radCenter[0]) * Math.sin(dist) * Math.cos(brng));
            var lng = radCenter[1] + Math.atan2(Math.sin(brng) * Math.sin(dist) * Math.cos(radCenter[0]), Math.cos(dist) - Math.sin(radCenter[0]) * Math.sin(lat));
            poly[i] = [];
            poly[i][1] = gju.numberToDegree(lat);
            poly[i][0] = gju.numberToDegree(lng);
        }
        return {
            type: "Polygon",
            coordinates: [ poly ]
        };
    };
    gju.rectangleCentroid = function(rectangle) {
        var bbox = rectangle.coordinates[0];
        var xmin = bbox[0][0], ymin = bbox[0][1], xmax = bbox[2][0], ymax = bbox[2][1];
        var xwidth = xmax - xmin;
        var ywidth = ymax - ymin;
        return {
            type: "Point",
            coordinates: [ xmin + xwidth / 2, ymin + ywidth / 2 ]
        };
    };
    gju.pointDistance = function(pt1, pt2) {
        var lon1 = pt1.coordinates[0], lat1 = pt1.coordinates[1], lon2 = pt2.coordinates[0], lat2 = pt2.coordinates[1], dLat = gju.numberToRadius(lat2 - lat1), dLon = gju.numberToRadius(lon2 - lon1), a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(gju.numberToRadius(lat1)) * Math.cos(gju.numberToRadius(lat2)) * Math.pow(Math.sin(dLon / 2), 2), c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return 1e3 * 6371 * c;
    }, gju.geometryWithinRadius = function(geometry, center, radius) {
        if ("Point" == geometry.type) return radius >= gju.pointDistance(geometry, center);
        if ("LineString" == geometry.type || "Polygon" == geometry.type) {
            var point = {};
            var coordinates;
            coordinates = "Polygon" == geometry.type ? geometry.coordinates[0] : geometry.coordinates;
            for (var i in coordinates) {
                point.coordinates = coordinates[i];
                if (gju.pointDistance(point, center) > radius) return false;
            }
        }
        return true;
    };
    gju.area = function(polygon) {
        var area = 0;
        var points = polygon.coordinates[0];
        var j = points.length - 1;
        var p1, p2;
        for (var i = 0; points.length > i; j = i++) {
            var p1 = {
                x: points[i][1],
                y: points[i][0]
            };
            var p2 = {
                x: points[j][1],
                y: points[j][0]
            };
            area += p1.x * p2.y;
            area -= p1.y * p2.x;
        }
        area /= 2;
        return area;
    }, gju.centroid = function(polygon) {
        var f, x = 0, y = 0;
        var points = polygon.coordinates[0];
        var j = points.length - 1;
        var p1, p2;
        for (var i = 0; points.length > i; j = i++) {
            var p1 = {
                x: points[i][1],
                y: points[i][0]
            };
            var p2 = {
                x: points[j][1],
                y: points[j][0]
            };
            f = p1.x * p2.y - p2.x * p1.y;
            x += (p1.x + p2.x) * f;
            y += (p1.y + p2.y) * f;
        }
        f = 6 * gju.area(polygon);
        return {
            type: "Point",
            coordinates: [ y / f, x / f ]
        };
    }, gju.simplify = function(source, kink) {
        kink = kink || 20;
        source = source.map(function(o) {
            return {
                lng: o.coordinates[0],
                lat: o.coordinates[1]
            };
        });
        var n_source, n_stack, n_dest, start, end, i, sig;
        var dev_sqr, max_dev_sqr, band_sqr;
        var x12, y12, d12, x13, y13, d13, x23, y23, d23;
        var F = .5 * (Math.PI / 180);
        var index = new Array();
        var sig_start = new Array();
        var sig_end = new Array();
        if (3 > source.length) return source;
        n_source = source.length;
        band_sqr = 360 * kink / (6378137 * 2 * Math.PI);
        band_sqr *= band_sqr;
        n_dest = 0;
        sig_start[0] = 0;
        sig_end[0] = n_source - 1;
        n_stack = 1;
        while (n_stack > 0) {
            start = sig_start[n_stack - 1];
            end = sig_end[n_stack - 1];
            n_stack--;
            if (end - start > 1) {
                x12 = source[end].lng() - source[start].lng();
                y12 = source[end].lat() - source[start].lat();
                Math.abs(x12) > 180 && (x12 = 360 - Math.abs(x12));
                x12 *= Math.cos(F * (source[end].lat() + source[start].lat()));
                d12 = x12 * x12 + y12 * y12;
                for (i = start + 1, sig = start, max_dev_sqr = -1; end > i; i++) {
                    x13 = source[i].lng() - source[start].lng();
                    y13 = source[i].lat() - source[start].lat();
                    Math.abs(x13) > 180 && (x13 = 360 - Math.abs(x13));
                    x13 *= Math.cos(F * (source[i].lat() + source[start].lat()));
                    d13 = x13 * x13 + y13 * y13;
                    x23 = source[i].lng() - source[end].lng();
                    y23 = source[i].lat() - source[end].lat();
                    Math.abs(x23) > 180 && (x23 = 360 - Math.abs(x23));
                    x23 *= Math.cos(F * (source[i].lat() + source[end].lat()));
                    d23 = x23 * x23 + y23 * y23;
                    dev_sqr = d13 >= d12 + d23 ? d23 : d23 >= d12 + d13 ? d13 : (x13 * y12 - y13 * x12) * (x13 * y12 - y13 * x12) / d12;
                    if (dev_sqr > max_dev_sqr) {
                        sig = i;
                        max_dev_sqr = dev_sqr;
                    }
                }
                if (band_sqr > max_dev_sqr) {
                    index[n_dest] = start;
                    n_dest++;
                } else {
                    n_stack++;
                    sig_start[n_stack - 1] = sig;
                    sig_end[n_stack - 1] = end;
                    n_stack++;
                    sig_start[n_stack - 1] = start;
                    sig_end[n_stack - 1] = sig;
                }
            } else {
                index[n_dest] = start;
                n_dest++;
            }
        }
        index[n_dest] = n_source - 1;
        n_dest++;
        var r = new Array();
        for (var i = 0; n_dest > i; i++) r.push(source[index[i]]);
        return r.map(function(o) {
            return {
                type: "Point",
                coordinates: [ o.lng, o.lat ]
            };
        });
    };
    gju.destinationPoint = function(pt, brng, dist) {
        dist /= 6371;
        brng = gju.numberToRadius(brng);
        var lat1 = gju.numberToRadius(pt.coordinates[0]);
        var lon1 = gju.numberToRadius(pt.coordinates[1]);
        var lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist) + Math.cos(lat1) * Math.sin(dist) * Math.cos(brng));
        var lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(dist) * Math.cos(lat1), Math.cos(dist) - Math.sin(lat1) * Math.sin(lat2));
        lon2 = (lon2 + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        return {
            type: "Point",
            coordinates: [ gju.numberToDegree(lat2), gju.numberToDegree(lon2) ]
        };
    };
})();