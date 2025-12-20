
import React from 'react';
import { Button } from './Button';
import { TTSModel, TranslationModel, MODEL_OPTIONS, TRANSLATION_MODEL_OPTIONS, VOICE_OPTIONS_MAP } from '../types';

interface ControlHeaderProps {
  generatedCount: number;
  translatedCount: number;
  totalParagraphs: number;
  handleFullAuto: () => void;
  isFullAutoRunning: boolean;
  handleExportEpub: () => void;
  isExporting: boolean;

  // Configuration props
  selectedModel: TTSModel;
  setSelectedModel: (val: TTSModel) => void;
  selectedVoice: string;
  setSelectedVoice: (val: string) => void;
  selectedTranslationModel: TranslationModel;
  setSelectedTranslationModel: (val: TranslationModel) => void;
  
  // Action props
  batchGenerateAudio: () => void;
  isBatchGenerating: boolean;
  handleTranslate: () => void;
  isTranslating: boolean;
  handleMerge: () => void;
  isMerging: boolean;
}

export const ControlHeader: React.FC<ControlHeaderProps> = ({
  generatedCount,
  translatedCount,
  totalParagraphs,
  handleFullAuto,
  isFullAutoRunning,
  handleExportEpub,
  isExporting,
  selectedModel,
  setSelectedModel,
  selectedVoice,
  setSelectedVoice,
  selectedTranslationModel,
  setSelectedTranslationModel,
  batchGenerateAudio,
  isBatchGenerating,
  handleTranslate,
  isTranslating,
  handleMerge,
  isMerging
}) => {
  return (
    <header className="flex flex-col border-b border-black/10 z-20 bg-white/95 backdrop-blur-md">
      {/* Top Bar: Actions & Status */}
      <div className="h-16 flex items-center justify-between px-10 border-b border-black/5">
        <div className="flex items-center space-x-6">
          <div className="text-[10px] font-black tracking-[0.4em] uppercase opacity-30 text-black">创作工坊</div>
          <div className="h-4 w-px bg-black/10"></div>
          <div className="flex space-x-2">
            <Button size="sm" onClick={handleFullAuto} isLoading={isFullAutoRunning}>
              {isFullAutoRunning ? '自动处理中...' : '一键全自动处理'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportEpub} isLoading={isExporting}>
              导出电子书 EPUB
            </Button>
          </div>
        </div>

        <div className="flex items-center space-x-8">
          <div className="flex space-x-6 text-[10px] font-black uppercase opacity-40 tracking-widest text-black">
            <div className="flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-black"></span>
              <span>音频生成 {generatedCount}/{totalParagraphs}</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full border border-black"></span>
              <span>文本翻译 {translatedCount}/{totalParagraphs}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Bar: Fixed Settings */}
      <div className="h-14 flex items-center px-10 bg-gray-50 space-x-8">
        <div className="flex items-center space-x-4">
          <label className="text-[9px] font-black opacity-40 tracking-widest uppercase text-black">语音引擎</label>
          <select 
            value={selectedModel} 
            onChange={e => setSelectedModel(e.target.value as TTSModel)} 
            className="bg-transparent border-b border-black/10 py-1 text-[11px] font-bold outline-none focus:border-black transition-colors text-black"
          >
            {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="flex items-center space-x-4">
          <label className="text-[9px] font-black opacity-40 tracking-widest uppercase text-black">音色</label>
          <select 
            value={selectedVoice} 
            onChange={e => setSelectedVoice(e.target.value)} 
            className="bg-transparent border-b border-black/10 py-1 text-[11px] font-bold outline-none focus:border-black transition-colors min-w-[100px] text-black"
          >
            {VOICE_OPTIONS_MAP[selectedModel].map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>

        <div className="flex items-center space-x-4">
          <label className="text-[9px] font-black opacity-40 tracking-widest uppercase text-black">解析模型</label>
          <select 
            value={selectedTranslationModel} 
            onChange={e => setSelectedTranslationModel(e.target.value as TranslationModel)} 
            className="bg-transparent border-b border-black/10 py-1 text-[11px] font-bold outline-none focus:border-black transition-colors text-black"
          >
            {TRANSLATION_MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="flex-1"></div>

        <div className="flex items-center space-x-2">
          <button 
            onClick={batchGenerateAudio} 
            disabled={isBatchGenerating}
            className="px-3 py-1.5 text-[9px] font-black border border-black/10 hover:bg-black hover:text-white transition-all disabled:opacity-20 uppercase text-black"
          >
            {isBatchGenerating ? '生成中...' : '批量生成音频'}
          </button>
          <button 
            onClick={handleTranslate} 
            disabled={isTranslating}
            className="px-3 py-1.5 text-[9px] font-black border border-black/10 hover:bg-black hover:text-white transition-all disabled:opacity-20 uppercase text-black"
          >
            {isTranslating ? '翻译中...' : '翻译本章内容'}
          </button>
          <button 
            onClick={handleMerge} 
            disabled={isMerging}
            className="px-3 py-1.5 text-[9px] font-black border border-black/10 hover:bg-black hover:text-white transition-all disabled:opacity-20 uppercase text-black"
          >
            {isMerging ? '合并中...' : '合并全章音轨'}
          </button>
        </div>
      </div>
    </header>
  );
};
