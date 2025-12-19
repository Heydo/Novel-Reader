
import { decodeAudioData } from "./audio-service";

export async function generateOpenAITTS(text: string, voiceName: string): Promise<AudioBuffer> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("未检测到 API Key。请在环境变量中配置 API_KEY。");
  }

  const response = await fetch("https://api.302.ai/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: text,
      voice: voiceName,
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || `OpenAI API Error: ${response.status}`;
    throw new Error(errorMsg);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  
  // Browsers decode WAV/MP3 from OpenAI natively
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  return audioBuffer;
}
