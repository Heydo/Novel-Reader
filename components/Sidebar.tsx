
import React from 'react';
import { Chapter, AppMode } from '../types';

interface SidebarProps {
  chapters: Chapter[];
  activeChapterIndex: number;
  setActiveChapterIndex: (idx: number) => void;
  setMode: (mode: AppMode) => void;
  clearChapterData: () => void;
  deleteChapter: (id: string, e: React.MouseEvent) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  chapters,
  activeChapterIndex,
  setActiveChapterIndex,
  setMode,
  clearChapterData,
  deleteChapter,
}) => {
  return (
    <aside className="w-80 flex-shrink-0 border-r border-black/10 flex flex-col bg-gray-50 overflow-hidden">
      {/* Chapter List Section */}
      <div className="p-8 border-b border-black/10">
        <div className="text-[10px] font-black tracking-[0.3em] uppercase opacity-40 mb-2 text-black">节目单 / 章节</div>
        <h2 className="text-3xl font-black serif-text tracking-tighter text-black">章节目录</h2>
      </div>
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {chapters.map((chapter, idx) => (
          <div 
            key={chapter.id}
            className={`group flex items-center p-3 cursor-pointer transition-all ${activeChapterIndex === idx ? 'bg-black text-white' : 'hover:bg-black/5 text-black'}`}
            onClick={() => { setActiveChapterIndex(idx); clearChapterData(); }}
          >
            <span className={`w-8 font-black text-[10px] ${activeChapterIndex === idx ? 'opacity-60' : 'opacity-30'}`}>{String(idx + 1).padStart(2, '0')}</span>
            <span className="flex-1 truncate serif-text font-bold text-sm">{chapter.title}</span>
            <button 
              onClick={(e) => deleteChapter(chapter.id, e)}
              className={`opacity-0 group-hover:opacity-40 hover:!opacity-100 px-2 ${activeChapterIndex === idx ? 'text-white' : 'text-black'}`}
            >
              ✕
            </button>
          </div>
        ))}
      </nav>

      <div className="p-6 bg-gray-50 border-t border-black/10">
         <button 
           onClick={() => setMode('welcome')} 
           className="w-full py-2 text-[10px] font-black tracking-widest uppercase border-2 border-black text-black hover:bg-black hover:text-white transition-all"
         >
           返回首页 HOME
         </button>
      </div>
    </aside>
  );
};
