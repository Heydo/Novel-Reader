
import { Chapter } from '../types';

export function splitTextIntoChapters(text: string, defaultTitle: string = 'Full Content'): Chapter[] {
  // Regex pattern for common chapter headers in Chinese novels:
  // "第[一二三四五六七八九十百千万0-9]+[章节回]"
  // Also common English patterns: "Chapter [0-9]+"
  const pattern = /(第[一二三四五六七八九十百千万0-9]+[章节回].*?|Chapter\s+\d+.*?)(?=\n|$)/g;
  
  const matches = [...text.matchAll(pattern)];
  
  if (matches.length === 0) {
    // If no chapters found, treat whole text as one chapter using provided defaultTitle
    return [{
      id: '1',
      title: defaultTitle,
      content: text.trim()
    }];
  }

  const chapters: Chapter[] = [];
  
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
    
    const rawTitle = matches[i][0].trim();
    const content = text.substring(start + rawTitle.length, end).trim();
    
    chapters.push({
      id: (i + 1).toString(),
      title: rawTitle,
      content: content
    });
  }

  return chapters;
}
