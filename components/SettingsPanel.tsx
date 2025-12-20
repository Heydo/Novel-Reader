
import React from 'react';
import { TTSModel, TranslationModel, MODEL_OPTIONS, TRANSLATION_MODEL_OPTIONS, VOICE_OPTIONS_MAP } from '../types';

interface SettingsPanelProps {
  selectedModel: TTSModel;
  setSelectedModel: (val: TTSModel) => void;
  selectedVoice: string;
  setSelectedVoice: (val: string) => void;
  selectedTranslationModel: TranslationModel;
  setSelectedTranslationModel: (val: TranslationModel) => void;
  batchGenerateParagraphs: () => void;
  isBatchGenerating: boolean;
  handleTranslateChapter: () => void;
  isTranslating: boolean;
  mergeExistingParagraphs: () => void;
  isMerging: boolean;
  setIsSettingsOpen: (val: boolean) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  selectedModel,
  setSelectedModel,
  selectedVoice,
  setSelectedVoice,
  selectedTranslationModel,
  setSelectedTranslationModel,
  batchGenerateParagraphs,
  isBatchGenerating,
  handleTranslateChapter,
  isTranslating,
  mergeExistingParagraphs,
  isMerging,
  setIsSettingsOpen
}) => {
  return (
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
         <button onClick={batchGenerateParagraphs} disabled={isBatchGenerating} className="text-[10px] font-black border border-white/20 py-2 hover:bg-white/10">
           {isBatchGenerating ? 'GENERATING...' : 'GEN AUDIO'}
         </button>
         <button onClick={handleTranslateChapter} disabled={isTranslating} className="text-[10px] font-black border border-white/20 py-2 hover:bg-white/10">
           {isTranslating ? 'TRANSLATING...' : 'TRANSLATE'}
         </button>
         <button onClick={mergeExistingParagraphs} disabled={isMerging} className="text-[10px] font-black border border-white/20 py-2 hover:bg-white/10">
           {isMerging ? 'MERGING...' : 'MERGE ALL'}
         </button>
         <button onClick={() => setIsSettingsOpen(false)} className="text-[10px] font-black bg-white text-black py-2">CLOSE</button>
      </div>
    </div>
  );
};
