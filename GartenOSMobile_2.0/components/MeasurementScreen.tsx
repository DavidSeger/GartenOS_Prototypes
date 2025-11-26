import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, G, Polygon, Polyline } from 'react-native-svg';
import { styled } from 'nativewind';
import { Screen } from '../types';
import { CornerExportData } from './CornersMap';
import { CornerMetrics } from '../app/utils/geo';
import { GardenAnnotation } from '../services/objectPlannerService.ts';
import { getAnnotationIcon } from './MapIcons';

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);

interface MeasurementScreenProps {
  onNavigate: (screen: Screen) => void;
  layout: CornerExportData | null;
  metrics: CornerMetrics | null;
  annotations: GardenAnnotation[];
}

const KeyValue: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <StyledView className="flex-row items-center justify-between border-b border-dashed border-green-200 py-1.5 last:border-b-0 gap-2 flex-wrap">
    <StyledText
      className="flex-1 text-sm text-gray-800"
      adjustsFontSizeToFit
      minimumFontScale={0.9}
      numberOfLines={2}
    >
      {label}
    </StyledText>
    <StyledText
      className="flex-1 text-right font-semibold text-gray-700"
      adjustsFontSizeToFit
      minimumFontScale={0.9}
      numberOfLines={2}
    >
      {value}
    </StyledText>
  </StyledView>
);

const InfoGroup: React.FC<{ title: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({
  title,
  children,
  style,
}) => (
  <StyledView className="bg-white border border-green-200 rounded-lg p-3 flex-1 min-w-[48%] self-stretch" style={style}>
    <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">{title}</StyledText>
    {children}
  </StyledView>
);

const MeasurementScreen: React.FC<MeasurementScreenProps> = ({ onNavigate, layout, metrics, annotations }) => {
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });
  const treeCount = React.useMemo(
    () =>
      (annotations ?? []).filter((ann) =>
        ann.type?.toLowerCase?.().includes('tree'),
      ).length,
    [annotations],
  );
  const toMark = (value: boolean) => (value ? '✓' : '✗');

  const fitted = React.useMemo(() => {
    if (!layout?.points?.length || !containerSize.width || !containerSize.height) {
      return null;
    }
    return fitPlanToView(layout.points, containerSize.width, containerSize.height, 20);
  }, [layout, containerSize]);

  const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== containerSize.width || height !== containerSize.height) {
      setContainerSize({ width, height });
    }
  }, [containerSize]);

  const formattedPerimeter = metrics?.perim ? `${metrics.perim.toFixed(2)} m` : '-';
  const formattedArea = metrics?.area ? `${metrics.area.toFixed(2)} m^2` : '-';

  return (
    <ScrollView>
      <StyledView className="p-5 items-center">
        <StyledText className="text-xl font-bold text-gray-800 mb-2">Measurements & Map</StyledText>
        <StyledView className="bg-green-50/70 border border-green-200 rounded-xl p-3 w-full mt-2 space-y-3">
          <StyledView>
            <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">
              Garden Dimensions
            </StyledText>
            <KeyValue label="Total Area" value={formattedArea} />
            <KeyValue label="Perimeter" value={formattedPerimeter} />
          </StyledView>
          <StyledView>
            <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">Layout</StyledText>
            <StyledView className="w-full h-[220px] rounded-lg border border-green-200 bg-[#eaf6ea] overflow-hidden mt-1">
              <StyledView style={{ flex: 1 }} onLayout={handleLayout}>
                {fitted ? (
                  <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
                    {layout?.closed ? (
                      <Polygon
                        points={fitted.fittedPts.map((p) => `${p.x},${p.y}`).join(' ')}
                        stroke="#15803d"
                        strokeWidth={2}
                        strokeOpacity={0.95}
                        fill="#bbf7d0"
                        fillOpacity={0.2}
                      />
                    ) : (
                      <Polyline
                        points={fitted.fittedPts.map((p) => `${p.x},${p.y}`).join(' ')}
                        stroke="#15803d"
                        strokeWidth={2}
                        strokeOpacity={0.95}
                        fill="none"
                      />
                    )}
                    {fitted.fittedPts.map((p, idx) => (
                      <G key={`corner-${idx}`}>
                        <Circle cx={p.x} cy={p.y} r={3.2} fill="#14532d" />
                      </G>
                    ))}
                    {(annotations ?? []).map((ann) => {
                      const point = fitted.toFit({ x: ann.x, y: ann.y });
                      return (
                        <G key={ann.id} x={point.x} y={point.y}>
                          {getAnnotationIcon(ann.type, 16)}
                        </G>
                      );
                    })}
                  </Svg>
                ) : (
                  <StyledView className="flex-1 items-center justify-center px-4">
                    <StyledText className="text-sm text-gray-600 text-center">
                      Capture at least two corners to preview the map.
                    </StyledText>
                  </StyledView>
                )}
              </StyledView>
            </StyledView>
            <StyledView className="flex-row gap-2.5 mt-2.5 flex-wrap items-stretch w-full">
              <InfoGroup title="Features">
                <KeyValue label="Trees" value={treeCount ? String(treeCount) : '0'} />
                <KeyValue label="Wildflower bed" value="3 m^2" />
                <KeyValue label="Pond depth" value="~0.5 m" />
                <KeyValue label="Insect hotel" value="1 (shed wall)" />
              </InfoGroup>
              <InfoGroup title="Derived from" style={{ marginLeft: 2 }}>
                <KeyValue label="GPS trace" value={toMark(Boolean(layout?.points?.length))} />
                <KeyValue label="Walkthrough video" value={toMark(true)} />
                <KeyValue label="User transcript" value={toMark(true)} />
              </InfoGroup>
            </StyledView>
          </StyledView>
        </StyledView>
        <StyledView className="flex-row gap-2 justify-center mt-4 px-5">
          <StyledTouchableOpacity
            onPress={() => onNavigate(Screen.Preview)}
            className="bg-green-100 border border-green-200 px-4 py-3 rounded-lg flex-1 items-center justify-center"
            activeOpacity={0.7}
          >
            <StyledText
              className="text-green-800 text-base font-semibold text-center"
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.9}
            >
              Back
            </StyledText>
          </StyledTouchableOpacity>
          <StyledTouchableOpacity
            onPress={() => onNavigate(Screen.Certification)}
            className="bg-green-600 px-4 py-3 rounded-lg flex-1"
            activeOpacity={0.7}
          >
            <StyledText
              className="text-white text-base font-semibold text-center"
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Certifications
            </StyledText>
          </StyledTouchableOpacity>
        </StyledView>
      </StyledView>
    </ScrollView>
  );
};

export default MeasurementScreen;

type XY = { x: number; y: number };

function fitPlanToView(
  pts: XY[],
  width: number,
  height: number,
  padding = 12,
) {
  if (!pts.length) {
    return null;
  }
  let minX = pts[0].x;
  let minY = pts[0].y;
  let maxX = pts[0].x;
  let maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const scaleX = (width - 2 * padding) / w;
  const scaleY = (height - 2 * padding) / h;
  const scale = Math.min(scaleX, scaleY);
  const tx = -minX * scale + padding;
  const ty = -minY * scale + padding;
  const toFit = (p: XY) => ({ x: p.x * scale + tx, y: p.y * scale + ty });
  return { toFit, fittedPts: pts.map(toFit) };
}
