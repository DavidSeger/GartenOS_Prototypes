import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, LayoutChangeEvent } from 'react-native';
import Svg, { G, Polygon, Polyline, Circle } from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import { styled } from 'nativewind';
import InfoButton from './InfoButton';

import { Screen } from '../types';
import { CornerExportData } from './CornersMap';
import { Corner, CornerMetrics } from '../app/utils/geo';
import { TranscriptionStatus, TranscriptSegment } from '../services/geminiService.ts';
import { GardenAnnotation, GardenZone } from '../services/objectPlannerService.ts';
import { getAnnotationIcon } from './MapIcons';

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);

type AiPlanStatus = 'idle' | 'planning' | 'ready' | 'error';

interface PreviewScreenProps {
  videoUri: string | null;
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  isProcessing: boolean;
  transcriptionStatus: TranscriptionStatus | null;
  onNavigate: (screen: Screen) => void;
  onRetake: () => void;
  onDownload?: () => void;
  corners: Corner[];
  metrics: CornerMetrics | null;
  canClosePolygon: boolean;
  onClosePolygon: () => void;
  isExporting: boolean;
  onExport: (data: CornerExportData | null) => void;
  exportData: CornerExportData | null;
  durationSeconds: number;
  onRetranscribe: () => void;
  walkDistanceMeters: number;
  aiPlanStatus: AiPlanStatus;
  aiPlanError: string | null;
  annotations: GardenAnnotation[];
  zones: GardenZone[];
  onAnnotationEdit: () => void;
  isAnnotationEditRecording: boolean;
  annotationEditStatus: string | null;
}

const PreviewScreen: React.FC<PreviewScreenProps> = ({
                                                       videoUri,
                                                       transcript,
                                                       transcriptSegments,
                                                       isProcessing,
                                                       transcriptionStatus,
                                                       onNavigate,
                                                       onRetake,
                                                       onDownload,
                                                       corners,
                                                       metrics,
                                                       canClosePolygon,
  onClosePolygon,
  isExporting,
  onExport,
  exportData,
  durationSeconds,
  onRetranscribe,
  walkDistanceMeters,
  aiPlanStatus,
  aiPlanError,
  annotations,
  zones,
  onAnnotationEdit,
                                                       isAnnotationEditRecording,
                                                       annotationEditStatus,
                                                     }) => {
  const video = React.useRef<Video | null>(null);
  const exportReady = Boolean(exportData && metrics);
  const formatTimecode = React.useCallback((totalSeconds: number) => {
    if (!Number.isFinite(totalSeconds)) return '0:00';
    const clamped = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(clamped / 60);
    const seconds = String(clamped % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }, []);
  const formattedDuration = React.useMemo(() => {
    if (!durationSeconds || durationSeconds < 1) return '0:00';
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.floor(durationSeconds % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }, [durationSeconds]);
  const formattedWalkDistance = React.useMemo(() => {
    if (!Number.isFinite(walkDistanceMeters) || walkDistanceMeters <= 0) return '0 m';
    if (walkDistanceMeters >= 1000) return `${(walkDistanceMeters / 1000).toFixed(2)} km`;
    if (walkDistanceMeters >= 10) return `${walkDistanceMeters.toFixed(1)} m`;
    return `${walkDistanceMeters.toFixed(2)} m`;
  }, [walkDistanceMeters]);
  const hasSegments = transcriptSegments.length > 0;
  const statusMessage = React.useMemo(() => {
    if (!isProcessing || !transcriptionStatus) {
      return 'Preparing transcript...';
    }
    if (transcriptionStatus.message) {
      return transcriptionStatus.message;
    }
    switch (transcriptionStatus.stage) {
      case 'preparing':
        return 'Preparing media for transcription...';
      case 'uploading':
        return transcriptionStatus.progress && transcriptionStatus.progress > 0
            ? `Uploading media (${Math.round(transcriptionStatus.progress * 100)}%)...`
            : 'Uploading media...';
      case 'transcribing':
        return transcriptionStatus.progress && transcriptionStatus.progress > 0
            ? `Transcribing audio (${Math.round(transcriptionStatus.progress * 100)}%)...`
            : 'Transcribing audio with Gemini...';
      default:
        return 'Processing transcription...';
    }
  }, [isProcessing, transcriptionStatus]);
  const aiStatus = React.useMemo(() => {
    switch (aiPlanStatus) {
      case 'planning':
        return { text: 'Interpreting walkthrough with ChatGPT...', className: 'text-green-800' };
      case 'ready':
        return { text: 'AI annotations ready. Map updated automatically.', className: 'text-green-700' };
      case 'error':
        return {
          text: aiPlanError ?? 'Unable to interpret walkthrough. Try retranscribing.',
          className: 'text-red-500',
        };
      default:
        return null;
    }
  }, [aiPlanStatus, aiPlanError]);

  const editButtonDisabled = !isAnnotationEditRecording && (!exportReady || isExporting || isProcessing);

  return (
      <ScrollView>
        <StyledView className="p-5 items-center">
          <StyledText className="text-xl font-bold text-gray-800 mb-2">Preview Submission</StyledText>
          {videoUri && (
              <Video
                  ref={video}
                  style={{ width: '100%', aspectRatio: 9 / 16, borderRadius: 8, backgroundColor: 'black' }}
                  source={{ uri: videoUri }}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  isLooping
              />
          )}
          <StyledView className="bg-green-50/70 border border-green-200 rounded-xl p-3 w-full mt-3">
            <StyledView className="flex-row justify-between items-center mb-2">
              <StyledText className="text-xs text-indigo-900 opacity-80 font-semibold">Corner mapper</StyledText>
              {canClosePolygon && (
                  <StyledTouchableOpacity
                      onPress={onClosePolygon}
                      className="bg-blue-100 border border-blue-200 px-3 py-1 rounded-lg"
                      activeOpacity={0.7}
                  >
                    <StyledText className="text-blue-700 text-xs font-semibold">Close polygon</StyledText>
                  </StyledTouchableOpacity>
              )}
            </StyledView>
            {exportData && metrics && corners.length >= 2 ? (
                <>
                  <PlanPreview layout={exportData} annotations={annotations} zones={zones} />
                  <StyledView className="mt-3 space-y-1">
                    <StyledText className="text-sm text-gray-700">
                      Perimeter: {metrics.perim.toFixed(2)} m
                    </StyledText>
                    <StyledText className="text-sm text-gray-700">
                      Area: {metrics.area.toFixed(2)} m²
                    </StyledText>
                    <StyledText className="text-xs text-gray-500">
                      Corners captured: {corners.length} {metrics.closed ? '(closed)' : '(open)'}
                    </StyledText>
                  </StyledView>
                </>
            ) : (
                <StyledText className="text-sm text-gray-600">
                  Capture at least two corners to generate perimeter and area.
                </StyledText>
            )}
          </StyledView>
          <StyledTouchableOpacity
              onPress={onAnnotationEdit}
              className={`px-4 py-3 rounded-lg w-full mt-2 border ${
                isAnnotationEditRecording ? 'bg-amber-50 border-amber-400' : 'bg-white border-green-200'
              }`}
              activeOpacity={0.7}
              disabled={editButtonDisabled}
              style={{ opacity: editButtonDisabled ? 0.6 : 1 }}
          >
            <StyledText className="text-green-800 text-base font-semibold text-center">
              {isAnnotationEditRecording ? 'Finish edit recording' : 'Edit object placements'}
            </StyledText>
          </StyledTouchableOpacity>
          {annotationEditStatus ? (
              <StyledText className="text-xs text-gray-600 mt-1 text-center">{annotationEditStatus}</StyledText>
          ) : null}

          <StyledView className="flex-row gap-2 justify-center mt-3 w-full">
            <StyledTouchableOpacity
                onPress={onRetake}
                className="bg-white border border-green-200 px-4 py-3 rounded-lg flex-1"
                activeOpacity={0.7}
            >
              <StyledText className="text-green-800 text-base font-semibold text-center">
                Re-record
              </StyledText>
            </StyledTouchableOpacity>
            {onDownload && (
                <StyledTouchableOpacity
                    onPress={onDownload}
                    className="bg-green-100 border border-green-200 px-4 py-3 rounded-lg flex-1"
                    activeOpacity={0.7}
                >
                  <StyledText className="text-green-800 text-base font-semibold text-center">
                    Download
                  </StyledText>
                </StyledTouchableOpacity>
            )}
          </StyledView>
          <StyledTouchableOpacity
              onPress={() => onExport(exportData ?? null)}
              className="bg-green-600 px-4 py-3 rounded-lg w-full mt-3"
              activeOpacity={0.7}
              disabled={!exportReady || isExporting || isProcessing}
              style={{ opacity: !exportReady || isExporting || isProcessing ? 0.6 : 1 }}
          >
            <StyledView className="flex-row items-center justify-center">
              <StyledText className="text-white text-base font-semibold text-center">
                {isExporting ? 'Exporting...' : 'Export garden JSON'}
              </StyledText>
              <InfoButton
                label="Export garden JSON"
                message="Downloads a shareable JSON map with your corners, transcript, and AI-placed objects."
                color="#ecfdf3"
                style={{ marginLeft: 8 }}
              />
            </StyledView>
          </StyledTouchableOpacity>
          {aiStatus ? (
              <StyledText className={`text-xs mt-2 text-center ${aiStatus.className}`}>
                {aiStatus.text}
              </StyledText>
          ) : null}
          {!exportReady && (
              <StyledText className="text-xs text-gray-500 mt-2 text-center">
                Add at least two corners to enable export.
              </StyledText>
          )}

          {/* Transcript header + re-transcribe button */}
          <StyledView className="flex-row items-center justify-between w-full mt-4 mb-1">
            <StyledText className="font-bold text-left">Transcript (auto-generated):</StyledText>
            <StyledTouchableOpacity
                onPress={onRetranscribe}
                className="bg-green-100 border border-green-200 px-3 py-1 rounded-lg"
                activeOpacity={0.7}
                disabled={isProcessing || !videoUri}
                style={{ opacity: isProcessing || !videoUri ? 0.6 : 1 }}
            >
              <StyledText className="text-green-800 text-xs font-semibold">
                {isProcessing ? 'Transcribing...' : 'Re-transcribe'}
              </StyledText>
            </StyledTouchableOpacity>
          </StyledView>

          <StyledView className="bg-gray-100 p-3 rounded-lg my-2 min-h-[6rem] w-full">
            {isProcessing ? (
                <StyledView className="flex-row items-center">
                  <ActivityIndicator color="#166534" />
                  <StyledText className="text-gray-500 ml-2">{statusMessage}</StyledText>
                </StyledView>
            ) : (
                <>
                  {hasSegments ? (
                      transcriptSegments.map((segment, idx) => (
                          <StyledView key={`${segment.start_s}-${idx}`} className="flex-row items-start mb-1">
                            <StyledText className="text-[11px] text-gray-600 w-14">
                              [{formatTimecode(segment.start_s)}]
                            </StyledText>
                            <StyledText className="text-sm text-gray-800 flex-1">{segment.text}</StyledText>
                          </StyledView>
                      ))
                  ) : (
                      <StyledText>{transcript}</StyledText>
                  )}
                </>
            )}
          </StyledView>

          <StyledView className="flex-row gap-2 justify-center flex-wrap my-2">
            <StyledText className="bg-green-100 border border-green-200 text-green-800 rounded-full px-3 py-1 text-sm">
              {formattedDuration} min
            </StyledText>
            <StyledText className="bg-green-100 border border-green-200 text-green-800 rounded-full px-3 py-1 text-sm">
              {formattedWalkDistance} walk
            </StyledText>
          </StyledView>
          <StyledView className="flex-row gap-2 justify-center mt-2 w-full">
            <StyledTouchableOpacity
                onPress={() => onNavigate(Screen.Measurement)}
                className="bg-green-100 border border-green-200 px-4 py-3 rounded-lg flex-1"
                activeOpacity={0.7}
            >
              <StyledText className="text-green-800 text-base font-semibold text-center">Measurements</StyledText>
            </StyledTouchableOpacity>
            <StyledTouchableOpacity
                onPress={() => onNavigate(Screen.Certification)}
                className="bg-green-600 px-4 py-3 rounded-lg flex-1"
                activeOpacity={0.7}
            >
              <StyledText className="text-white text-base font-semibold text-center">
                Continue to Certifications
              </StyledText>
            </StyledTouchableOpacity>
          </StyledView>
        </StyledView>
      </ScrollView>
  );
};

type PlanPreviewProps = {
  layout: CornerExportData;
  annotations: GardenAnnotation[];
  zones: GardenZone[];
};

type XY = { x: number; y: number };

const PlanPreview: React.FC<PlanPreviewProps> = ({ layout, annotations, zones }) => {
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });

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

  return (
      <StyledView
          className="w-full h-[240px] rounded-lg border border-green-200 bg-[#eaf6ea] overflow-hidden mt-1"
          onLayout={handleLayout}
      >
        {fitted ? (
            <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
              {(zones ?? [])
                  .filter((zone) => Array.isArray(zone.points) && zone.points.length >= 3)
                  .map((zone) => {
                    const fittedPoints = zone.points.map((p) => fitted.toFit(p));
                    const pointsAttr = fittedPoints.map((p) => `${p.x},${p.y}`).join(' ');
                    const fill = zoneFillColor(zone.type);
                    const stroke = zoneStrokeColor(zone.type);
                    return (
                        <Polygon
                            key={zone.id ?? pointsAttr}
                            points={pointsAttr}
                            stroke={stroke}
                            strokeWidth={1.5}
                            strokeOpacity={0.85}
                            fill={fill}
                            fillOpacity={0.22}
                        />
                    );
                  })}
              {layout.closed ? (
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
              {(annotations ?? []).map((ann, index) => {
                const point = fitted.toFit({ x: ann.x, y: ann.y });
                const key = `${ann.id ?? 'ann'}-${index}`;
                return (
                    <G key={key} x={point.x} y={point.y}>
                      {getAnnotationIcon(ann.type, 16)}
                    </G>
                );
              })}
            </Svg>
        ) : (
            <StyledView className="flex-1 items-center justify-center">
              <StyledText className="text-sm text-gray-600">Collect more corners to preview the map.</StyledText>
            </StyledView>
        )}
      </StyledView>
  );
};

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

function zoneFillColor(type?: string) {
  const t = (type || '').toLowerCase();
  if (t === 'soil') return '#8B5A2B';
  if (t === 'grass') return '#2E8B57';
  if (t === 'concrete') return '#9E9E9E';
  return '#4b5563';
}

function zoneStrokeColor(type?: string) {
  const t = (type || '').toLowerCase();
  if (t === 'soil') return '#5E3B1C';
  if (t === 'grass') return '#1F5E3B';
  if (t === 'concrete') return '#707070';
  return '#374151';
}

export default PreviewScreen;
