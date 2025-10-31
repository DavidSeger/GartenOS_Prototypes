import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { styled } from 'nativewind';

import { Screen } from '../types';
import { TrackMap, TrackPoint } from './TrackMap';
import { CornersMap, useCornerExportData, CornerExportData } from './CornersMap';
import { Corner, CornerMetrics } from '../app/utils/geo';
import { TranscriptionStatus } from '../services/geminiService.ts';

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);

interface PreviewScreenProps {
  videoUri: string | null;
  transcript: string;
  isProcessing: boolean;
  transcriptionStatus: TranscriptionStatus | null;
  onNavigate: (screen: Screen) => void;
  onRetake: () => void;
  onDownload?: () => void;
  track: TrackPoint[];
  corners: Corner[];
  metrics: CornerMetrics | null;
  canClosePolygon: boolean;
  onClosePolygon: () => void;
  isExporting: boolean;
  onExport: (data: CornerExportData | null) => void;
  durationSeconds: number;
}

const PreviewScreen: React.FC<PreviewScreenProps> = ({
  videoUri,
  transcript,
  isProcessing,
  transcriptionStatus,
  onNavigate,
  onRetake,
  onDownload,
  track,
  corners,
  metrics,
  canClosePolygon,
  onClosePolygon,
  isExporting,
  onExport,
  durationSeconds,
}) => {
  const video = React.useRef<Video | null>(null);
  const exportData = useCornerExportData(corners, metrics);
  const exportReady = Boolean(exportData && metrics);
  const formattedDuration = React.useMemo(() => {
    if (!durationSeconds || durationSeconds < 1) return '0:00';
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.floor(durationSeconds % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }, [durationSeconds]);
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
        {track.length > 1 && (
          <StyledView className="bg-green-50/70 border border-green-200 rounded-xl p-3 w-full mt-3">
            <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">
              Walkthrough path
            </StyledText>
            <TrackMap track={track} />
          </StyledView>
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
          {corners.length >= 2 && metrics ? (
            <>
              <CornersMap corners={corners} metrics={metrics} />
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
          <StyledText className="text-white text-base font-semibold text-center">
            {isExporting ? 'Exporting…' : 'Export garden JSON'}
          </StyledText>
        </StyledTouchableOpacity>
        {!exportReady && (
          <StyledText className="text-xs text-gray-500 mt-2 text-center">
            Add at least two corners to enable export.
          </StyledText>
        )}
        <StyledText className="font-bold mt-4 text-left w-full">Transcript (auto-generated):</StyledText>
        <StyledView className="bg-gray-100 p-3 rounded-lg my-2 min-h-[6rem] w-full">
          {isProcessing ? (
            <StyledView className="flex-row items-center">
              <ActivityIndicator color="#166534" />
              <StyledText className="text-gray-500 ml-2">{statusMessage}</StyledText>
            </StyledView>
          ) : (
            <StyledText>{transcript}</StyledText>
          )}
        </StyledView>
        <StyledView className="flex-row gap-2 justify-center flex-wrap my-2">
          <StyledText className="bg-green-100 border border-green-200 text-green-800 rounded-full px-3 py-1 text-sm">
            {formattedDuration} min
          </StyledText>
          <StyledText className="bg-green-100 border border-green-200 text-green-800 rounded-full px-3 py-1 text-sm">
            120 m walk
          </StyledText>
          <StyledText className="bg-green-100 border border-green-200 text-green-800 rounded-full px-3 py-1 text-sm">
            GPS synced
          </StyledText>
        </StyledView>
        <StyledView className="flex-row gap-2 justify-center mt-2">
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

export default PreviewScreen;
