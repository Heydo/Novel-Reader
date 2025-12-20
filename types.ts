
export interface Chapter {
  id: string;
  title: string;
  content: string;
}

export interface VoiceOption {
  id: string;
  name: string;
}

export type AppMode = 'welcome' | 'reader';
export type TTSModel = 'glm-tts' | 'gemini-tts' | 'openai-tts';
export type TranslationModel = 'glm-4.6v-flash' | 'gemini-3-flash-preview' | 'gpt-3.5-turbo';

export const MODEL_OPTIONS = [
  { id: 'glm-tts' as TTSModel, name: '智谱 GLM-TTS (超拟人)' },
  { id: 'gemini-tts' as TTSModel, name: 'Google Gemini TTS' },
  { id: 'openai-tts' as TTSModel, name: 'OpenAI TTS (标准)' },
];

export const TRANSLATION_MODEL_OPTIONS = [
  { id: 'gemini-3-flash-preview' as TranslationModel, name: 'Gemini 3 Flash' },
  { id: 'glm-4.6v-flash' as TranslationModel, name: 'GLM-4.6v-Flash' },
  { id: 'gpt-3.5-turbo' as TranslationModel, name: 'GPT-3.5 Turbo' },
];

export const VOICE_OPTIONS_MAP: Record<TTSModel, VoiceOption[]> = {
  'glm-tts': [
    { id: 'tongtong', name: '彤彤 (默认女声)' },
    { id: 'xiaochen', name: '小陈 (稳重男声)' },
    { id: 'chuichui', name: '锤锤 (活泼童声)' },
    { id: 'jam', name: 'Jam (磁性男声)' },
    { id: 'kazi', name: 'Kazi (甜美女声)' },
    { id: 'douji', name: 'Douji (趣味配音)' },
    { id: 'luodo', name: 'Luodo (温柔女声)' },
  ],
  'gemini-tts': [
    { id: 'Kore', name: 'Kore (开朗)' },
    { id: 'Puck', name: 'Puck (轻快)' },
    { id: 'Charon', name: 'Charon (深沉)' },
    { id: 'Fenrir', name: 'Fenrir (沉稳)' },
    { id: 'Zephyr', name: 'Zephyr (轻柔)' },
  ],
  'openai-tts': [
    { id: 'alloy', name: 'Alloy (中性)' },
    { id: 'echo', name: 'Echo (男声)' },
    { id: 'fable', name: 'Fable (磁性)' },
    { id: 'onyx', name: 'Onyx (深沉)' },
    { id: 'nova', name: 'Nova (女声)' },
    { id: 'shimmer', name: 'Shimmer (清亮)' },
  ],
};
