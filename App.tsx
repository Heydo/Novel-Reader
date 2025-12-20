
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Chapter, AppMode, MODEL_OPTIONS, VOICE_OPTIONS_MAP, TTSModel, TRANSLATION_MODEL_OPTIONS, TranslationModel } from './types';
import { splitTextIntoChapters } from './utils/text-parser';
import { parseEpubFile } from './utils/epub-parser';
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

const MusicalStaff: React.FC = () => (
  <div className="flex flex-col space-y-1 my-12 opacity-10">
    <div className="h-px bg-current w-full"></div>
    <div className="h-px bg-current w-full"></div>
    <div className="h-px bg-current w-full"></div>
    <div className="h-px bg-current w-full"></div>
    <div className="h-px bg-current w-full"></div>
  </div>
);

const SimpleMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-4 font-serif text-[15px] leading-relaxed text-[#4a4a4a]">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === '') return <div key={i} className="h-2"></div>;
        return <p key={i}>{line}</p>;
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

  const clearChapterData = useCallback(() => {
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
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    if (paragraphAudioRef.current) { paragraphAudioRef.current.pause(); paragraphAudioRef.current.src = ""; }
  }, []);

  const deleteChapter = (chapterId: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm('确定要移除此章节吗？')) return;
    const idx = chapters.findIndex(c => c.id === chapterId);
    const newChapters = chapters.filter(c => c.id !== chapterId);
    if (newChapters.length === 0) { setMode('welcome'); setChapters([]); return; }
    if (idx === activeChapterIndex) {
      setActiveChapterIndex(Math.min(idx, newChapters.length - 1));
      clearChapterData();
    } else if (idx < activeChapterIndex) {
      setActiveChapterIndex(p => p - 1);
    }
    setChapters(newChapters);
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

  const handleFullAuto = async () => {
    setIsFullAutoRunning(true);
    try {
      await batchGenerateParagraphs();
      const tMap = await handleTranslateChapter();
      await batchAnalyzeParagraphs(tMap);
      await mergeExistingParagraphs();
    } finally { setIsFullAutoRunning(false); }
  };

  const handleTranslateChapter = async () => {
    setIsTranslating(true);
    try {
      const results = await translateChapter(paragraphs, translateDirection, selectedTranslationModel);
      const translatedMap: Record<number, string> = {};
      results.forEach((text, idx) => { translatedMap[idx] = text; });
      setTranslatedParagraphs(translatedMap);
      return translatedMap;
    } finally { setIsTranslating(false); }
  };

  const batchGenerateParagraphs = async () => {
    setIsBatchGenerating(true);
    try {
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphBuffers[i]) continue;
        setGeneratingParagraphIdx(i);
        const result = await generateAudioData(paragraphs[i]);
        setParagraphAudios(prev => ({ ...prev, [i]: result.url }));
        setParagraphBuffers(prev => ({ ...prev, [i]: result.buffer }));
      }
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
      const newUrl = URL.createObjectURL(mergedBlob);
      setAudioUrl(newUrl);
    } finally { setIsMerging(false); }
  };

  const batchAnalyzeParagraphs = async (currentTranslated?: Record<number, string>) => {
    setIsBatchAnalyzing(true);
    const targetTranslated = currentTranslated || translatedParagraphs;
    try {
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphAnalyses[i]) continue;
        const targetText = translateDirection === 'zh-en' ? (targetTranslated[i] || paragraphs[i]) : paragraphs[i];
        setAnalyzingIdx(i);
        const analysis = await analyzeParagraph(targetText, selectedTranslationModel);
        setParagraphAnalyses(prev => ({ ...prev, [i]: analysis }));
      }
    } finally {
      setIsBatchAnalyzing(false);
      setAnalyzingIdx(null);
    }
  };

  const playParagraphAudio = (url: string, index: number) => {
    const player = paragraphAudioRef.current;
    if (!player) return;
    if (playingParagraphIdx === index && !player.paused) { player.pause(); setPlayingParagraphIdx(null); return; }
    player.pause(); player.src = url; player.load(); setPlayingParagraphIdx(index);
    player.play().catch(() => setPlayingParagraphIdx(null));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.name.toLowerCase().endsWith('.epub')) {
      const parsed = await parseEpubFile(file);
      setChapters(parsed);
      setMode('reader'); setActiveChapterIndex(0); clearChapterData();
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setChapters(splitTextIntoChapters(ev.target?.result as string));
        setMode('reader'); setActiveChapterIndex(0); clearChapterData();
      };
      reader.readAsText(file);
    }
  };

  if (mode === 'welcome') {
    return (
      <div className="h-screen w-full flex overflow-hidden relative">
        {/* Poster Style Sidebar Info */}
        <div className="w-16 h-full border-r border-black/10 flex flex-col items-center py-10 space-y-24">
           <div className="rotate-90 origin-center whitespace-nowrap text-[10px] font-black tracking-[0.5em] uppercase opacity-40">Gemini Powered Novel Studio</div>
           <div className="rotate-90 origin-center whitespace-nowrap text-[10px] font-black tracking-[0.5em] uppercase opacity-40">Est. 2024</div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-12 overflow-y-auto">
          <div className="max-w-3xl w-full grid grid-cols-1 md:grid-cols-2 gap-20">
            {/* Left Column: Huge Artistic Title */}
            <div className="flex flex-col justify-center space-y-6">
               <div className="text-[10px] font-black tracking-[0.4em] uppercase opacity-40">Novel · Audio · Vision</div>
               <h1 className="text-8xl font-black serif-text leading-[0.85] tracking-tighter">文学<br/><span className="text-5xl">的</span>结局<br/><span className="italic text-4xl font-normal opacity-60">Music 时分</span></h1>
               <div className="staff-lines !my-4"></div>
               <p className="text-sm font-medium leading-relaxed opacity-60 max-w-xs">集成 Gemini 2.5 拟人语音与 3.0 深度推理，将文字转化为感官的合奏曲。</p>
            </div>

            {/* Right Column: Interaction */}
            <div className="flex flex-col justify-center space-y-10">
               <div 
                 className="group cursor-pointer border-4 border-black p-8 hover:bg-black hover:text-[#e8e4d8] transition-all"
                 onClick={() => fileInputRef.current?.click()}
               >
                 <div className="text-4xl font-black mb-2">UPLOAD</div>
                 <div className="text-[10px] font-black tracking-widest uppercase opacity-60 group-hover:opacity-100">Drop TXT / EPUB Files Here</div>
                 <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".txt,.epub" />
               </div>

               <div className="flex flex-col space-y-4">
                  <textarea 
                    className="w-full h-48 p-6 bg-transparent border-2 border-black/20 focus:border-black outline-none resize-none serif-text text-xl"
                    placeholder="或者，在此粘贴您的文字..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                  />
                  <Button 
                    variant="primary" 
                    size="lg" 
                    disabled={!inputText.trim()}
                    onClick={() => {
                      setChapters(splitTextIntoChapters(inputText));
                      setMode('reader'); setActiveChapterIndex(0); clearChapterData();
                    }}
                  >
                    开始演奏 ENTER STUDIO
                  </Button>
               </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <audio ref={paragraphAudioRef} className="hidden" onEnded={() => setPlayingParagraphIdx(null)} />

      {/* Program List Sidebar */}
      <aside className="w-80 flex-shrink-0 border-r border-black/10 flex flex-col bg-[#dfdbcc]">
        <div className="p-8 border-b border-black/10">
          <div className="text-[10px] font-black tracking-[0.3em] uppercase opacity-40 mb-2">Program List</div>
          <h2 className="text-3xl font-black serif-text tracking-tighter">章节目录</h2>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {chapters.map((chapter, idx) => (
            <div 
              key={chapter.id}
              className={`group flex items-center p-3 cursor-pointer transition-all ${activeChapterIndex === idx ? 'bg-black text-[#e8e4d8]' : 'hover:bg-black/5'}`}
              onClick={() => { setActiveChapterIndex(idx); clearChapterData(); }}
            >
              <span className="w-8 font-black text-[10px] opacity-40">{String(idx + 1).padStart(2, '0')}</span>
              <span className="flex-1 truncate serif-text font-bold">{chapter.title}</span>
              <button 
                onClick={(e) => deleteChapter(chapter.id, e)}
                className="opacity-0 group-hover:opacity-40 hover:!opacity-100 px-2"
              >
                ✕
              </button>
            </div>
          ))}
        </nav>
        <div className="p-8 border-t border-black/10">
           <Button variant="outline" className="w-full" onClick={() => setMode('welcome')}>返回首页 HOME</Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 flex items-center justify-between px-10 border-b border-black/10 z-20 bg-[#e8e4d8]/80 backdrop-blur-md">
           <div className="flex items-center space-x-6">
             <div className="text-[10px] font-black tracking-[0.4em] uppercase opacity-30">Studio Session</div>
             <div className="h-4 w-px bg-black/10"></div>
             <div className="flex space-x-2">
                <Button size="sm" onClick={handleFullAuto} isLoading={isFullAutoRunning}>全自动 FULL AUTO</Button>
                <button 
                  onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                  className={`px-3 py-1 text-[10px] font-black uppercase border-2 border-black ${isSettingsOpen ? 'bg-black text-[#e8e4d8]' : ''}`}
                >
                  配置 SETTINGS
                </button>
             </div>
           </div>

           <div className="flex items-center space-x-6">
             <div className="flex space-x-4 text-[10px] font-black uppercase opacity-40 tracking-widest">
               <span>Audio {Object.keys(paragraphBuffers).length}/{paragraphs.length}</span>
               <span>Trans {Object.keys(translatedParagraphs).length}/{paragraphs.length}</span>
             </div>
           </div>

           {isSettingsOpen && (
             <div className="absolute top-16 right-10 w-80 bg-black text-[#e8e4d8] p-8 space-y-6 z-50 shadow-2xl animate-in fade-in slide-in-from-top-2">
                <div className="space-y-4">
                  <div className="flex flex-col space-y-1">
                    <label className="text-[9px] font-black opacity-50 tracking-widest">TTS MODEL</label>
                    <select value={selectedModel} onChange={e => setSelectedModel(e.target.value as TTSModel)} className="bg-transparent border-b border-[#e8e4d8]/20 py-2 text-xs outline-none focus:border-white">
                      {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id} className="text-black">{m.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="text-[9px] font-black opacity-50 tracking-widest">VOICE</label>
                    <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} className="bg-transparent border-b border-[#e8e4d8]/20 py-2 text-xs outline-none focus:border-white">
                      {VOICE_OPTIONS_MAP[selectedModel].map(v => <option key={v.id} value={v.id} className="text-black">{v.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="text-[9px] font-black opacity-50 tracking-widest">TRANSLATION</label>
                    <select value={selectedTranslationModel} onChange={e => setSelectedTranslationModel(e.target.value as TranslationModel)} className="bg-transparent border-b border-[#e8e4d8]/20 py-2 text-xs outline-none focus:border-white">
                      {TRANSLATION_MODEL_OPTIONS.map(m => <option key={m.id} value={m.id} className="text-black">{m.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="pt-4 border-t border-[#e8e4d8]/10 grid grid-cols-2 gap-2">
                   <button onClick={batchGenerateParagraphs} className="text-[10px] font-black border border-white/20 py-2 hover:bg-white/10">GEN AUDIO</button>
                   <button onClick={handleTranslateChapter} className="text-[10px] font-black border border-white/20 py-2 hover:bg-white/10">TRANSLATE</button>
                   <button onClick={mergeExistingParagraphs} className="text-[10px] font-black border border-white/20 py-2 hover:bg-white/10">MERGE ALL</button>
                   <button onClick={() => setIsSettingsOpen(false)} className="text-[10px] font-black bg-white text-black py-2">CLOSE</button>
                </div>
             </div>
           )}
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-32 px-12">
            {activeChapter && (
              <>
                <header className="mb-32">
                   <div className="text-[10px] font-black tracking-[0.6em] uppercase opacity-20 mb-4 text-center">Movement No. {(activeChapterIndex + 1).toString().padStart(2, '0')}</div>
                   <h1 className="text-7xl font-black serif-text text-center tracking-tighter leading-tight">{activeChapter.title}</h1>
                   <MusicalStaff />
                </header>

                <div className="space-y-40">
                  {paragraphs.map((text, idx) => {
                    const isPlaying = playingParagraphIdx === idx;
                    const hasAudio = !!paragraphAudios[idx];
                    const translation = translatedParagraphs[idx];
                    const analysis = paragraphAnalyses[idx];

                    return (
                      <div key={idx} className="relative group">
                         {/* Dot Decoration like poster */}
                         <div className="absolute -left-12 top-2 w-2 h-2 rounded-full bg-black opacity-10 group-hover:opacity-100 transition-opacity"></div>
                         
                         <div className="flex items-start space-x-10">
                            <button 
                              onClick={() => hasAudio && playParagraphAudio(paragraphAudios[idx], idx)}
                              className={`flex-shrink-0 w-12 h-12 border-2 border-black flex items-center justify-center transition-all ${isPlaying ? 'bg-black text-[#e8e4d8]' : 'hover:bg-black/5'}`}
                            >
                               {isPlaying ? '■' : '▶'}
                            </button>
                            <div className="flex-1 space-y-12">
                               <p className="text-3xl serif-text font-medium leading-[1.6] tracking-tight">{text}</p>
                               
                               {translation && (
                                 <div className="italic text-xl text-black/40 border-l-2 border-black/10 pl-8 leading-relaxed">
                                   {translation}
                                 </div>
                               )}

                               {analysis && (
                                 <div className="bg-black text-[#e8e4d8] p-10 space-y-4">
                                    <div className="text-[10px] font-black tracking-[0.4em] uppercase opacity-40">Analysis Depth</div>
                                    <SimpleMarkdown text={analysis} />
                                 </div>
                               )}

                               {!analysis && !isFullAutoRunning && (
                                 <button 
                                   onClick={() => analyzeParagraph(text, selectedTranslationModel).then(res => setParagraphAnalyses(p => ({...p, [idx]: res})))}
                                   className="text-[10px] font-black tracking-[0.3em] uppercase opacity-20 hover:opacity-100 transition-opacity"
                                 >
                                    [ Request Linguistic Analysis ]
                                 </button>
                               )}
                            </div>
                         </div>
                         <div className="h-px bg-black/5 w-full mt-24"></div>
                      </div>
                    );
                  })}
                </div>

                <footer className="mt-64 flex items-center justify-between border-t-4 border-black pt-10">
                   <div className="text-4xl font-black serif-text opacity-10 italic">Fin.</div>
                   <div className="flex space-x-12">
                      <button disabled={activeChapterIndex === 0} onClick={() => { setActiveChapterIndex(p => p - 1); clearChapterData(); }} className="text-xs font-black tracking-widest uppercase disabled:opacity-10">PREV</button>
                      <button disabled={activeChapterIndex === chapters.length - 1} onClick={() => { setActiveChapterIndex(p => p + 1); clearChapterData(); }} className="text-xs font-black tracking-widest uppercase disabled:opacity-10">NEXT</button>
                   </div>
                </footer>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
