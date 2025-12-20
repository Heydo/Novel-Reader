
import JSZip from 'jszip';
import { Chapter } from '../types';

/**
 * 解析 EPUB 文件并返回章节列表
 */
export async function parseEpubFile(file: File): Promise<Chapter[]> {
  const zip = await JSZip.loadAsync(file);
  
  // 1. 查找 container.xml 以获取 content.opf 的路径
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error("无效的 EPUB 文件：缺少 container.xml");
  
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'text/xml');
  const rootFilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootFilePath) throw new Error("无效的 EPUB 文件：无法找到 rootfile 路径");
  
  // 2. 读取并解析 OPF 文件
  const opfContent = await zip.file(rootFilePath)?.async('string');
  if (!opfContent) throw new Error("无效的 EPUB 文件：无法读取 OPF 文件");
  
  const opfDoc = parser.parseFromString(opfContent, 'text/xml');
  
  // 建立 ID 到路径的映射
  const manifestItems: Record<string, string> = {};
  const manifestNodes = opfDoc.querySelectorAll('manifest > item');
  manifestNodes.forEach(node => {
    const id = node.getAttribute('id');
    const href = node.getAttribute('href');
    if (id && href) manifestItems[id] = href;
  });
  
  // 获取阅读顺序 (Spine)
  const spineNodes = opfDoc.querySelectorAll('spine > itemref');
  const spineIds = Array.from(spineNodes).map(node => node.getAttribute('idref')!);
  
  const rootDir = rootFilePath.includes('/') 
    ? rootFilePath.substring(0, rootFilePath.lastIndexOf('/') + 1) 
    : '';
    
  const chapters: Chapter[] = [];
  
  // 3. 按顺序读取每个章节的 XHTML 内容
  for (let i = 0; i < spineIds.length; i++) {
    const id = spineIds[i];
    const relativePath = manifestItems[id];
    if (!relativePath) continue;
    
    // 注意：这里的路径可能是相对 OPF 文件的路径，需要处理
    const fullPath = rootDir + relativePath;
    const xhtmlContent = await zip.file(fullPath)?.async('string');
    if (!xhtmlContent) continue;
    
    const xhtmlDoc = parser.parseFromString(xhtmlContent, 'text/html');
    
    // 提取标题
    let title = xhtmlDoc.querySelector('title')?.textContent || 
                xhtmlDoc.querySelector('h1, h2, h3')?.textContent || 
                `Chapter ${i + 1}`;
    
    // 提取正文并清洗 HTML
    // 我们主要提取 p 标签和一些块级元素的内容
    const contentNodes = xhtmlDoc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div');
    const paragraphLines: string[] = [];
    
    contentNodes.forEach(node => {
      // 避免重复提取（比如 div 下嵌套了 p）
      // 只有当节点直接包含文本且不是其他已处理块节点的父节点时才比较稳妥
      // 简单起见，我们提取所有 p 节点的内容，如果没有 p 则尝试 div
      if (node.tagName.toLowerCase() === 'p') {
        const text = node.textContent?.trim();
        if (text) paragraphLines.push(text);
      } else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.tagName.toLowerCase())) {
        const text = node.textContent?.trim();
        if (text) paragraphLines.push(text);
      }
    });

    // 如果没找到 p，再试着从 body 直接按行提取（对于简单的 epub）
    let finalContent = paragraphLines.join('\n\n');
    if (!finalContent.trim()) {
      finalContent = xhtmlDoc.body.textContent?.trim().replace(/\n\s*\n/g, '\n\n') || "";
    }
    
    if (finalContent.trim().length > 10) { // 过滤掉太短的空白页
      chapters.push({
        id: (i + 1).toString(),
        title: title.trim(),
        content: finalContent
      });
    }
  }
  
  return chapters;
}
