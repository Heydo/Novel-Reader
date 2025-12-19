
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Chapter, AppMode, MODEL_OPTIONS, VOICE_OPTIONS_MAP, TTSModel, TRANSLATION_MODEL_OPTIONS, TranslationModel } from './types';
import { splitTextIntoChapters } from './utils/text-parser';
import { Button } from './components/Button';
import { generateTTS as generateZhipuTTS } from './services/zhipu-tts';
import { generateGeminiTTS } from './services/gemini-tts';
import { generateOpenAITTS } from './services/openai-tts';
import { audioBufferToWav, concatenateAudioBuffers } from './services/audio-service';
import { translateChapter, analyzeParagraph } from './services/translation-service';
import { generateEpub } from './services/epub-service';

interface ErrorDetail {
  message: string;
  explanation: string;
}

/**
 * 健壮的 Markdown 渲染器
 */
const SimpleMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const parseInline = (content: string): React.ReactNode[] => {
    let parts: (string | React.ReactNode)[] = [content];

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
        if (/^[-*]{3,}$/.test(trimmed)) return <hr key={i} className="my-6 border-amber-300/40 border-t-2 border-dashed" />;

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
          return React.createElement(`h${level}`, { key: i, className: styles }, ...parseInline(content));
        }

        if (trimmed.startsWith('>')) {
          const content = trimmed.replace(/^>\s?/, '');
          return (
            <blockquote key={i} className="border-l-4 border-amber-400/60 bg-white/50 p-4 rounded-r-xl italic text-slate-700 shadow-sm my-4">
               {parseInline(content)}
            </blockquote>
          );
        }

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
  
  // Status flags
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isProcessingAuto, setIsProcessingAuto] = useState(false);
  
  const [selectedModel, setSelectedModel] = useState<TTSModel>('glm-tts');
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS_MAP['glm-tts'][0].id);
  const [selectedTranslationModel, setSelectedTranslationModel] = useState<TranslationModel>('gemini-3-flash-preview');
  const [translateDirection, setTranslateDirection] = useState<'zh-en' | 'en-zh'>('zh-en');
  
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mergedAudioBlobRef = useRef<Blob | null>(null);
  
  // Content states
  const [paragraphAudios, setParagraphAudios] = useState<Record<number, string>>({});
  const [paragraphBuffers, setParagraphBuffers] = useState<Record<number, AudioBuffer>>({});
  const [translatedParagraphs, setTranslatedParagraphs] = useState<Record<number, string>>({});
  const [paragraphAnalyses, setParagraphAnalyses] = useState<Record<number, string>>({});
  const [collapsedAnalyses, setCollapsedAnalyses] = useState<Record<number, boolean>>({});
  
  // Index trackers
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

  const clearChapterData = () => {
    activeUrls.current.forEach(url => URL.revokeObjectURL(url));
    activeUrls.current.clear();
    setAudioUrl(null);
    mergedAudioBlobRef.current = null;
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
    setIsBatchAnalyzing(false);
    setIsProcessingAuto(false);
  };

  const getErrorExplanation = (err: any): ErrorDetail => {
    const msg = err.message || String(err);
    let explanation = "发生了未知错误。";
    if (msg.includes("API Key") || msg.includes("401")) explanation = "API 密钥无效。";
    else if (msg.includes("429")) explanation = "已达到配额限制。";
    return { message: msg, explanation };
  };

  const generateAudioData = async (text: string): Promise<{ url: string, buffer: AudioBuffer }> => {
    let audioBuffer: AudioBuffer;
    if (selectedModel === 'glm-tts') audioBuffer = await generateZhipuTTS(text, selectedVoice);
    else if (selectedModel === 'gemini-tts') audioBuffer = await generateGeminiTTS(text, selectedVoice);
    else audioBuffer = await generateOpenAITTS(text, selectedVoice);
    
    const wavBlob = audioBufferToWav(audioBuffer);
    const url = URL.createObjectURL(wavBlob);
    activeUrls.current.add(url);
    return { url, buffer: audioBuffer };
  };

  const handleTranslateChapter = async (): Promise<Record<number, string>> => {
    if (!paragraphs.length) return {};
    setIsTranslating(true);
    setErrorDetail(null);
    try {
      const results = await translateChapter(paragraphs, translateDirection, selectedTranslationModel);
      const translatedMap: Record<number, string> = {};
      results.forEach((text, idx) => { translatedMap[idx] = text; });
      setTranslatedParagraphs(translatedMap);
      return translatedMap;
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
      throw err;
    } finally {
      setIsTranslating(false);
    }
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
    if (availableIndices.length === 0) return;
    setIsMerging(true);
    try {
      const buffers = availableIndices.map(idx => paragraphBuffers[idx]);
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const mergedBuffer = concatenateAudioBuffers(buffers, audioCtx);
      const mergedBlob = audioBufferToWav(mergedBuffer);
      mergedAudioBlobRef.current = mergedBlob;
      const newUrl = URL.createObjectURL(mergedBlob);
      activeUrls.current.add(newUrl);
      setAudioUrl(newUrl);
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setIsMerging(false);
    }
  };

  const batchAnalyzeParagraphs = async (currentTranslated?: Record<number, string>) => {
    if (!paragraphs.length) return;
    const targetTranslated = currentTranslated || translatedParagraphs;
    setIsBatchAnalyzing(true);
    setErrorDetail(null);
    try {
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphAnalyses[i]) continue;
        const targetText = translateDirection === 'zh-en' ? targetTranslated[i] : paragraphs[i];
        if (!targetText) continue;
        
        setAnalyzingIdx(i);
        const analysis = await analyzeParagraph(targetText, selectedTranslationModel);
        setParagraphAnalyses(prev => ({ ...prev, [i]: analysis }));
        setCollapsedAnalyses(prev => ({ ...prev, [i]: false }));
      }
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setIsBatchAnalyzing(false);
      setAnalyzingIdx(null);
    }
  };

  const handleFullAuto = async () => {
    setIsProcessingAuto(true);
    setErrorDetail(null);
    try {
      // 1. Translation
      let currentTranslation = translatedParagraphs;
      if (Object.keys(currentTranslation).length === 0) {
        currentTranslation = await handleTranslateChapter();
      }
      // 2. TTS
      await batchGenerateParagraphs();
      // 3. Merging
      await mergeExistingParagraphs();
      // 4. Analysis
      await batchAnalyzeParagraphs(currentTranslation);
    } catch (e) {
      console.error("Auto process failed", e);
    } finally {
      setIsProcessingAuto(false);
    }
  };

  const handleAnalyzeParagraph = async (index: number) => {
    const targetText = translateDirection === 'zh-en' ? translatedParagraphs[index] : paragraphs[index];
    if (!targetText) return;
    setAnalyzingIdx(index);
    try {
      const analysis = await analyzeParagraph(targetText, selectedTranslationModel);
      setParagraphAnalyses(prev => ({ ...prev, [index]: analysis }));
      setCollapsedAnalyses(prev => ({ ...prev, [index]: false }));
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setAnalyzingIdx(null);
    }
  };

  const handleExportEpub = async () => {
    if (!activeChapter) return;
    setIsExporting(true);
    try {
      if (!mergedAudioBlobRef.current && Object.keys(paragraphBuffers).length > 0) await mergeExistingParagraphs();
      const pAudioBlobs: Record<number, Blob> = {};
      Object.entries(paragraphBuffers).forEach(([idx, buffer]) => { pAudioBlobs[Number(idx)] = audioBufferToWav(buffer); });

      const blob = await generateEpub({
        title: activeChapter.title,
        paragraphs,
        translations: translatedParagraphs,
        analyses: paragraphAnalyses,
        audioBlob: mergedAudioBlobRef.current || undefined,
        paragraphAudioBlobs: pAudioBlobs
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${activeChapter.title}.epub`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setIsExporting(false);
    }
  };

  const playParagraphAudio = (url: string, index: number) => {
    const player = paragraphAudioRef.current;
    if (!player) return;
    if (playingParagraphIdx === index && !player.paused) { player.pause(); setPlayingParagraphIdx(null); return; }
    player.pause(); player.src = url; player.load(); setPlayingParagraphIdx(index);
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
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-2xl font-bold">↑</div>
              <p className="font-semibold text-center">上传 TXT 小说</p>
              <input type="file" ref={fileInputRef} onChange={(e) => {
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
              }} className="hidden" accept=".txt" />
            </div>
            <div className="flex flex-col space-y-4">
              <textarea className="flex-1 p-4 border rounded-xl text-sm min-h-[160px]" placeholder="粘贴文本进行阅读..." value={inputText} onChange={(e) => setInputText(e.target.value)} />
              <Button onClick={() => {
                if (!inputText.trim()) return;
                setChapters(splitTextIntoChapters(inputText));
                setMode('reader');
                setActiveChapterIndex(0);
                clearChapterData();
              }} disabled={!inputText.trim()} className="w-full">进入阅读</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const generatedCount = Object.keys(paragraphBuffers).length;
  const analysisCount = Object.keys(paragraphAnalyses).length;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-900">
      <audio ref={paragraphAudioRef} className="hidden" onEnded={() => setPlayingParagraphIdx(null)} />

      <aside className="w-64 md:w-80 flex-shrink-0 border-r bg-white flex flex-col shadow-lg">
        <div className="p-6 border-b flex items-center justify-between bg-slate-50">
          <h2 className="font-bold text-lg text-slate-700">章节目录</h2>
          <Button variant="outline" size="sm" onClick={() => setMode('welcome')}>退出</Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {chapters.map((chapter, index) => (
            <button key={chapter.id} onClick={() => { setActiveChapterIndex(index); clearChapterData(); }} className={`w-full text-left px-4 py-3 rounded-lg text-sm transition-all ${activeChapterIndex === index ? 'bg-indigo-600 text-white font-bold shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}>
              <div className="flex items-center space-x-3">
                <span className="opacity-70 font-mono text-xs">{index + 1}</span>
                <span className="truncate">{chapter.title}</span>
              </div>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="sticky top-0 z-30 flex flex-col shadow-md bg-white">
          <header className="flex flex-col lg:flex-row items-center justify-between px-6 py-2 border-b border-slate-100 gap-4 overflow-x-auto">
            <div className="flex items-center space-x-3">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-bold uppercase mb-0.5 ml-1">朗读模型与音色</span>
                <div className="flex space-x-2">
                  <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as TTSModel)} className="bg-slate-50 border border-slate-200 rounded-lg text-xs px-2 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer">
                    {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg text-xs px-2 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer">
                    {VOICE_OPTIONS_MAP[selectedModel].map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Button size="sm" variant="outline" onClick={batchGenerateParagraphs} isLoading={isBatchGenerating} disabled={isProcessingAuto} className="px-3">
                {isBatchGenerating ? `生成中 (${generatingParagraphIdx! + 1}/${paragraphs.length})` : '批量TTS合成'}
              </Button>
              <Button size="sm" variant="outline" onClick={mergeExistingParagraphs} isLoading={isMerging} disabled={isProcessingAuto || generatedCount === 0} className="px-3">
                {isMerging ? '合并中...' : '拼接当前音频'}
              </Button>
              <div className="w-px h-6 bg-slate-200 mx-1 hidden md:block"></div>
              <Button size="sm" onClick={handleFullAuto} isLoading={isProcessingAuto} className="px-4 shadow-sm bg-gradient-to-r from-indigo-600 to-violet-600">
                {isProcessingAuto ? '自动流程处理中...' : '全流程自动完成'}
              </Button>
            </div>
          </header>

          <header className="flex flex-col lg:flex-row items-center justify-between px-6 py-2 border-b border-slate-100 bg-slate-50/50 gap-4 overflow-x-auto">
             <div className="flex items-center space-x-3">
               <div className="flex flex-col">
                 <span className="text-[10px] text-slate-400 font-bold uppercase mb-0.5 ml-1">翻译与解析设置</span>
                 <div className="flex items-center space-x-2">
                   <select value={selectedTranslationModel} onChange={(e) => setSelectedTranslationModel(e.target.value as TranslationModel)} className="bg-white border border-slate-200 rounded-lg text-xs px-2 py-1.5 shadow-sm">
                     {TRANSLATION_MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                   </select>
                   <button onClick={() => setTranslateDirection(translateDirection === 'zh-en' ? 'en-zh' : 'zh-en')} className="px-3 py-1.5 text-[10px] font-bold text-indigo-600 bg-white border border-slate-200 shadow-sm rounded-lg transition-all hover:bg-indigo-50">
                     <span>{translateDirection === 'zh-en' ? '中' : '英'} → {translateDirection === 'zh-en' ? '英' : '中'}</span>
                   </button>
                 </div>
               </div>
             </div>

             <div className="flex items-center space-x-2">
                <Button size="sm" variant="primary" onClick={handleTranslateChapter} isLoading={isTranslating} disabled={isProcessingAuto} className="px-4 text-xs bg-indigo-500">
                  执行全章翻译
                </Button>
                <Button size="sm" variant="secondary" onClick={() => batchAnalyzeParagraphs()} isLoading={isBatchAnalyzing} disabled={isProcessingAuto} className="px-4 text-xs">
                  {isBatchAnalyzing ? `解析中 (${analyzingIdx! + 1}/${paragraphs.length})` : '全章批量深度解析'}
                </Button>
                <div className="w-px h-6 bg-slate-200 mx-1"></div>
                <Button size="sm" variant="outline" onClick={handleExportEpub} isLoading={isExporting} disabled={!activeChapter} className="px-4 text-xs font-bold text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                  导出 EPUB
                </Button>
             </div>
          </header>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 flex justify-center bg-slate-50">
          <article className="max-w-4xl w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
            {activeChapter ? (
              <>
                <h1 className="text-3xl font-bold text-slate-900 border-b pb-6 px-4 serif-text">{activeChapter.title}</h1>
                
                {audioUrl && (
                  <div className="mx-4 sticky top-4 z-20 bg-white/90 backdrop-blur-md p-4 rounded-xl border border-indigo-100 shadow-xl flex flex-col space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <p className="text-[10px] font-extrabold text-indigo-700 uppercase tracking-widest flex items-center">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full mr-2 animate-pulse"></span>
                        全章朗读音频
                      </p>
                      <button onClick={() => setAudioUrl(null)} className="text-slate-400 hover:text-red-500 transition-colors">✕</button>
                    </div>
                    <div className="flex items-center space-x-3">
                      <audio ref={audioRef} controls src={audioUrl} className="flex-1 h-10" />
                      <a href={audioUrl} download={`${activeChapter.title}.wav`} className="p-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                        ↓
                      </a>
                    </div>
                  </div>
                )}

                {errorDetail && (
                  <div className="mx-4 bg-red-50 text-red-800 p-4 rounded-xl border border-red-200 text-sm flex items-start space-x-2 animate-bounce">
                    <div><strong>错误:</strong> {errorDetail.explanation}</div>
                  </div>
                )}

                <div className="serif-text text-xl leading-relaxed text-slate-800 space-y-6 px-4">
                  {paragraphs.map((pText, idx) => {
                    const isPlaying = playingParagraphIdx === idx;
                    const hasAudio = !!paragraphAudios[idx];
                    const translation = translatedParagraphs[idx];
                    const analysis = paragraphAnalyses[idx];
                    const isAnalyzingP = analyzingIdx === idx;
                    const isCollapsed = collapsedAnalyses[idx] || false;

                    return (
                      <div key={idx} className={`relative flex items-start space-x-4 p-5 rounded-2xl border transition-all duration-300 ${isPlaying ? 'bg-indigo-50 border-indigo-300 shadow-sm ring-1 ring-indigo-200' : 'bg-white border-slate-100 hover:border-slate-300 shadow-sm'}`}>
                        <div className="flex-shrink-0 flex flex-col items-center space-y-3">
                          <button onClick={() => hasAudio ? playParagraphAudio(paragraphAudios[idx], idx) : null} disabled={!hasAudio} className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${isPlaying ? 'bg-indigo-600 text-white shadow-lg scale-110' : hasAudio ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}>
                            {isPlaying ? '■' : '▶'}
                          </button>
                          <span className={`text-[9px] font-mono ${hasAudio ? 'text-indigo-500 font-bold' : 'text-slate-300'}`}>#{idx + 1}</span>
                        </div>
                        
                        <div className="flex-1 space-y-4">
                          <div className="group relative">
                            <p className={`whitespace-pre-wrap transition-colors duration-300 ${isPlaying ? 'text-indigo-950 font-medium' : 'text-slate-800'}`}>
                              {pText}
                            </p>
                          </div>
                          
                          {translation && (
                            <div className="p-5 bg-slate-50 rounded-xl border border-slate-200/60 text-base text-slate-500 italic leading-relaxed animate-in fade-in slide-in-from-left-2 shadow-inner">
                              {translation}
                            </div>
                          )}

                          {analysis && (
                            <div className="bg-amber-50/50 rounded-2xl border border-amber-200 overflow-hidden shadow-sm">
                              <div onClick={() => setCollapsedAnalyses(prev => ({ ...prev, [idx]: !prev[idx] }))} className="flex items-center justify-between p-4 cursor-pointer hover:bg-amber-100/50 transition-colors border-b border-amber-100">
                                <div className="flex items-center space-x-2 text-amber-900 font-bold">
                                  <span className="w-1 h-5 bg-amber-400 rounded-full mr-2"></span>
                                  AI 语言深度解析
                                </div>
                                <span className="text-xs text-amber-600">{isCollapsed ? '点击展开' : '点击收起'}</span>
                              </div>
                              {!isCollapsed && (
                                <div className="p-6 pt-2 text-sm leading-relaxed animate-in slide-in-from-top-2">
                                  <SimpleMarkdown text={analysis} />
                                </div>
                              )}
                            </div>
                          )}

                          {!analysis && (
                            <div className="flex justify-end pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <Button size="sm" variant="outline" onClick={() => handleAnalyzeParagraph(idx)} isLoading={isAnalyzingP} className="text-[10px] py-1 h-7 border-indigo-200 text-indigo-600">
                                 {isAnalyzingP ? '分析中...' : '单独 AI 解析'}
                               </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                <div className="pt-12 mx-4 flex justify-between items-center text-slate-400 border-t pb-24">
                   <Button variant="outline" disabled={activeChapterIndex === 0} onClick={() => { setActiveChapterIndex(activeChapterIndex - 1); clearChapterData(); }}>上一章</Button>
                   <span className="text-xs font-mono tracking-widest bg-slate-100 px-4 py-1.5 rounded-full uppercase text-slate-500 shadow-inner">
                     PAGE {activeChapterIndex + 1} / {chapters.length}
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
