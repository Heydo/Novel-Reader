
/**
 * 模型名称与 URL 配置文件
 * 统一管理不同服务商的具体模型 ID 及请求基础路径。
 */
export const MODEL_NAMES = {
  GEMINI: {
    TTS: 'gemini-2.5-flash-preview-tts',
    TRANSLATION: 'gemini-3-flash-preview',
    ANALYSIS: 'gemini-3-pro-preview',
  },
  ZHIPU: {
    TTS: 'glm-tts',
    CHAT: 'glm-4-9-air',
  },
  OPENAI: {
    TTS: 'gpt-4o-mini-tts',
    CHAT: 'gpt-3.5-turbo',
  }
} as const;

/**
 * 基础请求路径配置
 * 如果配置了 GEMINI 的 URL，系统将尝试通过 REST API 访问而非官方 SDK（适用于代理场景）。
 */
export const API_URLS = {
  // 智谱标准 API 地址
  ZHIPU: 'https://open.bigmodel.cn/api/paas/v4',
  // OpenAI/302 转发地址
  OPENAI: 'https://api.302.ai/v1',
  // Gemini 可选代理地址，留空则默认使用官方 SDK
  GEMINI: '', 
} as const;
