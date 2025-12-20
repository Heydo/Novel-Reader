
import React from 'react';
import { Button } from './Button';
import { splitTextIntoChapters } from '../utils/text-parser';
import { Chapter, AppMode } from '../types';

interface WelcomeViewProps {
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  inputText: string;
  setInputText: (val: string) => void;
  bookTitle: string;
  setBookTitle: (val: string) => void;
  setChapters: (chapters: Chapter[]) => void;
  setMode: (mode: AppMode) => void;
  setActiveChapterIndex: (idx: number) => void;
  clearChapterData: () => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({
  fileInputRef,
  handleFileChange,
  inputText,
  setInputText,
  bookTitle,
  setBookTitle,
  setChapters,
  setMode,
  setActiveChapterIndex,
  clearChapterData
}) => {
  return (
    <div className="h-screen w-full flex overflow-hidden relative bg-white">
      <div className="w-16 h-full border-r border-black/10 flex flex-col items-center py-10 space-y-24">
         <div className="rotate-90 origin-center whitespace-nowrap text-[10px] font-black tracking-[0.5em] uppercase opacity-30">Gemini 强力驱动的小说工坊</div>
         <div className="rotate-90 origin-center whitespace-nowrap text-[10px] font-black tracking-[0.5em] uppercase opacity-30">创办于 2024</div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-12 overflow-y-auto">
        <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-20">
          <div className="flex flex-col justify-center space-y-6">
             <div className="text-[10px] font-black tracking-[0.4em] uppercase opacity-30">小说 · 声音 · 意境</div>
             <h1 className="text-8xl font-black serif-text leading-[0.85] tracking-tighter text-black">文学<br/><span className="text-5xl">的</span>结局<br/><span className="italic text-4xl font-normal opacity-50">Music 时分</span></h1>
             <div className="flex flex-col space-y-1 my-4 opacity-10">
                {[...Array(5)].map((_, i) => <div key={i} className="h-px bg-black w-full"></div>)}
             </div>
             <p className="text-sm font-medium leading-relaxed opacity-50 max-w-xs text-black">集成 Gemini 2.5 拟人语音与 3.0 深度推理，将文字转化为感官的合奏曲。</p>
          </div>

          <div className="flex flex-col justify-center space-y-10">
             {/* Book Title Input */}
             <div className="space-y-2">
                <label className="text-[9px] font-black tracking-widest uppercase opacity-40">作品标题 / TITLE OF THE WORK</label>
                <input 
                  type="text" 
                  className="w-full bg-transparent border-b-2 border-black py-2 text-2xl font-black serif-text outline-none focus:border-black/60 transition-colors placeholder-black/10"
                  placeholder="在此输入您的作品标题..."
                  value={bookTitle}
                  onChange={(e) => setBookTitle(e.target.value)}
                />
             </div>

             <div 
               className="group cursor-pointer border-4 border-black p-8 hover:bg-black hover:text-white transition-all bg-white"
               onClick={() => fileInputRef.current?.click()}
             >
               <div className="text-4xl font-black mb-2">上传文件</div>
               <div className="text-[10px] font-black tracking-widest uppercase opacity-40 group-hover:opacity-100">支持拖拽 TXT 或 EPUB 文件到此处</div>
               <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".txt,.epub" />
             </div>

             <div className="flex flex-col space-y-4">
                <textarea 
                  className="w-full h-48 p-6 bg-white border-2 border-black/10 focus:border-black outline-none resize-none serif-text text-xl placeholder-black/20"
                  placeholder="或者，在此粘贴您的文字..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <Button 
                  variant="primary" 
                  size="lg" 
                  disabled={!inputText.trim()}
                  onClick={() => {
                    setChapters(splitTextIntoChapters(inputText, bookTitle));
                    setMode('reader'); setActiveChapterIndex(0); clearChapterData();
                  }}
                >
                  开始创作 ENTER STUDIO
                </Button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
