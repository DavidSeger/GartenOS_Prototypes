import React, { useMemo, useState, useCallback } from 'react';
import { View, LayoutChangeEvent } from 'react-native';
import Svg, { Polygon, Circle, Rect, Line, Text as SvgText } from 'react-native-svg';

import {
  Corner,
  CornerMetrics,
  formatMeters,
  XY,
  edgeLengthsMeters,
} from '../app/utils/geo';

export type CornerExportData = {
  points: XY[];
  closed: boolean;
  scale: number;
  extent: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    padding: number;
    width: number;
    height: number;
  };
};

/**
 * If you need the exported points (e.g. for sharing / saving),
 * call this hook and pass in the SAME width your component actually gets.
 *
 * If you don’t have a width, you can still call it with a fallback width.
 */
export function useCornerExportData(
    corners: Corner[],
    metrics: CornerMetrics | null,
    opts?: { width?: number },
): CornerExportData | null {
  const width = opts?.width ?? 360; // fallback so it doesn't crash
  const height = Math.min(340, Math.max(220, Math.round(width * 0.6)));
  const padding = 16;

  return useMemo(() => {
    if (corners.length < 2 || !metrics) return null;

    // geographic extents (might be useful to keep)
    let minLat = corners[0].latitude;
    let maxLat = corners[0].latitude;
    let minLon = corners[0].longitude;
    let maxLon = corners[0].longitude;
    for (const p of corners) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLon) minLon = p.longitude;
      if (p.longitude > maxLon) maxLon = p.longitude;
    }

    // now base on metric XY (meters)
    const allXY = metrics.xy;
    let minX = allXY[0].x;
    let maxX = allXY[0].x;
    let minY = allXY[0].y;
    let maxY = allXY[0].y;
    for (const p of allXY) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    const meterSpanX = Math.max(1e-6, maxX - minX);
    const meterSpanY = Math.max(1e-6, maxY - minY);
    // choose the scale that fits BOTH spans
    const scaleMetersPerPixel = Math.max(
        meterSpanX / innerW,
        meterSpanY / innerH,
    );

    const transformedPoints = allXY.map((p: XY) => ({
      x: Math.round((p.x - minX) / scaleMetersPerPixel + padding),
      y: Math.round((p.y - minY) / scaleMetersPerPixel + padding),
    }));

    return {
      points: transformedPoints,
      closed: metrics.closed,
      scale: scaleMetersPerPixel,
      extent: {
        minLat,
        maxLat,
        minLon,
        maxLon,
        padding,
        width,
        height,
      },
    };
  }, [corners, metrics, width, height]);
}

type CornersMapProps = {
  corners: Corner[];
  metrics: CornerMetrics;
  /**
   * optional: if you already know the width (e.g. you're in a fixed card)
   * you can pass it and we skip onLayout
   */
  width?: number;
  /**
   * optional fixed height
   */
  height?: number;
  /**
   * background fill for the SVG area
   */
  backgroundColor?: string;
};

export function CornersMap({
                             corners,
                             metrics,
                             width: propWidth,
                             height: propHeight,
                             backgroundColor = 'transparent',
                           }: CornersMapProps) {
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);

  const handleLayout = useCallback(
      (e: LayoutChangeEvent) => {
        if (propWidth) return; // user controls width, we don't need layout
        const w = e.nativeEvent.layout.width;
        if (w && w !== layoutWidth) {
          setLayoutWidth(w);
        }
      },
      [layoutWidth, propWidth],
  );

  // decide which width to use
  const width = propWidth ?? layoutWidth ?? 0;
  const height =
      propHeight ??
      (width ? Math.min(340, Math.max(220, Math.round(width * 0.6))) : 0);
  const padding = 16;

  const { polyPoints, dots, edgeLabels } = useMemo(() => {
    if (!width || !height || corners.length === 0 || !metrics) {
      return {
        polyPoints: '',
        dots: [] as XY[],
        edgeLabels: [] as { x: number; y: number; text: string }[],
      };
    }

    // 1) get geographic extents
    let minLat = corners[0].latitude;
    let maxLat = corners[0].latitude;
    let minLon = corners[0].longitude;
    let maxLon = corners[0].longitude;
    for (const p of corners) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLon) minLon = p.longitude;
      if (p.longitude > maxLon) maxLon = p.longitude;
    }
    const latSpan = Math.max(1e-6, maxLat - minLat);
    const lonSpan = Math.max(1e-6, maxLon - minLon);

    // 2) compute inner area
    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    // 3) scale so that lat/lon fit
    const scaleX = innerW / lonSpan;
    const scaleY = innerH / latSpan;
    const scale = Math.min(scaleX, scaleY);

    const contentW = lonSpan * scale;
    const contentH = latSpan * scale;

    // center inside the view
    const offsetX = (width - contentW) / 2;
    const offsetY = (height - contentH) / 2;

    // projection: lon -> x, lat -> y (inverted)
    const project = (lat: number, lon: number) => {
      const x = offsetX + (lon - minLon) * scale;
      const y = offsetY + (maxLat - lat) * scale;
      return { x, y };
    };

    // 4) polygon + dots
    const dotPts = corners.map((p) => project(p.latitude, p.longitude));
    const polyPointsStr = dotPts.map((p) => `${p.x},${p.y}`).join(' ');

    // 5) edge labels using metric XY -> back to lat/lon -> project
    const labels: { x: number; y: number; text: string }[] = [];
    if (metrics && metrics.xy.length >= 2) {
      const xyWithClosing = metrics.closed
          ? [...metrics.xy, metrics.xy[0]]
          : metrics.xy;
      const edges = edgeLengthsMeters(metrics.xy);

      for (let i = 0; i < xyWithClosing.length - 1; i++) {
        const a = metrics.xy[i];
        const b = metrics.xy[(i + 1) % metrics.xy.length];
        const mid: XY = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // back to lat/lon using your projection
        const { lat, lon } = metrics.proj.toLatLon(mid.x, mid.y);
        const mpt = project(lat, lon);
        labels.push({
          x: mpt.x,
          y: mpt.y,
          text: formatMeters(edges[i]),
        });
      }
    }

    return { polyPoints: polyPointsStr, dots: dotPts, edgeLabels: labels };
  }, [width, height, corners, metrics, padding]);

  return (
      <View
          onLayout={handleLayout}
          style={{ width: propWidth ? propWidth : '100%' }}
      >
        {width ? (
            <Svg width={width} height={height}>
              <Rect x={0} y={0} width={width} height={height} fill={backgroundColor} />
              {polyPoints && corners.length >= 2 ? (
                  <Polygon
                      points={polyPoints}
                      stroke="#80ff80"
                      strokeWidth={2}
                      fill="rgba(128,255,128,0.15)"
                  />
              ) : null}
              {dots.map((p, i) => (
                  <Circle key={i} cx={p.x} cy={p.y} r={4} fill="#80ff80" />
              ))}
              {edgeLabels.map((l, i) => (
                  <SvgText
                      key={`lbl${i}`}
                      x={l.x}
                      y={l.y - 6}
                      fontSize={12}
                      fill="#e0ffe0"
                      textAnchor="middle"
                  >
                    {l.text}
                  </SvgText>
              ))}
              {dots.length === 2 ? (
                  <Line
                      x1={dots[0].x}
                      y1={dots[0].y}
                      x2={dots[1].x}
                      y2={dots[1].y}
                      stroke="#80ff80"
                      strokeWidth={2}
                  />
              ) : null}
            </Svg>
        ) : null}
      </View>
  );
}
