import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, useWindowDimensions, Text as RNText, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import Svg, { Polygon, Circle, Rect, Line, Text as SvgText } from 'react-native-svg';

import Button from '@/app/components/Button';

/** Types **/
type Corner = { latitude: number; longitude: number; timestamp: number };

type XY = { x: number; y: number };

/** GEO UTILS **/
const R = 6378137; // Earth radius (m)
function toMetersProjector(lat0: number, lon0: number) {
    const cos = Math.cos((lat0 * Math.PI) / 180);
    return {
        toXY(lat: number, lon: number) {
            const x = (lon - lon0) * (Math.PI / 180) * R * cos;
            const y = (lat - lat0) * (Math.PI / 180) * R;
            return { x, y };
        },
        toLatLon(x: number, y: number) {
            const lat = lat0 + (y / R) * (180 / Math.PI);
            const lon = lon0 + (x / (R * cos)) * (180 / Math.PI);
            return { lat, lon };
        },
    };
}

/** Douglas–Peucker simplify (on meters) — optional for very wiggly points **/
function simplifyXY(points: XY[], eps = 0.03): any { // 3 cm to just remove duplicates
    if (points.length <= 2) return points;
    const lineDist = (p: any, a: any, b: any) => {
        const A = b.y - a.y, B = a.x - b.x, C = -(A * a.x + B * a.y);
        return Math.abs(A * p.x + B * p.y + C) / Math.hypot(A, B);
    };
    let dmax = 0, idx = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = lineDist(points[i], points[0], points[points.length - 1]);
        if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) {
        const r1 = simplifyXY(points.slice(0, idx + 1), eps);
        const r2 = simplifyXY(points.slice(idx), eps);
        return r1.slice(0, -1).concat(r2);
    } else return [points[0], points[points.length - 1]];
}

/** Polygon metrics in meters **/
function polygonAreaMeters(xys: XY[]) {
    if (xys.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < xys.length; i++) {
        const a = xys[i], b = xys[(i + 1) % xys.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
}
function edgeLengthsMeters(xys: XY[]) {
    const arr: number[] = [];
    for (let i = 0; i < xys.length; i++) {
        const a = xys[i], b = xys[(i + 1) % xys.length];
        arr.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    return arr;
}

function formatMeters(m: number) {
    if (m < 1) return `${(m * 100).toFixed(0)} cm`;
    if (m < 10) return `${m.toFixed(2)} m`;
    return `${m.toFixed(1)} m`;
}

/** Corner averaging (stay ~10 s per corner) **/
async function averageCorner(seconds = 10): Promise<Corner | null> {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Location permission is required to mark a corner.');
        return null;
    }
    const start = Date.now();
    const buf: Corner[] = [];
    while (Date.now() - start < seconds * 1000) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
        if ((pos.coords.accuracy ?? 99) <= 5) {
            buf.push({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, timestamp: pos.timestamp ?? Date.now() });
        }
        await new Promise((r) => setTimeout(r, 300)); // ~3 Hz
    }
    if (!buf.length) return null;
    const lat = buf.reduce((a, p) => a + p.latitude, 0) / buf.length;
    const lon = buf.reduce((a, p) => a + p.longitude, 0) / buf.length;
    return { latitude: lat, longitude: lon, timestamp: Date.now() };
}

export default function GardenCornersOnly() {
    const [corners, setCorners] = useState<Corner[]>([]);
    const [isAveraging, setIsAveraging] = useState(false);

    const addCorner = useCallback(async () => {
        if (isAveraging) return;
        setIsAveraging(true);
        const c = await averageCorner(10);
        setIsAveraging(false);
        if (!c) {
            Alert.alert('No good GPS', 'Move to a clearer sky view and try again.');
            return;
        }
        setCorners((prev) => [...prev, c]);
    }, [isAveraging]);

    const undoCorner = useCallback(() => setCorners((cs) => cs.slice(0, -1)), []);
    const resetAll = useCallback(() => setCorners([]), []);
    const closePolygon = useCallback(() => setCorners((cs) => (cs.length >= 3 ? [...cs, cs[0]] : cs)), []);

    // Metrics in meters (local tangent projection around first point)
    const metrics = useMemo(() => {
        if (corners.length < 2) return null;
        const lat0 = corners[0].latitude, lon0 = corners[0].longitude;
        const proj = toMetersProjector(lat0, lon0);
        // If closed, drop duplicate for metrics to avoid zero-length edge
        const rawXY: XY[] = corners.map((c) => proj.toXY(c.latitude, c.longitude));
        const closed = rawXY.length > 2 && Math.hypot(rawXY[0].x - rawXY[rawXY.length - 1].x, rawXY[0].y - rawXY[rawXY.length - 1].y) < 0.05;
        const pts = closed ? rawXY.slice(0, -1) : rawXY;
        const simp = simplifyXY(pts, 0.02);
        const perim = edgeLengthsMeters(simp).reduce((a, b) => a + b, 0);
        const area = simp.length >= 3 ? polygonAreaMeters(simp) : 0;
        return { proj, xy: simp, perim, area };
    }, [corners]);

    return (
        <View style={styles.container}>
            <CornersMap corners={corners} metrics={metrics} />

            <View style={styles.controls}>
                <Button theme="primary" label={isAveraging ? 'Averaging (10s)…' : 'Mark Corner (10s)'} onPress={addCorner} />
                <Button label="Undo Corner" onPress={undoCorner} />
                <Button label="Close Polygon" onPress={closePolygon} />
                <Button label="Reset" onPress={resetAll} />
            </View>

            <ScrollView style={styles.metrics} contentContainerStyle={{ paddingVertical: 8 }}>
                {metrics ? (
                    <View>
                        <RNText style={styles.metricText}>Perimeter: {metrics.perim.toFixed(2)} m</RNText>
                        <RNText style={styles.metricText}>Area: {metrics.area.toFixed(2)} m²</RNText>
                        <RNText style={[styles.metricTextDim, { marginTop: 6 }]}>Tip: For best accuracy, stand still with a clear sky view while marking each corner.</RNText>
                    </View>
                ) : (
                    <RNText style={styles.metricTextDim}>Add ≥2 corners to see distances. Close the polygon for area.</RNText>
                )}
            </ScrollView>
        </View>
    );
}

/** Map component — draws corners, connects them, and annotates edge lengths **/
function CornersMap({ corners, metrics }: { corners: Corner[]; metrics: null | { proj: ReturnType<typeof toMetersProjector>; xy: XY[]; perim: number; area: number } }) {
    const { width } = useWindowDimensions();
    const height = Math.min(340, Math.max(220, Math.round(width * 0.6)));
    const padding = 16;

    const { polyPoints, dots, edgeLabels } = useMemo(() => {
        if (corners.length === 0) return { polyPoints: '', dots: [] as XY[], edgeLabels: [] as { x: number; y: number; text: string }[] };

        // Compute bounds on raw lat/lon
        let minLat = corners[0].latitude, maxLat = corners[0].latitude;
        let minLon = corners[0].longitude, maxLon = corners[0].longitude;
        for (const p of corners) {
            if (p.latitude < minLat) minLat = p.latitude;
            if (p.latitude > maxLat) maxLat = p.latitude;
            if (p.longitude < minLon) minLon = p.longitude;
            if (p.longitude > maxLon) maxLon = p.longitude;
        }
        const latSpan = Math.max(1e-6, maxLat - minLat);
        const lonSpan = Math.max(1e-6, maxLon - minLon);

        const innerW = width - padding * 2;
        const innerH = height - padding * 2;
        const scaleX = innerW / lonSpan;
        const scaleY = innerH / latSpan;
        const scale = Math.min(scaleX, scaleY);
        const contentW = lonSpan * scale;
        const contentH = latSpan * scale;
        const offsetX = (width - contentW) / 2;
        const offsetY = (height - contentH) / 2;

        const project = (lat: number, lon: number) => {
            const x = offsetX + (lon - minLon) * scale;
            const y = offsetY + (maxLat - lat) * scale;
            return { x, y };
        };

        const dotPts = corners.map((p) => project(p.latitude, p.longitude));
        const polyPoints = dotPts.map((p) => `${p.x},${p.y}`).join(' ');

        const labels: { x: number; y: number; text: string }[] = [];
        if (metrics && metrics.xy.length >= 2) {
            const edges = edgeLengthsMeters(metrics.xy);
            for (let i = 0; i < metrics.xy.length; i++) {
                const a = metrics.xy[i], b = metrics.xy[(i + 1) % metrics.xy.length];
                const mid: XY = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const { lat, lon } = metrics.proj.toLatLon(mid.x, mid.y);
                const mpt = project(lat, lon);
                labels.push({ x: mpt.x, y: mpt.y, text: formatMeters(edges[i]) });
            }
        }

        return { polyPoints, dots: dotPts, edgeLabels: labels };
    }, [corners, metrics, width, height]);

    return (
        <View style={{ width, height }}>
            <Svg width={width} height={height}>
                <Rect x={0} y={0} width={width} height={height} fill="transparent" />

                {/* Polygon */}
                {polyPoints && corners.length >= 2 ? (
                    <Polygon points={polyPoints} stroke="#80ff80" strokeWidth={2} fill="rgba(128,255,128,0.15)" />
                ) : null}

                {/* Corner dots */}
                {dots.map((p, i) => (
                    <Circle key={i} cx={p.x} cy={p.y} r={4} fill="#80ff80" />
                ))}

                {/* Edge length labels */}
                {edgeLabels.map((l, i) => (
                    <SvgText key={`lbl${i}`} x={l.x} y={l.y - 6} fontSize={12} fill="#e0ffe0" textAnchor="middle">{l.text}</SvgText>
                ))}

                {/* Small lines to emphasize edges when only 2 pts */}
                {dots.length === 2 && (
                    <Line x1={dots[0].x} y1={dots[0].y} x2={dots[1].x} y2={dots[1].y} stroke="#80ff80" strokeWidth={2} />
                )}
            </Svg>
        </View>
    );
}

/** Styles **/
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#25292e',
        alignItems: 'center',
        paddingTop: 12,
    },
    controls: {
        width: '100%',
        paddingHorizontal: 16,
        paddingTop: 12,
        gap: 10,
    },
    metrics: {
        width: '100%',
        paddingHorizontal: 16,
        marginTop: 8,
    },
    metricText: {
        color: 'white',
        fontSize: 14,
    },
    metricTextDim: {
        color: '#c0c0c0',
        fontSize: 14,
    },
});
