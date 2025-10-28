# Garden Walkthrough Recorder

`GartenOSMobile_2.0/` is the primary Expo application in this repository. It captures narrated garden walkthroughs, records GPS traces, averages boundary corners for polygon metrics, and prepares exportable JSON bundles for downstream tools and certification workflows. This document is a comprehensive guide to the project: structure, runtime behaviour, working features, placeholders, setup, and next steps.

---

## 1. Project Map

```
GartenOSMobile_2.0/
├─ app/
│  ├─ index.tsx            # App entry – orchestrates camera, GPS, corners, navigation, export
│  ├─ _layout.tsx          # Expo Router stack configuration
│  └─ utils/
│     └─ geo.ts            # Shared geospatial helpers (location readiness, averaging, metrics)
├─ components/
│  ├─ HomeScreen.tsx       # Landing screen with “start recording” call to action
│  ├─ RecordingScreen.tsx  # Live recording overlay with pause/stop/corner controls
│  ├─ PreviewScreen.tsx    # Review video, transcript, GPS trace, polygon metrics, export actions
│  ├─ TrackMap.tsx         # SVG map for recorded GPS track
│  ├─ CornersMap.tsx       # SVG polygon renderer + export helper
│  ├─ MeasurementScreen.tsx# Mock measurement dashboard (placeholder)
│  ├─ CertScreen.tsx       # Mock certification checklist (placeholder)
│  └─ SubmittedScreen.tsx  # Confirmation screen with reset button
├─ services/
│  └─ geminiService.ts     # Gemini 2.5 Flash transcription helper with mock fallback
├─ assets/                 # Icons, splash imagery
├─ app.json                # Expo configuration
└─ package.json            # Dependency manifest (Expo SDK 54 + React 19)
```

---

## 2. Core Modules

| Area | Files | Responsibility | Status |
| --- | --- | --- | --- |
| Application shell | `app/index.tsx`, `app/_layout.tsx` | Manages lifecycle: requesting permissions, starting/stopping video, subscribing to GPS, capturing corners, wiring screens via Expo Router. | ✅ Working |
| Geospatial utilities | `app/utils/geo.ts` | Location readiness, Douglas–Peucker simplification, perimeter/area maths, 20 s averaged corner sampling, formatting. | ⚠️ needs testing |
| Home screen | `components/HomeScreen.tsx` | Entry CTA into the recording workflow. | ✅ Working |
| Recording overlay | `components/RecordingScreen.tsx` | Live view with timers, pause/stop, Mark Corner (averaging), Close Area, corner count display. | ✅ Working |
| Preview | `components/PreviewScreen.tsx`, `components/TrackMap.tsx`, `components/CornersMap.tsx` | Plays captured video, renders transcript, GPS path, polygon, metrics, and triggers export. | ✅ Working |
| Export plumbing | `app/index.tsx` (`handleExportGarden`) | Serialises session info (video, transcript, GPS, corners, metrics) to JSON and shares via `expo-sharing`. | ⚠️ needs testing |
| Measurement & certification | `components/MeasurementScreen.tsx`, `components/CertScreen.tsx`, `components/SubmittedScreen.tsx` | Future product steps; currently illustrative only. | ⚠️ Placeholder |
| Transcription | `services/geminiService.ts` | Gemini integration with error when API key is absent. | ✅ Working |

---

## 3. Functional Walkthrough

1. **Start session** – `HomeScreen` → `startRecording()` in `app/index.tsx`. Requests camera/mic/location permissions, configures audio, starts `expo-camera`, and spawns a high-accuracy GPS watcher (drops fixes with accuracy > 8 m).
2. **Track + corners** – GPS points stream into `track[]`. “Mark corner” runs `averageCorner()` (20 s weighted average) and appends to `corners[]`. “Close area” duplicates first corner if polygon isn’t already closed (threshold 5 cm). `useMetrics()` recomputes perimeter/area after every change.
3. **Preview** – Opens automatically when recording stops. Shows video playback, transcript (Gemini or mock), GPS map (`TrackMap`), corner map (`CornersMap`), metrics, export button, and navigation to measurement/cert screens.
4. **Export** – “Export garden JSON” triggers `handleExportGarden()`, writes the JSON to `FileSystem.documentDirectory`, and opens share sheet via `expo-sharing` when available.
5. **Measurement & certification** – Present but static; real data wiring TBD.

---

## 4. Working vs Placeholder

**Production-ready today**
- Video recording + pause/resume (hardware permitting).
- GPS logging and smoothing.
- Corner averaging, polygon closure detection, perimeter/area math.
- Preview UI and export pipeline.
- Session reset flow and error handling for common GPS issues.

**Still in progress**
- Gemini transcription requires API key and network; otherwise mock output is shown.
- Measurement and certification screens display static content only.
- Session persistence/history beyond exported JSON.

---

## 5. Development Environment

### 5.1 Prerequisites
- Node.js 18+, npm 9+.
- Expo CLI (`npx expo`) and Expo Go (for device testing).
- Xcode or Android Studio for simulators/emulators.

### 5.2 Installation
```bash
cd GartenOSMobile_2.0
npm config set legacy-peer-deps true
npm install
npx expo install expo-location expo-sharing expo-camera expo-av -- --legacy-peer-deps
```

O

### 5.3 Running
```bash
npx expo start
```

Helpful flags:
- `npx expo start -c` → clear Metro cache.
- `EXPO_USE_DEV_SERVER=1 npx expo start` → faster reload on some setups.

### 5.4 Troubleshooting
| Issue | Cause | Fix |
| --- | --- | --- |
| Missing native modules (e.g., `expo-location`) | Install skipped due to peer conflicts. | Re-run `expo install ... -- --legacy-peer-deps`. |
| npm peer dependency errors | React 19 vs Expo SDK 54 mismatch. | Keep `legacy-peer-deps` enabled or downgrade to React 18.3. |
| Transcript stays mock | No Gemini key or network failure. | Provide API key or retry with connectivity. |
| Pause button disabled | Device lacks support for `toggleRecordingAsync`. | Use a physical device that supports pause. |
| Corner capture fails indoors | GPS precision too low. | Move outdoors or enable high-accuracy mode in OS settings. |

---

