import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_ROOT = "https://generativelanguage.googleapis.com/upload/v1beta";
const MODEL_NAME = "models/gemini-2.5-flash";
const MOCK_TRANSCRIPT = "API key is not configured.";

// Timestamped transcript types
export type TranscriptSegment = { start_s: number; end_s: number; text: string };
export type TranscriptResult = { fullText: string; segments: TranscriptSegment[] };

export type TranscriptionStage = "preparing" | "uploading" | "transcribing";

export type TranscriptionStatus = {
  stage: TranscriptionStage;
  progress?: number;
  message?: string;
};

export type PreparedMedia = {
  uri: string;
  mimeType: string;
  size: number;
  cleanup?: () => Promise<void>;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

type GeminiFileMetadata = {
  name?: string;
  uri?: string;
  state?: string;
};

const UPLOAD_TYPE_BINARY = FileSystem.FileSystemUploadType.BINARY_CONTENT;

function requireApiKey(): string {
  if (!API_KEY) {
    throw new Error("Gemini API key is not configured.");
  }
  return API_KEY;
}

async function geminiRequest(
  path: string,
  init: RequestInit & { baseUrl?: string } = {},
  context: string,
): Promise<Response> {
  const apiKey = requireApiKey();
  const base = init.baseUrl ?? API_ROOT;
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("content-type") && init.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  headers.set("x-goog-api-key", apiKey);

  const response = await fetch(url, { ...init, headers });
  if (response.ok) {
    return response;
  }

  let message: string;
  try {
    const data = await response.json();
    message = data?.error?.message ?? JSON.stringify(data);
  } catch {
    message = await response.text();
  }
  throw new Error(`${context}: ${message}`);
}

function extractTranscript(response: GeminiGenerateResponse): string {
  if (response.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request (${response.promptFeedback.blockReason}).`);
  }
  const candidate = response.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.length) {
    throw new Error("Gemini returned no transcript candidates.");
  }
  const transcript = candidate.content.parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!transcript) {
    throw new Error("Gemini returned an empty transcription.");
  }
  return transcript;
}

type TimestampedTranscriptPayload = {
  fullText?: unknown;
  segments?: Array<{ start_s?: unknown; end_s?: unknown; text?: unknown }>;
};

function toSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return 0;
}

function extractTranscriptSegments(response: GeminiGenerateResponse): TranscriptResult {
  if (response.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request (${response.promptFeedback.blockReason}).`);
  }
  const candidate = response.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.length) {
    throw new Error("Gemini returned no transcript candidates.");
  }
  const payloadText = candidate.content.parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!payloadText) {
    throw new Error("Gemini returned an empty transcription.");
  }

  let parsed: TimestampedTranscriptPayload;
  try {
    parsed = JSON.parse(payloadText) as TimestampedTranscriptPayload;
  } catch (error) {
    throw new Error(`Gemini returned invalid timestamped transcript JSON: ${(error as Error).message}`);
  }

  const segments = (parsed.segments ?? [])
    .map((segment) => {
      const text = typeof segment.text === "string" ? segment.text.trim() : "";
      const start = Math.max(0, toSeconds(segment.start_s));
      const endRaw = toSeconds(segment.end_s);
      const end = endRaw >= start ? endRaw : start;
      return { start_s: start, end_s: end, text };
    })
    .filter((segment) => segment.text.length > 0)
    .sort((a, b) => a.start_s - b.start_s);

  const fullTextFromPayload = typeof parsed.fullText === "string" ? parsed.fullText.trim() : "";
  const fullText = fullTextFromPayload || segments.map((segment) => segment.text).join(" ").trim();

  if (!fullText) {
    throw new Error("Gemini returned an empty transcription.");
  }

  return {
    fullText,
    segments,
  };
}

async function requestTranscriptSegments(
  parts: Array<Record<string, unknown>>,
  opts: { targetSegmentSeconds?: number } = {},
): Promise<TranscriptResult> {
  const targetSeconds = opts.targetSegmentSeconds && opts.targetSegmentSeconds > 0 ? opts.targetSegmentSeconds : 12;
  const instruction =
    `Transcribe this garden walkthrough. Respond with strict JSON using this schema: ` +
    `{"fullText": string, "segments": [{"start_s": number, "end_s": number, "text": string}]}. ` +
    `Make segments sequential, non-overlapping, and roughly ${targetSeconds}-second chunks. ` +
    `start_s and end_s must be seconds from the beginning of the media. Return only JSON.`;

  const response = await geminiRequest(
    `/${MODEL_NAME}:generateContent`,
    {
      method: "POST",
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: instruction }, ...parts],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    },
    "Gemini timestamped transcription failed",
  );

  const json = (await response.json()) as GeminiGenerateResponse;
  return extractTranscriptSegments(json);
}

export async function prepareMediaForTranscription(videoUri: string): Promise<PreparedMedia> {
  const info = await FileSystem.getInfoAsync(videoUri);
  if (!info.exists || info.isDirectory || typeof info.size !== "number") {
    throw new Error("Recording file is missing or unreadable.");
  }

  // Future enhancement: export an audio-only track here to shrink uploads.
  return {
    uri: videoUri,
    mimeType: Platform.OS === "web" ? "video/mp4" : "video/mp4",
    size: info.size,
  };
}

async function startResumableUpload(params: {
  fileUri: string;
  mimeType: string;
  displayName: string;
  size: number;
}): Promise<string> {
  const { fileUri, mimeType, displayName, size } = params;

  const body = JSON.stringify({
    file: {
      display_name: displayName,
      mime_type: mimeType,
      size_bytes: String(size),
    },
  });

  const response = await geminiRequest(
    "/files",
    {
      method: "POST",
      baseUrl: UPLOAD_ROOT,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(size),
        "X-Goog-Upload-Header-Content-Type": mimeType,
      },
      body,
    },
    "Failed to initiate Gemini file upload",
  );

  const uploadUrl = response.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini did not return an upload URL.");
  }

  return uploadUrl;
}

async function uploadMediaChunked(params: {
  uploadUrl: string;
  fileUri: string;
  mimeType: string;
  size: number;
  onProgress?: (progress: number) => void;
}): Promise<GeminiFileMetadata> {
  const { uploadUrl, fileUri, mimeType, onProgress, size } = params;

  const uploadTask = FileSystem.createUploadTask(
    uploadUrl,
    fileUri,
    {
      httpMethod: "POST",
      headers: {
        "Content-Type": mimeType,
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Protocol": "resumable",
        "x-goog-api-key": requireApiKey(),
      },
      uploadType: UPLOAD_TYPE_BINARY,
    },
    (progressData) => {
      if (!onProgress) return;
      const { totalBytesSent, totalBytesExpectedToSend } = progressData;
      if (totalBytesExpectedToSend && totalBytesExpectedToSend > 0) {
        onProgress(Math.min(totalBytesSent / totalBytesExpectedToSend, 1));
      } else if (size > 0) {
        onProgress(Math.min(totalBytesSent / size, 1));
      }
    },
  );

  const result = await uploadTask.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Gemini upload failed (${result.status}): ${result.body}`);
  }

  try {
    const payload = JSON.parse(result.body);
    if (payload?.file) {
      return payload.file as GeminiFileMetadata;
    }
    return payload as GeminiFileMetadata;
  } catch (error) {
    throw new Error(`Unable to parse Gemini upload response: ${(error as Error).message}`);
  }
}

function normaliseFileName(name: string): string {
  return name.startsWith("files/") ? name.slice("files/".length) : name;
}

async function deleteRemoteFile(name?: string): Promise<void> {
  if (!name) return;
  const encodedName = encodeURIComponent(normaliseFileName(name));
  try {
    await geminiRequest(`/files/${encodedName}`, { method: "DELETE" }, "Failed to delete uploaded file");
  } catch (error) {
    console.warn("Unable to delete uploaded file", error);
  }
}

async function fetchFileMetadata(name: string): Promise<GeminiFileMetadata> {
  const encodedName = encodeURIComponent(normaliseFileName(name));
  const response = await geminiRequest(
    `/files/${encodedName}`,
    { method: "GET" },
    "Failed to fetch uploaded file status",
  );
  return (await response.json()) as GeminiFileMetadata;
}

async function requestTranscript(parts: Array<Record<string, unknown>>): Promise<string> {
  const response = await geminiRequest(
    `/${MODEL_NAME}:generateContent`,
    {
      method: "POST",
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
      }),
    },
    "Gemini transcription failed",
  );

  const json = (await response.json()) as GeminiGenerateResponse;
  return extractTranscript(json);
}

export async function transcribeMediaViaFileApi(params: {
  fileUri: string;
  mimeType: string;
  onStatus?: (status: TranscriptionStatus) => void;
}): Promise<string> {
  const { fileUri, mimeType, onStatus } = params;

  if (!API_KEY) {
    console.warn("EXPO_PUBLIC_GEMINI_API_KEY is not set. Using mock response.");
    onStatus?.({ stage: "transcribing", progress: 1, message: "Using mock response." });
    return new Promise((resolve) => setTimeout(() => resolve(MOCK_TRANSCRIPT), 1200));
  }

  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists || info.isDirectory || typeof info.size !== "number") {
    throw new Error("Recording file is missing or unreadable.");
  }

  const displayName = fileUri.split("/").pop() ?? "garden-session";

  onStatus?.({ stage: "uploading", progress: 0 });
  const uploadUrl = await startResumableUpload({
    fileUri,
    mimeType,
    displayName,
    size: info.size,
  });

  const remoteFile = await uploadMediaChunked({
    uploadUrl,
    fileUri,
    mimeType,
    size: info.size,
    onProgress: (progress) => onStatus?.({ stage: "uploading", progress }),
  });

  onStatus?.({ stage: "transcribing", progress: 0 });

  try {
    const fileUriForModel =
      remoteFile.uri ?? (remoteFile.name ? `${API_ROOT}/${remoteFile.name}` : undefined);
    if (!fileUriForModel) {
      throw new Error("Gemini upload did not return a usable file URI.");
    }

    let activeFile = remoteFile;
    if (remoteFile.name && remoteFile.state !== "ACTIVE") {
      const maxAttempts = 30;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        activeFile = await fetchFileMetadata(remoteFile.name!);
        if (activeFile.state === "ACTIVE") {
          break;
        }
        onStatus?.({
          stage: "transcribing",
          progress: 0,
          message: "Processing media on Gemini...",
        });
      }
      if (activeFile.state !== "ACTIVE") {
        throw new Error("Gemini did not activate the uploaded file in time.");
      }
    }

    const finalFileUri =
      activeFile.uri ??
      (activeFile.name ? `${API_ROOT}/files/${normaliseFileName(activeFile.name)}` : fileUriForModel);

    const transcript = await requestTranscript([
      {
        text: "Transcribe this media from a garden walkthrough. Respond with only the transcript text.",
      },
      {
        fileData: {
          fileUri: finalFileUri,
          mimeType,
        },
      },
    ]);

    onStatus?.({ stage: "transcribing", progress: 1 });
    return transcript;
  } finally {
    await deleteRemoteFile(remoteFile.name);
  }
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: "audio/wav" | "video/mp4",
): Promise<string> {
  if (!API_KEY) {
    console.warn("EXPO_PUBLIC_GEMINI_API_KEY is not set. Using mock response.");
    return new Promise((resolve) => setTimeout(() => resolve(MOCK_TRANSCRIPT), 1200));
  }

  const transcript = await requestTranscript([
    {
      text: "Transcribe this audio from a video of a person describing their garden walkthrough.",
    },
    {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    },
  ]);

  return transcript;
}




// Timestamped variant using the File API
export async function transcribeMediaViaFileApiTimestamped(params: {
  fileUri: string;
  mimeType: string;
  onStatus?: (status: TranscriptionStatus) => void;
  targetSegmentSeconds?: number;
}): Promise<TranscriptResult> {
  const { fileUri, mimeType, onStatus, targetSegmentSeconds } = params;

  if (!API_KEY) {
    console.warn("EXPO_PUBLIC_GEMINI_API_KEY is not set. Using mock response.");
    const mock: TranscriptResult = {
      fullText: MOCK_TRANSCRIPT,
      segments: [
        { start_s: 0, end_s: 10, text: "Intro and boundary start." },
        { start_s: 10, end_s: 20, text: "Pond and kitchen bed description." },
        { start_s: 20, end_s: 30, text: "Return to gate and finish." },
      ],
    };
    onStatus?.({ stage: "transcribing", progress: 1, message: "Using mock response." });
    return new Promise((resolve) => setTimeout(() => resolve(mock), 600));
  }

  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists || info.isDirectory || typeof info.size !== "number") {
    throw new Error("Recording file is missing or unreadable.");
  }

  const displayName = fileUri.split("/").pop() ?? "garden-session";
  onStatus?.({ stage: "uploading", progress: 0 });
  const uploadUrl = await startResumableUpload({ fileUri, mimeType, displayName, size: info.size });

  const remoteFile = await uploadMediaChunked({
    uploadUrl,
    fileUri,
    mimeType,
    size: info.size,
    onProgress: (progress) => onStatus?.({ stage: "uploading", progress }),
  });

  onStatus?.({ stage: "transcribing", progress: 0 });
  try {
    const fileUriForModel = remoteFile.uri ?? (remoteFile.name ? `${API_ROOT}/${remoteFile.name}` : undefined);
    if (!fileUriForModel) throw new Error("Gemini upload did not return a usable file URI.");

    let activeFile = remoteFile;
    if (remoteFile.name && remoteFile.state !== "ACTIVE") {
      const maxAttempts = 30;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        activeFile = await fetchFileMetadata(remoteFile.name!);
        if (activeFile.state === "ACTIVE") break;
        onStatus?.({ stage: "transcribing", progress: 0, message: "Processing media on Gemini..." });
      }
      if (activeFile.state !== "ACTIVE") throw new Error("Gemini did not activate the uploaded file in time.");
    }

    const finalFileUri =
      activeFile.uri ?? (activeFile.name ? `${API_ROOT}/files/${normaliseFileName(activeFile.name)}` : fileUriForModel);

    const result = await requestTranscriptSegments(
      [ { fileData: { fileUri: finalFileUri, mimeType } } ],
      { targetSegmentSeconds },
    );

    onStatus?.({ stage: "transcribing", progress: 1 });
    return result;
  } finally {
    await deleteRemoteFile(remoteFile.name);
  }
}

// Timestamped variant using inline data
export async function transcribeAudioTimestamped(
  audioBase64: string,
  mimeType: "audio/wav" | "video/mp4",
  opts: { targetSegmentSeconds?: number } = {},
): Promise<TranscriptResult> {
  if (!API_KEY) {
    const mock: TranscriptResult = {
      fullText: MOCK_TRANSCRIPT,
      segments: [
        { start_s: 0, end_s: 10, text: "Intro and boundary start." },
        { start_s: 10, end_s: 20, text: "Pond and kitchen bed description." },
        { start_s: 20, end_s: 30, text: "Return to gate and finish." },
      ],
    };
    return new Promise((resolve) => setTimeout(() => resolve(mock), 600));
  }

  const result = await requestTranscriptSegments(
    [ { inlineData: { mimeType, data: audioBase64 } } ],
    opts,
  );
  return result;
}
