
import React from 'react';

interface ParagraphItemProps {
  text: string;
  idx: number;
  isPlaying: boolean;
  hasAudio: boolean;
  translation?: string;
  analysis?: string;
  isAnalyzing: boolean;
  isFullAutoRunning: boolean;
  playParagraphAudio: (url: string, index: number) => void;
  audioUrl?: string;
  handleAnalyzeParagraph: (idx: number) => void;
}

const SimpleMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-3 font-serif text-[14px] leading-relaxed text-black/80">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === '') return <div key={i} className="h-1"></div>;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
};

export const ParagraphItem: React.FC<ParagraphItemProps> = ({
  text,
  idx,
  isPlaying,
  hasAudio,
  translation,
  analysis,
  isAnalyzing,
  isFullAutoRunning,
  playParagraphAudio,
  audioUrl,
  handleAnalyzeParagraph
}) => {
  return (
    <div className="relative group bg-white">
       {/* Newspaper style marker */}
       <div className="absolute -left-10 top-1.5 w-1.5 h-1.5 bg-black opacity-10 group-hover:opacity-100 transition-opacity"></div>
       
       <div className="flex items-start space-x-8">
          <button 
            onClick={() => hasAudio && audioUrl && playParagraphAudio(audioUrl, idx)}
            className={`flex-shrink-0 w-10 h-10 border border-black flex items-center justify-center transition-all ${isPlaying ? 'bg-black text-white' : hasAudio ? 'bg-black/5 hover:bg-black/10' : 'opacity-10 cursor-not-allowed'}`}
          >
             {isPlaying ? <span className="text-[10px]">■</span> : <span className="text-[10px]">▶</span>}
          </button>
          <div className="flex-1 space-y-8">
             <p className={`text-xl newspaper-font font-medium leading-[1.7] tracking-tight transition-opacity text-black ${isPlaying ? 'opacity-100' : 'opacity-80'}`}>{text}</p>
             
             {translation && (
               <div className="italic text-lg text-black/40 border-l border-black/10 pl-6 leading-relaxed newspaper-font">
                 {translation}
               </div>
             )}

             {analysis && (
               <div className="bg-gray-50 text-black p-8 space-y-3 shadow-sm border-2 border-black">
                  <div className="text-[9px] font-black tracking-[0.3em] uppercase opacity-50 border-b border-black/10 pb-2 mb-2">专栏：英语研习与表达分析报告</div>
                  <SimpleMarkdown text={analysis} />
               </div>
             )}

             {!analysis && !isFullAutoRunning && (
               <button 
                 onClick={() => handleAnalyzeParagraph(idx)}
                 className="text-[9px] font-black tracking-[0.2em] uppercase opacity-20 hover:opacity-100 transition-opacity text-black"
               >
                  {isAnalyzing ? '[ 正在提取语言要点... ]' : '[ 获取英语学习分析 ]'}
               </button>
             )}
          </div>
       </div>
       <div className="h-px bg-black/5 w-full mt-16"></div>
    </div>
  );
};
