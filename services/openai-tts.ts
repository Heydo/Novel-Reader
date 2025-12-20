
import { decodeAudioData } from "./audio-service";
import { getApiKey } from "./api-config";
import { MODEL_NAMES, API_URLS } from "./model-config";

export async function generateOpenAITTS(text: string, voiceName: string): Promise<AudioBuffer> {
  const apiKey = getApiKey('openai');

  const response = await fetch(`${API_URLS.OPENAI}/audio/speech`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAMES.OPENAI.TTS,
      input: text,
      voice: voiceName,
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || `OpenAI API 错误: ${response.status}`;
    throw new Error(errorMsg);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  return audioBuffer;
}
