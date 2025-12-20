
import { GoogleGenAI, Type } from "@google/genai";
import { TranslationModel } from "../types";
import { getApiKey } from "./api-config";
import { MODEL_NAMES, API_URLS } from "./model-config";

export async function translateChapter(
  paragraphs: string[], 
  direction: 'zh-en' | 'en-zh',
  model: TranslationModel
): Promise<string[]> {
  const apiKey = (model === 'gemini-3-flash-preview') ? getApiKey('gemini') : 
                 (model === 'glm-4-9-air') ? getApiKey('zhipu') : getApiKey('openai');

  const sourceLang = direction === 'zh-en' ? 'Chinese' : 'English';
  const targetLang = direction === 'zh-en' ? 'English' : 'Chinese';

  const systemInstruction = `You are a professional book translator specializing in literary translation. 
Translate text from ${sourceLang} to ${targetLang}. 
Maintain the original prose's tone, atmosphere, and nuances. 
Return ONLY a JSON array of strings. 
The array must have exactly ${paragraphs.length} elements, matching the input paragraph order.`;

  const userPrompt = `Translate these ${paragraphs.length} paragraphs:
${paragraphs.map((p, i) => `[${i}]: ${p}`).join('\n')}`;

  if (model === 'gemini-3-flash-preview') {
    return translateWithGemini(apiKey, paragraphs, systemInstruction, userPrompt);
  } else if (model === 'glm-4-9-air') {
    return translateWithGLM(apiKey, paragraphs, systemInstruction, userPrompt);
  } else {
    return translateWithOpenAI(apiKey, paragraphs, systemInstruction, userPrompt);
  }
}

export async function analyzeParagraph(
  text: string,
  model: TranslationModel
): Promise<string> {
  const apiKey = (model === 'gemini-3-flash-preview') ? getApiKey('gemini') : 
                 (model === 'glm-4-9-air') ? getApiKey('zhipu') : getApiKey('openai');

  const prompt = `请作为资深英语教学专家，对以下段落进行深入的英语语言学习解析：
1. **核心单词 (Vocabulary)**: 提取3-5个核心词汇，标注音标、在本语境下的含义及常见搭配。
2. **地道短语 (Phrases & Collocations)**: 提取段落中的地道表达、固定搭配或习惯用语。
3. **长难句拆解 (Grammar Analysis)**: 选取并分析段落中的复杂句式，拆解其语法结构（如定语从句、非谓语动词等）。
请使用中文回答，保持排版工整简洁。

待分析文本：
${text}`;

  if (model === 'gemini-3-flash-preview') {
    // 同样检查 URL 配置
    if (API_URLS.GEMINI) {
      const url = `${API_URLS.GEMINI}/v1beta/models/${MODEL_NAMES.GEMINI.ANALYSIS}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
             // 模拟 thinking 暂不直接支持，仅基础生成
             temperature: 0.7
          }
        })
      });
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "解析失败。";
    } else {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: MODEL_NAMES.GEMINI.ANALYSIS,
        contents: prompt,
        config: {
          thinkingConfig: { thinkingBudget: 16384 }
        }
      });
      return response.text || "解析失败。";
    }
  }

  const baseUrl = model === 'glm-4-9-air' ? API_URLS.ZHIPU : API_URLS.OPENAI;
  const targetModel = model === 'glm-4-9-air' ? MODEL_NAMES.ZHIPU.CHAT : MODEL_NAMES.OPENAI.CHAT;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: targetModel,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function translateWithGemini(apiKey: string, paragraphs: string[], system: string, prompt: string): Promise<string[]> {
  if (API_URLS.GEMINI) {
    const url = `${API_URLS.GEMINI}/v1beta/models/${MODEL_NAMES.GEMINI.TRANSLATION}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(text);
  } else {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL_NAMES.GEMINI.TRANSLATION,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
    });
    return JSON.parse(response.text || "[]");
  }
}

async function translateWithGLM(apiKey: string, paragraphs: string[], system: string, prompt: string): Promise<string[]> {
  const response = await fetch(`${API_URLS.ZHIPU}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAMES.ZHIPU.CHAT,
      messages: [
        { role: "system", content: system + " Ensure the output is a valid JSON array of strings." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`GLM API Error: ${response.status}`);
  const data = await response.json();
  const content = data.choices[0].message.content;
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : Object.values(parsed)[0] as string[];
}

async function translateWithOpenAI(apiKey: string, paragraphs: string[], system: string, prompt: string): Promise<string[]> {
  const response = await fetch(`${API_URLS.OPENAI}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAMES.OPENAI.CHAT,
      messages: [
        { role: "system", content: system + " Respond strictly with a JSON array." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`OpenAI API Error: ${response.status}`);
  const data = await response.json();
  const content = data.choices[0].message.content;
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : Object.values(parsed)[0] as string[];
}
