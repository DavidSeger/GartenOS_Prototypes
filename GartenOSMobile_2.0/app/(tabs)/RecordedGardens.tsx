import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import Svg, { Polygon, Polyline, Circle, Text as SvgText, G } from 'react-native-svg';

type XY = { x: number; y: number };
type GardenJson = {
    points: XY[];
    closed?: boolean;
    surface?: string;
    scale?: number;   // meters per screen unit
    unit?: string;    // usually "m"
    calibratedEdgeIndex?: number;
    annotations?: any[];
    zones?: any[];
    _meta?: { ts?: number; app?: string };
    _metrics?: { perimeter_m?: number; area_m2?: number };
};

const VIEW_W = 360;
const VIEW_H = 360;

export default function Index() {
    const [data, setData] = useState<GardenJson | null>(null);
    const [error, setError] = useState<string | null>(null);

    const pickFile = useCallback(async () => {
        try {
            setError(null);
            const res = await DocumentPicker.getDocumentAsync({
                type: 'application/json',
                multiple: false,
                copyToCacheDirectory: true,
            });
            const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
            // @ts-ignore
            const file = new File(result.assets[0]);

            const json = JSON.parse(file.textSync()) as GardenJson;
            if (!json || !Array.isArray(json.points) || json.points.length < 2) {
                throw new Error('Invalid file: expected { points: [{x,y}, ...] }.');
            }
            setData(json);
        } catch (e: any) {
            console.error(e);
            setData(null);
            const msg = e?.message ?? 'Failed to open file.';
            setError(msg);
            Alert.alert('Could not open garden JSON', msg);
        }
    }, []);

    // Fit points (screen space) into an SVG square viewbox
    const fitted = useMemo(() => {
        if (!data?.points?.length) return null;
        const padding = 16;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of data.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        const w = Math.max(1, maxX - minX);
        const h = Math.max(1, maxY - minY);

        const sx = (VIEW_W - 2 * padding) / w;
        const sy = (VIEW_H - 2 * padding) / h;
        const scale = Math.min(sx, sy);

        const tx = -minX * scale + padding;
        const ty = -minY * scale + padding;

        // flip Y for SVG (optional): here we keep the original orientation,
        // assuming your points are already in screen coords (y down).
        const fittedPts = data.points.map(p => ({
            x: p.x * scale + tx,
            y: p.y * scale + ty,
        }));

        return { fittedPts, scale, tx, ty };
    }, [data]);

    // Metrics: use _metrics if available; otherwise compute from points & scale
    const derivedMetrics = useMemo(() => {
        if (!data?.points?.length) return null;

        const closed = !!data.closed;
        const perim_screen = polyPerimeter(data.points, closed);
        const area_screen = shoelaceArea(data.points); // in screen^2 units

        const s = data.scale ?? 1; // meters per screen unit
        const perimeter_m = perim_screen * s;
        const area_m2 = area_screen * s * s;

        return { perimeter_m, area_m2, closed };
    }, [data]);

    const metrics = useMemo(() => {
        const m = data?._metrics;
        if (m && typeof m.perimeter_m === 'number' && typeof m.area_m2 === 'number') {
            return { perimeter_m: m.perimeter_m, area_m2: m.area_m2, closed: !!data?.closed };
        }
        return derivedMetrics;
    }, [data, derivedMetrics]);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Previously Recorded Gardens</Text>
            </View>

            <View style={styles.actions}>
                <Pressable onPress={pickFile} style={styles.btn}>
                    <Text style={styles.btnText}>{data ? 'Open another JSON' : 'Open garden JSON'}</Text>
                </Pressable>
            </View>

            {!data && (
                <View style={styles.placeholder}>
                    <Text style={styles.placeholderText}>
                        Pick a garden JSON.
                    </Text>
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                </View>
            )}

            {data && fitted && (
                <ScrollView contentContainerStyle={styles.scroll}>
                    <View style={styles.card}>
                        <Svg width={VIEW_W} height={VIEW_H} style={styles.svg}>
                            <G>
                                {data.closed ? (
                                    <Polygon
                                        points={toSvgPoints(fitted.fittedPts)}
                                        strokeWidth={2}
                                        strokeOpacity={0.9}
                                        fillOpacity={0.15}
                                    />
                                ) : (
                                    <Polyline
                                        points={toSvgPoints(fitted.fittedPts)}
                                        strokeWidth={2}
                                        strokeOpacity={0.9}
                                        fill="none"
                                    />
                                )}

                                {/* corner dots with indices */}
                                {fitted.fittedPts.map((p, i) => (
                                    <React.Fragment key={i}>
                                        <Circle cx={p.x} cy={p.y} r={3} />
                                        <SvgText x={p.x + 6} y={p.y - 6} fontSize={10}>{String(i + 1)}</SvgText>
                                    </React.Fragment>
                                ))}
                            </G>
                        </Svg>

                        <View style={styles.stats}>
                            <Row label="Closed" value={data.closed ? 'Yes' : 'No'} />
                            <Row label="Surface" value={data.surface ?? '—'} />
                            <Row label="Unit" value={data.unit ?? 'm'} />
                            <Row
                                label="Perimeter"
                                value={
                                    metrics?.perimeter_m != null
                                        ? `${metrics.perimeter_m.toFixed(2)} m`
                                        : 'n/a'
                                }
                            />
                            <Row
                                label="Area"
                                value={
                                    metrics?.area_m2 != null
                                        ? `${metrics.area_m2.toFixed(3)} m²`
                                        : 'n/a'
                                }
                            />
                            {data._meta?.ts ? (
                                <Row label="Exported" value={formatWhen(data._meta.ts)} />
                            ) : null}
                            {data._meta?.app ? <Row label="App" value={data._meta.app} /> : null}
                        </View>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

/* ---------- geometry helpers for screen-space points ---------- */
function toSvgPoints(pts: XY[]) {
    return pts.map(p => `${p.x},${p.y}`).join(' ');
}
function polyPerimeter(pts: XY[], closed: boolean) {
    if (pts.length < 2) return 0;
    let p = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        p += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    }
    if (closed && pts.length > 2) {
        p += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
    }
    return p;
}
function shoelaceArea(pts: XY[]) {
    if (pts.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

/* ---------- UI bits ---------- */
function Row({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{value}</Text>
        </View>
    );
}

function formatWhen(epochMs?: number) {
    if (!epochMs) return '—';
    try {
        const d = new Date(epochMs);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
        return '—';
    }
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#25292e' },
    header: { paddingTop: 28, paddingHorizontal: 16, paddingBottom: 12 },
    title: { color: '#fff', fontSize: 18, fontWeight: '600' },

    actions: { paddingHorizontal: 16, paddingBottom: 12 },
    btn: {
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        alignSelf: 'flex-start',
    },
    btnText: { color: '#25292e', fontWeight: '600' },

    placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
    placeholderText: { color: '#cfd2d7', textAlign: 'center' },
    errorText: { marginTop: 8, color: '#ffb4b4' },

    scroll: { padding: 16, paddingBottom: 32 },
    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 12,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 3,
    },
    svg: { alignSelf: 'center', borderRadius: 12, backgroundColor: '#f6faf6' },

    stats: {
        marginTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#e5e8ec',
        paddingTop: 8,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    rowLabel: { color: '#475569' },
    rowValue: { color: '#111827', fontWeight: '600' },
});
