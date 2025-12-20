
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
        result.push(<code key={`code-${match.index}`} className="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-mono text-[0.85em] border border-amber-200 mx-0.5">{match[1]}</code>);
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
        result.push(<em key={`italic-${match.index}`} className="italic text-slate-700">{match[1]}</em>);
        lastIndex = regex.lastIndex;
      }
      result.push(part.substring(lastIndex));
      return result;
    });
    return parts;
  };

  const lines = text.split('\n');
  return (
    <div className="space-y-4">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === '') return <div key={i} className="h-2"></div>;
        if (/^[-*]{3,}$/.test(trimmed)) return <hr key={i} className="my-6 border-amber-200 border-t-2 border-dashed" />;
        const headerMatch = trimmed.match(/^(#{1,4})\s+(.*)/);
        if (headerMatch) {
          const level = headerMatch[1].length;
          const styles = [
            "text-2xl font-black text-amber-950 mb-4 border-b-2 border-amber-200 pb-2",
            "text-xl font-bold text-amber-900 mb-3",
            "text-lg font-bold text-amber-800 mb-2 flex items-center before:content-[''] before:w-1 before:h-4 before:bg-amber-400 before:mr-2 before:rounded",
            "text-base font-bold text-amber-700 mb-1"
          ][level - 1];
          return React.createElement(`h${level}`, { key: i, className: styles }, ...parseInline(headerMatch[2]));
        }
        if (trimmed.startsWith('>')) {
          return (
            <blockquote key={i} className="border-l-4 border-amber-300 bg-amber-50/50 p-4 rounded-r-xl italic text-slate-700 my-4 shadow-sm">
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
  
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  const [isAutoAudioRunning, setIsAutoAudioRunning] = useState(false);
  const [isAutoTransAnalysisRunning, setIsAutoTransAnalysisRunning] = useState(false);
  const [isFullAutoRunning, setIsFullAutoRunning] = useState(false);
  
  const [selectedModel, setSelectedModel] = useState<TTSModel>('gemini-tts');
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS_MAP['gemini-tts'][0].id);
  const [selectedTranslationModel, setSelectedTranslationModel] = useState<TranslationModel>('gemini-3-flash-preview');
  const [translateDirection, setTranslateDirection] = useState<'zh-en' | 'en-zh'>('zh-en');
  
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
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

  const handleAutoAudio = async () => {
    setIsAutoAudioRunning(true);
    try {
      await batchGenerateParagraphs();
      await mergeExistingParagraphs();
    } catch (e) {
       console.error("Auto Audio failed", e);
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
       console.error("Auto Trans/Analysis failed", e);
    } finally {
      setIsAutoTransAnalysisRunning(false);
    }
  };

  const handleFullAuto = async () => {
    setIsFullAutoRunning(true);
    try {
      await Promise.all([handleAutoAudio(), handleAutoTransAnalysis()]);
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
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#fdfdfb]">
        <div className="max-w-4xl w-full flex flex-col items-center space-y-12">
          <div className="text-center space-y-4">
             <div className="inline-flex items-center px-4 py-1.5 bg-indigo-50 rounded-full text-indigo-600 text-xs font-black uppercase tracking-widest mb-4">
               Gemini Powered Novel Studio
             </div>
             <h1 className="text-5xl font-black text-slate-900 tracking-tight serif-text">AI 深度朗读与文学工坊</h1>
             <p className="text-slate-500 text-lg max-w-xl mx-auto leading-relaxed">集成 Gemini 2.5 极致拟人语音与 Gemini 3 Pro 深度文学推理，为您打造沉浸式的多模态阅读体验。</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 w-full max-w-3xl">
            <div 
              className="group relative bg-white border-2 border-slate-100 rounded-3xl p-10 flex flex-col items-center justify-center space-y-6 cursor-pointer hover:border-indigo-400 hover:shadow-2xl transition-all duration-500 overflow-hidden"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/0 via-transparent to-indigo-50/20 group-hover:opacity-100 opacity-0 transition-opacity"></div>
              <div className="w-20 h-20 bg-indigo-600 text-white rounded-[2rem] flex items-center justify-center text-3xl font-bold group-hover:rotate-12 group-hover:scale-110 transition-all shadow-lg shadow-indigo-200">↑</div>
              <div className="text-center">
                <p className="font-black text-xl text-slate-800 mb-2">上传 TXT 文稿</p>
                <p className="text-slate-400 text-sm">自动切分章节，智能识别语境</p>
              </div>
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

            <div className="flex flex-col space-y-6">
              <textarea 
                className="flex-1 p-6 border-2 border-slate-100 rounded-3xl text-sm min-h-[180px] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-inner bg-slate-50/30 resize-none font-serif text-lg leading-relaxed" 
                placeholder="在此粘贴文本片段..." 
                value={inputText} 
                onChange={(e) => setInputText(e.target.value)} 
              />
              <Button onClick={() => {
                if (!inputText.trim()) return;
                setChapters(splitTextIntoChapters(inputText));
                setMode('reader'); setActiveChapterIndex(0); clearChapterData();
              }} disabled={!inputText.trim()} className="w-full py-4 text-base font-black tracking-widest uppercase shadow-xl hover:translate-y-[-2px] active:translate-y-[1px]">进入创作工坊</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const generatedCount = Object.keys(paragraphBuffers).length;
  const translatedCount = Object.keys(translatedParagraphs).length;

  return (
    <div className="flex h-screen bg-white overflow-hidden text-slate-900">
      <audio ref={paragraphAudioRef} className="hidden" onEnded={() => setPlayingParagraphIdx(null)} />

      {/* 侧边栏 */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-100 bg-slate-50/50 flex flex-col z-10">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-black text-lg text-slate-800 tracking-tight serif-text">章节目录</h2>
          <button onClick={() => setMode('welcome')} className="text-[10px] font-black uppercase text-slate-400 hover:text-rose-500 transition-colors">退出</button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {chapters.map((chapter, index) => (
            <button 
              key={chapter.id} 
              onClick={() => { setActiveChapterIndex(index); clearChapterData(); }} 
              className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all flex items-center group ${activeChapterIndex === index ? 'bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-100' : 'text-slate-500 hover:bg-white hover:shadow-sm'}`}
            >
              <span className={`w-6 font-mono text-[10px] opacity-50 ${activeChapterIndex === index ? 'text-indigo-200' : ''}`}>{(index + 1).toString().padStart(2, '0')}</span>
              <span className="truncate flex-1">{chapter.title}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* 主阅读区域 */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* 极简单层工具栏 */}
        <header className="sticky top-0 z-40 flex items-center justify-between px-6 h-14 bg-white/80 backdrop-blur-md border-b border-slate-100 shadow-sm">
          <div className="flex items-center space-x-4">
            <h1 className="font-black text-sm tracking-widest uppercase text-slate-400 serif-text truncate max-w-[200px] hidden md:block">
              {activeChapter?.title}
            </h1>
            <div className="h-4 w-px bg-slate-100 hidden md:block"></div>
            {/* 核心工作流按钮 */}
            <div className="flex items-center space-x-1">
              <Button 
                size="sm" 
                onClick={handleFullAuto} 
                isLoading={isFullAutoRunning} 
                className="rounded-full px-4 h-9 font-black text-[10px] uppercase tracking-widest shadow-md shadow-indigo-100 border-none bg-indigo-600 hover:bg-indigo-700"
              >
                {isFullAutoRunning ? '自动生成中' : '全自动处理'}
              </Button>
              <Button 
                variant="outline"
                size="sm" 
                onClick={handleExportEpub} 
                isLoading={isExporting} 
                className="rounded-full px-4 h-9 font-black text-[10px] uppercase tracking-widest border-emerald-100 text-emerald-600 hover:bg-emerald-50"
              >
                导出 EPUB
              </Button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* 状态展示 */}
            <div className="flex items-center space-x-3 bg-slate-50 px-4 h-9 rounded-full border border-slate-100 transition-all hover:bg-indigo-50/50">
               <div className="flex items-center space-x-1.5" title="音频合成进度">
                 <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></div>
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Audio {generatedCount}/{paragraphs.length}</span>
               </div>
               <div className="flex items-center space-x-1.5" title="翻译进度">
                 <div className="w-1.5 h-1.5 bg-violet-400 rounded-full"></div>
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Trans {translatedCount}/{paragraphs.length}</span>
               </div>
            </div>

            <div className="h-4 w-px bg-slate-100"></div>

            {/* 设置与分步操作 */}
            <div className="flex items-center space-x-1">
              <button 
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`w-9 h-9 flex items-center justify-center rounded-full transition-all border ${isSettingsOpen ? 'bg-indigo-50 border-indigo-200 text-indigo-600 ring-2 ring-indigo-50' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              </button>
            </div>
          </div>

          {/* 设置浮层 */}
          {isSettingsOpen && (
            <div className="absolute top-16 right-6 w-80 bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 space-y-6 animate-in zoom-in-95 duration-200 origin-top-right">
              <div className="space-y-4">
                <div className="flex flex-col space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">TTS 引擎与音色</label>
                  <div className="grid grid-cols-1 gap-2">
                    <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as TTSModel)} className="w-full bg-slate-50 border border-slate-100 rounded-xl text-xs px-3 py-2 font-bold outline-none">
                      {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-xl text-xs px-3 py-2 font-bold outline-none">
                      {VOICE_OPTIONS_MAP[selectedModel].map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">翻译模型与方向</label>
                  <div className="flex flex-col space-y-2">
                    <select value={selectedTranslationModel} onChange={(e) => setSelectedTranslationModel(e.target.value as TranslationModel)} className="w-full bg-slate-50 border border-slate-100 rounded-xl text-xs px-3 py-2 font-bold outline-none">
                      {TRANSLATION_MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button 
                      onClick={() => setTranslateDirection(translateDirection === 'zh-en' ? 'en-zh' : 'zh-en')}
                      className="w-full h-10 flex items-center justify-center bg-indigo-50 text-indigo-700 rounded-xl text-xs font-black transition-all hover:bg-indigo-100 group active:scale-95"
                    >
                      <span className="mr-2 opacity-60">方向:</span>
                      <span className="flex items-center space-x-2">
                         <span className={translateDirection === 'zh-en' ? 'text-indigo-900' : 'text-slate-400'}>{translateDirection === 'zh-en' ? '中文' : '英文'}</span>
                         <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                         <span className={translateDirection === 'en-zh' ? 'text-indigo-900' : 'text-slate-400'}>{translateDirection === 'zh-en' ? '英文' : '中文'}</span>
                      </span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="h-px bg-slate-100"></div>
              <div className="grid grid-cols-2 gap-2">
                 <Button variant="outline" size="sm" onClick={batchGenerateParagraphs} isLoading={isBatchGenerating} className="text-[10px] font-black uppercase tracking-widest rounded-xl border-slate-200">分步:音频</Button>
                 <Button variant="outline" size="sm" onClick={handleTranslateChapter} isLoading={isTranslating} className="text-[10px] font-black uppercase tracking-widest rounded-xl border-slate-200">分步:翻译</Button>
                 <Button variant="outline" size="sm" onClick={() => batchAnalyzeParagraphs()} isLoading={isBatchAnalyzing} className="text-[10px] font-black uppercase tracking-widest rounded-xl border-slate-200">分步:解析</Button>
                 <Button variant="outline" size="sm" onClick={mergeExistingParagraphs} isLoading={isMerging} className="text-[10px] font-black uppercase tracking-widest rounded-xl border-slate-200">拼接音轨</Button>
              </div>
            </div>
          )}
        </header>

        {/* 内容展示区 */}
        <div className="flex-1 overflow-y-auto bg-white">
          <article className="max-w-4xl mx-auto py-20 px-10 md:px-16 animate-in fade-in duration-700">
            {activeChapter ? (
              <>
                <header className="mb-20 text-center">
                  <div className="text-[10px] font-black tracking-[0.4em] text-slate-200 uppercase mb-4">Chapter {(activeChapterIndex + 1).toString().padStart(2, '0')}</div>
                  <h1 className="text-5xl font-black text-slate-900 serif-text tracking-tight">{activeChapter.title}</h1>
                </header>

                {audioUrl && (
                  <div className="mb-16 bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100 flex items-center justify-between shadow-sm animate-in slide-in-from-top-4">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"></path></svg>
                      </div>
                      <span className="text-xs font-black text-indigo-700 uppercase tracking-widest">章节精选音轨</span>
                    </div>
                    <audio ref={audioRef} controls src={audioUrl} className="h-10" />
                  </div>
                )}

                {errorDetail && (
                  <div className="mb-10 bg-rose-50 p-4 rounded-2xl border border-rose-100 text-[11px] font-black text-rose-600 uppercase flex items-center space-x-3">
                    <span className="text-lg">⚠️</span>
                    <span>{errorDetail.explanation}: {errorDetail.message}</span>
                  </div>
                )}

                <div className="serif-text space-y-24">
                  {paragraphs.map((pText, idx) => {
                    const isPlaying = playingParagraphIdx === idx;
                    const hasAudio = !!paragraphAudios[idx];
                    const translation = translatedParagraphs[idx];
                    const analysis = paragraphAnalyses[idx];
                    const isAnalyzingP = analyzingIdx === idx;
                    const isCollapsed = collapsedAnalyses[idx] || false;

                    return (
                      <div key={idx} className={`relative flex flex-col space-y-8 transition-all duration-700 ${isPlaying ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}>
                        {/* 正文与播放控制 */}
                        <div className="flex items-start space-x-6">
                           <button 
                            onClick={() => hasAudio ? playParagraphAudio(paragraphAudios[idx], idx) : null} 
                            disabled={!hasAudio && !isFullAutoRunning}
                            className={`flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-2xl transition-all ${isPlaying ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100 scale-110' : hasAudio ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'bg-slate-50 text-slate-200'}`}
                          >
                            {isPlaying ? (
                              <svg className="w-5 h-5 animate-pulse" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>
                            ) : (
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
                            )}
                          </button>
                          <p className={`text-2xl leading-relaxed text-slate-800 tracking-wide transition-all ${isPlaying ? 'font-medium' : ''}`}>
                            {pText}
                          </p>
                        </div>
                        
                        {/* 译文 */}
                        {translation && (
                          <div className="ml-18 p-6 bg-slate-50/50 rounded-2xl border border-slate-100 italic text-lg text-slate-500 leading-relaxed animate-in fade-in duration-700">
                            {translation}
                          </div>
                        )}

                        {/* 解析卡片 */}
                        {analysis && (
                          <div className="ml-18 border border-amber-100 rounded-3xl overflow-hidden bg-amber-50/30">
                            <button 
                              onClick={() => setCollapsedAnalyses(prev => ({ ...prev, [idx]: !prev[idx] }))}
                              className="w-full flex items-center justify-between px-6 py-4 hover:bg-amber-100/30 transition-colors"
                            >
                              <div className="flex items-center space-x-3">
                                <span className="w-2 h-2 bg-amber-400 rounded-full"></span>
                                <span className="text-[10px] font-black uppercase text-amber-700 tracking-widest">文学深度解析</span>
                              </div>
                              <span className="text-amber-400 transform transition-transform duration-300">
                                {isCollapsed ? '展开' : '收起'}
                              </span>
                            </button>
                            {!isCollapsed && (
                              <div className="px-6 pb-6 animate-in slide-in-from-top-4 duration-500">
                                <SimpleMarkdown text={analysis} />
                              </div>
                            )}
                          </div>
                        )}

                        {!analysis && !isFullAutoRunning && (
                           <div className="flex justify-end pr-4">
                             <button 
                              onClick={() => handleAnalyzeParagraph(idx)}
                              className="text-[10px] font-black uppercase tracking-widest text-slate-300 hover:text-indigo-400 transition-colors"
                             >
                               {isAnalyzingP ? '分析中...' : '深度解析本段'}
                             </button>
                           </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <footer className="mt-40 pt-10 border-t border-slate-100 flex items-center justify-between text-slate-300 font-black text-[10px] uppercase tracking-[0.3em] pb-32">
                   <button disabled={activeChapterIndex === 0} onClick={() => { setActiveChapterIndex(activeChapterIndex - 1); clearChapterData(); }} className="hover:text-indigo-500 disabled:opacity-30">Previous</button>
                   <span className="text-slate-200">{activeChapterIndex + 1} / {chapters.length}</span>
                   <button disabled={activeChapterIndex === chapters.length - 1} onClick={() => { setActiveChapterIndex(activeChapterIndex + 1); clearChapterData(); }} className="hover:text-indigo-500 disabled:opacity-30">Next</button>
                </footer>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-slate-200">
                <span className="text-4xl mb-4">📑</span>
                <span className="text-[10px] font-black uppercase tracking-widest">请选择章节开始阅读</span>
              </div>
            )}
          </article>
        </div>
      </main>
    </div>
  );
}
