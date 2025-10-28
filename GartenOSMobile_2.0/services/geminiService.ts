
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

export async function transcribeAudio(audioBase64: string, mimeType: 'audio/wav' | 'video/mp4'): Promise<string> {
  if (!API_KEY) {
    console.warn("EXPO_PUBLIC_GEMINI_API_KEY is not set. Using mock response.");
    return new Promise(resolve =>
      setTimeout(
        () => resolve("API key is not configured."),
        2000,
      ),
    );
  }
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { text: "Transcribe this audio from a video of a person describing their garden walkthrough." },
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: audioBase64,
                    },
                },
            ],
        },
    });
    return response.text.trim();
  } catch (error) {
    console.error("Error transcribing audio with Gemini:", error);
    throw new Error("Failed to transcribe audio. Please check your API key and network connection.");
  }
}
