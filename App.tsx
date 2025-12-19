
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Chapter, AppMode, MODEL_OPTIONS, VOICE_OPTIONS_MAP, TTSModel, TRANSLATION_MODEL_OPTIONS, TranslationModel } from './types';
import { splitTextIntoChapters } from './utils/text-parser';
import { Button } from './components/Button';
import { generateTTS as generateZhipuTTS } from './services/zhipu-tts';
import { generateGeminiTTS } from './services/gemini-tts';
import { generateOpenAITTS } from './services/openai-tts';
import { audioBufferToWav, concatenateAudioBuffers } from './services/audio-service';
import { translateChapter, analyzeParagraph } from './services/translation-service';

interface ErrorDetail {
  message: string;
  explanation: string;
}

/**
 * 健壮的 Markdown 渲染器
 * 修复了标题、引用、列表等解析逻辑，支持 H1-H4, Blockquote, HR, Bold, Italic, Code
 */
const SimpleMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const parseInline = (content: string): React.ReactNode[] => {
    let parts: (string | React.ReactNode)[] = [content];

    // 1. 处理行内代码 `code`
    parts = parts.flatMap(part => {
      if (typeof part !== 'string') return part;
      const regex = /`(.*?)`/g;
      const result = [];
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(part)) !== null) {
        if (match.index > lastIndex) result.push(part.substring(lastIndex, match.index));
        result.push(<code key={`code-${match.index}`} className="bg-amber-200/60 text-amber-900 px-1.5 py-0.5 rounded font-mono text-[0.85em] border border-amber-300/30 mx-0.5">{match[1]}</code>);
        lastIndex = regex.lastIndex;
      }
      result.push(part.substring(lastIndex));
      return result;
    });

    // 2. 处理加粗 **text**
    parts = parts.flatMap(part => {
      if (typeof part !== 'string') return part;
      const regex = /\*\*(.*?)\*\*/g;
      const result = [];
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(part)) !== null) {
        if (match.index > lastIndex) result.push(part.substring(lastIndex, match.index));
        result.push(<strong key={`bold-${match.index}`} className="text-amber-950 font-black">{match[1]}</strong>);
        lastIndex = regex.lastIndex;
      }
      result.push(part.substring(lastIndex));
      return result;
    });

    // 3. 处理倾斜 *text* (排除了加粗干扰)
    parts = parts.flatMap(part => {
      if (typeof part !== 'string') return part;
      const regex = /\*(.*?)\*/g;
      const result = [];
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(part)) !== null) {
        if (match.index > lastIndex) result.push(part.substring(lastIndex, match.index));
        result.push(<em key={`italic-${match.index}`} className="italic text-slate-700 opacity-90">{match[1]}</em>);
        lastIndex = regex.lastIndex;
      }
      result.push(part.substring(lastIndex));
      return result;
    });

    return parts;
  };

  const lines = text.split('\n');
  return (
    <div className="space-y-3">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === '') return <div key={i} className="h-1"></div>;

        // 1. 水平分割线
        if (/^[-*]{3,}$/.test(trimmed)) {
          return <hr key={i} className="my-6 border-amber-300/40 border-t-2 border-dashed" />;
        }

        // 2. 标题 (H1-H4)
        const headerMatch = trimmed.match(/^(#{1,4})\s+(.*)/);
        if (headerMatch) {
          const level = headerMatch[1].length;
          const content = headerMatch[2];
          const styles = [
            "text-2xl font-black text-amber-950 mb-4 border-b-2 border-amber-300 pb-2",
            "text-xl font-bold text-amber-900 mb-3 border-b border-amber-200 pb-1",
            "text-lg font-bold text-amber-800 mb-2 flex items-center",
            "text-base font-bold text-amber-800 mb-1 flex items-center opacity-85"
          ][level - 1];
          const Icon = level >= 3 ? <span className="w-1.5 h-4 bg-amber-400 rounded-sm mr-2 inline-block"></span> : null;
          return React.createElement(`h${level}`, { key: i, className: styles }, Icon, ...parseInline(content));
        }

        // 3. 引用 (Blockquote)
        if (trimmed.startsWith('>')) {
          const content = trimmed.replace(/^>\s?/, '');
          return (
            <blockquote key={i} className="border-l-4 border-amber-400/60 bg-white/50 p-4 rounded-r-xl italic text-slate-700 shadow-sm my-4 relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-amber-200/30"></div>
               {parseInline(content)}
            </blockquote>
          );
        }

        // 4. 无序列表
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const content = trimmed.substring(2);
          return (
            <div key={i} className="flex items-start space-x-3 ml-2 py-1 group">
              <span className="text-amber-500 mt-2 text-[10px] transform group-hover:scale-125 transition-transform flex-shrink-0">●</span>
              <span className="flex-1 text-slate-700">{parseInline(content)}</span>
            </div>
          );
        }

        // 5. 有序列表
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <div key={i} className="flex items-start space-x-3 ml-2 py-1">
              <span className="text-amber-700 font-mono font-bold text-sm mt-1 flex-shrink-0">{numMatch[1]}.</span>
              <span className="flex-1 text-slate-700">{parseInline(numMatch[2])}</span>
            </div>
          );
        }

        // 6. 普通段落
        return <p key={i} className="leading-relaxed text-slate-700 text-base">{parseInline(line)}</p>;
      })}
    </div>
  );
};

export default function App() {
  const [mode, setMode] = useState<AppMode>('welcome');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  
  const [selectedModel, setSelectedModel] = useState<TTSModel>('glm-tts');
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS_MAP['glm-tts'][0].id);
  const [selectedTranslationModel, setSelectedTranslationModel] = useState<TranslationModel>('gemini-3-flash-preview');
  const [translateDirection, setTranslateDirection] = useState<'zh-en' | 'en-zh'>('zh-en');
  
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  // Paragraph-level state
  const [paragraphAudios, setParagraphAudios] = useState<Record<number, string>>({});
  const [paragraphBuffers, setParagraphBuffers] = useState<Record<number, AudioBuffer>>({});
  const [translatedParagraphs, setTranslatedParagraphs] = useState<Record<number, string>>({});
  const [paragraphAnalyses, setParagraphAnalyses] = useState<Record<number, string>>({});
  const [collapsedAnalyses, setCollapsedAnalyses] = useState<Record<number, boolean>>({});
  const [analyzingIdx, setAnalyzingIdx] = useState<number | null>(null);
  const [generatingParagraphIdx, setGeneratingParagraphIdx] = useState<number | null>(null);
  const [playingParagraphIdx, setPlayingParagraphIdx] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null); 
  const paragraphAudioRef = useRef<HTMLAudioElement>(null); 

  const activeUrls = useRef<Set<string>>(new Set());
  const activeChapter = chapters[activeChapterIndex];

  const paragraphs = useMemo(() => {
    if (!activeChapter) return [];
    return activeChapter.content.split(/\n+/).filter(p => p.trim().length > 0);
  }, [activeChapter]);

  useEffect(() => {
    setSelectedVoice(VOICE_OPTIONS_MAP[selectedModel][0].id);
  }, [selectedModel]);

  useEffect(() => {
    return () => {
      activeUrls.current.forEach(url => URL.revokeObjectURL(url));
      activeUrls.current.clear();
    };
  }, []);

  const clearChapterData = () => {
    activeUrls.current.forEach(url => URL.revokeObjectURL(url));
    activeUrls.current.clear();
    setAudioUrl(null);
    setParagraphAudios({});
    setParagraphBuffers({});
    setTranslatedParagraphs({});
    setParagraphAnalyses({});
    setCollapsedAnalyses({});
    setErrorDetail(null);
    setPlayingParagraphIdx(null);
    setIsBatchGenerating(false);
    setIsMerging(false);
    setIsTranslating(false);
    if (paragraphAudioRef.current) {
      paragraphAudioRef.current.pause();
      paragraphAudioRef.current.src = "";
    }
  };

  const getErrorExplanation = (err: any): ErrorDetail => {
    const msg = err.message || String(err);
    let explanation = "发生了未知错误。";
    if (msg.includes("API Key") || msg.includes("401")) explanation = "API 密钥无效。";
    else if (msg.includes("429")) explanation = "已达到配额限制。";
    else if (msg.includes("safety")) explanation = "触发安全策略。";
    return { message: msg, explanation };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setChapters(splitTextIntoChapters(event.target?.result as string));
      setMode('reader');
      setActiveChapterIndex(0);
      clearChapterData();
    };
    reader.readAsText(file);
  };

  const handleManualSubmit = () => {
    if (!inputText.trim()) return;
    setChapters(splitTextIntoChapters(inputText));
    setMode('reader');
    setActiveChapterIndex(0);
    clearChapterData();
  };

  const generateAudioData = async (text: string): Promise<{ url: string, buffer: AudioBuffer }> => {
    let audioBuffer: AudioBuffer;
    if (selectedModel === 'glm-tts') {
      audioBuffer = await generateZhipuTTS(text, selectedVoice);
    } else if (selectedModel === 'gemini-tts') {
      audioBuffer = await generateGeminiTTS(text, selectedVoice);
    } else {
      audioBuffer = await generateOpenAITTS(text, selectedVoice);
    }
    const wavBlob = audioBufferToWav(audioBuffer);
    const url = URL.createObjectURL(wavBlob);
    activeUrls.current.add(url);
    return { url, buffer: audioBuffer };
  };

  const handleTranslateChapter = async () => {
    if (!paragraphs.length) return;
    setIsTranslating(true);
    setErrorDetail(null);
    try {
      const results = await translateChapter(paragraphs, translateDirection, selectedTranslationModel);
      const translatedMap: Record<number, string> = {};
      results.forEach((text, idx) => {
        translatedMap[idx] = text;
      });
      setTranslatedParagraphs(translatedMap);
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setIsTranslating(false);
    }
  };

  const handleAnalyzeParagraph = async (index: number) => {
    const targetText = translateDirection === 'zh-en' ? translatedParagraphs[index] : paragraphs[index];
    if (!targetText) return;

    setAnalyzingIdx(index);
    try {
      const analysis = await analyzeParagraph(targetText, selectedTranslationModel);
      setParagraphAnalyses(prev => ({ ...prev, [index]: analysis }));
      // 生成后默认展开
      setCollapsedAnalyses(prev => ({ ...prev, [index]: false }));
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setAnalyzingIdx(null);
    }
  };

  const toggleAnalysisCollapse = (index: number) => {
    setCollapsedAnalyses(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const batchGenerateParagraphs = async () => {
    if (!paragraphs.length) return;
    setIsBatchGenerating(true);
    setErrorDetail(null);
    try {
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphBuffers[i]) continue;
        setGeneratingParagraphIdx(i);
        const result = await generateAudioData(paragraphs[i]);
        setParagraphAudios(prev => ({ ...prev, [i]: result.url }));
        setParagraphBuffers(prev => ({ ...prev, [i]: result.buffer }));
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
      throw err;
    } finally {
      setIsBatchGenerating(false);
      setGeneratingParagraphIdx(null);
    }
  };

  const mergeExistingParagraphs = async () => {
    const availableIndices = Object.keys(paragraphBuffers).map(Number).sort((a, b) => a - b);
    if (availableIndices.length === 0) {
      setErrorDetail({ message: "No audio available", explanation: "当前没有任何已生成的段落音频可供合并。" });
      return;
    }
    
    setIsMerging(true);
    try {
      const buffers = availableIndices.map(idx => paragraphBuffers[idx]);
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const mergedBuffer = concatenateAudioBuffers(buffers, audioCtx);
      const mergedBlob = audioBufferToWav(mergedBuffer);
      
      if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          activeUrls.current.delete(audioUrl);
      }
      const newUrl = URL.createObjectURL(mergedBlob);
      activeUrls.current.add(newUrl);
      setAudioUrl(newUrl);
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setIsMerging(false);
    }
  };

  const handleFullAuto = async () => {
    try {
      await batchGenerateParagraphs();
      await mergeExistingParagraphs();
    } catch (e) {
      console.error("Full auto process interrupted:", e);
    }
  };

  const handleGenerateParagraphTTS = async (text: string, index: number) => {
    setGeneratingParagraphIdx(index);
    setErrorDetail(null);
    try {
      if (paragraphAudios[index]) {
        URL.revokeObjectURL(paragraphAudios[index]);
        activeUrls.current.delete(paragraphAudios[index]);
      }
      const result = await generateAudioData(text);
      setParagraphAudios(prev => ({ ...prev, [index]: result.url }));
      setParagraphBuffers(prev => ({ ...prev, [index]: result.buffer }));
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setGeneratingParagraphIdx(null);
    }
  };

  const playParagraphAudio = (url: string, index: number) => {
    const player = paragraphAudioRef.current;
    if (!player) return;
    if (playingParagraphIdx === index && !player.paused) {
      player.pause();
      setPlayingParagraphIdx(null);
      return;
    }
    player.pause();
    player.src = url;
    player.load();
    setPlayingParagraphIdx(index);
    player.play().catch(() => setPlayingParagraphIdx(null));
  };

  if (mode === 'welcome') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-100">
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold text-slate-900">AI 精准小说朗读器</h1>
            <p className="text-slate-500">超强上下文翻译与多模型语音合成</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 border-2 border-dashed border-slate-200 rounded-xl hover:border-indigo-400 transition-colors flex flex-col items-center justify-center space-y-4 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              </div>
              <p className="font-semibold text-center">上传 TXT 小说</p>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".txt" />
            </div>
            <div className="flex flex-col space-y-4">
              <textarea className="flex-1 p-4 border rounded-xl text-sm min-h-[160px]" placeholder="粘贴文本进行阅读..." value={inputText} onChange={(e) => setInputText(e.target.value)} />
              <Button onClick={handleManualSubmit} disabled={!inputText.trim()} className="w-full">进入阅读</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const generatedCount = Object.keys(paragraphBuffers).length;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-900">
      <audio ref={paragraphAudioRef} className="hidden" onEnded={() => setPlayingParagraphIdx(null)} onError={() => setPlayingParagraphIdx(null)} />

      <aside className="w-64 md:w-80 flex-shrink-0 border-r bg-white flex flex-col">
        <div className="p-6 border-b flex items-center justify-between">
          <h2 className="font-bold text-lg">章节目录</h2>
          <Button variant="outline" size="sm" onClick={() => setMode('welcome')}>退出</Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {chapters.map((chapter, index) => (
            <button key={chapter.id} onClick={() => { setActiveChapterIndex(index); clearChapterData(); }} className={`w-full text-left px-4 py-3 rounded-lg text-sm transition-colors ${activeChapterIndex === index ? 'bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100' : 'text-slate-600 hover:bg-slate-50'}`}>
              <div className="flex items-center space-x-3">
                <span className="opacity-50 font-mono text-xs">{index + 1}</span>
                <span className="truncate">{chapter.title}</span>
              </div>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="sticky top-0 z-30 flex flex-col shadow-sm bg-white">
          {/* TTS 控制栏 */}
          <header className="flex flex-col md:flex-row items-center justify-between px-6 py-2 border-b border-slate-100 gap-4 overflow-x-auto whitespace-nowrap scrollbar-hide">
            <div className="flex items-center space-x-3">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-bold uppercase mb-0.5 ml-1">朗读模型与音色</span>
                <div className="flex space-x-2">
                  <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as TTSModel)} className="bg-slate-50 border border-slate-200 rounded-lg text-xs px-2 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer hover:bg-white transition-colors">
                    {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg text-xs px-2 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer hover:bg-white transition-colors">
                    {VOICE_OPTIONS_MAP[selectedModel].map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <div className="hidden lg:flex items-center bg-indigo-50/50 px-2 py-1.5 rounded-lg border border-indigo-100 text-[10px] font-bold text-indigo-500 mr-2 uppercase tracking-wider">
                 缓存: {generatedCount}/{paragraphs.length} 段
              </div>
              <Button size="sm" variant="outline" onClick={batchGenerateParagraphs} isLoading={isBatchGenerating} disabled={isMerging || isGenerating || generatedCount === paragraphs.length} className="px-3">
                {isBatchGenerating ? `生成中 (${generatingParagraphIdx! + 1}/${paragraphs.length})` : '批量合成音频'}
              </Button>
              <Button size="sm" variant="outline" onClick={mergeExistingParagraphs} isLoading={isMerging} disabled={isBatchGenerating || isGenerating || generatedCount === 0} className="px-3">
                {isMerging ? '合并中...' : '拼接当前音频'}
              </Button>
              <div className="w-px h-6 bg-slate-200 mx-1 hidden md:block"></div>
              <Button size="sm" onClick={handleFullAuto} isLoading={isBatchGenerating || isMerging} disabled={isGenerating} className="px-4 shadow-sm">
                全流程自动完成
              </Button>
            </div>
          </header>

          {/* 翻译控制栏 */}
          <header className="flex flex-col md:flex-row items-center justify-between px-6 py-2 border-b border-slate-100 bg-slate-50/30 gap-4 overflow-x-auto whitespace-nowrap scrollbar-hide">
             <div className="flex items-center space-x-3">
               <div className="flex flex-col">
                 <span className="text-[10px] text-slate-400 font-bold uppercase mb-0.5 ml-1">翻译模型与方向</span>
                 <div className="flex items-center space-x-2">
                   <select value={selectedTranslationModel} onChange={(e) => setSelectedTranslationModel(e.target.value as TranslationModel)} className="bg-white border border-slate-200 rounded-lg text-xs px-2 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer shadow-sm">
                     {TRANSLATION_MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                   </select>
                   <button 
                     onClick={() => setTranslateDirection(translateDirection === 'zh-en' ? 'en-zh' : 'zh-en')}
                     className="px-3 py-1.5 text-[10px] font-bold text-indigo-600 bg-white border border-slate-200 shadow-sm rounded-lg transition-all hover:bg-indigo-50 active:scale-95 whitespace-nowrap flex items-center space-x-1"
                   >
                     <span>{translateDirection === 'zh-en' ? '中文' : '英文'}</span>
                     <svg className="w-3 h-3 mx-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                     <span>{translateDirection === 'zh-en' ? '英文' : '中文'}</span>
                   </button>
                 </div>
               </div>
             </div>

             <div className="flex items-center space-x-2">
                <Button size="sm" variant="primary" onClick={handleTranslateChapter} isLoading={isTranslating} disabled={isBatchGenerating || isMerging} className="px-6 text-xs shadow-sm bg-indigo-500 hover:bg-indigo-600">
                  执行全章翻译
                </Button>
                {Object.keys(translatedParagraphs).length > 0 && (
                   <Button size="sm" variant="outline" onClick={() => { setTranslatedParagraphs({}); setParagraphAnalyses({}); setCollapsedAnalyses({}); }} className="px-3 text-xs text-slate-400 border-none hover:text-red-500">
                     清除译文
                   </Button>
                )}
             </div>
          </header>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 flex justify-center bg-slate-50">
          <article className="max-w-4xl w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
            {activeChapter ? (
              <>
                <h1 className="text-3xl font-bold text-slate-900 border-b pb-6 px-4">{activeChapter.title}</h1>
                
                {audioUrl && (
                  <div className="mx-4 sticky top-4 z-20 bg-indigo-50 p-4 rounded-xl border border-indigo-100 shadow-lg flex flex-col space-y-2 animate-in slide-in-from-top-4">
                    <div className="flex items-center justify-between px-1">
                      <p className="text-[10px] font-extrabold text-indigo-700 uppercase tracking-widest flex items-center">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full mr-2 animate-pulse"></span>
                        已拼接音频播放器
                      </p>
                      <button onClick={() => setAudioUrl(null)} className="text-indigo-400 hover:text-indigo-600">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                      </button>
                    </div>
                    <div className="flex items-center space-x-3">
                      <audio ref={audioRef} controls src={audioUrl} className="flex-1 h-8" />
                      <a href={audioUrl} download={`${activeChapter.title}.wav`} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </a>
                    </div>
                  </div>
                )}

                {errorDetail && (
                  <div className="mx-4 bg-red-50 text-red-800 p-4 rounded-xl border border-red-200 text-sm flex items-start space-x-2">
                    <svg className="w-5 h-5 text-red-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                    <div>
                      <strong className="block mb-0.5">错误详情:</strong> {errorDetail.explanation}
                    </div>
                  </div>
                )}

                <div className="serif-text text-xl leading-relaxed text-slate-800 space-y-4 px-4">
                  {paragraphs.map((pText, idx) => {
                    const isPlaying = playingParagraphIdx === idx;
                    const isGeneratingP = generatingParagraphIdx === idx;
                    const hasAudio = !!paragraphAudios[idx];
                    const translation = translatedParagraphs[idx];
                    const analysis = paragraphAnalyses[idx];
                    const isAnalyzing = analyzingIdx === idx;
                    const isCollapsed = collapsedAnalyses[idx];

                    return (
                      <div key={idx} className={`relative flex items-start space-x-4 p-4 rounded-xl border transition-all duration-300 ${isPlaying ? 'bg-indigo-50 border-indigo-200 shadow-sm' : isGeneratingP ? 'bg-indigo-50/50 border-indigo-300 animate-pulse' : 'bg-white border-slate-100 hover:border-slate-300'}`}>
                        <div className="flex-shrink-0 flex flex-col items-center space-y-2">
                          {hasAudio ? (
                            <div className="flex flex-col items-center space-y-2">
                              <button onClick={() => playParagraphAudio(paragraphAudios[idx], idx)} className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${isPlaying ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'}`}>
                                {isPlaying ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"/></svg> : <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"/></svg>}
                              </button>
                              <button 
                                onClick={() => handleGenerateParagraphTTS(pText, idx)} 
                                disabled={generatingParagraphIdx !== null || isMerging || isBatchGenerating}
                                title="重新生成此段音频"
                                className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 border border-slate-100 transition-all disabled:opacity-30 shadow-xs"
                              >
                                {isGeneratingP ? (
                                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                )}
                              </button>
                            </div>
                          ) : (
                            <button disabled={generatingParagraphIdx !== null || isMerging || isBatchGenerating} onClick={() => handleGenerateParagraphTTS(pText, idx)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 disabled:opacity-30 transition-all">
                              {isGeneratingP ? <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11a7 7 0 01-7 7m0 0 a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </button>
                          )}
                          <span className={`text-[9px] mt-1 font-mono transition-colors ${hasAudio ? 'text-indigo-500 font-bold' : 'text-slate-400'}`}>#{idx + 1}</span>
                        </div>
                        <div className="flex-1 space-y-4">
                          {/* 原文区块 */}
                          <div className="group relative">
                            <p className={`whitespace-pre-wrap transition-colors duration-300 ${isPlaying ? 'text-indigo-900 font-medium' : 'text-slate-800'}`}>
                              {pText}
                            </p>
                            {/* 当英译中时，分析按钮在原文旁 */}
                            {translateDirection === 'en-zh' && (
                              <div className={`absolute -right-2 top-0 transition-all duration-300 ${isAnalyzing ? 'opacity-100 translate-y-0' : 'opacity-0 group-hover:opacity-100 translate-y-[-4px]'}`}>
                                <button 
                                  onClick={() => handleAnalyzeParagraph(idx)}
                                  disabled={isAnalyzing}
                                  className={`shadow-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white text-[11px] px-5 py-2 rounded-full border-2 border-white/40 hover:scale-105 active:scale-95 transition-all z-20 flex items-center space-x-2 ${isAnalyzing ? 'animate-pulse ring-4 ring-indigo-300/50 pointer-events-auto' : ''}`}
                                >
                                  {isAnalyzing ? (
                                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"></path></svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                                  )}
                                  <span className="font-black tracking-wide drop-shadow-sm">{isAnalyzing ? '深度解析引擎运行中' : analysis ? '重新 AI 解析' : 'AI 深度学习分析'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                          
                          {/* 译文区块 */}
                          {translation && (
                            <div className="group relative">
                              <p className="text-base text-slate-500 italic bg-slate-100/40 p-5 rounded-2xl border border-slate-200/60 animate-in fade-in slide-in-from-left-2 duration-500 leading-relaxed shadow-inner">
                                {translation}
                              </p>
                              {/* 当中译英时，分析按钮在译文旁 */}
                              {translateDirection === 'zh-en' && (
                                <div className={`absolute -right-2 top-0 transition-all duration-300 ${isAnalyzing ? 'opacity-100 translate-y-0' : 'opacity-0 group-hover:opacity-100 translate-y-[-4px]'}`}>
                                  <button 
                                    onClick={() => handleAnalyzeParagraph(idx)}
                                    disabled={isAnalyzing}
                                    className={`shadow-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white text-[11px] px-5 py-2 rounded-full border-2 border-white/40 hover:scale-105 active:scale-95 transition-all z-20 flex items-center space-x-2 ${isAnalyzing ? 'animate-pulse ring-4 ring-indigo-300/50 pointer-events-auto' : ''}`}
                                  >
                                    {isAnalyzing ? (
                                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"></path></svg>
                                    ) : (
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                                    )}
                                    <span className="font-black tracking-wide drop-shadow-sm">{isAnalyzing ? '深度解析引擎运行中' : analysis ? '重新 AI 解析' : 'AI 深度学习分析'}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* 解析结果渲染区块 - 可折叠 */}
                          {analysis && (
                            <div className="bg-gradient-to-br from-amber-50 via-white/80 to-orange-50/60 rounded-[1.5rem] border-2 border-amber-200/50 text-sm text-slate-800 animate-in slide-in-from-top-4 duration-500 shadow-xl overflow-hidden ring-1 ring-amber-100/50">
                               {/* 标题栏 - 点击可切换折叠 */}
                               <div 
                                 onClick={() => toggleAnalysisCollapse(idx)}
                                 className="flex items-center justify-between p-5 cursor-pointer hover:bg-amber-100/30 transition-colors select-none group"
                               >
                                 <div className="flex items-center space-x-3 text-amber-900 font-bold relative z-10">
                                   <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-200 to-orange-300 flex items-center justify-center text-amber-800 shadow-md border border-amber-400/30 group-hover:scale-110 transition-transform">
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                   </div>
                                   <div className="flex flex-col">
                                     <span className="text-lg serif-text font-black tracking-tight leading-tight">AI 语言深度解析报告</span>
                                     <span className="text-[9px] uppercase tracking-[0.2em] opacity-50 font-sans">Semantic & Grammatical Report</span>
                                   </div>
                                 </div>
                                 <div className="flex items-center space-x-2">
                                   <div className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider">
                                     {isCollapsed ? '点击展开分析' : '点击收起分析'}
                                   </div>
                                   <button className={`w-8 h-8 rounded-full flex items-center justify-center bg-amber-200/40 text-amber-700 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}>
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                                   </button>
                                 </div>
                               </div>

                               {/* 内容区域 - 折叠动画 */}
                               <div className={`transition-all duration-500 ease-in-out ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'}`}>
                                 <div className="p-8 pt-0 serif-text max-w-none text-base leading-relaxed border-t border-amber-200/40">
                                   <div className="mt-6 prose prose-amber max-w-none">
                                      <SimpleMarkdown text={analysis} />
                                   </div>
                                   <div className="mt-12 flex justify-end border-t border-amber-100/50 pt-4">
                                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setParagraphAnalyses(prev => {
                                        const next = {...prev};
                                        delete next[idx];
                                        return next;
                                      }); }} className="text-amber-600 border-amber-200 hover:bg-amber-100/50">
                                        永久清除此分析
                                      </Button>
                                   </div>
                                 </div>
                               </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                <div className="pt-12 mx-4 flex justify-between items-center text-slate-400 border-t pb-20">
                   <Button variant="outline" disabled={activeChapterIndex === 0} onClick={() => { setActiveChapterIndex(activeChapterIndex - 1); clearChapterData(); }}>上一章</Button>
                   <span className="text-xs font-mono tracking-widest bg-slate-100 px-3 py-1 rounded-full uppercase text-slate-500">
                     CHAPTER {activeChapterIndex + 1} / {chapters.length}
                   </span>
                   <Button variant="outline" disabled={activeChapterIndex === chapters.length - 1} onClick={() => { setActiveChapterIndex(activeChapterIndex + 1); clearChapterData(); }}>下一章</Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400"><p>请在左侧选择章节</p></div>
            )}
          </article>
        </div>
      </main>
    </div>
  );
}
