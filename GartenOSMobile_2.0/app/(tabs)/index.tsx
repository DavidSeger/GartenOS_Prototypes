import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { Camera, CameraView, CameraType } from 'expo-camera';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import { styled } from 'nativewind';

import { Screen } from '../../types.ts';
import {
  prepareMediaForTranscription,
  transcribeMediaViaFileApi,
  TranscriptionStatus,
} from '../../services/geminiService.ts';
import { averageCorner, Corner, toMetersProjector, useMetrics } from '../utils/geo.ts';

import HomeScreen from '../../components/HomeScreen.tsx';
import RecordingScreen from '../../components/RecordingScreen.tsx';
import PreviewScreen from '../../components/PreviewScreen.tsx';
import MeasurementScreen from '../../components/MeasurementScreen.tsx';
import CertScreen from '../../components/CertScreen.tsx';
import SubmittedScreen from '../../components/SubmittedScreen.tsx';
import { CornerExportData } from '../../components/CornersMap.tsx';
import { getAnnotationIcon } from '../../components/MapIcons.tsx';
import Svg, { G, Polygon, Polyline, Circle, Text as SvgText } from 'react-native-svg';

const StyledSafeAreaView = styled(SafeAreaView);
const StyledView = styled(View);
const DEFAULT_TRANSCRIPT_MESSAGE =
    'The auto-generated transcript will appear here after recording.';
type CameraViewInstance = React.ComponentRef<typeof CameraView>;
type TrackPoint = { latitude: number; longitude: number; timestamp: number };

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>(Screen.Home);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>(DEFAULT_TRANSCRIPT_MESSAGE);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isCameraReady, setIsCameraReady] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [shouldAutoRestart, setShouldAutoRestart] = useState<boolean>(false);
  const [isPauseSupported, setIsPauseSupported] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [facing] = useState<CameraType>(Platform.OS === 'web' ? 'front' : 'back');
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [corners, setCorners] = useState<Corner[]>([]);
  const [isAveragingCorner, setIsAveragingCorner] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus | null>(null);

  type XY = { x: number; y: number };
  type Annotation = { id: string; type: 'tree' | 'water' | string; x: number; y: number };
  type Zone = { id: string; type?: string; points: XY[] };

  type CornerDrawing = {
    points: XY[];
    closed?: boolean;
    annotations?: Annotation[];
    zones?: Zone[];
    scale?: number;
    unit?: string;
  };

  const [cornerDrawing, setCornerDrawing] = useState<CornerDrawing | null>(null);

  const cameraRef = useRef<CameraViewInstance | null>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);

  const metrics = useMetrics(corners);
  const canClosePolygon = Boolean(metrics && corners.length >= 3 && !metrics.closed);

  useEffect(() => {
    (async () => {
      const cameraStatus = await Camera.requestCameraPermissionsAsync();
      const microphoneStatus = await Camera.requestMicrophonePermissionsAsync();
      await Location.requestForegroundPermissionsAsync().catch(() => undefined);
      setHasPermission(cameraStatus.status === 'granted' && microphoneStatus.status === 'granted');
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
    };
  }, []);

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

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startLocationTracking = useCallback(async () => {
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!servicesEnabled && Location.enableNetworkProviderAsync) {
        await Location.enableNetworkProviderAsync().catch(() => undefined);
      }

      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location needed', 'Location permission is required to map garden corners.');
        return false;
      }

      locationWatchRef.current?.remove();
      setTrack([]);

      const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            mayShowUserSettingsDialog: true,
          },
          (pos) => {
            const acc = pos.coords.accuracy ?? 99;
            if (acc > 0.5) return;
            const tp: TrackPoint = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              timestamp: pos.timestamp ?? Date.now(),
            };
            setTrack((prev) => [...prev, tp]);
          },
      );
      locationWatchRef.current = sub;
      return true;
    } catch (error) {
      const details =
          error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
      Alert.alert('Location error', details || 'Unable to start GPS tracking.');
      return false;
    }
  }, []);

  const stopLocationTracking = useCallback(() => {
    locationWatchRef.current?.remove();
    locationWatchRef.current = null;
  }, []);

  const markCorner = useCallback(async () => {
    if (isAveragingCorner) return;
    setIsAveragingCorner(true);
    try {
      const corner = await averageCorner(15);
      if (!corner) {
        Alert.alert(
            'No reliable GPS fix',
            'Stand still with a clear sky view and try capturing the corner again.',
        );
        return;
      }
      setCorners((prev) => [...prev, corner]);
    } catch (error) {
      const message =
          error instanceof Error ? error.message : 'Unable to capture a stable corner at this time.';
      Alert.alert('Corner capture failed', message);
    } finally {
      setIsAveragingCorner(false);
    }
  }, [isAveragingCorner]);

  const closePolygon = useCallback(() => {
    if (corners.length < 3) {
      Alert.alert('Need more corners', 'Capture at least three corners before closing the area.');
      return;
    }

    const first = corners[0];
    const last = corners[corners.length - 1];
    const proj = toMetersProjector(first.latitude, first.longitude);
    const delta = proj.toXY(last.latitude, last.longitude);
    const distMeters = Math.hypot(delta.x, delta.y);

    if (distMeters < 0.05) {
      Alert.alert('Already closed', 'The first and last corner are already connected.');
      return;
    }

    setCorners((prev) => [...prev, { ...prev[0], timestamp: Date.now() }]);
  }, [corners]);

  const configureAudioMode = useCallback(async (recording: boolean) => {
    if (Platform.OS === 'web') {
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: recording,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: !recording,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.warn('Unable to configure audio mode for recording:', error);
    }
  }, []);

  const updatePauseSupport = useCallback(() => {
    try {
      const features = cameraRef.current?.getSupportedFeatures?.();
      setIsPauseSupported(!!features?.toggleRecordingAsyncAvailable);
    } catch (error) {
      setIsPauseSupported(false);
    }
  }, []);

  const deleteFileIfExists = useCallback(async (uri: string | null) => {
    if (!uri || Platform.OS === 'web') {
      return;
    }
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (error) {
      console.warn('Unable to delete recording', error);
    }
  }, []);

  const handleRecordingComplete = useCallback(
      async (uri: string | null) => {
        stopTimer();
        recordingPromiseRef.current = null;
        setIsRecording(false);
        setIsPaused(false);
        await configureAudioMode(false);
        stopLocationTracking();

        if (!uri) {
          Alert.alert('Recording unavailable', 'No video was captured. Please try again.');
          setActiveScreen(Screen.Home);
          return;
        }

        setVideoUri(uri);
        setActiveScreen(Screen.Preview);
      },
      [configureAudioMode, stopLocationTracking, stopTimer],
  );

  const startRecording = useCallback(async () => {
    if (!cameraRef.current) {
      Alert.alert('Camera not ready', 'Please allow camera access and try again.');
      return;
    }

    if (!isCameraReady) {
      Alert.alert('Camera is starting', 'Please wait for the camera to initialise, then try again.');
      return;
    }

    if (recordingPromiseRef.current) {
      return;
    }

    updatePauseSupport();
    setIsPaused(false);
    setTranscript(DEFAULT_TRANSCRIPT_MESSAGE);
    setRecordingSeconds(0);
    setCorners([]);

    const locationReady = await startLocationTracking();
    if (!locationReady) {
      return;
    }

    setActiveScreen(Screen.Recording);
    setIsRecording(true);

    await configureAudioMode(true);

    try {
      startTimer();
      const recordingPromise = cameraRef.current.recordAsync();
      if (!recordingPromise) {
        throw new Error('Camera was not ready to start recording.');
      }
      recordingPromiseRef.current = recordingPromise;
      const recording = await recordingPromise;
      await handleRecordingComplete(recording?.uri ?? null);
    } catch (error) {
      const details =
          error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
      console.error('Error during recording:', details);
      stopTimer();
      recordingPromiseRef.current = null;
      setIsRecording(false);
      await configureAudioMode(false);
      stopLocationTracking();
      Alert.alert(
          'Recording error',
          details === 'An error occurred while recording a video'
              ? 'The current device or simulator does not support video capture. Please try on a physical device with camera access.'
              : details || 'Something went wrong while recording. Please try again.',
      );
      setActiveScreen(Screen.Home);
    }
  }, [
    configureAudioMode,
    handleRecordingComplete,
    isCameraReady,
    startLocationTracking,
    startTimer,
    stopLocationTracking,
    stopTimer,
    updatePauseSupport,
  ]);

  useEffect(() => {
    if (shouldAutoRestart) {
      setShouldAutoRestart(false);
      setVideoUri(null);
      setTranscript(DEFAULT_TRANSCRIPT_MESSAGE);
      setIsPaused(false);
      startRecording();
    }
  }, [shouldAutoRestart, startRecording]);

  const stopRecording = useCallback(() => {
    if (cameraRef.current && recordingPromiseRef.current) {
      setIsPaused(false);
      stopTimer();
      cameraRef.current.stopRecording();
      stopLocationTracking();
    }
  }, [stopLocationTracking, stopTimer]);

  const pauseRecording = useCallback(async () => {
    if (!cameraRef.current || !recordingPromiseRef.current || !isPauseSupported) {
      return;
    }
    try {
      await cameraRef.current.toggleRecordingAsync?.();
      setIsPaused((prev) => {
        const next = !prev;
        if (next) {
          stopTimer();
        } else {
          startTimer();
        }
        return next;
      });
    } catch (error) {
      console.warn('Unable to pause or resume recording:', error);
    }
  }, [isPauseSupported, startTimer, stopTimer]);

  const resetApp = useCallback(async () => {
    setIsPaused(false);
    await configureAudioMode(false);
    await deleteFileIfExists(videoUri);
    setVideoUri(null);
    setTranscript(DEFAULT_TRANSCRIPT_MESSAGE);
    setIsProcessing(false);
    setRecordingSeconds(0);
    stopTimer();
    stopLocationTracking();
    setTrack([]);
    setCorners([]);
    setIsAveragingCorner(false);
    setActiveScreen(Screen.Home);
  }, [configureAudioMode, deleteFileIfExists, stopLocationTracking, stopTimer, videoUri]);

  const handleExportGarden = useCallback(
      async (exportData: CornerExportData | null) => {
        if (!exportData || !metrics) {
          Alert.alert('Export unavailable', 'Add at least two corners before exporting.');
          return;
        }

        try {
          setIsExporting(true);
          setCornerDrawing(exportData as unknown as CornerDrawing);
          const payload = {
            version: 1,
            exportedAt: Date.now(),
            transcript,
            videoUri,
            gpsTrack: track,
            corners,
            cornerDrawing: {
              ...exportData,
            },
            metrics: {
              perimeter_m: Number(metrics.perim.toFixed(3)),
              area_m2: Number(metrics.area.toFixed(3)),
              closed: metrics.closed,
            },
          };

          const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
          if (!dir) {
            throw new Error('No writable directory available on this device.');
          }
          const fname = `garden-session-${Date.now()}.json`;
          const uri = `${dir}${fname}`;
          await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2));

          const canShare = Sharing.isAvailableAsync ? await Sharing.isAvailableAsync() : false;
          if (canShare) {
            await Sharing.shareAsync(uri, {
              mimeType: 'application/json',
              dialogTitle: 'Export garden JSON',
            });
          } else {
            Alert.alert('Export saved', `Garden export saved to ${uri}`);
          }
        } catch (error) {
          const message =
              error instanceof Error ? error.message : 'An unknown error occurred during export.';
          Alert.alert('Export failed', message);
        } finally {
          setIsExporting(false);
        }
      },
      [corners, metrics, transcript, track, videoUri],
  );

  const processTranscription = useCallback(
      async (uri: string) => {
        setIsProcessing(true);
        setTranscriptionStatus({
          stage: 'preparing',
          progress: 0,
          message: 'Preparing media for transcription...',
        });
        setTranscript('Preparing media for transcription...');

        let cleanupTask: (() => Promise<void>) | undefined;

        try {
          const prepared = await prepareMediaForTranscription(uri);
          cleanupTask = prepared.cleanup;

          const result = await transcribeMediaViaFileApi({
            fileUri: prepared.uri,
            mimeType: prepared.mimeType,
            onStatus: (status) => {
              setTranscriptionStatus(status);
              if (status.stage === 'uploading') {
                setTranscript('Uploading walkthrough for transcription...');
              } else if (status.stage === 'transcribing') {
                setTranscript('Transcribing audio with Gemini... Please wait.');
              }
            },
          });

          setTranscript(result);
        } catch (error) {
          console.error('Error during transcription process:', error);
          const message =
              error instanceof Error
                  ? error.message
                  : 'An unknown error occurred during transcription.';
          setTranscriptionStatus(null);
          setTranscript(message);
        } finally {
          setIsProcessing(false);
          setTranscriptionStatus(null);
          if (cleanupTask) {
            try {
              await cleanupTask();
            } catch (cleanupError) {
              console.warn('Failed to clean up temporary transcription media', cleanupError);
            }
          }
        }
      },
      [prepareMediaForTranscription, transcribeMediaViaFileApi],
  );

  useEffect(() => {
    if (
        activeScreen === Screen.Preview &&
        videoUri &&
        !isProcessing &&
        transcript.startsWith('The auto-generated')
    ) {
      processTranscription(videoUri);
    }
  }, [activeScreen, videoUri, isProcessing, transcript, processTranscription]);

  const retakeRecording = useCallback(async () => {
    await deleteFileIfExists(videoUri);
    setIsPaused(false);
    setVideoUri(null);
    setTranscript(DEFAULT_TRANSCRIPT_MESSAGE);
    setActiveScreen(Screen.Recording);
    setShouldAutoRestart(true);
  }, [deleteFileIfExists, videoUri]);

  const downloadRecording = useCallback(async () => {
    if (!videoUri || Platform.OS !== 'web') {
      return;
    }
    const response = await fetch(videoUri);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'garden-walkthrough.mp4';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
  }, [videoUri]);

  if (hasPermission === null) {
    return <View />;
  }
  if (hasPermission === false) {
    return <Text>No access to camera</Text>;
  }

  function fitToView(
      pts: XY[],
      width: number,
      height: number,
      padding = 12
  ) {
    if (!pts.length) return { toFit: (p: XY) => p, fittedPts: pts };
    let minX = pts[0].x, minY = pts[0].y, maxX = pts[0].x, maxY = pts[0].y;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const sx = (width - 2 * padding) / w;
    const sy = (height - 2 * padding) / h;
    const s = Math.min(sx, sy);
    const tx = -minX * s + padding;
    const ty = -minY * s + padding;
    const toFit = (p: XY) => ({ x: p.x * s + tx, y: p.y * s + ty });
    return { toFit, fittedPts: pts.map(toFit) };
  }

  const renderScreen = () => {
    switch (activeScreen) {
      case Screen.Recording:
        return (
            <RecordingScreen
                elapsedSeconds={recordingSeconds}
                isPauseSupported={isPauseSupported}
                isPaused={isPaused}
                onPause={pauseRecording}
                onStop={stopRecording}
                isStoppingDisabled={!isRecording}
                onMarkCorner={markCorner}
                isMarkingCorner={isAveragingCorner}
                cornerCount={corners.length}
                onClosePolygon={closePolygon}
                canClosePolygon={canClosePolygon}
            />
        );
      case Screen.Preview:
        return (
            <PreviewScreen
                videoUri={videoUri}
                transcript={transcript}
                isProcessing={isProcessing}
                transcriptionStatus={transcriptionStatus}
                onNavigate={setActiveScreen}
                onRetake={retakeRecording}
                onDownload={Platform.OS === 'web' ? downloadRecording : undefined}
                track={track}
                corners={corners}
                metrics={metrics}
                canClosePolygon={canClosePolygon}
                onClosePolygon={closePolygon}
                isExporting={isExporting}
                onExport={handleExportGarden}
                durationSeconds={recordingSeconds}
            />
        );
      case Screen.Measurement:
        return <MeasurementScreen onNavigate={setActiveScreen} />;
      case Screen.Certification:
        return (
            <CertScreen
                transcript={transcript}
                onNavigate={setActiveScreen}
                onSubmit={() => setActiveScreen(Screen.Submitted)}
            />
        );
      case Screen.Submitted:
        return <SubmittedScreen onStartOver={resetApp} />;
      case Screen.Home:
      default:
        return <HomeScreen onStartRecording={startRecording} isCameraReady={isCameraReady} />;
    }
  };

  return (
      <StyledSafeAreaView className="flex-1 bg-green-50">
        <StyledView className="flex-1 justify-center items-center">
          <StyledView
              className="w-[390px] max-w-[96%] rounded-2xl shadow-lg overflow-hidden border border-green-200"
              style={{
                backgroundColor: activeScreen === Screen.Recording ? 'transparent' : '#ffffff',
                minHeight: 640,
              }}
          >
            <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                active={activeScreen === Screen.Home || activeScreen === Screen.Recording}
                mode="video"
                facing={facing}
                videoQuality="1080p"
                mute={false}
                onCameraReady={() => {
                  setIsCameraReady(true);
                  updatePauseSupport();
                }}
                onMountError={({ message }) => {
                  const details = message ?? 'Unable to access the camera.';
                  console.error('Camera mount error:', details);
                  Alert.alert('Camera error', details);
                }}
            />
            <StyledView
                className="relative"
                style={[
                  {
                    zIndex: 10,
                    backgroundColor: activeScreen === Screen.Recording ? 'transparent' : 'white',
                  },
                  activeScreen === Screen.Recording && { flex: 1 },
                ]}
            >
              {activeScreen === Screen.Preview && cornerDrawing?.points?.length ? (
                  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
                      {(() => {

                        const W = 390;
                        const H = 640;
                        const { toFit, fittedPts } = fitToView(cornerDrawing.points, W, H, 24);

                        {(cornerDrawing.zones ?? []).map(z => {
                          if (!z.points?.length) return null;
                          const zPts = z.points.map(toFit);
                          return (
                              <Polygon
                                  key={`zone-${z.id}`}
                                  points={zPts.map(p => `${p.x},${p.y}`).join(' ')}
                                  stroke={zoneStrokeColor(z.type)}
                                  fill={zoneFillColor(z.type)}
                                  strokeWidth={1}
                                  strokeOpacity={0.85}
                                  fillOpacity={0.28}
                              />
                          );
                        })}

                        if (cornerDrawing.closed) {

                          return (
                              <>
                                <Polygon
                                    points={fittedPts.map(p => `${p.x},${p.y}`).join(' ')}
                                    strokeWidth={2}
                                    strokeOpacity={0.9}
                                    fillOpacity={0.12}
                                />
                                {fittedPts.map((p, i) => (
                                    <G key={`corner-${i}`}>
                                      <Circle cx={p.x} cy={p.y} r={3} />
                                    </G>
                                ))}
                                {}
                                {(cornerDrawing.annotations ?? []).map(a => {
                                  const p = toFit({ x: a.x, y: a.y });
                                  return (
                                      <G key={a.id} x={p.x} y={p.y}>
                                        {getAnnotationIcon(a.type, 16)}
                                      </G>
                                  );
                                })}
                              </>
                          );
                        } else {

                          return (
                              <>
                                <Polyline
                                    points={fittedPts.map(p => `${p.x},${p.y}`).join(' ')}
                                    strokeWidth={2}
                                    strokeOpacity={0.9}
                                    fill="none"
                                />
                                {fittedPts.map((p, i) => (
                                    <G key={`corner-${i}`}>
                                      <Circle cx={p.x} cy={p.y} r={3} />
                                    </G>
                                ))}
                                {(cornerDrawing.annotations ?? []).map(a => {
                                  const p = toFit({ x: a.x, y: a.y });
                                  return (
                                      <G key={a.id} x={p.x} y={p.y}>
                                        {getAnnotationIcon(a.type, 16)}
                                      </G>
                                  );
                                })}
                              </>
                          );
                        }
                      })()}
                    </Svg>
                  </View>
              ) : null}
              {renderScreen()}
            </StyledView>
          </StyledView>
        </StyledView>
      </StyledSafeAreaView>
  );
}
