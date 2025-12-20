
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Chapter, AppMode, MODEL_OPTIONS, VOICE_OPTIONS_MAP, TTSModel, TRANSLATION_MODEL_OPTIONS, TranslationModel } from './types';
import { splitTextIntoChapters } from './utils/text-parser';
import { parseEpubFile } from './utils/epub-parser';
import { generateTTS as generateZhipuTTS } from './services/zhipu-tts';
import { generateGeminiTTS } from './services/gemini-tts';
import { generateOpenAITTS } from './services/openai-tts';
import { audioBufferToWav, concatenateAudioBuffers } from './services/audio-service';
import { translateChapter, analyzeParagraph } from './services/translation-service';
import { generateEpub } from './services/epub-service';

// Components
import { WelcomeView } from './components/WelcomeView';
import { Sidebar } from './components/Sidebar';
import { ControlHeader } from './components/ControlHeader';
import { ParagraphItem } from './components/ParagraphItem';
import { MusicalStaff } from './components/MusicalStaff';

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
  
  const [isFullAutoRunning, setIsFullAutoRunning] = useState(false);
  
  const [selectedModel, setSelectedModel] = useState<TTSModel>('gemini-tts');
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS_MAP['gemini-tts'][0].id);
  const [selectedTranslationModel, setSelectedTranslationModel] = useState<TranslationModel>('gemini-3-flash-preview');
  const [translateDirection] = useState<'zh-en' | 'en-zh'>('zh-en');
  
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [paragraphAudios, setParagraphAudios] = useState<Record<number, string>>({});
  const [paragraphBuffers, setParagraphBuffers] = useState<Record<number, AudioBuffer>>({});
  const [translatedParagraphs, setTranslatedParagraphs] = useState<Record<number, string>>({});
  const [paragraphAnalyses, setParagraphAnalyses] = useState<Record<number, string>>({});
  
  const [analyzingIdx, setAnalyzingIdx] = useState<number | null>(null);
  const [playingParagraphIdx, setPlayingParagraphIdx] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null); 
  const paragraphAudioRef = useRef<HTMLAudioElement>(null); 
  const activeUrls = useRef<Set<string>>(new Set());
  const mergedAudioBlobRef = useRef<Blob | null>(null);

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
    setPlayingParagraphIdx(null);
    mergedAudioBlobRef.current = null;
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
        const result = await generateAudioData(paragraphs[i]);
        setParagraphAudios(prev => ({ ...prev, [i]: result.url }));
        setParagraphBuffers(prev => ({ ...prev, [i]: result.buffer }));
      }
    } finally { setIsBatchGenerating(false); }
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

  const handleAnalyzeParagraph = async (idx: number) => {
    setAnalyzingIdx(idx);
    try {
      const targetText = translateDirection === 'zh-en' ? (translatedParagraphs[idx] || paragraphs[idx]) : paragraphs[idx];
      const res = await analyzeParagraph(targetText, selectedTranslationModel);
      setParagraphAnalyses(p => ({ ...p, [idx]: res }));
    } finally { setAnalyzingIdx(null); }
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
    } finally { setIsExporting(false); }
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
      <WelcomeView 
        fileInputRef={fileInputRef}
        handleFileChange={handleFileChange}
        inputText={inputText}
        setInputText={setInputText}
        setChapters={setChapters}
        setMode={setMode}
        setActiveChapterIndex={setActiveChapterIndex}
        clearChapterData={clearChapterData}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <audio ref={paragraphAudioRef} className="hidden" onEnded={() => setPlayingParagraphIdx(null)} />

      <Sidebar 
        chapters={chapters}
        activeChapterIndex={activeChapterIndex}
        setActiveChapterIndex={setActiveChapterIndex}
        setMode={setMode}
        clearChapterData={clearChapterData}
        deleteChapter={deleteChapter}
      />

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <ControlHeader 
          generatedCount={Object.keys(paragraphBuffers).length}
          translatedCount={Object.keys(translatedParagraphs).length}
          totalParagraphs={paragraphs.length}
          handleFullAuto={handleFullAuto}
          isFullAutoRunning={isFullAutoRunning}
          handleExportEpub={handleExportEpub}
          isExporting={isExporting}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          selectedVoice={selectedVoice}
          setSelectedVoice={setSelectedVoice}
          selectedTranslationModel={selectedTranslationModel}
          setSelectedTranslationModel={setSelectedTranslationModel}
          batchGenerateAudio={batchGenerateParagraphs}
          isBatchGenerating={isBatchGenerating}
          handleTranslate={handleTranslateChapter}
          isTranslating={isTranslating}
          handleMerge={mergeExistingParagraphs}
          isMerging={isMerging}
        />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-24 px-12 md:px-20">
            {activeChapter && (
              <>
                <header className="mb-24">
                   <div className="text-[9px] font-black tracking-[0.5em] uppercase opacity-30 mb-3 text-center">当前章节 No. {(activeChapterIndex + 1).toString().padStart(2, '0')}</div>
                   <h1 className="text-5xl md:text-6xl font-black serif-text text-center tracking-tighter leading-tight border-b-2 border-black pb-8 mb-4">{activeChapter.title}</h1>
                   <div className="flex justify-between items-center text-[8px] font-bold uppercase opacity-20 tracking-widest px-1">
                      <span>Gemini 小说工作室 · 珍藏版</span>
                      <span>卷 一</span>
                      <span>创作时间：{new Date().toLocaleDateString()}</span>
                   </div>
                   <MusicalStaff />
                </header>

                <div className="space-y-24">
                  {paragraphs.map((text, idx) => (
                    <ParagraphItem 
                      key={idx}
                      text={text}
                      idx={idx}
                      isPlaying={playingParagraphIdx === idx}
                      hasAudio={!!paragraphAudios[idx]}
                      audioUrl={paragraphAudios[idx]}
                      translation={translatedParagraphs[idx]}
                      analysis={paragraphAnalyses[idx]}
                      isAnalyzing={analyzingIdx === idx}
                      isFullAutoRunning={isFullAutoRunning}
                      playParagraphAudio={playParagraphAudio}
                      handleAnalyzeParagraph={handleAnalyzeParagraph}
                    />
                  ))}
                </div>

                <footer className="mt-48 flex items-center justify-between border-t-2 border-black pt-8 mb-32">
                   <div className="text-3xl font-black serif-text opacity-10 italic">本章完</div>
                   <div className="flex space-x-10">
                      <button disabled={activeChapterIndex === 0} onClick={() => { setActiveChapterIndex(p => p - 1); clearChapterData(); }} className="text-[10px] font-black tracking-widest uppercase disabled:opacity-5 hover:opacity-100 opacity-40 transition-opacity">上一章 PREV</button>
                      <button disabled={activeChapterIndex === chapters.length - 1} onClick={() => { setActiveChapterIndex(p => p + 1); clearChapterData(); }} className="text-[10px] font-black tracking-widest uppercase disabled:opacity-5 hover:opacity-100 opacity-40 transition-opacity">下一章 NEXT</button>
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
