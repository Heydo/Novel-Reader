
import { GoogleGenAI, Modality } from "@google/genai";
import { decodeBase64, decodeAudioData } from "./audio-service";

export async function generateGeminiTTS(text: string, voiceName: string): Promise<AudioBuffer> {
  // Use process.env.API_KEY directly as per guidelines
  if (!process.env.API_KEY) {
    throw new Error("未检测到 API Key。请在环境变量中配置 API_KEY。");
  }

  // Create a new GoogleGenAI instance right before making an API call
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    throw new Error("Gemini API 未返回音频数据。");
  }

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const rawData = decodeBase64(base64Audio);
  // The Gemini TTS returns raw PCM data. 
  // We decode the 16-bit 24kHz mono PCM data using the utility from audio-service.
  const audioBuffer = await decodeAudioData(rawData, audioCtx, 24000, 1);
  
  return audioBuffer;
}
