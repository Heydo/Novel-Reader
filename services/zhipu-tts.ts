
import { decodeAudioData } from "./audio-service";

const API_KEY = process.env.API_KEY || '';

export async function generateTTS(text: string, voiceName: string): Promise<AudioBuffer> {
  if (!API_KEY) {
    throw new Error("未检测到 API Key。请在环境变量中配置 API_KEY。");
  }

  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "glm-tts",
      input: text,
      voice: voiceName,
      speed: 1.0,
      volume: 1.0,
      response_format: "wav"
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || `HTTP error! status: ${response.status}`;
    throw new Error(errorMsg);
  }

  // Zhipu returns the binary WAV data
  const arrayBuffer = await response.arrayBuffer();
  
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  
  // Browsers can decode WAV natively via decodeAudioData
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  return audioBuffer;
}
