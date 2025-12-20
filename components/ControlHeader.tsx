
import React from 'react';
import { Button } from './Button';

interface ControlHeaderProps {
  generatedCount: number;
  translatedCount: number;
  totalParagraphs: number;
  handleFullAuto: () => void;
  isFullAutoRunning: boolean;
  handleExportEpub: () => void;
  isExporting: boolean;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (val: boolean) => void;
  activeChapterTitle?: string;
}

export const ControlHeader: React.FC<ControlHeaderProps> = ({
  generatedCount,
  translatedCount,
  totalParagraphs,
  handleFullAuto,
  isFullAutoRunning,
  handleExportEpub,
  isExporting,
  isSettingsOpen,
  setIsSettingsOpen,
  activeChapterTitle
}) => {
  return (
    <header className="h-16 flex items-center justify-between px-10 border-b border-black/10 z-20 bg-[#e8e4d8]/80 backdrop-blur-md">
       <div className="flex items-center space-x-6">
         <div className="text-[10px] font-black tracking-[0.4em] uppercase opacity-30">Studio Session</div>
         <div className="h-4 w-px bg-black/10"></div>
         <div className="flex space-x-2">
            <Button size="sm" onClick={handleFullAuto} isLoading={isFullAutoRunning}>全自动 FULL AUTO</Button>
            <Button variant="outline" size="sm" onClick={handleExportEpub} isLoading={isExporting}>导出 EPUB</Button>
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
           <span>Audio {generatedCount}/{totalParagraphs}</span>
           <span>Trans {translatedCount}/{totalParagraphs}</span>
         </div>
       </div>
    </header>
  );
};
