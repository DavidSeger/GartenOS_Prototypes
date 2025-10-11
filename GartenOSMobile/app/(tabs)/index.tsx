import React, { useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Alert, useWindowDimensions } from 'react-native';
import Button from '@/app/components/Button';
import * as Location from 'expo-location';
import Svg, { Polyline, Circle, Rect } from 'react-native-svg';

type TrackPoint = { latitude: number; longitude: number; timestamp: number };

export default function Index() {
    const [isRecording, setIsRecording] = useState(false);
    const [track, setTrack] = useState<TrackPoint[]>([]);
    const watchSubRef = useRef<Location.LocationSubscription | null>(null);

    const startRecording = async () => {
        if (isRecording) return;

        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
            // On Android this may open settings for network provider; safe to ignore if it fails
            await Location.enableNetworkProviderAsync().catch(() => {});
        }

        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
            Alert.alert('Permission needed', 'Location permission is required to record a garden.');
            return;
        }

        setTrack([]);
        setIsRecording(true);

        watchSubRef.current = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.BestForNavigation,
                timeInterval: 1000,     // ~1 Hz
                distanceInterval: 0.5,    // or ~1 meter move
            },
            (pos) => {
                const tp = {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    timestamp: pos.timestamp ?? Date.now(),
                };
                setTrack((prev) => [...prev, tp]);
                // console.log(`position: ${tp.latitude}, ${tp.longitude}`);
            }
        );
    };

    const stopRecording = async () => {
        if (watchSubRef.current) {
            watchSubRef.current.remove();
            watchSubRef.current = null;
        }
        setIsRecording(false);
        // TODO: persist `track`
        // console.log('Recorded points:', track.length);
    };


    return (
        <View style={styles.container}>
            <MapPreview track={track} />
            <View style={styles.footerContainer}>
                <Button
                    theme="primary"
                    label={isRecording ? 'Recording…' : 'Record a Garden'}
                    onPress={startRecording}
                />
                {isRecording && (
                    <Button label="Stop" onPress={stopRecording} />
                )}
            </View>
        </View>
    );
}

function smoothPoints(points: TrackPoint[], window = 3) {
    if (points.length < window) return points;
    const smoothed: TrackPoint[] = [];
    for (let i = 0; i < points.length; i++) {
        const start = Math.max(0, i - window + 1);
        const slice = points.slice(start, i + 1);
        const lat = slice.reduce((a, p) => a + p.latitude, 0) / slice.length;
        const lon = slice.reduce((a, p) => a + p.longitude, 0) / slice.length;
        smoothed.push({ ...points[i], latitude: lat, longitude: lon });
    }
    return smoothed;
}

function MapPreview({ track }: { track: TrackPoint[] }) {
    const { width } = useWindowDimensions();
    const height = Math.min(300, Math.max(200, Math.round(width * 0.6))); // responsive, ~landscape strip
    const padding = 16;

    // Compute bounds (min/max lat/lon) and a projector to screen coords
    const { pointsStr, head } = useMemo(() => {
        if (track.length === 0)
            return { pointsStr: '', head: null as null | { x: number; y: number } };

        // 🟢 Smooth the track before processing
        const smoothed = smoothPoints(track, 3); // 3-point moving average

        let minLat = smoothed[0].latitude;
        let maxLat = smoothed[0].latitude;
        let minLon = smoothed[0].longitude;
        let maxLon = smoothed[0].longitude;

        for (const p of smoothed) {
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

        const pts = smoothed.map((p) => project(p.latitude, p.longitude));
        const str = pts.map((p) => `${p.x},${p.y}`).join(' ');
        const headPt = pts[pts.length - 1];

        return { pointsStr: str, head: headPt };
    }, [track, width, height]);

    return (
        <View style={{ width, height }}>
            <Svg width={width} height={height}>
                {/* background */}
                <Rect x={0} y={0} width={width} height={height} fill="transparent" />
                {/* path */}
                {pointsStr ? (
                    <Polyline
                        points={pointsStr}
                        stroke="white"
                        strokeWidth={3}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        fill="none"
                    />
                ) : null}
                {/* current point */}
                {head ? <Circle cx={head.x} cy={head.y} r={4} fill="white" /> : null}
            </Svg>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#25292e',
        alignItems: 'center',
    },
    footerContainer: {
        flex: 1 / 3,
        alignItems: 'center',
        gap: 12,
    },
});
