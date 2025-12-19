
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
          const styles = [
            "text-2xl font-black text-amber-950 mb-4 border-b-2 border-amber-300 pb-2",
            "text-xl font-bold text-amber-900 mb-3 border-b border-amber-200 pb-1",
            "text-lg font-bold text-amber-800 mb-2 flex items-center",
            "text-base font-bold text-amber-800 mb-1 flex items-center opacity-85"
          ][level - 1];
          return React.createElement(`h${level}`, { key: i, className: styles }, ...parseInline(headerMatch[2]));
        }
        if (trimmed.startsWith('>')) {
          return (
            <blockquote key={i} className="border-l-4 border-amber-400/60 bg-white/50 p-4 rounded-r-xl italic text-slate-700 shadow-sm my-4">
               {parseInline(trimmed.replace(/^>\s?/, ''))}
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
  
  // Composite automation status
  const [isAutoAudioRunning, setIsAutoAudioRunning] = useState(false);
  const [isAutoTransAnalysisRunning, setIsAutoTransAnalysisRunning] = useState(false);
  const [isFullAutoRunning, setIsFullAutoRunning] = useState(false);
  
  const [selectedModel, setSelectedModel] = useState<TTSModel>('glm-tts');
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS_MAP['glm-tts'][0].id);
  const [selectedTranslationModel, setSelectedTranslationModel] = useState<TranslationModel>('gemini-3-flash-preview');
  const [translateDirection, setTranslateDirection] = useState<'zh-en' | 'en-zh'>('zh-en');
  
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  // Refs
  // Fixed ReferenceError: moved initialization before any possible access
  const mergedAudioBlobRef = useRef<Blob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null); 
  const paragraphAudioRef = useRef<HTMLAudioElement>(null); 
  const activeUrls = useRef<Set<string>>(new Set());
  
  const [paragraphAudios, setParagraphAudios] = useState<Record<number, string>>({});
  const [paragraphBuffers, setParagraphBuffers] = useState<Record<number, AudioBuffer>>({});
  const [translatedParagraphs, setTranslatedParagraphs] = useState<Record<number, string>>({});
  const [paragraphAnalyses, setParagraphAnalyses] = useState<Record<number, string>>({});
  const [collapsedAnalyses, setCollapsedAnalyses] = useState<Record<number, boolean>>({});
  
  const [analyzingIdx, setAnalyzingIdx] = useState<number | null>(null);
  const [generatingParagraphIdx, setGeneratingParagraphIdx] = useState<number | null>(null);
  const [playingParagraphIdx, setPlayingParagraphIdx] = useState<number | null>(null);

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
    if (mergedAudioBlobRef.current) mergedAudioBlobRef.current = null;
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
    setIsAutoAudioRunning(false);
    setIsAutoTransAnalysisRunning(false);
    setIsFullAutoRunning(false);
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

  // Base actions
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
      throw err;
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
        const targetText = translateDirection === 'zh-en' ? (targetTranslated[i] || paragraphs[i]) : paragraphs[i];
        if (!targetText) continue;
        setAnalyzingIdx(i);
        const analysis = await analyzeParagraph(targetText, selectedTranslationModel);
        setParagraphAnalyses(prev => ({ ...prev, [i]: analysis }));
        setCollapsedAnalyses(prev => ({ ...prev, [i]: false }));
      }
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
      throw err;
    } finally {
      setIsBatchAnalyzing(false);
      setAnalyzingIdx(null);
    }
  };

  const handleAnalyzeParagraph = async (idx: number) => {
    setErrorDetail(null);
    setAnalyzingIdx(idx);
    try {
      const targetText = translateDirection === 'zh-en' 
        ? (translatedParagraphs[idx] || paragraphs[idx]) 
        : paragraphs[idx];
      const analysis = await analyzeParagraph(targetText, selectedTranslationModel);
      setParagraphAnalyses(prev => ({ ...prev, [idx]: analysis }));
      setCollapsedAnalyses(prev => ({ ...prev, [idx]: false }));
    } catch (err: any) {
      setErrorDetail(getErrorExplanation(err));
    } finally {
      setAnalyzingIdx(null);
    }
  };

  // Composite automation workflows
  const handleAutoAudio = async () => {
    setIsAutoAudioRunning(true);
    try {
      await batchGenerateParagraphs();
      await mergeExistingParagraphs();
    } catch (e) {
       console.error("Auto Audio workflow failed", e);
    } finally {
      setIsAutoAudioRunning(false);
    }
  };

  const handleAutoTransAnalysis = async () => {
    setIsAutoTransAnalysisRunning(true);
    try {
      const tMap = await handleTranslateChapter();
      await batchAnalyzeParagraphs(tMap);
    } catch (e) {
       console.error("Auto Translation workflow failed", e);
    } finally {
      setIsAutoTransAnalysisRunning(false);
    }
  };

  const handleFullAuto = async () => {
    setIsFullAutoRunning(true);
    try {
      await handleAutoAudio();
      await handleAutoTransAnalysis();
    } catch (e) {
       console.error("Full Auto workflow failed", e);
    } finally {
      setIsFullAutoRunning(false);
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
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-2xl p-8 space-y-8 border border-slate-200">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">AI 精准小说朗读器</h1>
            <p className="text-slate-500 font-medium">超高音质 TTS 与多维语言深度解析</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-8 border-2 border-dashed border-slate-300 rounded-2xl hover:border-indigo-500 hover:bg-indigo-50/30 transition-all flex flex-col items-center justify-center space-y-4 cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
              <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center text-3xl font-bold group-hover:scale-110 transition-transform">↑</div>
              <p className="font-bold text-slate-700">上传 TXT 小说</p>
              <input type="file" ref={fileInputRef} onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                  setChapters(splitTextIntoChapters(event.target?.result as string));
                  setMode('reader'); setActiveChapterIndex(0); clearChapterData();
                };
                reader.readAsText(file);
              }} className="hidden" accept=".txt" />
            </div>
            <div className="flex flex-col space-y-4">
              <textarea className="flex-1 p-4 border rounded-xl text-sm min-h-[160px] focus:ring-2 focus:ring-indigo-500 outline-none shadow-inner" placeholder="粘贴文本进行阅读..." value={inputText} onChange={(e) => setInputText(e.target.value)} />
              <Button onClick={() => {
                if (!inputText.trim()) return;
                setChapters(splitTextIntoChapters(inputText));
                setMode('reader'); setActiveChapterIndex(0); clearChapterData();
              }} disabled={!inputText.trim()} className="w-full py-3 shadow-lg">进入阅读模式</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const generatedCount = Object.keys(paragraphBuffers).length;
  const analyzedCount = Object.keys(paragraphAnalyses).length;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-900">
      <audio ref={paragraphAudioRef} className="hidden" onEnded={() => setPlayingParagraphIdx(null)} />

      <aside className="w-64 md:w-80 flex-shrink-0 border-r bg-white flex flex-col shadow-xl z-10">
        <div className="p-6 border-b flex items-center justify-between bg-white sticky top-0">
          <h2 className="font-black text-lg text-slate-800 tracking-tight">章节目录</h2>
          <Button variant="outline" size="sm" onClick={() => setMode('welcome')} className="text-xs">退出</Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-thin">
          {chapters.map((chapter, index) => (
            <button key={chapter.id} onClick={() => { setActiveChapterIndex(index); clearChapterData(); }} className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all ${activeChapterIndex === index ? 'bg-indigo-600 text-white font-bold shadow-lg transform scale-[1.02]' : 'text-slate-600 hover:bg-slate-100'}`}>
              <div className="flex items-center space-x-3">
                <span className={`opacity-70 font-mono text-xs ${activeChapterIndex === index ? 'text-indigo-200' : ''}`}>{index + 1}</span>
                <span className="truncate">{chapter.title}</span>
              </div>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div className="sticky top-0 z-30 flex flex-col shadow-md bg-white border-b">
          {/* Row 1: TTS Controls */}
          <div className="flex flex-col lg:flex-row items-center justify-between px-6 py-3 border-b border-slate-50 gap-4">
            <div className="flex items-center space-x-4">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-black uppercase mb-1 ml-1 tracking-wider">朗读模型与音色</span>
                <div className="flex space-x-2">
                  <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as TTSModel)} className="bg-slate-50 border border-slate-200 rounded-lg text-xs px-3 py-2 font-medium focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer hover:bg-white transition-colors">
                    {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg text-xs px-3 py-2 font-medium focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer hover:bg-white transition-colors">
                    {VOICE_OPTIONS_MAP[selectedModel].map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Button size="sm" variant="outline" onClick={batchGenerateParagraphs} isLoading={isBatchGenerating} disabled={isFullAutoRunning || isAutoAudioRunning} className="px-4 text-xs">
                {isBatchGenerating ? `合成中 (${generatedCount}/${paragraphs.length})` : '批量TTS合成'}
              </Button>
              <Button size="sm" variant="outline" onClick={mergeExistingParagraphs} isLoading={isMerging} disabled={isFullAutoRunning || isAutoAudioRunning || generatedCount === 0} className="px-4 text-xs">拼接当前音频</Button>
              <div className="w-px h-6 bg-slate-200 mx-2"></div>
              <Button size="sm" onClick={handleAutoAudio} isLoading={isAutoAudioRunning} disabled={isFullAutoRunning} className="px-5 text-xs bg-indigo-500 hover:bg-indigo-600">
                {isAutoAudioRunning ? `自动朗读中 (${generatedCount}/${paragraphs.length})` : '自动完成朗读流程'}
              </Button>
            </div>
          </div>

          {/* Row 2: Translation & Analysis Controls */}
          <div className="flex flex-col lg:flex-row items-center justify-between px-6 py-3 border-b border-slate-50 bg-slate-50/30 gap-4">
            <div className="flex items-center space-x-4">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-black uppercase mb-1 ml-1 tracking-wider">翻译与解析设置</span>
                <div className="flex items-center space-x-2">
                  <select value={selectedTranslationModel} onChange={(e) => setSelectedTranslationModel(e.target.value as TranslationModel)} className="bg-white border border-slate-200 rounded-lg text-xs px-3 py-2 font-medium shadow-sm">
                    {TRANSLATION_MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <button onClick={() => setTranslateDirection(translateDirection === 'zh-en' ? 'en-zh' : 'zh-en')} className="px-4 py-2 text-[11px] font-bold text-violet-600 bg-white border border-violet-100 shadow-sm rounded-lg transition-all hover:bg-violet-50">
                    {translateDirection === 'zh-en' ? '中 → 英' : '英 → 中'}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Button size="sm" variant="outline" onClick={handleTranslateChapter} isLoading={isTranslating} disabled={isFullAutoRunning || isAutoTransAnalysisRunning} className="px-4 text-xs text-violet-600 border-violet-200 hover:bg-violet-50">执行全文翻译</Button>
              <Button size="sm" variant="outline" onClick={() => batchAnalyzeParagraphs()} isLoading={isBatchAnalyzing} disabled={isFullAutoRunning || isAutoTransAnalysisRunning} className="px-4 text-xs text-violet-600 border-violet-200 hover:bg-violet-50">
                {isBatchAnalyzing ? `解析中 (${analyzedCount}/${paragraphs.length})` : '批量深度解析'}
              </Button>
              <div className="w-px h-6 bg-slate-200 mx-2"></div>
              <Button size="sm" onClick={handleAutoTransAnalysis} isLoading={isAutoTransAnalysisRunning} disabled={isFullAutoRunning} className="px-5 text-xs bg-violet-600 hover:bg-violet-700">
                {isAutoTransAnalysisRunning ? `自动解析中 (${analyzedCount}/${paragraphs.length})` : '自动完成翻译和解析流程'}
              </Button>
            </div>
          </div>

          {/* Row 3: Final Global Operations */}
          <div className="flex items-center justify-between px-6 py-2 bg-slate-100/50">
            <div className="flex items-center space-x-2">
               <div className="flex items-center space-x-1.5 bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm">
                 <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                 <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">全章进度: 音频({generatedCount}/{paragraphs.length}) 解析({analyzedCount}/{paragraphs.length})</span>
               </div>
            </div>
            <div className="flex items-center space-x-3">
              <Button size="sm" onClick={handleFullAuto} isLoading={isFullAutoRunning} className="px-8 font-black text-xs uppercase tracking-widest bg-gradient-to-r from-indigo-600 via-violet-600 to-rose-600 hover:scale-105 active:scale-95 transition-all shadow-xl border-none">
                {isFullAutoRunning ? '全流程处理中...' : '全流程自动完成'}
              </Button>
              <div className="w-px h-8 bg-slate-300 mx-1"></div>
              <Button size="sm" variant="outline" onClick={handleExportEpub} isLoading={isExporting} disabled={!activeChapter} className="px-6 text-xs font-black text-emerald-700 border-emerald-300 hover:bg-emerald-50 bg-white shadow-lg">
                导出 EPUB 电子书
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-10 flex justify-center bg-slate-50 scroll-smooth">
          <article className="max-w-4xl w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32">
            {activeChapter ? (
              <>
                <header className="border-b pb-8 px-4 flex flex-col space-y-4">
                  <h1 className="text-4xl font-black text-slate-900 serif-text tracking-tight">{activeChapter.title}</h1>
                  <p className="text-slate-400 text-xs font-mono tracking-[0.3em] uppercase">Chapter {activeChapterIndex + 1} / {chapters.length}</p>
                </header>
                
                {audioUrl && (
                  <div className="mx-4 sticky top-4 z-20 bg-white/95 backdrop-blur-md p-5 rounded-2xl border border-indigo-200 shadow-2xl flex flex-col space-y-3 animate-in slide-in-from-top-4">
                    <div className="flex items-center justify-between px-1">
                      <p className="text-[10px] font-black text-indigo-700 uppercase tracking-[0.2em] flex items-center">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full mr-2 animate-pulse"></span>
                        已就绪: 全章同步朗读
                      </p>
                      <button onClick={() => setAudioUrl(null)} className="text-slate-300 hover:text-rose-500 transition-colors">✕</button>
                    </div>
                    <div className="flex items-center space-x-4">
                      <audio ref={audioRef} controls src={audioUrl} className="flex-1 h-12" />
                      <a href={audioUrl} download={`${activeChapter.title}.wav`} className="w-12 h-12 flex items-center justify-center bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-lg hover:rotate-3 active:scale-90">
                        ↓
                      </a>
                    </div>
                  </div>
                )}

                {errorDetail && (
                  <div className="mx-4 bg-rose-50 text-rose-800 p-5 rounded-2xl border border-rose-200 text-sm font-medium flex items-center space-x-3 shadow-sm border-l-4 border-l-rose-500">
                    <span className="text-xl">⚠️</span>
                    <div>{errorDetail.explanation}</div>
                  </div>
                )}

                <div className="serif-text text-xl leading-relaxed text-slate-800 space-y-10 px-4">
                  {paragraphs.map((pText, idx) => {
                    const isPlaying = playingParagraphIdx === idx;
                    const hasAudio = !!paragraphAudios[idx];
                    const translation = translatedParagraphs[idx];
                    const analysis = paragraphAnalyses[idx];
                    const isAnalyzingP = analyzingIdx === idx;
                    const isCollapsed = collapsedAnalyses[idx] || false;

                    return (
                      <div key={idx} className={`relative flex items-start space-x-6 p-6 rounded-3xl border transition-all duration-500 ${isPlaying ? 'bg-indigo-50/80 border-indigo-300 shadow-2xl ring-1 ring-indigo-200 scale-[1.01]' : 'bg-white border-slate-100 hover:border-slate-300 shadow-sm'}`}>
                        <div className="flex-shrink-0 flex flex-col items-center space-y-4 pt-1">
                          <button onClick={() => hasAudio ? playParagraphAudio(paragraphAudios[idx], idx) : null} disabled={!hasAudio} className={`w-14 h-14 flex items-center justify-center rounded-2xl transition-all ${isPlaying ? 'bg-indigo-600 text-white shadow-xl scale-110' : hasAudio ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200 shadow-sm' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}>
                            {isPlaying ? <span className="text-xl">■</span> : <span className="text-xl ml-1">▶</span>}
                          </button>
                          <span className={`text-[10px] font-mono tracking-widest ${hasAudio ? 'text-indigo-500 font-black' : 'text-slate-300 font-bold'}`}>#{idx + 1}</span>
                        </div>
                        
                        <div className="flex-1 space-y-6">
                          <p className={`whitespace-pre-wrap transition-colors duration-500 text-2xl leading-[1.8] ${isPlaying ? 'text-indigo-950 font-semibold' : 'text-slate-800'}`}>
                            {pText}
                          </p>
                          
                          {translation && (
                            <div className="p-6 bg-slate-50/80 rounded-2xl border border-slate-200/50 text-lg text-slate-500 italic leading-relaxed animate-in fade-in slide-in-from-left-4 shadow-inner border-l-4 border-l-indigo-200">
                              {translation}
                            </div>
                          )}

                          {analysis && (
                            <div className="bg-amber-50/30 rounded-[2rem] border-2 border-amber-200/40 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                              <div onClick={() => setCollapsedAnalyses(prev => ({ ...prev, [idx]: !prev[idx] }))} className="flex items-center justify-between p-5 cursor-pointer hover:bg-amber-100/30 transition-colors border-b border-amber-100/50 select-none">
                                <div className="flex items-center space-x-3 text-amber-900 font-black tracking-tight">
                                  <span className="w-1.5 h-6 bg-amber-400 rounded-full"></span>
                                  <span className="serif-text text-lg">AI 深度学习解析</span>
                                </div>
                                <div className="flex items-center space-x-2 text-[10px] font-black uppercase text-amber-600/60 tracking-widest">
                                  <span>{isCollapsed ? '展开分析' : '折叠分析'}</span>
                                  <span className={`transform transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`}>▼</span>
                                </div>
                              </div>
                              {!isCollapsed && (
                                <div className="p-8 pt-4 text-base leading-relaxed animate-in slide-in-from-top-4 duration-500">
                                  <SimpleMarkdown text={analysis} />
                                </div>
                              )}
                            </div>
                          )}

                          {!analysis && !isFullAutoRunning && !isAutoTransAnalysisRunning && (
                            <div className="flex justify-end pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <Button size="sm" variant="outline" onClick={() => handleAnalyzeParagraph(idx)} isLoading={isAnalyzingP} className="text-[10px] py-1 h-8 rounded-full border-indigo-200 text-indigo-600 hover:bg-indigo-50 px-4 font-bold uppercase tracking-widest">
                                 {isAnalyzingP ? '分析中...' : '单段 AI 解析'}
                               </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                <footer className="pt-20 mx-4 flex justify-between items-center text-slate-400 border-t border-slate-200 pb-32">
                   <Button variant="outline" disabled={activeChapterIndex === 0} onClick={() => { setActiveChapterIndex(activeChapterIndex - 1); clearChapterData(); }} className="px-8 rounded-full">上一章</Button>
                   <div className="flex flex-col items-center">
                     <span className="text-[10px] font-black tracking-[0.5em] text-slate-300 mb-1">阅读进度</span>
                     <span className="text-sm font-black font-mono tracking-widest bg-slate-100 px-6 py-2 rounded-full text-slate-600 shadow-inner">
                       {activeChapterIndex + 1} / {chapters.length}
                     </span>
                   </div>
                   <Button variant="outline" disabled={activeChapterIndex === chapters.length - 1} onClick={() => { setActiveChapterIndex(activeChapterIndex + 1); clearChapterData(); }} className="px-8 rounded-full">下一章</Button>
                </footer>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-96 text-slate-300 space-y-4">
                <div className="text-6xl opacity-20">📖</div>
                <p className="font-bold tracking-widest uppercase text-xs opacity-50">请从侧边栏选择章节</p>
              </div>
            )}
          </article>
        </div>
      </main>
    </div>
  );
}
