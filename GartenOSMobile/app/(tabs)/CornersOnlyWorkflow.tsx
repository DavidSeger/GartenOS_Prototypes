import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, useWindowDimensions, Text as RNText, ScrollView, Platform } from 'react-native';
import * as Location from 'expo-location';
import Svg, { Polygon, Circle, Rect, Line, Text as SvgText } from 'react-native-svg';
import Button from '@/app/components/Button';
import {Paths, File} from "expo-file-system";
import * as Sharing from 'expo-sharing';

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

async function saveHelloWorldToDownloads() {
    try {
        console.log(Paths.document)
        const file = new File(Paths.document, 'example5.txt');
        file.create();
        file.write('Hello, world!');
        await Sharing.shareAsync(Paths.document.uri + "example4.txt", { mimeType: 'text/plain', dialogTitle: 'Save hello-world.txt' });
        console.log("here")
        Alert.alert('Saved', 'Saved as hello-world.txt in the folder you chose.');
    } catch (e: any) {
        Alert.alert('Save failed', String(e?.message ?? e));
    }
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

async function ensureLocationReady(): Promise<void> {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
        throw new Error('Location permission denied. Enable it in Settings.');
    }
    if (Platform.OS === 'android') {
        const on = await Location.hasServicesEnabledAsync();
        if (!on) throw new Error('Location services are off. Turn on GPS.');
    }
}

async function averageCorner(seconds = 10): Promise<Corner | null> {
    try { await ensureLocationReady(); } catch (e: any) {
        Alert.alert('Location needed', e?.message ?? String(e)); return null;
    }

    const samples: { lat: number; lon: number; acc: number }[] = [];
    const t0 = Date.now();
    let sub: Location.LocationSubscription | null = null;

    try {
        sub = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.BestForNavigation,
                timeInterval: 500,
                distanceInterval: 0,
                mayShowUserSettingsDialog: true,
            },
            (pos) => {
                const acc = pos.coords.accuracy ?? 9999;
                const { latitude: lat, longitude: lon } = pos.coords;
                // Accept up to ~20 m; tighten later if you like
                if (Number.isFinite(lat) && Number.isFinite(lon) && acc <= 20) {
                    samples.push({ lat, lon, acc });
                }
                if (Date.now() - t0 >= seconds * 1000) { sub?.remove(); sub = null; }
            }
        );

        while (Date.now() - t0 < seconds * 1000) {
            await new Promise(r => setTimeout(r, 200));
        }
    } finally { sub?.remove(); }

    if (!samples.length) {
        Alert.alert('No good GPS', 'Enable Precise Location and try outdoors with a clear sky.');
        return null;
    }

    // Weighted average by 1/σ²
    let wSum = 0, latSum = 0, lonSum = 0;
    for (const s of samples) {
        const sigma = Math.max(1, s.acc);
        const w = 1 / (sigma * sigma);
        wSum += w; latSum += w * s.lat; lonSum += w * s.lon;
    }
    const lat = latSum / wSum;
    const lon = lonSum / wSum;
    return { latitude: lat, longitude: lon, timestamp: Date.now() };
}

// Helper to wrap the memoized metrics calculation
function useMetrics(corners: Corner[]) {
    return useMemo(() => {
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
        return { proj, xy: simp, perim, area, closed };
    }, [corners]);
}

// Custom hook to calculate map-specific values for JSON export
function useExportData(corners: Corner[], metrics: ReturnType<typeof useMetrics>) {
    const { width } = useWindowDimensions();
    const height = Math.min(340, Math.max(220, Math.round(width * 0.6)));
    const padding = 16;

    const exportData = useMemo(() => {
        if (corners.length < 2 || !metrics) return null;

        // Compute bounds on raw lat/lon (same logic as in CornersMap)
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

        const allXY = metrics.xy;
        let minX = allXY[0].x, maxX = allXY[0].x;
        let minY = allXY[0].y, maxY = allXY[0].y;
        for (const p of allXY) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

        const meterSpanX = Math.max(1e-6, maxX - minX);
        const meterSpanY = Math.max(1e-6, maxY - minY);

        // The desktop app's scale is **meters per pixel (m/px)**
        const mapPixelWidth = innerW;
        const mapPixelHeight = innerH;

        // Calculate the scale based on the visible bounds on the screen
        // Scale is the larger ratio of (meters_span / pixel_span) to fit on screen
        const scaleMetersPerPixel = Math.max(meterSpanX / mapPixelWidth, meterSpanY / mapPixelHeight);

        // Transform the meter coordinates to pixel coordinates for the desktop app
        // The desktop app expects normalized coordinates (like 0,0 to maxW,maxH)
        const transformedPoints = allXY.map((p: XY) => ({
            // Normalize the x and y coordinates relative to the bounding box in meters
            // Then scale that normalized value by the map's pixel width/height (innerW/innerH)
            // Adding 'padding' here acts as the offset
            x: Math.round((p.x - minX) / scaleMetersPerPixel + padding),
            y: Math.round((p.y - minY) / scaleMetersPerPixel + padding),
        }));

        const isClosed = metrics.closed;

        return {
            points: transformedPoints,
            closed: isClosed,
            scale: scaleMetersPerPixel,
        };
    }, [corners, metrics, width, height, padding]);

    return exportData;
}


export default function GardenCornersOnly() {
    const [corners, setCorners] = useState<Corner[]>([]);
    const [isAveraging, setIsAveraging] = useState(false);

    const metrics = useMetrics(corners);
    const exportData = useExportData(corners, metrics);

    const addCorner = useCallback(async () => {
        if (isAveraging) return;
        setIsAveraging(true);
        const c = await averageCorner(20);
        setIsAveraging(false);
        if (!c) {
            Alert.alert('No good GPS', 'Move to a clearer sky view and try again.');
            return;
        }
        setCorners((prev) => [...prev, c]);
    }, [isAveraging]);

    return (
        <View style={styles.container}>
            <CornersMap corners={corners} metrics={metrics} />

            <View style={styles.controls}>
                <Button theme="primary" label={isAveraging ? 'Averaging (10s)…' : 'Mark Corner (10s)'} onPress={addCorner} />
                <Button label="Download hello-world.txt" onPress={saveHelloWorldToDownloads} />
            </View>

            <ScrollView style={styles.metrics} contentContainerStyle={{ paddingVertical: 8 }}>
                {metrics ? (
                    <View>
                        <RNText style={styles.metricText}>Perimeter: {metrics.perim.toFixed(2)} m</RNText>
                        <RNText style={styles.metricText}>Area: {metrics.area.toFixed(2)} m²</RNText>
                        {exportData && <RNText style={styles.metricTextDim}>Export Scale (m/px): {exportData.scale.toFixed(6)}</RNText>}
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
function CornersMap({ corners, metrics }: { corners: Corner[]; metrics: null | ReturnType<typeof useMetrics> }) {
    const { width } = useWindowDimensions();
    const height = Math.min(340, Math.max(220, Math.round(width * 0.6)));
    const padding = 16;

    const { polyPoints, dots, edgeLabels } = useMemo(() => {
        if (corners.length === 0 || !metrics) return { polyPoints: '', dots: [] as XY[], edgeLabels: [] as { x: number; y: number; text: string }[] };

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
            // Need a version of metrics.xy that includes the closing point for edge lengths
            const xyWithClosing = metrics.closed ? [...metrics.xy, metrics.xy[0]] : metrics.xy;
            const edges = edgeLengthsMeters(metrics.xy);

            for (let i = 0; i < xyWithClosing.length - 1; i++) {
                const a = metrics.xy[i], b = metrics.xy[(i + 1) % metrics.xy.length]; // use metrics.xy for real projection
                const mid: XY = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const { lat, lon } = metrics.proj.toLatLon(mid.x, mid.y);
                const mpt = project(lat, lon); // Project back to screen space
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