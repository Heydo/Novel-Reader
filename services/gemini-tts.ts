
import { GoogleGenAI, Modality } from "@google/genai";
import { decodeBase64, decodeAudioData } from "./audio-service";
import { getApiKey } from "./api-config";
import { MODEL_NAMES, API_URLS } from "./model-config";

export async function generateGeminiTTS(text: string, voiceName: string): Promise<AudioBuffer> {
  const apiKey = getApiKey('gemini');
  let base64Audio: string | undefined;

  // 如果配置了自定义 URL，使用 REST 方式请求
  if (API_URLS.GEMINI) {
    const url = `${API_URLS.GEMINI}/v1beta/models/${MODEL_NAMES.GEMINI.TTS}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } }
          }
        }
      })
    });
    
    if (!response.ok) throw new Error(`Gemini URL 访问错误: ${response.status}`);
    const data = await response.json();
    base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } 
  // 否则默认使用官方 SDK
  else {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL_NAMES.GEMINI.TTS,
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
    base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  }
  
  if (!base64Audio) {
    throw new Error("Gemini API 未返回音频数据。");
  }

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const rawData = decodeBase64(base64Audio);
  const audioBuffer = await decodeAudioData(rawData, audioCtx, 24000, 1);
  
  return audioBuffer;
}
