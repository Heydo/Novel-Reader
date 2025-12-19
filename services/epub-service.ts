
import JSZip from 'jszip';

interface ChapterExportData {
  title: string;
  paragraphs: string[];
  translations: Record<number, string>;
  analyses: Record<number, string>;
  audioBlob?: Blob;
  paragraphAudioBlobs?: Record<number, Blob>;
}

/**
 * 将简单的 Markdown 语法转换为 EPUB 兼容的 HTML
 * 增加了一些内联样式以确保在不支持外部 CSS 的阅读器中也有基本样式
 */
function simpleMarkdownToHtml(text: string): string {
  if (!text) return '';
  
  return text.split('\n').map(line => {
    let content = line.trim();
    if (!content) return '<br/>';
    
    // 标题处理
    if (content.startsWith('#### ')) return `<h4 style="color: #92400e; margin-top: 1em;">${content.slice(5)}</h4>`;
    if (content.startsWith('### ')) return `<h3 style="color: #92400e; border-bottom: 1px solid #fde68a; padding-bottom: 4px;">${content.slice(4)}</h3>`;
    if (content.startsWith('## ')) return `<h2 style="color: #78350f;">${content.slice(3)}</h2>`;
    if (content.startsWith('# ')) return `<h1 style="text-align: center; color: #451a03;">${content.slice(2)}</h1>`;
    
    // 引用处理
    if (content.startsWith('> ')) return `<blockquote style="border-left: 4px solid #f59e0b; padding: 10px 15px; background: #fffbeb; font-style: italic; color: #78350f; margin: 15px 0; border-radius: 0 8px 8px 0;">${content.slice(2)}</blockquote>`;
    
    // 分割线
    if (/^[-*]{3,}$/.test(content)) return '<hr style="border: none; border-top: 2px dashed #fde68a; margin: 25px 0;" />';
    
    // 行内格式
    content = content
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #451a03;">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em style="color: #92400e;">$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: #fef3c7; color: #92400e; padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>');
      
    return `<p style="margin-bottom: 0.8em;">${content}</p>`;
  }).join('\n');
}

export async function generateEpub(data: ChapterExportData): Promise<Blob> {
  const zip = new JSZip();

  // 1. mimetype (必须在第一位且不压缩)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. 容器元数据
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  // 3. 样式表 - 高度还原网页 UI 的视觉层次
  zip.file('OEBPS/style.css', `
    @font-face {
      font-family: "Noto Serif SC";
      src: local("Noto Serif SC"), local("Source Han Serif SC");
    }
    body { 
      font-family: "Noto Serif SC", "Source Han Serif SC", serif; 
      padding: 5% 8%; 
      line-height: 1.85; 
      color: #1e293b; 
      background-color: #ffffff;
    }
    h1.chapter-title { 
      text-align: center; 
      font-size: 2.2em; 
      margin-top: 1em;
      margin-bottom: 1.2em; 
      color: #0f172a; 
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 0.5em;
    }
    .chapter-audio-container { 
      background-color: #f0f7ff; 
      padding: 20px; 
      border-radius: 16px; 
      margin-bottom: 40px; 
      border: 1px solid #bfdbfe; 
      text-align: center; 
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .audio-label {
      font-weight: bold; 
      margin-bottom: 12px; 
      color: #1d4ed8; 
      font-size: 0.95em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .paragraph-wrapper { 
      margin-bottom: 50px; 
      padding-bottom: 30px;
      border-bottom: 1px solid #f1f5f9;
    }
    .original-text { 
      font-size: 1.2em; 
      color: #0f172a;
      margin-bottom: 15px;
      font-weight: 400;
    }
    .paragraph-audio-container { 
      margin-top: 10px; 
      margin-bottom: 15px; 
      text-align: left; 
    }
    .translation-container { 
      font-size: 1.05em; 
      color: #475569; 
      font-style: italic; 
      background-color: #f8fafc; 
      padding: 18px; 
      border-radius: 12px; 
      margin-bottom: 20px; 
      border-left: 4px solid #cbd5e1;
    }
    .analysis-container { 
      font-size: 0.95em; 
      background-color: #fffbeb; 
      padding: 24px; 
      border: 1px solid #fef3c7; 
      border-radius: 20px; 
      margin-top: 15px; 
      color: #451a03;
    }
    .analysis-header { 
      display: flex;
      align-items: center;
      font-weight: bold; 
      color: #92400e; 
      margin-bottom: 15px; 
      font-size: 1.15em; 
      border-bottom: 1px solid #fde68a; 
      padding-bottom: 8px; 
    }
    .analysis-header:before {
      content: "✦ ";
      color: #f59e0b;
    }
    audio { 
      width: 100%; 
      height: 40px; 
    }
    .p-audio { 
      width: 100%; 
      max-width: 320px; 
      height: 34px; 
    }
  `);

  // 4. 构建章节内容 HTML
  const hasChapterAudio = !!data.audioBlob;
  const paragraphAudioMap = data.paragraphAudioBlobs || {};
  
  let chapterHtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${data.title}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1 class="chapter-title">${data.title}</h1>`;

  if (hasChapterAudio) {
    chapterHtml += `
    <div class="chapter-audio-container">
      <div class="audio-label">章节朗读 · 全章播放</div>
      <audio controls="controls">
        <source src="audio_chapter.wav" type="audio/wav" />
        您的阅读器不支持音频播放。
      </audio>
    </div>`;
  }

  data.paragraphs.forEach((p, idx) => {
    const translation = data.translations[idx];
    const analysis = data.analyses[idx];
    const pAudio = paragraphAudioMap[idx];

    chapterHtml += `
    <div class="paragraph-wrapper">
      <div class="original-text">${p}</div>`;
    
    if (pAudio) {
      chapterHtml += `
      <div class="paragraph-audio-container">
        <audio controls="controls" class="p-audio">
          <source src="audio_p${idx}.wav" type="audio/wav" />
        </audio>
      </div>`;
    }

    if (translation) {
      chapterHtml += `<div class="translation-container">${translation}</div>`;
    }
    
    if (analysis) {
      chapterHtml += `
      <div class="analysis-container">
        <div class="analysis-header">AI 语言深度解析报告</div>
        <div class="analysis-content">
          ${simpleMarkdownToHtml(analysis)}
        </div>
      </div>`;
    }
    
    chapterHtml += `</div>`;
  });

  chapterHtml += `</body></html>`;
  zip.file('OEBPS/chapter.xhtml', chapterHtml);

  // 5. 音频文件写入
  if (data.audioBlob) {
    zip.file('OEBPS/audio_chapter.wav', data.audioBlob);
  }
  
  Object.entries(paragraphAudioMap).forEach(([idx, blob]) => {
    zip.file(`OEBPS/audio_p${idx}.wav`, blob);
  });

  // 6. 包清单 content.opf
  let manifestItems = `
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="style" href="style.css" media-type="text/css"/>
  `;
  
  if (hasChapterAudio) {
    manifestItems += `<item id="audio_chapter" href="audio_chapter.wav" media-type="audio/wav"/>`;
  }
  
  Object.keys(paragraphAudioMap).forEach((idx) => {
    manifestItems += `<item id="audio_p${idx}" href="audio_p${idx}.wav" media-type="audio/wav"/>`;
  });

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${Math.random().toString(36).substring(2, 11)}</dc:identifier>
    <dc:title>${data.title}</dc:title>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', contentOpf);

  return await zip.generateAsync({ 
    type: 'blob', 
    mimeType: 'application/epub+zip',
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}
