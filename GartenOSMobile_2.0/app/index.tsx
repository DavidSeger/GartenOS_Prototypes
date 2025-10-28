import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { Camera, CameraView, CameraType } from 'expo-camera';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import { styled } from 'nativewind';

import { Screen } from '../types';
import { transcribeAudio } from '../services/geminiService';
import { averageCorner, Corner, toMetersProjector, useMetrics } from './utils/geo';

import HomeScreen from '../components/HomeScreen';
import RecordingScreen from '../components/RecordingScreen';
import PreviewScreen from '../components/PreviewScreen';
import MeasurementScreen from '../components/MeasurementScreen';
import CertScreen from '../components/CertScreen';
import SubmittedScreen from '../components/SubmittedScreen';
import { CornerExportData } from '../components/CornersMap';

const StyledSafeAreaView = styled(SafeAreaView);
const StyledView = styled(View);
const DEFAULT_TRANSCRIPT_MESSAGE =
  'The auto-generated transcript will appear here after recording.';
type CameraViewInstance = React.ComponentRef<typeof CameraView>;
type TrackPoint = { latitude: number; longitude: number; timestamp: number };

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

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
          timeInterval: 1000,
          distanceInterval: 1,
          mayShowUserSettingsDialog: true,
        },
        (pos) => {
          const acc = pos.coords.accuracy ?? 99;
          if (acc > 8) return;
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
      const corner = await averageCorner(20);
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
      setTranscript('Converting video to audio format...');

      try {
        let base64 = '';
        let mimeType: 'audio/wav' | 'video/mp4' = 'video/mp4';

        if (Platform.OS === 'web') {
          const response = await fetch(uri);
          const blob = await response.blob();
          mimeType = (blob.type as 'video/mp4') || 'video/mp4';
          base64 = await blobToBase64(blob);
        } else {
          base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        }

        setTranscript('Transcribing audio with Gemini... Please wait.');
        const result = await transcribeAudio(base64, mimeType);
        setTranscript(result);
      } catch (error) {
        console.error('Error during transcription process:', error);
        const message =
          error instanceof Error
            ? error.message
            : 'An unknown error occurred during transcription.';
        setTranscript(message);
      } finally {
        setIsProcessing(false);
      }
    },
    [],
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
            {renderScreen()}
          </StyledView>
        </StyledView>
      </StyledView>
    </StyledSafeAreaView>
  );
}
