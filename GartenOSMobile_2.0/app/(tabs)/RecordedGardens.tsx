import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {File} from 'expo-file-system';
import Svg, {
    Polygon,
    Polyline,
    Circle,
    Text as SvgText,
    G,
    Path,
} from 'react-native-svg';

type XY = { x: number; y: number };
type Annotation = { id: string; type: 'tree' | 'water' | string; x: number; y: number };
type Zone = { id: string; type?: string; points: XY[] };

type GardenJson = {
    points: XY[];
    closed?: boolean;
    surface?: string;
    scale?: number;   // meters per screen unit
    unit?: string;    // usually "m"
    calibratedEdgeIndex?: number;
    annotations?: Annotation[];
    zones?: Zone[];
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

        const applyFit = (p: XY) => ({ x: p.x * scale + tx, y: p.y * scale + ty });

        const fittedPts = data.points.map(applyFit);

        // Zones (if any)
        const fittedZones = (data.zones ?? [])
            .filter(z => Array.isArray(z.points) && z.points.length >= 2)
            .map(z => ({ ...z, points: z.points.map(applyFit) }));

        // Annotations (icons)
        const fittedAnnotations = (data.annotations ?? []).map(a => ({
            ...a,
            x: a.x * scale + tx,
            y: a.y * scale + ty,
        }));

        return { fittedPts, fittedZones, fittedAnnotations, scale, tx, ty };
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
                    <Text style={styles.placeholderText}>Pick a garden JSON.</Text>
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                </View>
            )}

            {data && fitted && (
                <ScrollView contentContainerStyle={styles.scroll}>
                    <View style={styles.card}>
                        <Svg width={VIEW_W} height={VIEW_H} style={styles.svg}>
                            <G>
                                {/* Zones (semi-transparent fills; different alpha by type) */}
                                {fitted.fittedZones.map(zone => (
                                    <Polygon
                                        key={zone.id}
                                        points={toSvgPoints(zone.points)}
                                        strokeWidth={1}
                                        strokeOpacity={0.5}
                                        fillOpacity={zoneFillOpacity(zone.type)}
                                    />
                                ))}

                                {/* Garden outline */}
                                {data.closed ? (
                                    <Polygon
                                        points={toSvgPoints(fitted.fittedPts)}
                                        strokeWidth={2}
                                        strokeOpacity={0.9}
                                        fillOpacity={0.12}
                                    />
                                ) : (
                                    <Polyline
                                        points={toSvgPoints(fitted.fittedPts)}
                                        strokeWidth={2}
                                        strokeOpacity={0.9}
                                        fill="none"
                                    />
                                )}

                                {/* Corner dots with indices */}
                                {fitted.fittedPts.map((p, i) => (
                                    <G key={`corner-${i}`}>
                                        <Circle cx={p.x} cy={p.y} r={3} />
                                        <SvgText x={p.x + 6} y={p.y - 6} fontSize={10}>
                                            {String(i + 1)}
                                        </SvgText>
                                    </G>
                                ))}

                                {/* Annotations: trees & water */}
                                {fitted.fittedAnnotations.map(a => (
                                    <G key={a.id} x={a.x} y={a.y}>
                                        {a.type === 'tree' ? (
                                            <TreeIcon size={16} />
                                        ) : a.type === 'water' ? (
                                            <WaterIcon size={16} />
                                        ) : (
                                            <UnknownIcon size={12} />
                                        )}
                                    </G>
                                ))}
                            </G>
                        </Svg>

                        <View style={styles.legend}>
                            <LegendItem label="Tree" icon={<TreeIcon size={12} />} />
                            <LegendItem label="Water" icon={<WaterIcon size={12} />} />
                        </View>

                        <View style={styles.stats}>
                            <Row label="Closed" value={data.closed ? 'Yes' : 'No'} />
                            <Row label="Surface" value={data.surface ?? '—'} />
                            <Row label="Unit" value={data.unit ?? 'm'} />
                            <Row
                                label="Perimeter"
                                value={metrics?.perimeter_m != null ? `${metrics.perimeter_m.toFixed(2)} m` : 'n/a'}
                            />
                            <Row
                                label="Area"
                                value={metrics?.area_m2 != null ? `${metrics.area_m2.toFixed(3)} m²` : 'n/a'}
                            />
                            {data._meta?.ts ? <Row label="Exported" value={formatWhen(data._meta.ts)} /> : null}
                            {data._meta?.app ? <Row label="App" value={data._meta.app} /> : null}
                        </View>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

/* ---------- icons (inline SVG) ---------- */
function TreeIcon({ size = 16 }: { size?: number }) {
    // Simple trunk + canopy
    const s = size;
    const trunkW = s * 0.2;
    const trunkH = s * 0.4;
    const canopyR = s * 0.45;
    return (
        <G>
            {/* canopy */}
            <Circle cx={0} cy={-trunkH - canopyR * 0.2} r={canopyR} />
            {/* trunk */}
            <RectLike x={-trunkW / 2} y={-trunkH} width={trunkW} height={trunkH} />
        </G>
    );
}

function WaterIcon({ size = 16 }: { size?: number }) {
    // Droplet path centered at (0,0), pointing up
    const s = size;
    const r = s * 0.45;
    return (
        <Path
            d={`
        M 0 ${-r}
        C ${r * 0.55} ${-r * 0.3}, ${r} ${-r * 0.05}, ${r} ${r * 0.35}
        C ${r} ${r * 0.7}, ${r * 0.55} ${r}, 0 ${r}
        C ${-r * 0.55} ${r}, ${-r} ${r * 0.7}, ${-r} ${r * 0.35}
        C ${-r} ${-r * 0.05}, ${-r * 0.55} ${-r * 0.3}, 0 ${-r}
        Z
      `}
        />
    );
}

function UnknownIcon({ size = 12 }: { size?: number }) {
    const s = size;
    return <Circle cx={0} cy={0} r={s * 0.4} />;
}

// tiny rect helper using Path so we don't import Rect separately
function RectLike({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
    return <Path d={`M ${x} ${y} h ${width} v ${height} h ${-width} Z`} />;
}

/* ---------- geometry helpers ---------- */
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

/* ---------- legend & rows ---------- */
function LegendItem({ label, icon }: { label: string; icon: React.ReactNode }) {
    return (
        <View style={styles.legendItem}>
            <Svg width={16} height={16} style={{ marginRight: 6 }}>
                <G x={8} y={8}>{icon}</G>
            </Svg>
            <Text style={styles.legendText}>{label}</Text>
        </View>
    );
}

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

function zoneFillOpacity(type?: string) {
    // Slightly different opacities by zone type; adjust as you like
    switch (type) {
        case 'grass':
            return 0.18;
        case 'flowerbed':
            return 0.12;
        case 'paved':
            return 0.1;
        default:
            return 0.14;
    }
}

/* ---------- styles ---------- */
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

    legend: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center' },
    legendText: { color: '#111827' },

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