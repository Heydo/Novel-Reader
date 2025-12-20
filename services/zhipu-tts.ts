
import { decodeAudioData } from "./audio-service";
import { getApiKey } from "./api-config";
import { MODEL_NAMES, API_URLS } from "./model-config";

export async function generateTTS(text: string, voiceName: string): Promise<AudioBuffer> {
  const apiKey = getApiKey('zhipu');

  const response = await fetch(`${API_URLS.ZHIPU}/audio/speech`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAMES.ZHIPU.TTS,
      input: text,
      voice: voiceName,
      speed: 1.0,
      volume: 1.0,
      response_format: "wav"
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || `智谱 API 错误: ${response.status}`;
    throw new Error(errorMsg);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  return audioBuffer;
}
