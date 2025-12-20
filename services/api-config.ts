
/**
 * API 配置文件
 * 遵循安全准则：所有密钥均来源于 process.env.API_KEY。
 * 此文件仅用于在架构上解耦不同服务对密钥的依赖。
 */
export const API_CONFIG = {
  // 统一映射到环境变量中的主 API_KEY
  gemini: process.env.API_KEY,
  zhipu: process.env.API_KEY,
  openai: process.env.API_KEY,
};

/**
 * 获取指定服务的 API Key
 * @param service 服务名称
 * @returns 密钥字符串
 * @throws 当密钥未配置时抛出错误
 */
export function getApiKey(service: keyof typeof API_CONFIG): string {
  const key = API_CONFIG[service];
  if (!key) {
    throw new Error(`[Configuration Error] 未检测到 ${service} 的 API Key。请确保环境变量中已配置 API_KEY。`);
  }
  return key;
}
