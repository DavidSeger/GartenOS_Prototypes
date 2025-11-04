import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
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
const TREE_COLOR = '#0b8043';
const WATER_COLOR = '#1e88e5';
const UNKNOWN_COLOR = '#666666';

type GardenJson = {
    points: XY[];
    closed?: boolean;
    surface?: string;
    scale?: number;
    unit?: string;
    calibratedEdgeIndex?: number;
    annotations?: Annotation[];
    zones?: Zone[];
    _meta?: { ts?: number; app?: string };
    _metrics?: { perimeter_m?: number; area_m2?: number };
    transcript?: string;
    videoUri?: string;
};


const VIEW_W = 360;
const VIEW_H = 360;

function normalizeGardenJson(raw: any): GardenJson {
    // Old shape already matches
    if (raw && Array.isArray(raw.points)) {
        const gj: GardenJson = raw;
        // if someone provided `metrics` on old files, surface them
        if (!gj._metrics && raw.metrics) {
            gj._metrics = {
                perimeter_m: raw.metrics.perimeter_m,
                area_m2: raw.metrics.area_m2,
            };
        }
        if (!gj._meta && (raw._meta || raw.exportedAt || raw.version)) {
            gj._meta = raw._meta ?? {
                ts: typeof raw.exportedAt === 'number' ? raw.exportedAt : undefined,
                app: raw.version != null ? `garden-mapper-v${raw.version}` : undefined,
            };
        }
        return gj;
    }

    // New shape (your example)
    const cd = raw?.cornerDrawing;
    if (cd && Array.isArray(cd.points)) {
        const gj: GardenJson = {
            points: cd.points,                 // <- main change
            closed: !!cd.closed,
            scale: typeof cd.scale === 'number' ? cd.scale : undefined,
            // carry over extras if you want them around
            transcript: typeof raw.transcript === 'string' ? raw.transcript : undefined,
            videoUri: typeof raw.videoUri === 'string' ? raw.videoUri : undefined,
            _metrics: raw?.metrics
                ? {
                    perimeter_m: raw.metrics.perimeter_m,
                    area_m2: raw.metrics.area_m2,
                }
                : undefined,
            _meta: {
                ts: typeof raw.exportedAt === 'number' ? raw.exportedAt : undefined,
                app: raw.version != null ? `garden-mapper-v${raw.version}` : undefined,
            },
        };
        return gj;
    }

    throw new Error('Unrecognized garden JSON format: expected `points` or `cornerDrawing.points`.');
}


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
            const parsed = JSON.parse(file.textSync());
            const normalized = normalizeGardenJson(parsed);

            if (!normalized || !Array.isArray(normalized.points) || normalized.points.length < 2) {
                throw new Error('Invalid file: expected at least two points.');
            }

            setData(normalized);
        } catch (e: any) {
            console.error(e);
            setData(null);
            const msg = e?.message ?? 'Failed to open file.';
            setError(msg);
            Alert.alert('Could not open garden JSON', msg);
        }
    }, []);

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

        const fittedZones = (data.zones ?? [])
            .filter(z => Array.isArray(z.points) && z.points.length >= 2)
            .map(z => ({ ...z, points: z.points.map(applyFit) }));

        const fittedAnnotations = (data.annotations ?? []).map(a => ({
            ...a,
            x: a.x * scale + tx,
            y: a.y * scale + ty,
        }));

        return { fittedPts, fittedZones, fittedAnnotations, scale, tx, ty };
    }, [data]);

    const derivedMetrics = useMemo(() => {
        if (!data?.points?.length) return null;
        const closed = !!data.closed;
        const perim_screen = polyPerimeter(data.points, closed);
        const area_screen = shoelaceArea(data.points);
        const s = data.scale ?? 1;
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
                                {fitted.fittedZones.map(zone => (
                                    <Polygon
                                        key={zone.id}
                                        points={toSvgPoints(zone.points)}
                                        stroke={zoneStrokeColor(zone.type)}
                                        fill={zoneFillColor(zone.type)}
                                        strokeWidth={1}
                                        strokeOpacity={0.85}
                                        fillOpacity={0.28}
                                    />
                                ))}

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

                                {fitted.fittedPts.map((p, i) => (
                                    <G key={`corner-${i}`}>
                                        <Circle cx={p.x} cy={p.y} r={3} />
                                        <SvgText x={p.x + 6} y={p.y - 6} fontSize={10}>
                                            {String(i + 1)}
                                        </SvgText>
                                    </G>
                                ))}

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
                            <LegendItem
                                label="Tree"
                                icon={
                                    <Svg width={18} height={18} viewBox="-18 -18 32 32">
                                        <TreeIcon size={18} />
                                    </Svg>
                                }
                            />
                            <LegendItem
                                label="Water"
                                icon={
                                    <Svg width={18} height={18} viewBox="-18 -18 32 32">
                                        <WaterIcon size={18} />
                                    </Svg>
                                }
                            />
                        </View>

                        <View style={[styles.legend, { marginTop: 8, flexWrap: 'wrap' }]}>
                            <ZoneLegendItem label="Soil" type="soil" />
                            <ZoneLegendItem label="Grass" type="grass" />
                            <ZoneLegendItem label="Concrete" type="concrete" />
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

function TreeIcon({ size = 16, color = TREE_COLOR }: { size?: number; color?: string }) {
    const s = size;
    const trunkW = s * 0.2;
    const trunkH = s * 0.4;
    const canopyR = s * 0.45;
    return (
        <G>
            <Circle cx={0} cy={-trunkH - canopyR * 0.2} r={canopyR} fill={color} />
            <Path d={`M ${-trunkW / 2} ${-trunkH} h ${trunkW} v ${trunkH} h ${-trunkW} Z`} fill={color} />
        </G>
    );
}

function WaterIcon({ size = 16, color = WATER_COLOR }: { size?: number; color?: string }) {
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
            fill={color}
        />
    );
}

function UnknownIcon({ size = 12, color = UNKNOWN_COLOR }: { size?: number; color?: string }) {
    const s = size;
    return <Circle cx={0} cy={0} r={s * 0.4} fill={color} />;
}

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

function zoneFillColor(type?: string) {
    const t = (type || '').toLowerCase();
    if (t === 'soil') return '#8B5A2B';
    if (t === 'grass') return '#2E8B57';
    if (t === 'concrete') return '#9E9E9E';
    return '#888888';
}

function zoneStrokeColor(type?: string) {
    const t = (type || '').toLowerCase();
    if (t === 'soil') return '#5E3B1C';
    if (t === 'grass') return '#1F5E3B';
    if (t === 'concrete') return '#707070';
    return '#666666';
}

function ZoneLegendItem({ label, type }: { label: string; type: string }) {
    const fill = zoneFillColor(type);
    const stroke = zoneStrokeColor(type);
    return (
        <View style={styles.legendItem}>
            <View style={[styles.colorSwatch, { backgroundColor: fill, borderColor: stroke }]} />
            <Text style={styles.legendText}>{label}</Text>
        </View>
    );
}

function LegendItem({ label, icon }: { label: string; icon: React.ReactNode }) {
    return (
        <View style={styles.legendItem}>
            <View style={{ marginRight: 6 }}>{icon}</View>
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
    colorSwatch: {
        width: 16,
        height: 16,
        borderWidth: 1,
        borderRadius: 3,
        marginRight: 6,
    },

});