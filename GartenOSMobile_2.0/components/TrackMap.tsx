import React, { useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Svg, { Polyline, Circle, Rect } from 'react-native-svg';

export type TrackPoint = { latitude: number; longitude: number; timestamp: number };

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

type Props = {
  track: TrackPoint[];
};

export const TrackMap: React.FC<Props> = ({ track }) => {
  const { width } = useWindowDimensions();
  const height = Math.min(300, Math.max(200, Math.round(width * 0.6)));
  const padding = 16;

  const { pointsStr, head } = useMemo(() => {
    if (track.length === 0) {
      return { pointsStr: '', head: null as null | { x: number; y: number } };
    }

    const smoothed = smoothPoints(track, 3);

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
  }, [track, width, height, padding]);

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill="transparent" />
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
        {head ? <Circle cx={head.x} cy={head.y} r={4} fill="white" /> : null}
      </Svg>
    </View>
  );
};

