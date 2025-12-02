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
  transcribeMediaViaFileApiTimestamped,
  TranscriptionStatus,
  TranscriptSegment,
} from '../../services/geminiService.ts';
import {
  suggestGardenPlanWithChatGPT,
  editGardenPlanWithChatGPT,
  HeadingSample,
  GardenAnnotation,
  GardenZone,
  PlannerSuggestion,
} from '../../services/objectPlannerService.ts';
import { averageCorner, Corner, toMetersProjector, useMetrics } from '../utils/geo.ts';

import HomeScreen from '../../components/HomeScreen.tsx';
import RecordingScreen from '../../components/RecordingScreen.tsx';
import PreviewScreen from '../../components/PreviewScreen.tsx';
import MeasurementScreen from '../../components/MeasurementScreen.tsx';
import CertScreen from '../../components/CertScreen.tsx';
import SubmittedScreen from '../../components/SubmittedScreen.tsx';
import { CornerExportData, useCornerExportData } from '../../components/CornersMap.tsx';

const StyledSafeAreaView = styled(SafeAreaView);
const StyledView = styled(View);
const DEFAULT_TRANSCRIPT_MESSAGE =
    'The auto-generated transcript will appear here after recording.';
const EDIT_AUDIO_MIME_TYPE = 'audio/m4a';
type CameraViewInstance = React.ComponentRef<typeof CameraView>;
type TrackPoint = { latitude: number; longitude: number; timestamp: number };

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>(Screen.Home);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [walkthroughAudioUri, setWalkthroughAudioUri] = useState<string | null>(null);
  const [transcriptionMediaUri, setTranscriptionMediaUri] = useState<string | null>(null);
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
  const [rawTranscriptSegments, setRawTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [headings, setHeadings] = useState<HeadingSample[]>([]);
  const [isRecordingAnnotationEdit, setIsRecordingAnnotationEdit] = useState(false);
  const [annotationEditStatus, setAnnotationEditStatus] = useState<string | null>(null);

  const cameraRef = useRef<CameraViewInstance | null>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const layoutSignatureRef = useRef<string | null>(null);
  const aiPlanSignatureRef = useRef<string | null>(null);
  const editRecordingRef = useRef<Audio.Recording | null>(null);
  const walkthroughAudioRecordingRef = useRef<Audio.Recording | null>(null);

  const metrics = useMetrics(corners);
  const exportData = useCornerExportData(corners, metrics);
  const walkDistanceMeters = React.useMemo(() => computeTrackDistance(track), [track]);
  const [aiAnnotations, setAiAnnotations] = useState<GardenAnnotation[]>([]);
  const [aiZones, setAiZones] = useState<GardenZone[]>([]);
  const [aiSurface, setAiSurface] = useState<string | null>(null);
  const [aiPlanStatus, setAiPlanStatus] = useState<'idle' | 'planning' | 'ready' | 'error'>('idle');
  const [aiPlanError, setAiPlanError] = useState<string | null>(null);
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

  useEffect(() => {
    return () => {
      if (editRecordingRef.current) {
        editRecordingRef.current.stopAndUnloadAsync().catch(() => undefined);
        editRecordingRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!transcript || transcript === DEFAULT_TRANSCRIPT_MESSAGE) {
      setTranscriptSegments([]);
      return;
    }
    const normalized = normalizeTranscriptSegments(rawTranscriptSegments, transcript, recordingSeconds);
    setTranscriptSegments(normalized);
  }, [rawTranscriptSegments, transcript, recordingSeconds]);

  useEffect(() => {
    if (!exportData) {
      layoutSignatureRef.current = null;
      aiPlanSignatureRef.current = null;
      setAiAnnotations([]);
      setAiZones([]);
      setAiSurface(null);
      setAiPlanStatus('idle');
      setAiPlanError(null);
      if (editRecordingRef.current) {
        editRecordingRef.current.stopAndUnloadAsync().catch(() => undefined);
        editRecordingRef.current = null;
      }
      setIsRecordingAnnotationEdit(false);
      setAnnotationEditStatus(null);
      return;
    }
    const layoutSig = buildLayoutSignature(exportData);
      if (layoutSignatureRef.current !== layoutSig) {
        layoutSignatureRef.current = layoutSig;
        aiPlanSignatureRef.current = null;
        setAiAnnotations([]);
        setAiZones([]);
        setAiSurface(null);
        setAiPlanStatus('idle');
        setAiPlanError(null);
      if (editRecordingRef.current) {
        editRecordingRef.current.stopAndUnloadAsync().catch(() => undefined);
        editRecordingRef.current = null;
      }
      setIsRecordingAnnotationEdit(false);
      setAnnotationEditStatus(null);
    }
  }, [exportData]);

  useEffect(() => {
    if (!transcriptSegments.length) {
      aiPlanSignatureRef.current = null;
      setAiAnnotations([]);
      setAiZones([]);
      setAiSurface(null);
      if (!isProcessing) {
        setAiPlanStatus('idle');
        setAiPlanError(null);
      }
    }
  }, [transcriptSegments.length, isProcessing]);

  useEffect(() => {
    const startTs = recordingStartRef.current;
    if (isRecording || !startTs || track.length < 2) {
      if (!startTs || track.length === 0) {
        setHeadings([]);
      }
      return;
    }
    const computed = buildHeadingSeries(track, startTs, recordingSeconds);
    setHeadings(computed);
  }, [track, isRecording, recordingSeconds]);

  useEffect(() => {
    if (
        activeScreen !== Screen.Preview ||
        !exportData ||
        !transcriptSegments.length ||
        isProcessing
    ) {
      return;
    }
    const signature = buildAiPlanSignature(exportData, transcriptSegments, headings);
    if (aiPlanSignatureRef.current === signature) {
      return;
    }
    let isCancelled = false;
    setAiPlanStatus('planning');
    setAiPlanError(null);
    planAiAnnotations({
      layout: exportData,
      transcriptSegments,
      headings,
      corners,
      surface: aiSurface,
    })
        .then((planResult) => {
          if (isCancelled) {
            return;
          }
          setAiAnnotations(planResult.annotations);
          setAiZones(planResult.zones);
          setAiSurface(planResult.surface ?? null);
          aiPlanSignatureRef.current = signature;
          setAiPlanStatus('ready');
        })
        .catch((error) => {
          if (isCancelled) {
            return;
          }
          const message =
              error instanceof Error ? error.message : 'Unable to interpret the walkthrough.';
          setAiPlanError(message);
          setAiPlanStatus('error');
        });

    return () => {
      isCancelled = true;
    };
  }, [activeScreen, aiSurface, corners, exportData, headings, isProcessing, transcriptSegments]);

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
            if (acc > 10) return;
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

  const stopWalkthroughAudioRecording = useCallback(async (): Promise<string | null> => {
    const recording = walkthroughAudioRecordingRef.current;
    if (!recording) {
      return null;
    }
    walkthroughAudioRecordingRef.current = null;
    try {
      await recording.stopAndUnloadAsync();
      return recording.getURI() ?? null;
    } catch (error) {
      console.warn('Unable to finalize walkthrough audio recording', error);
      return null;
    }
  }, []);

  const clearWalkthroughAudio = useCallback(async () => {
    const pending = await stopWalkthroughAudioRecording();
    const uriToDelete = pending ?? walkthroughAudioUri;
    if (uriToDelete) {
      await deleteFileIfExists(uriToDelete);
    }
    setWalkthroughAudioUri(null);
    setTranscriptionMediaUri(null);
  }, [deleteFileIfExists, stopWalkthroughAudioRecording, walkthroughAudioUri]);

  const startWalkthroughAudioRecording = useCallback(async () => {
    if (Platform.OS === 'web') {
      walkthroughAudioRecordingRef.current = null;
      return;
    }
    try {
      const permission = await Audio.requestPermissionsAsync?.();
      if (permission && !permission.granted) {
        console.warn('Microphone permission denied for standalone audio capture.');
        return;
      }
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      walkthroughAudioRecordingRef.current = recording;
    } catch (error) {
      console.warn('Unable to start walkthrough audio capture', error);
      walkthroughAudioRecordingRef.current = null;
    }
  }, []);

  const toggleWalkthroughAudioPause = useCallback(
      async (pause: boolean) => {
        const recording = walkthroughAudioRecordingRef.current;
        if (!recording) {
          return;
        }
        try {
          if (pause) {
            await recording.pauseAsync();
          } else {
            await recording.startAsync();
          }
        } catch (error) {
          console.warn('Unable to toggle walkthrough audio recording state', error);
        }
      },
      [],
  );

  const handleRecordingComplete = useCallback(
      async (uri: string | null) => {
        stopTimer();
        recordingPromiseRef.current = null;
        setIsRecording(false);
        setIsPaused(false);
        stopLocationTracking();

        let audioUri: string | null = null;
        try {
          audioUri = await stopWalkthroughAudioRecording();
        } finally {
          await configureAudioMode(false);
        }

        const transcriptionUri = audioUri ?? uri ?? null;
        setWalkthroughAudioUri(audioUri ?? null);
        setTranscriptionMediaUri(transcriptionUri);

        if (!uri) {
          Alert.alert('Recording unavailable', 'No video was captured. Please try again.');
          setActiveScreen(Screen.Home);
          return;
        }

        setVideoUri(uri);
        setActiveScreen(Screen.Preview);
      },
      [configureAudioMode, stopLocationTracking, stopTimer, stopWalkthroughAudioRecording],
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

    await clearWalkthroughAudio();
    updatePauseSupport();
    setIsPaused(false);
    setTranscript(DEFAULT_TRANSCRIPT_MESSAGE);
    setRawTranscriptSegments([]);
    setTranscriptSegments([]);
    setHeadings([]);
    setRecordingSeconds(0);
    setCorners([]);

    const locationReady = await startLocationTracking();
    if (!locationReady) {
      return;
    }

    setActiveScreen(Screen.Recording);
    setIsRecording(true);

    await configureAudioMode(true);
    await startWalkthroughAudioRecording();
    recordingStartRef.current = Date.now();

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
      const orphanAudio = await stopWalkthroughAudioRecording();
      if (orphanAudio) {
        await deleteFileIfExists(orphanAudio);
      }
      setWalkthroughAudioUri(null);
      setTranscriptionMediaUri(null);
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
    clearWalkthroughAudio,
    configureAudioMode,
    deleteFileIfExists,
    handleRecordingComplete,
    isCameraReady,
    startLocationTracking,
    startTimer,
    startWalkthroughAudioRecording,
    stopLocationTracking,
    stopTimer,
    stopWalkthroughAudioRecording,
    updatePauseSupport,
  ]);

  useEffect(() => {
    if (!shouldAutoRestart) {
      return;
    }
    (async () => {
      setShouldAutoRestart(false);
      await deleteFileIfExists(videoUri);
      await clearWalkthroughAudio();
      setVideoUri(null);
      setTranscript(DEFAULT_TRANSCRIPT_MESSAGE);
      setRawTranscriptSegments([]);
      setTranscriptSegments([]);
      setHeadings([]);
      setIsPaused(false);
      setAiAnnotations([]);
      setAiZones([]);
      setAiSurface(null);
      recordingStartRef.current = null;
      await startRecording();
    })();
  }, [shouldAutoRestart, startRecording, deleteFileIfExists, videoUri, clearWalkthroughAudio]);

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
      const nextPaused = !isPaused;
      setIsPaused(nextPaused);
      if (nextPaused) {
        stopTimer();
      } else {
        startTimer();
      }
      await toggleWalkthroughAudioPause(nextPaused);
    } catch (error) {
      console.warn('Unable to pause or resume recording:', error);
    }
  }, [isPauseSupported, isPaused, startTimer, stopTimer, toggleWalkthroughAudioPause]);

  const resetApp = useCallback(async () => {
    setIsPaused(false);
    await configureAudioMode(false);
    await deleteFileIfExists(videoUri);
    await clearWalkthroughAudio();
    setVideoUri(null);
    setTranscript(DEFAULT_TRANSCRIPT_MESSAGE);
    setRawTranscriptSegments([]);
    setTranscriptSegments([]);
    setHeadings([]);
    setIsProcessing(false);
    setRecordingSeconds(0);
    stopTimer();
    stopLocationTracking();
    setTrack([]);
    setCorners([]);
    setIsAveragingCorner(false);
    if (editRecordingRef.current) {
      editRecordingRef.current.stopAndUnloadAsync().catch(() => undefined);
      editRecordingRef.current = null;
    }
    setIsRecordingAnnotationEdit(false);
    setAnnotationEditStatus(null);
    setAiAnnotations([]);
    setAiZones([]);
    setAiSurface(null);
    setAiPlanStatus('idle');
    setAiPlanError(null);
    layoutSignatureRef.current = null;
    aiPlanSignatureRef.current = null;
    setActiveScreen(Screen.Home);
    recordingStartRef.current = null;
  }, [clearWalkthroughAudio, configureAudioMode, deleteFileIfExists, stopLocationTracking, stopTimer, videoUri]);

  const handleExportGarden = useCallback(
      async (exportData: CornerExportData | null) => {
        if (!exportData || !metrics) {
          Alert.alert('Export unavailable', 'Add at least two corners before exporting.');
          return;
        }

        try {
          setIsExporting(true);
          const transcriptForExport = buildTimestampedTranscript(transcriptSegments, transcript);
          let annotationsForExport = aiAnnotations;
          let zonesForExport = aiZones;
          let surfaceForExport = aiSurface;
          if (!annotationsForExport?.length && !zonesForExport?.length) {
            const planResult = await planAiAnnotations({
              layout: exportData,
              corners,
              transcriptSegments,
              headings,
              surface: surfaceForExport,
            });
            annotationsForExport = planResult.annotations;
            zonesForExport = planResult.zones;
            surfaceForExport = planResult.surface ?? null;
            setAiAnnotations(annotationsForExport);
            setAiZones(zonesForExport);
            setAiSurface(surfaceForExport);
            const signature = buildAiPlanSignature(exportData, transcriptSegments, headings);
            aiPlanSignatureRef.current = signature;
            setAiPlanStatus('ready');
            setAiPlanError(null);
          }
          const exportTimestamp = Date.now();
          const surfaceValue = surfaceForExport ?? 'grass';
          const paddingPx = exportData.extent?.padding ?? 16;
          const xyPoints = metrics.xy ?? [];
          let minX = xyPoints[0]?.x ?? 0;
          let minY = xyPoints[0]?.y ?? 0;
          for (const pt of xyPoints) {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
          }
          const toLatLngFromLayout = (pt: { x: number; y: number } | null | undefined) => {
            if (
                !pt ||
                !Number.isFinite(pt.x) ||
                !Number.isFinite(pt.y) ||
                !Number.isFinite(exportData.scale)
            ) {
              return null;
            }
            const { lat, lon } = metrics.proj.toLatLon(
                (pt.x - paddingPx) * exportData.scale + minX,
                (pt.y - paddingPx) * exportData.scale + minY,
            );
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
              return null;
            }
            return { lat: Number(lat.toFixed(8)), lng: Number(lon.toFixed(8)) };
          };
          const annotationsGeo =
              (annotationsForExport ?? [])
                  .map((ann) => {
                    const latlng = toLatLngFromLayout(ann);
                    if (!latlng) {
                      return null;
                    }
                    return {
                      id: ann.id ?? createAnnotationId(),
                      type: ann.type?.trim() || 'unknown',
                      size: normalizeTreeSize(ann.size),
                      latlng,
                    };
                  })
                  .filter((ann): ann is NonNullable<typeof ann> => Boolean(ann));
          const zonesGeo =
              (zonesForExport ?? [])
                  .map((zone, idx) => {
                    const pts =
                        (zone.points ?? [])
                            .map((pt) => toLatLngFromLayout(pt))
                            .filter((pt): pt is { lat: number; lng: number } => Boolean(pt));
                    if (pts.length < 3) {
                      return null;
                    }
                    return {
                      id: zone.id ?? `zone_${idx}_${createAnnotationId()}`,
                      type: zone.type ?? 'grass',
                      points: pts,
                    };
                  })
                  .filter((zone): zone is NonNullable<typeof zone> => Boolean(zone));

          const boundaryPoints =
              (metrics.closed && corners.length > 1 ? corners.slice(0, -1) : corners).map((corner) => ({
                lat: Number(corner.latitude.toFixed(8)),
                lng: Number(corner.longitude.toFixed(8)),
              }));

          const expertPayload = {
            points: boundaryPoints,
            closed: metrics.closed,
            surface: surfaceValue,
            unit: 'm',
            calibratedEdgeIndex: null,
            correctionFactor: 1,
            annotations: annotationsGeo,
            zones: zonesGeo,
            _meta: {
              ts: exportTimestamp,
              app: 'garden-mapper-v2',
            },
          };

          const payload = {
            ...expertPayload,
            version: 1,
            exportedAt: exportTimestamp,
            transcript: transcriptForExport,
            transcriptSegments,
            headings,
            planarAnnotations: annotationsForExport ?? [],
            planarZones: zonesForExport ?? [],
            surface: surfaceValue,
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
      [aiAnnotations, aiSurface, aiZones, corners, headings, metrics, transcript, transcriptSegments, track, videoUri],
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
        setRawTranscriptSegments([]);
        setTranscriptSegments([]);

        let cleanupTask: (() => Promise<void>) | undefined;

        try {
          const prepared = await prepareMediaForTranscription(uri);
          cleanupTask = prepared.cleanup;

          const result = await transcribeMediaViaFileApiTimestamped({
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
            targetSegmentSeconds: 1,
          });

          setTranscript(result.fullText);
          setRawTranscriptSegments(result.segments ?? []);
        } catch (error) {
          console.error('Error during transcription process:', error);
          const message =
              error instanceof Error
                  ? error.message
                  : 'An unknown error occurred during transcription.';
          setTranscriptionStatus(null);
          setTranscript(message);
          setRawTranscriptSegments([]);
          setTranscriptSegments([]);
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
      [prepareMediaForTranscription, recordingSeconds, transcribeMediaViaFileApiTimestamped],
  );

  useEffect(() => {
    if (
        activeScreen === Screen.Preview &&
        transcriptionMediaUri &&
        !isProcessing &&
        transcript.startsWith('The auto-generated')
    ) {
      processTranscription(transcriptionMediaUri);
    }
  }, [activeScreen, transcriptionMediaUri, isProcessing, transcript, processTranscription]);

  const retakeRecording = useCallback(async () => {
    await deleteFileIfExists(videoUri);
    await clearWalkthroughAudio();
    setIsPaused(false);
    setVideoUri(null);
    setTranscript(DEFAULT_TRANSCRIPT_MESSAGE);
    setRawTranscriptSegments([]);
    setTranscriptSegments([]);
    setHeadings([]);
    if (editRecordingRef.current) {
      editRecordingRef.current.stopAndUnloadAsync().catch(() => undefined);
      editRecordingRef.current = null;
    }
    setIsRecordingAnnotationEdit(false);
    setAnnotationEditStatus(null);
    setAiAnnotations([]);
    setAiZones([]);
    setAiSurface(null);
    setAiPlanStatus('idle');
    setAiPlanError(null);
    layoutSignatureRef.current = null;
    aiPlanSignatureRef.current = null;
    recordingStartRef.current = null;
    setActiveScreen(Screen.Recording);
    setShouldAutoRestart(true);
  }, [clearWalkthroughAudio, deleteFileIfExists, videoUri]);

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

  const applyAnnotationEditFromAudio = useCallback(
      async (audioUri: string) => {
        if (!exportData) {
          setAnnotationEditStatus('Add at least two corners before editing placements.');
          await deleteFileIfExists(audioUri);
          return;
        }
        try {
          setAnnotationEditStatus('Transcribing edit instructions...');
          const transcriptResult = await transcribeMediaViaFileApiTimestamped({
            fileUri: audioUri,
            mimeType: EDIT_AUDIO_MIME_TYPE,
            targetSegmentSeconds: 3,
          });
          const editTranscript = transcriptResult.fullText?.trim();
          if (!editTranscript) {
            setAnnotationEditStatus('Could not understand the edit request. Please try again.');
            return;
          }
          setAnnotationEditStatus('Updating map with ChatGPT...');
          setAiPlanStatus('planning');
          const updatedPlan = await editAiAnnotations({
            layout: exportData,
            corners,
            transcriptSegments,
            headings,
            existingAnnotations: aiAnnotations,
            existingZones: aiZones,
            surface: aiSurface,
            editTranscript,
          });
          setAiAnnotations(updatedPlan.annotations);
          setAiZones(updatedPlan.zones);
          setAiSurface(updatedPlan.surface ?? null);
          aiPlanSignatureRef.current = buildAiPlanSignature(exportData, transcriptSegments, headings);
          setAiPlanStatus('ready');
          setAiPlanError(null);
          setAnnotationEditStatus('Edits applied.');
        } catch (error) {
          const message =
              error instanceof Error ? error.message : 'Failed to apply edit instructions.';
          console.error('Annotation edit failed', error);
          setAnnotationEditStatus(message);
          setAiPlanStatus('error');
          setAiPlanError(message);
          Alert.alert('Annotation edit failed', message);
        } finally {
          await deleteFileIfExists(audioUri);
        }
      },
      [aiAnnotations, aiSurface, aiZones, corners, deleteFileIfExists, exportData, headings, transcriptSegments],
  );

  const startAnnotationEditRecording = useCallback(async () => {
    if (isRecordingAnnotationEdit) {
      return;
    }
    if (!exportData) {
      Alert.alert('Map not ready', 'Add at least two corners before editing object placements.');
      return;
    }
    if (isProcessing) {
      Alert.alert('Please wait', 'Finish transcription before editing placements.');
      return;
    }
    try {
      const permission = await Audio.requestPermissionsAsync?.();
      if (permission && !permission.granted) {
        Alert.alert('Microphone denied', 'Enable microphone access to record edit instructions.');
        return;
      }
      setAnnotationEditStatus('Recording edit instructions... Tap again to finish.');
      await configureAudioMode(true);
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      editRecordingRef.current = recording;
      setIsRecordingAnnotationEdit(true);
      Alert.alert(
          'Recording edits',
          'Describe what should change, then tap "Edit object placements" again to finish.',
      );
    } catch (error) {
      console.warn('Unable to start annotation edit recording', error);
      setAnnotationEditStatus('Unable to start recording edit instructions.');
      await configureAudioMode(false);
    }
  }, [configureAudioMode, exportData, isProcessing, isRecordingAnnotationEdit]);

  const finishAnnotationEditRecording = useCallback(async () => {
    const recording = editRecordingRef.current;
    if (!recording) {
      setIsRecordingAnnotationEdit(false);
      return;
    }
    try {
      setAnnotationEditStatus('Processing edit instructions...');
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      editRecordingRef.current = null;
      setIsRecordingAnnotationEdit(false);
      await configureAudioMode(false);
      if (!uri) {
        setAnnotationEditStatus('No audio captured. Please try again.');
        return;
      }
      await applyAnnotationEditFromAudio(uri);
    } catch (error) {
      console.error('Unable to finish annotation edit recording', error);
      setAnnotationEditStatus('Unable to process the edit recording.');
      editRecordingRef.current = null;
      setIsRecordingAnnotationEdit(false);
      await configureAudioMode(false);
    }
  }, [applyAnnotationEditFromAudio, configureAudioMode]);

  const handleAnnotationEditRequest = useCallback(async () => {
    if (isRecordingAnnotationEdit) {
      await finishAnnotationEditRecording();
    } else {
      await startAnnotationEditRecording();
    }
  }, [finishAnnotationEditRecording, isRecordingAnnotationEdit, startAnnotationEditRecording]);

  if (hasPermission === null) {
    return <View />;
  }
  if (hasPermission === false) {
    return <Text>No access to camera</Text>;
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
                transcriptSegments={transcriptSegments}
                isProcessing={isProcessing}
                transcriptionStatus={transcriptionStatus}
                onNavigate={setActiveScreen}
                onRetake={retakeRecording}
                onDownload={Platform.OS === 'web' ? downloadRecording : undefined}
                corners={corners}
                metrics={metrics}
                canClosePolygon={canClosePolygon}
                onClosePolygon={closePolygon}
                isExporting={isExporting}
                onExport={handleExportGarden}
                exportData={exportData}
                durationSeconds={recordingSeconds}
                walkDistanceMeters={walkDistanceMeters}
                annotations={aiAnnotations}
                zones={aiZones}
                aiPlanStatus={aiPlanStatus}
                aiPlanError={aiPlanError}
                onAnnotationEdit={handleAnnotationEditRequest}
                isAnnotationEditRecording={isRecordingAnnotationEdit}
                annotationEditStatus={annotationEditStatus}
                onRetranscribe={() => {
                  if (videoUri && !isProcessing) {
                    processTranscription(videoUri);
                  }
                }}
            />
        );
      case Screen.Measurement:
        return (
            <MeasurementScreen
                onNavigate={setActiveScreen}
                layout={exportData}
                metrics={metrics}
                annotations={aiAnnotations}
            />
        );
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
              {renderScreen()}
            </StyledView>
          </StyledView>
        </StyledView>
      </StyledSafeAreaView>
  );
}

function buildLayoutSignature(layout: CornerExportData): string {
  const pointsSig = layout.points
      .map((pt) => `${Math.round(pt.x * 100)}:${Math.round(pt.y * 100)}`)
      .join('|');
  return `${pointsSig}|${layout.closed ? 1 : 0}|${Math.round(layout.scale * 1000)}`;
}

function buildTranscriptSignature(segments: TranscriptSegment[]): string {
  if (!segments.length) {
    return '';
  }
  return segments
      .map((segment) => {
        const label = segment.text?.slice(0, 48) ?? '';
        return `${Math.round(segment.start_s * 10)}:${label}`;
      })
      .join('|');
}

function buildHeadingsSignature(headings: HeadingSample[]): string {
  if (!headings.length) {
    return '';
  }
  return headings
      .slice(0, 120)
      .map((sample) => `${sample.second}:${Math.round(sample.heading_deg)}`)
      .join('|');
}

function buildAiPlanSignature(
    layout: CornerExportData,
    segments: TranscriptSegment[],
    headings: HeadingSample[],
): string {
  return `${buildLayoutSignature(layout)}::${buildTranscriptSignature(segments)}::${buildHeadingsSignature(headings)}`;
}

function formatTimestampLabel(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) {
    return '0:00';
  }
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = String(clamped % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function normalizeTranscriptSegments(
    rawSegments: TranscriptSegment[] | undefined,
    fallbackText: string,
    durationSeconds: number,
): TranscriptSegment[] {
  const cleaned = (rawSegments ?? [])
      .map((segment) => {
        const start = Number.isFinite(segment.start_s) ? segment.start_s : Number(segment.start_s) || 0;
        const endCandidate = Number.isFinite(segment.end_s) ? segment.end_s : Number(segment.end_s);
        const end = typeof endCandidate === 'number' && Number.isFinite(endCandidate) && endCandidate >= start
            ? endCandidate
            : start;
        const text = segment.text?.trim?.() ?? '';
        return { start_s: start, end_s: end, text };
      })
      .filter((segment) => segment.text.length > 0)
      .sort((a, b) => a.start_s - b.start_s);

  if (cleaned.length > 0) {
    return cleaned;
  }

  const trimmedTranscript = fallbackText?.trim?.() ?? '';
  if (!trimmedTranscript) {
    return cleaned;
  }

  const approxDuration = durationSeconds && durationSeconds > 0
      ? durationSeconds
      : Math.max(1, Math.ceil(trimmedTranscript.length / 6));
  const totalSeconds = Math.max(1, Math.ceil(approxDuration));
  const words = trimmedTranscript.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return cleaned;
  }

  const wordsPerSecond = words.length / totalSeconds;
  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  for (let second = 0; second < totalSeconds; second += 1) {
    const targetCursor = second === totalSeconds - 1
        ? words.length
        : Math.min(words.length, Math.round((second + 1) * wordsPerSecond));
    if (targetCursor <= cursor) {
      continue;
    }
    const text = words.slice(cursor, targetCursor).join(' ').trim();
    if (text.length === 0) {
      cursor = targetCursor;
      continue;
    }
    segments.push({
      start_s: second,
      end_s: second + 1,
      text,
    });
    cursor = targetCursor;
  }

  return segments;
}

function buildTimestampedTranscript(
    segments: TranscriptSegment[] | undefined,
    fallbackText: string,
): string {
  if (!segments?.length) {
    return fallbackText;
  }
  const lines = segments
      .map((segment) => {
        const text = segment.text?.trim?.() ?? '';
        if (!text) {
          return null;
        }
        return `[${formatTimestampLabel(segment.start_s ?? 0)}] ${text}`;
      })
      .filter((line): line is string => Boolean(line));

  return lines.length ? lines.join('\n') : fallbackText;
}

type AiPlanArgs = {
  layout: CornerExportData;
  corners: Corner[];
  transcriptSegments: TranscriptSegment[];
  headings: HeadingSample[];
  existingAnnotations?: GardenAnnotation[];
  existingZones?: GardenZone[];
  surface?: string | null;
};

async function planAiAnnotations(args: AiPlanArgs): Promise<PlannerSuggestion> {
  const { layout, transcriptSegments, headings, corners, existingAnnotations, existingZones, surface } = args;
  if (!layout?.points?.length || !transcriptSegments.length) {
    return {
      annotations: existingAnnotations ?? [],
      zones: existingZones ?? [],
      surface: surface ?? null,
    };
  }

  try {
    const plannerSuggestion = await suggestGardenPlanWithChatGPT({
      layout: {
        points: layout.points,
        closed: layout.closed,
        scale: layout.scale,
        extent: layout.extent,
      },
      corners: corners.map((corner) => ({
        latitude: corner.latitude,
        longitude: corner.longitude,
      })),
      transcriptSegments,
      headings,
      existingAnnotations,
      existingZones,
      surface,
    });
    return {
      annotations: normalizeAnnotationsForLayout(plannerSuggestion.annotations, layout),
      zones: normalizeZonesForLayout(plannerSuggestion.zones, layout),
      surface: plannerSuggestion.surface ?? surface ?? null,
    };
  } catch (error) {
    console.warn('AI object placement failed', error);
    return {
      annotations: existingAnnotations ?? [],
      zones: existingZones ?? [],
      surface: surface ?? null,
    };
  }
}

type AiEditArgs = AiPlanArgs & {
  editTranscript: string;
};

async function editAiAnnotations(args: AiEditArgs): Promise<PlannerSuggestion> {
  const {
    layout,
    corners,
    transcriptSegments,
    headings,
    existingAnnotations,
    existingZones,
    surface,
    editTranscript,
  } = args;
  if (!layout?.points?.length) {
    return {
      annotations: existingAnnotations ?? [],
      zones: existingZones ?? [],
      surface: surface ?? null,
    };
  }
  if (!editTranscript?.trim()) {
    return {
      annotations: existingAnnotations ?? [],
      zones: existingZones ?? [],
      surface: surface ?? null,
    };
  }

  try {
    const plannerSuggestion = await editGardenPlanWithChatGPT(
        {
          layout: {
            points: layout.points,
            closed: layout.closed,
            scale: layout.scale,
            extent: layout.extent,
          },
          corners: corners.map((corner) => ({
            latitude: corner.latitude,
            longitude: corner.longitude,
          })),
          transcriptSegments,
          headings,
          existingAnnotations,
          existingZones,
          surface,
        },
        editTranscript,
    );
    return {
      annotations: normalizeAnnotationsForLayout(plannerSuggestion.annotations, layout),
      zones: normalizeZonesForLayout(plannerSuggestion.zones, layout),
      surface: plannerSuggestion.surface ?? surface ?? null,
    };
  } catch (error) {
    console.warn('AI object edit failed', error);
    return {
      annotations: existingAnnotations ?? [],
      zones: existingZones ?? [],
      surface: surface ?? null,
    };
  }
}

function normalizeAnnotationsForLayout(
    annotations: GardenAnnotation[] | undefined,
    layout: CornerExportData,
): GardenAnnotation[] {
  if (!annotations?.length) {
    return [];
  }
  if (!layout.points?.length) {
    return [];
  }
  let minX = layout.points[0].x;
  let maxX = layout.points[0].x;
  let minY = layout.points[0].y;
  let maxY = layout.points[0].y;
  for (const pt of layout.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const clamped = annotations.map((ann) => ({
    id: ann.id ?? createAnnotationId(),
    type: ann.type?.trim() || 'unknown',
    label: ann.label?.trim(),
    confidence: ann.confidence,
    size: normalizeTreeSize(ann.size),
    x: clampNumber(ann.x, minX, maxX),
    y: clampNumber(ann.y, minY, maxY),
  }));
  return enforceMinSpacing(clamped, { minX, maxX, minY, maxY });
}

function normalizeZonesForLayout(
    zones: GardenZone[] | undefined,
    layout: CornerExportData,
): GardenZone[] {
  if (!zones?.length) {
    return [];
  }
  if (!layout.points?.length) {
    return [];
  }
  let minX = layout.points[0].x;
  let maxX = layout.points[0].x;
  let minY = layout.points[0].y;
  let maxY = layout.points[0].y;
  for (const pt of layout.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  return zones
      .map((zone, index) => {
        const normalizedPoints = (zone.points ?? [])
            .map((point) => ({
              x: clampNumber(point.x, minX, maxX),
              y: clampNumber(point.y, minY, maxY),
            }))
            .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
        if (normalizedPoints.length < 3) {
          return null;
        }
        return {
          ...zone,
          id: zone.id ?? `zone_${index}_${createAnnotationId()}`,
          points: normalizedPoints,
        };
      })
      .filter((zone): zone is GardenZone => Boolean(zone));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function normalizeTreeSize(value: unknown): GardenAnnotation['size'] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  if (v === 'small' || v === 'medium' || v === 'large') {
    return v;
  }
  return undefined;
}

function enforceMinSpacing(
    annotations: GardenAnnotation[],
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
): GardenAnnotation[] {
  if (annotations.length < 2) {
    return annotations;
  }

  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  // Keep objects visually apart; fall back to a small absolute spacing if the garden is tiny.
  const minSpacing = Math.max(Math.max(spanX, spanY) * 0.012, 0.5);
  const minSpacingSq = minSpacing * minSpacing;

  const placed: GardenAnnotation[] = [];

  for (const ann of annotations) {
    let candidate = { ...ann };
    let attempts = 0;
    while (
        placed.some(
            (p) => {
              const dx = candidate.x - p.x;
              const dy = candidate.y - p.y;
              return dx * dx + dy * dy < minSpacingSq;
            },
        ) &&
        attempts < 24
    ) {
      // Spread in a spiral: try 8 directions, then increase radius.
      const radius = minSpacing * (1 + Math.floor(attempts / 8));
      const angle = ((attempts % 8) / 8) * Math.PI * 2;
      const newX = clampNumber(candidate.x + Math.cos(angle) * radius, bounds.minX, bounds.maxX);
      const newY = clampNumber(candidate.y + Math.sin(angle) * radius, bounds.minY, bounds.maxY);
      candidate = { ...candidate, x: newX, y: newY };
      attempts += 1;
    }
    placed.push(candidate);
  }

  return placed;
}

function createAnnotationId() {
  return Math.random().toString(36).slice(2, 9);
}

function buildHeadingSeries(
    track: TrackPoint[],
    startTimestamp: number,
    recordingSeconds: number,
): HeadingSample[] {
  if (!track.length) {
    return [];
  }

  const headingPerSecond = new Map<number, number>();
  for (let i = 0; i < track.length - 1; i += 1) {
    const current = track[i];
    const next = track[i + 1];
    if (!current || !next) {
      continue;
    }
    const heading = computeHeadingDegrees(current, next);
    const second = Math.max(0, Math.floor((current.timestamp - startTimestamp) / 1000));
    if (!headingPerSecond.has(second)) {
      headingPerSecond.set(second, heading);
    }
  }

  const lastTimestamp = track[track.length - 1]?.timestamp ?? startTimestamp;
  const derivedDuration = Math.max(0, Math.floor((lastTimestamp - startTimestamp) / 1000) + 1);
  const totalSeconds = Math.max(recordingSeconds, derivedDuration);

  const results: HeadingSample[] = [];
  let lastHeading: number | null = headingPerSecond.get(0) ?? null;
  for (let second = 0; second < totalSeconds; second += 1) {
    if (headingPerSecond.has(second)) {
      lastHeading = headingPerSecond.get(second)!;
    }
    if (lastHeading == null) {
      continue;
    }
    results.push({ second, heading_deg: Number(lastHeading.toFixed(2)) });
  }

  return results;
}

function computeHeadingDegrees(a: TrackPoint, b: TrackPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(a.latitude);
  const phi2 = toRad(b.latitude);
  const deltaLambda = toRad(b.longitude - a.longitude);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return (((theta * 180) / Math.PI) + 360) % 360;
}

function computeTrackDistance(track: TrackPoint[]): number {
  if (!track || track.length < 2) {
    return 0;
  }
  const origin = track[0];
  if (!Number.isFinite(origin?.latitude) || !Number.isFinite(origin?.longitude)) {
    return 0;
  }
  const proj = toMetersProjector(origin.latitude, origin.longitude);
  let distance = 0;
  for (let i = 0; i < track.length - 1; i += 1) {
    const a = track[i];
    const b = track[i + 1];
    if (
      !a ||
      !b ||
      !Number.isFinite(a.latitude) ||
      !Number.isFinite(a.longitude) ||
      !Number.isFinite(b.latitude) ||
      !Number.isFinite(b.longitude)
    ) {
      continue;
    }
    const pa = proj.toXY(a.latitude, a.longitude);
    const pb = proj.toXY(b.latitude, b.longitude);
    distance += Math.hypot(pb.x - pa.x, pb.y - pa.y);
  }
  return distance;
}
