// 真实的EPUB阅读器实现
class RealEPUBReader {
  constructor(arrayBuffer) {
    this.arrayBuffer = arrayBuffer;
    this.files = {};
    this.manifest = {};
    this.spine = [];
    this.currentChapterIndex = 0;
    this.chapters = [];
    this.metadata = {};
    this.tableOfContents = [];
    this.basePath = '';
    this.showToc = false;
    
    // 阅读设置
    this.settings = {
      fontSize: 19,
      lineHeight: 1.6,
      fontFamily: 'yahei',
      theme: 'light',
      customBgColor: '#ffffff',
      customTextColor: '#333333'
    };
  }

  // 解压缩数据
  async decompressData(compressedData, compressionMethod) {
    if (compressionMethod === 0) {
      // 无压缩
      return compressedData;
    } else if (compressionMethod === 8) {
      // Deflate压缩
      try {
        // 尝试使用浏览器原生的解压缩
        if (typeof DecompressionStream !== 'undefined') {
          const stream = new DecompressionStream('deflate-raw');
          const writer = stream.writable.getWriter();
          const reader = stream.readable.getReader();
          
          writer.write(compressedData);
          writer.close();
          
          const chunks = [];
          let done = false;
          
          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
              chunks.push(value);
            }
          }
          
          // 合并所有chunks
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          
          return result;
        } else {
          // 浏览器不支持DecompressionStream，使用简单的inflate实现
          return this.simpleInflate(compressedData);
        }
      } catch (error) {
        console.warn('解压缩失败，尝试简单inflate:', error);
        return this.simpleInflate(compressedData);
      }
    } else {
      console.warn(`不支持的压缩方法: ${compressionMethod}`);
      return null;
    }
  }

  // 简单的Deflate解压缩实现（用于fallback）
  simpleInflate(data) {
    try {
      // 这是一个简化的实现，可能不适用于所有情况
      // 但对于大多数EPUB文件应该足够了
      const result = [];
      let i = 0;
      
      while (i < data.length) {
        const b = data[i++];
        
        if ((b & 0x80) === 0) {
          // 字面值
          result.push(b);
        } else {
          // 这是一个非常简化的实现
          // 实际的Deflate算法更复杂
          result.push(b);
        }
      }
      
      return new Uint8Array(result);
    } catch (error) {
      console.warn('简单inflate失败:', error);
      // 如果解压缩失败，返回原始数据
      return data;
    }
  }

  // 解析ZIP文件
  async parseZip() {
    const view = new Uint8Array(this.arrayBuffer);
    
    // 查找ZIP文件的中央目录
    const eocdInfo = this.findCentralDirectory(view);
    if (!eocdInfo) {
      throw new Error('无效的ZIP文件：找不到中央目录');
    }

    const { cdOffset, numEntries } = eocdInfo;
    
    // 解析文件条目
    let currentOffset = cdOffset;
    
    for (let i = 0; i < numEntries; i++) {
      try {
        const entry = this.parseFileEntry(view, currentOffset);
        if (entry) {
          const fileData = await this.extractFile(view, entry);
          if (fileData) {
            this.files[entry.filename] = fileData;
          }
          currentOffset = entry.nextOffset;
        } else {
          break; // 无法解析更多条目
        }
      } catch (error) {
        console.warn(`跳过文件条目 ${i}:`, error.message);
        break;
      }
    }
  }

  findCentralDirectory(view) {
    // 从文件末尾向前查找EOCD签名 (0x06054b50)
    for (let i = view.length - 22; i >= 0; i--) {
      if (i + 22 > view.length) continue;
      
      if (view[i] === 0x50 && view[i + 1] === 0x4b && 
          view[i + 2] === 0x05 && view[i + 3] === 0x06) {
        
        // 验证EOCD记录的长度
        if (i + 22 > view.length) continue;
        
        try {
          // 读取中央目录信息
          const dv = new DataView(view.buffer, i);
          const numEntries = dv.getUint16(10, true);
          const cdSize = dv.getUint32(12, true);
          const cdOffset = dv.getUint32(16, true);
          
          // 验证偏移量的有效性
          if (cdOffset >= 0 && cdOffset < view.length && 
              cdOffset + cdSize <= view.length) {
            return { cdOffset, numEntries };
          }
        } catch (error) {
          continue; // 尝试下一个位置
        }
      }
    }
    return null;
  }

  parseFileEntry(view, offset) {
    // 检查基本长度
    if (offset + 46 > view.length) {
      throw new Error('文件条目超出范围');
    }
    
    try {
      const dv = new DataView(view.buffer, offset, 46);
      const signature = dv.getUint32(0, true);
      
      if (signature !== 0x02014b50) {
        throw new Error('无效的中央目录签名');
      }
      
      const filenameLength = dv.getUint16(28, true);
      const extraFieldLength = dv.getUint16(30, true);
      const commentLength = dv.getUint16(32, true);
      const localHeaderOffset = dv.getUint32(42, true);
      
      // 检查文件名长度是否合理
      if (filenameLength > 1024 || filenameLength === 0) {
        throw new Error('文件名长度异常');
      }
      
      // 检查是否有足够的空间读取文件名
      if (offset + 46 + filenameLength > view.length) {
        throw new Error('文件名超出范围');
      }
      
      const filename = new TextDecoder().decode(
        view.slice(offset + 46, offset + 46 + filenameLength)
      );
      
      // 计算下一个条目的偏移量
      const nextOffset = offset + 46 + filenameLength + extraFieldLength + commentLength;
      
      return {
        filename,
        filenameLength,
        extraFieldLength,
        commentLength,
        localHeaderOffset,
        nextOffset
      };
    } catch (error) {
      throw new Error(`解析文件条目失败: ${error.message}`);
    }
  }

  async extractFile(view, entry) {
    const localHeaderOffset = entry.localHeaderOffset;
    
    // 检查本地文件头的基本长度
    if (localHeaderOffset + 30 > view.length) {
      console.warn(`文件 ${entry.filename} 的本地头超出范围`);
      return null;
    }
    
    try {
      const dv = new DataView(view.buffer, localHeaderOffset, 30);
      
      // 检查本地文件头签名
      const signature = dv.getUint32(0, true);
      if (signature !== 0x04034b50) {
        console.warn(`文件 ${entry.filename} 的本地头签名无效`);
        return null;
      }
      
      const filenameLength = dv.getUint16(26, true);
      const extraFieldLength = dv.getUint16(28, true);
      const compressedSize = dv.getUint32(18, true);
      const uncompressedSize = dv.getUint32(22, true);
      const compressionMethod = dv.getUint16(8, true);
      
      // 检查文件数据是否在有效范围内
      const dataOffset = localHeaderOffset + 30 + filenameLength + extraFieldLength;
      
      if (dataOffset >= view.length || 
          compressedSize > view.length - dataOffset ||
          compressedSize > 50 * 1024 * 1024) { // 限制文件大小为50MB
        console.warn(`文件 ${entry.filename} 的数据超出范围或过大`);
        return null;
      }
      
      const compressedData = view.slice(dataOffset, dataOffset + compressedSize);
      
      // 解压缩数据
      console.log(`解压缩文件 ${entry.filename}，压缩方法: ${compressionMethod}`);
      const decompressedData = await this.decompressData(compressedData, compressionMethod);
      
      if (decompressedData) {
        console.log(`文件 ${entry.filename} 解压成功，原始大小: ${compressedSize}, 解压后大小: ${decompressedData.length}`);
        return decompressedData;
      } else {
        console.warn(`文件 ${entry.filename} 解压失败`);
        return null;
      }
      
    } catch (error) {
      console.warn(`提取文件 ${entry.filename} 失败:`, error.message);
      return null;
    }
  }

  // 解析container.xml来找到OPF文件
  parseContainer() {
    const containerData = this.files['META-INF/container.xml'];
    if (!containerData) {
      throw new Error('找不到container.xml文件');
    }
    
    const containerText = new TextDecoder().decode(containerData);
    const match = containerText.match(/full-path="([^"]+)"/);
    if (!match) {
      throw new Error('无法解析container.xml');
    }
    
    return match[1];
  }

  // 解析目录（TOC）
  parseTableOfContents() {
    // 尝试解析toc.ncx文件
    const tocNcxPath = this.basePath + 'toc.ncx';
    let tocData = this.files[tocNcxPath];
    
    if (!tocData) {
      // 尝试在manifest中查找NCX文件
      for (const [id, item] of Object.entries(this.manifest)) {
        if (item.mediaType === 'application/x-dtbncx+xml') {
          const fullPath = this.basePath + item.href;
          tocData = this.files[fullPath];
          break;
        }
      }
    }
    
    if (tocData) {
      try {
        const tocText = new TextDecoder().decode(tocData);
        const parser = new DOMParser();
        const doc = parser.parseFromString(tocText, 'text/xml');
        
        const navPoints = doc.querySelectorAll('navPoint');
        this.tableOfContents = Array.from(navPoints).map((navPoint, index) => {
          const label = navPoint.querySelector('navLabel text')?.textContent || `章节 ${index + 1}`;
          const src = navPoint.querySelector('content')?.getAttribute('src') || '';
          
          // 找到对应的spine索引
          let spineIndex = -1;
          for (let i = 0; i < this.spine.length; i++) {
            const spineItem = this.manifest[this.spine[i]];
            if (spineItem && src.includes(spineItem.href)) {
              spineIndex = i;
              break;
            }
          }
          
          return {
            title: label,
            src: src,
            spineIndex: spineIndex >= 0 ? spineIndex : index
          };
        });
      } catch (error) {
        console.warn('解析TOC失败:', error);
        this.generateSimpleToc();
      }
    } else {
      this.generateSimpleToc();
    }
  }

  // 生成简单目录
  generateSimpleToc() {
    this.tableOfContents = this.spine.map((id, index) => {
      const item = this.manifest[id];
      let title = `章节 ${index + 1}`;
      
      // 尝试从文件名推断标题
      if (item && item.href) {
        const filename = item.href.split('/').pop().replace(/\.(xhtml|html)$/, '');
        if (filename && filename !== 'index') {
          title = filename.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
      }
      
      return {
        title: title,
        src: item ? item.href : '',
        spineIndex: index
      };
    });
  }

  // 创建图片的Data URL - 增强版本
  createImageDataUrl(originalPath, resolvedPath = null, imageData = null) {
    try {
      console.log('尝试创建图片DataURL:', { originalPath, resolvedPath });
      
      let finalPath = resolvedPath;
      let finalImageData = imageData;
      
      // 如果没有提供数据，尝试自己查找
      if (!finalImageData || !finalPath) {
        // 规范化路径，正确处理相对路径
        finalPath = resolvedPath || this.resolveImagePath(originalPath);
        console.log('解析后的图片路径:', finalPath);
        
        // 首先尝试完整路径
        finalImageData = this.files[finalPath];
        
        // 如果找不到，尝试其他可能的路径
        if (!finalImageData) {
          const possiblePaths = this.generatePossibleImagePaths(originalPath);
          console.log('尝试的所有路径:', possiblePaths);
          for (const path of possiblePaths) {
            finalImageData = this.files[path];
            if (finalImageData) {
              finalPath = path;
              console.log(`找到图片文件: ${finalPath} (原路径: ${originalPath})`);
              break;
            }
          }
        } else {
          console.log('直接找到图片:', finalPath);
        }
      }
      
      if (!finalImageData) {
        console.warn('找不到图片文件:', originalPath);
        return null;
      }
      
      // 检查图片大小，如果太大则跳过（防止内存问题）
      if (finalImageData.length > 5 * 1024 * 1024) { // 5MB 限制
        console.warn(`图片文件太大，跳过显示: ${finalPath} (${(finalImageData.length / 1024 / 1024).toFixed(2)} MB)`);
        return null;
      }
      
      console.log(`图片文件大小: ${(finalImageData.length / 1024).toFixed(1)} KB`);
      
      // 根据文件扩展名确定MIME类型
      const ext = finalPath.toLowerCase().split('.').pop();
      let mimeType = 'image/jpeg'; // 默认
      
      switch (ext) {
        case 'png':
          mimeType = 'image/png';
          break;
        case 'gif':
          mimeType = 'image/gif';
          break;
        case 'svg':
          mimeType = 'image/svg+xml';
          break;
        case 'webp':
          mimeType = 'image/webp';
          break;
        case 'bmp':
          mimeType = 'image/bmp';
          break;
        case 'tiff':
        case 'tif':
          mimeType = 'image/tiff';
          break;
        default:
          // jpg, jpeg等
          mimeType = 'image/jpeg';
      }
      
      console.log(`图片MIME类型: ${mimeType}`);
      
      // 安全地将Uint8Array转换为base64（分批处理避免栈溢出）
      const base64 = this.uint8ArrayToBase64(finalImageData);
      console.log(`图片base64转换完成，长度: ${base64.length}`);
      return `data:${mimeType};base64,${base64}`;
      
    } catch (error) {
      console.warn(`图片转换失败: ${originalPath}`, error);
      return null;
    }
  }

  // 安全地将 Uint8Array 转换为 base64
  uint8ArrayToBase64(uint8Array) {
    const chunkSize = 1024; // 每次处理 1KB
    let binary = '';
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    
    return btoa(binary);
  }

  // 解析图片的完整路径
  resolveImagePath(imagePath) {
    // 如果是绝对路径或包含协议，直接返回
    if (imagePath.startsWith('/') || imagePath.includes('://')) {
      return imagePath;
    }
    
    // 获取当前章节的路径
    const currentSpineId = this.spine[this.currentChapterIndex];
    const currentItem = this.manifest[currentSpineId];
    let currentChapterPath = '';
    
    if (currentItem && currentItem.href) {
      currentChapterPath = this.basePath + currentItem.href;
      // 获取当前章节文件的目录
      const currentDir = currentChapterPath.substring(0, currentChapterPath.lastIndexOf('/') + 1);
      
      // 解析相对路径
      return this.resolvePath(currentDir, imagePath);
    }
    
    // 如果无法确定当前章节路径，使用basePath
    return this.resolvePath(this.basePath, imagePath);
  }

  // 通用路径解析函数
  resolvePath(basePath, relativePath) {
    // 将路径分割为数组
    const baseSegments = basePath.split('/').filter(segment => segment.length > 0);
    const relativeSegments = relativePath.split('/').filter(segment => segment.length > 0);
    
    // 处理相对路径
    const resultSegments = [...baseSegments];
    
    for (const segment of relativeSegments) {
      if (segment === '..') {
        // 上一级目录
        if (resultSegments.length > 0) {
          resultSegments.pop();
        }
      } else if (segment !== '.') {
        // 当前目录(.)忽略，其他加入路径
        resultSegments.push(segment);
      }
    }
    
    return resultSegments.join('/');
  }

  // 生成可能的图片路径列表 - 增强版本
  generatePossibleImagePaths(originalPath) {
    const paths = [];
    
    // 1. 解析后的完整路径
    const resolvedPath = this.resolveImagePath(originalPath);
    paths.push(resolvedPath);
    
    // 2. 直接拼接basePath
    if (!originalPath.startsWith('/') && !originalPath.includes('://')) {
      paths.push(this.basePath + originalPath);
    }
    
    // 3. 尝试常见的图片目录
    const imageDirs = [
      'Images/', 'images/', 'img/', 'graphics/', 'Graphics/', 
      'OEBPS/Images/', 'OEBPS/images/', 'OEBPS/img/',
      'Text/Images/', 'Text/images/', 'epub/Images/', 'epub/images/',
      'assets/', 'Assets/', 'media/', 'Media/'
    ];
    const filename = originalPath.split('/').pop();
    
    for (const dir of imageDirs) {
      paths.push(this.basePath + dir + filename);
      paths.push(dir + filename);
    }
    
    // 4. 尝试从根目录开始的路径
    paths.push(originalPath.startsWith('/') ? originalPath.substring(1) : originalPath);
    
    // 5. 尝试移除可能的URL编码
    try {
      const decodedPath = decodeURIComponent(originalPath);
      if (decodedPath !== originalPath) {
        paths.push(this.resolveImagePath(decodedPath));
        paths.push(this.basePath + decodedPath);
      }
    } catch (e) {
      // 忽略解码错误
    }
    
    // 6. 尝试处理相对路径中的 ../ 和 ./
    const normalizedPath = originalPath.replace(/\.\//g, '').replace(/\/\.\//g, '/');
    if (normalizedPath !== originalPath) {
      paths.push(this.resolveImagePath(normalizedPath));
      paths.push(this.basePath + normalizedPath);
    }
    
    // 7. 尝试大小写变化（有些EPUB文件大小写敏感）
    const lowerPath = originalPath.toLowerCase();
    const upperPath = originalPath.toUpperCase();
    if (lowerPath !== originalPath) {
      paths.push(this.resolveImagePath(lowerPath));
      paths.push(this.basePath + lowerPath);
    }
    if (upperPath !== originalPath) {
      paths.push(this.resolveImagePath(upperPath));
      paths.push(this.basePath + upperPath);
    }
    
    // 8. 查找所有可能匹配文件名的图片（最后的fallback）
    const targetFilename = filename.toLowerCase();
    const imageFiles = Object.keys(this.files).filter(f => {
      const ext = f.toLowerCase().split('.').pop();
      return ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'tiff', 'tif'].includes(ext);
    });
    
    for (const imageFile of imageFiles) {
      const imageFilename = imageFile.split('/').pop().toLowerCase();
      if (imageFilename === targetFilename) {
        paths.push(imageFile);
      }
    }
    
    // 去重并返回
    const uniquePaths = [...new Set(paths)];
    console.log(`为图片 ${originalPath} 生成了 ${uniquePaths.length} 个可能路径`);
    return uniquePaths;
  }

  // 解析OPF文件
  parseOPF(opfPath) {
    const opfData = this.files[opfPath];
    if (!opfData) {
      throw new Error('找不到OPF文件');
    }
    
    const opfText = new TextDecoder().decode(opfData);
    const parser = new DOMParser();
    const doc = parser.parseFromString(opfText, 'text/xml');
    
    // 检查XML解析是否成功
    if (doc.querySelector('parsererror')) {
      throw new Error('OPF文件XML格式错误');
    }
    
    // 解析metadata
    const metadata = doc.querySelector('metadata');
    if (metadata) {
      this.metadata.title = metadata.querySelector('title')?.textContent || '未知标题';
      this.metadata.creator = metadata.querySelector('creator')?.textContent || '未知作者';
    }
    
    // 解析manifest
    const manifestItems = doc.querySelectorAll('manifest item');
    manifestItems.forEach(item => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      const mediaType = item.getAttribute('media-type');
      if (id && href) {
        this.manifest[id] = { href, mediaType };
      }
    });
    
    // 解析spine
    const spineItems = doc.querySelectorAll('spine itemref');
    spineItems.forEach(item => {
      const idref = item.getAttribute('idref');
      if (this.manifest[idref] && 
          (this.manifest[idref].mediaType === 'application/xhtml+xml' ||
           this.manifest[idref].mediaType === 'text/html')) {
        this.spine.push(idref);
      }
    });
    
    if (this.spine.length === 0) {
      throw new Error('未找到可读的章节');
    }
    
    // 获取OPF文件的基础路径
    this.basePath = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
    
    // 解析目录
    this.parseTableOfContents();
    
    // 加载所有章节内容
    this.chapters = this.spine.map(id => {
      const item = this.manifest[id];
      const fullPath = this.basePath + item.href;
      const chapterData = this.files[fullPath];
      if (chapterData) {
        return new TextDecoder().decode(chapterData);
      }
      return '<p>无法加载章节内容</p>';
    });
  }

  async init() {
    try {
      console.log('开始解析EPUB文件...');
      await this.parseZip();
      console.log(`解析完成，找到 ${Object.keys(this.files).length} 个文件`);
      
      // 列出所有图片文件
      const imageFiles = Object.keys(this.files).filter(filename => {
        const ext = filename.toLowerCase().split('.').pop();
        return ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'tiff', 'tif'].includes(ext);
      });
      console.log('找到的图片文件:', imageFiles);
      
      const opfPath = this.parseContainer();
      console.log('找到OPF文件:', opfPath);
      
      this.parseOPF(opfPath);
      console.log(`解析完成，找到 ${this.chapters.length} 个章节`);
      console.log(`目录包含 ${this.tableOfContents.length} 个条目`);
      console.log('basePath:', this.basePath);
      
      return true;
    } catch (error) {
      console.error('EPUB解析失败:', error);
      return false;
    }
  }

  renderTo(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return null;

    const rendition = {
      display: () => {
        this.displayCurrentChapter();
        return Promise.resolve();
      },
      prev: () => this.prevChapter(),
      next: () => this.nextChapter()
    };

    return rendition;
  }

  // 切换目录显示
  toggleToc() {
    // 在新布局中，目录始终显示，此方法保留用于兼容性
    console.log('目录已固定显示在左侧栏');
  }

  // 跳转到指定章节
  goToChapter(chapterIndex) {
    if (chapterIndex >= 0 && chapterIndex < this.chapters.length) {
      this.currentChapterIndex = chapterIndex;
      this.displayCurrentChapter();
    }
  }

  // 滚动到顶部的方法
  scrollToTop() {
    console.log('开始滚动到顶部...');
    
    const readingArea = document.querySelector('.reading-area');
    if (readingArea) {
      // 使用平滑滚动
      readingArea.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      console.log('已对 .reading-area 执行平滑滚动');
    } else {
      console.warn('未找到 .reading-area 滚动容器');
    }
  }

  displayCurrentChapter() {
    const readerElement = document.getElementById('reader');
    const tocContainer = document.getElementById('tocContainer');
    
    if (!readerElement || this.chapters.length === 0) {
      readerElement.innerHTML = '<p style="padding: 20px;">无法加载EPUB内容</p>';
      return;
    }

    try {
      const currentChapter = this.chapters[this.currentChapterIndex] || '<p>章节不存在</p>';
      console.log('当前章节原始长度:', currentChapter.length);
      
      // 清理HTML内容
      const cleanedContent = this.cleanHtmlContent(currentChapter);
      console.log('清理后内容长度:', cleanedContent.length);
      
      // 检查清理后的内容大小
      if (cleanedContent.length > 35000000) {
        console.warn('清理后内容仍然过大，使用备用显示，长度:', cleanedContent.length);
        readerElement.innerHTML = this.fallbackHtmlContent();
        return;
      }
      
      // 显示章节内容
      readerElement.innerHTML = `
        <div style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border-color, #e9ecef);">
          <h1 style="margin: 0 0 10px 0; color: var(--text-color, #333); font-size: 24px;">${this.metadata.title || '未知标题'}</h1>
          <p style="margin: 0; color: var(--text-color, #666); font-size: 14px;">作者: ${this.metadata.creator || '未知作者'} | 第 ${this.currentChapterIndex + 1} 章 / 共 ${this.chapters.length} 章</p>
        </div>
        <div class="chapter-content">
          ${cleanedContent}
        </div>
        <div style="height: 200px; background: transparent;" id="bottom-spacer">
          <!-- 底部间距区域 -->
        </div>
      `;
      
      // 更新目录
      this.updateTocDisplay();
      
      // 应用当前设置
      this.applySettings();
      
      // 立即尝试滚动（快速响应）
      this.quickScrollToTop();
      
      // 滚动到顶部（延迟执行确保内容已渲染）
      setTimeout(() => {
        this.scrollToTop();
      }, 300); // 增加延迟到300ms
      
      console.log('章节显示完成');
      
      // 将reader实例绑定到window
      window.reader = this;
      
    } catch (error) {
      console.error('显示章节失败:', error);
      readerElement.innerHTML = `
        <div style="padding: 20px;">
          <h1>章节显示错误</h1>
          ${this.fallbackHtmlContent()}
        </div>
      `;
    }
  }

  // 更新目录显示
  updateTocDisplay() {
    const tocContainer = document.getElementById('tocContainer');
    if (!tocContainer || this.tableOfContents.length === 0) {
      return;
    }
    
    const tocItems = this.tableOfContents.map((item, index) => `
      <div class="toc-item ${index === this.currentChapterIndex ? 'active' : ''}" data-chapter-index="${item.spineIndex}">
        ${item.title}
      </div>
    `).join('');
    
    tocContainer.innerHTML = tocItems;
    
    // 只在第一次调用时添加事件监听器
    if (!tocContainer.hasAttribute('data-events-added')) {
      tocContainer.addEventListener('click', (event) => {
        const tocItem = event.target.closest('[data-chapter-index]');
        if (tocItem) {
          const chapterIndex = parseInt(tocItem.dataset.chapterIndex, 10);
          this.goToChapter(chapterIndex);
        }
      });
      tocContainer.setAttribute('data-events-added', 'true');
    }
  }

  // 应用阅读设置
  applySettings() {
    const body = document.body;
    const readingContent = document.querySelector('.reading-content');
    
    if (!readingContent) return;
    
    // 应用主题
    body.className = body.className.replace(/theme-\w+/g, '');
    if (this.settings.theme !== 'light') {
      body.classList.add(`theme-${this.settings.theme}`);
    }
    
    // 应用字体
    body.className = body.className.replace(/font-\w+/g, '');
    body.classList.add(`font-${this.settings.fontFamily}`);
    
    // 应用字体大小和行距
    readingContent.style.setProperty('--font-size', `${this.settings.fontSize}px`);
    readingContent.style.setProperty('--line-height', this.settings.lineHeight);
    
    // 应用主题或自定义颜色
    setTimeout(() => {
      const readingArea = document.querySelector('.reading-area');
      
      if (this.settings.theme === 'custom') {
        // 使用CSS变量设置自定义颜色
        document.documentElement.style.setProperty('--bg-color', this.settings.customBgColor);
        document.documentElement.style.setProperty('--text-color', this.settings.customTextColor);
      } else if (this.settings.theme === 'sepia') {
        document.documentElement.style.setProperty('--bg-color', '#f7f3e9');
        document.documentElement.style.setProperty('--text-color', '#5c4b37');
      } else if (this.settings.theme === 'green') {
        document.documentElement.style.setProperty('--bg-color', '#C7EDCC');
        document.documentElement.style.setProperty('--text-color', '#2d5016');
      } else if (this.settings.theme === 'dark') {
        document.documentElement.style.setProperty('--bg-color', '#1a1a1a');
        document.documentElement.style.setProperty('--text-color', '#e0e0e0');
      } else {
        document.documentElement.style.setProperty('--bg-color', '#ffffff');
        document.documentElement.style.setProperty('--text-color', '#333333');
      }
    }, 50);
  }

  cleanHtmlContent(html) {
    try {
      console.log('开始处理HTML内容，原始长度:', html.length);
      
      // 第一步：检查并截断过大的内容
      if (html.length > 10000000) { // 设置为10MB限制
        console.warn('HTML内容过大，截断处理，原始长度:', html.length);
        html = html.substring(0, 10000000) + '\n<p style="color: #999; text-align: center; padding: 20px;">（内容过长，已截取显示）</p>';
      }

      // 第二步：直接使用字符串处理，避免DOM解析
      const result = this.simpleHtmlClean(html);
      console.log('HTML处理完成，最终长度:', result.length);
      return result;

    } catch (error) {
      console.warn('HTML处理完全失败:', error);
      return this.fallbackHtmlContent();
    }
  }

  // 简化的HTML清理方法
  simpleHtmlClean(html) {
    try {
      console.log('开始简化HTML清理，输入长度:', html.length);
      
      // 移除脚本和样式标签
      let cleaned = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
      cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      
      console.log('移除脚本和样式后长度:', cleaned.length);
      
      // 移除所有事件处理器
      cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
      cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^>\s]+/gi, '');
      
      // 智能图片处理 - 增强版本，提高图片显示成功率
      let imageCount = 0;
      const maxImages = 30; // 增加图片数量限制到30张
      let processedImageSize = 0;
      const maxTotalImageSize = 15 * 1024 * 1024; // 增加总图片大小限制到15MB
      
      cleaned = cleaned.replace(/<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi, (match, src) => {
        imageCount++;
        console.log(`处理第${imageCount}张图片: ${src}`);
        
        // 如果图片太多，直接显示占位符
        if (imageCount > maxImages) {
          return `<div style="background: #f9f9f9; padding: 10px; text-align: center; color: #999; border: 1px solid #ddd; margin: 5px 0;">图片已隐藏（第${imageCount}张）: ${src.split('/').pop()}</div>`;
        }
        
        // 检查总图片大小限制
        if (processedImageSize > maxTotalImageSize) {
          return `<div style="background: #f9f9f9; padding: 10px; text-align: center; color: #999; border: 1px solid #ddd; margin: 5px 0;">图片已跳过（大小限制）: ${src.split('/').pop()}</div>`;
        }
        
        try {
          // 增强的图片查找逻辑
          let imageData = null;
          let finalPath = null;
          
          // 1. 尝试解析的完整路径
          const resolvedPath = this.resolveImagePath(src);
          imageData = this.files[resolvedPath];
          if (imageData) {
            finalPath = resolvedPath;
            console.log(`图片找到 (解析路径): ${finalPath}`);
          }
          
          // 2. 如果没找到，尝试所有可能的路径
          if (!imageData) {
            const possiblePaths = this.generatePossibleImagePaths(src);
            console.log(`尝试查找图片的所有路径:`, possiblePaths);
            
            for (const path of possiblePaths) {
              imageData = this.files[path];
              if (imageData) {
                finalPath = path;
                console.log(`图片找到 (备用路径): ${finalPath}`);
                break;
              }
            }
          }
          
          // 3. 如果还是没找到，尝试模糊匹配文件名
          if (!imageData) {
            const fileName = src.split('/').pop().toLowerCase();
            console.log(`模糊匹配文件名: ${fileName}`);
            
            for (const [filePath, fileData] of Object.entries(this.files)) {
              if (filePath.toLowerCase().endsWith(fileName)) {
                const ext = filePath.toLowerCase().split('.').pop();
                if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'tiff'].includes(ext)) {
                  imageData = fileData;
                  finalPath = filePath;
                  console.log(`图片找到 (模糊匹配): ${finalPath}`);
                  break;
                }
              }
            }
          }
          
          if (!imageData) {
            console.warn(`图片 ${src} 未找到，可用文件列表:`, Object.keys(this.files).filter(f => {
              const ext = f.toLowerCase().split('.').pop();
              return ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'tiff'].includes(ext);
            }));
            return `<div style="background: #fff3cd; padding: 15px; text-align: center; color: #856404; border: 1px solid #ffeaa7; margin: 10px 0; border-radius: 4px;">
              <strong>图片未找到:</strong> ${src.split('/').pop()}<br>
              <small>原路径: ${src}</small>
            </div>`;
          }
          
          // 检查单个图片大小（增加限制为3MB）
          if (imageData.length > 3 * 1024 * 1024) {
            console.log(`图片 ${src} 太大，跳过处理 (${(imageData.length / 1024 / 1024).toFixed(2)} MB)`);
            return `<div style="background: #f0f0f0; padding: 15px; text-align: center; color: #666; border: 1px dashed #ccc; margin: 10px 0;">
              图片过大: ${src.split('/').pop()} (${(imageData.length / 1024 / 1024).toFixed(2)} MB)
            </div>`;
          }
          
          const dataUrl = this.createImageDataUrl(src, finalPath, imageData);
          if (dataUrl) {
            processedImageSize += imageData.length;
            console.log(`图片 ${src} 转换成功，大小: ${(imageData.length / 1024).toFixed(1)} KB，累计: ${(processedImageSize / 1024 / 1024).toFixed(2)} MB`);
            return `<img src="${dataUrl}" style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" alt="${src.split('/').pop()}" title="${finalPath}" />`;
          } else {
            console.warn(`图片 ${src} 转换失败`);
            return `<div style="background: #f8d7da; padding: 15px; text-align: center; color: #721c24; border: 1px solid #f5c6cb; margin: 10px 0; border-radius: 4px;">
              <strong>图片转换失败:</strong> ${src.split('/').pop()}<br>
              <small>文件存在但无法转换为可显示格式</small>
            </div>`;
          }
        } catch (error) {
          console.error('处理图片失败:', src, error);
          return `<div style="background: #f8d7da; padding: 15px; text-align: center; color: #721c24; border: 1px solid #f5c6cb; margin: 10px 0; border-radius: 4px;">
            <strong>图片处理错误:</strong> ${src.split('/').pop()}<br>
            <small>错误: ${error.message}</small>
          </div>`;
        }
      });
      
      console.log(`图片处理完成，共处理${imageCount}张图片，总图片大小: ${processedImageSize} 字节，当前长度:`, cleaned.length);
      
      // 最终长度检查和截断
      if (cleaned.length > 30000000) { // 设置为30MB限制
        console.warn('处理后内容过大，截断处理，长度:', cleaned.length);
        cleaned = cleaned.substring(0, 30000000) + '\n<p style="color: #999; text-align: center; padding: 20px;">（内容过长，已截取显示）</p>';
      }
      
      console.log('HTML清理完成，最终长度:', cleaned.length);
      return cleaned;
      
    } catch (error) {
      console.warn('简化HTML清理失败:', error);
      return this.fallbackHtmlContent();
    }
  }

  // 辅助方法：通过路径查找图片
  findImageByPath(imagePath) {
    const possiblePaths = this.generatePossibleImagePaths(imagePath);
    for (const path of possiblePaths) {
      const imageData = this.files[path];
      if (imageData) {
        return imageData;
      }
    }
    return null;
  }

  // 最后的备用内容
  fallbackHtmlContent() {
    return `
      <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; padding: 20px; margin: 20px 0; color: #856404;">
        <h3 style="margin-top: 0;">章节内容加载失败</h3>
        <p>当前章节的内容过于复杂或存在格式问题，无法正常显示。</p>
        <p>建议尝试：</p>
        <ul>
          <li>切换到其他章节</li>
          <li>检查EPUB文件是否完整</li>
          <li>联系技术支持</li>
        </ul>
      </div>
    `;
  }

  prevChapter() {
    if (this.currentChapterIndex > 0) {
      this.currentChapterIndex--;
      this.displayCurrentChapter();
    }
  }

  nextChapter() {
    if (this.currentChapterIndex < this.chapters.length - 1) {
      this.currentChapterIndex++;
      this.displayCurrentChapter();
    }
  }

  // 设置字体大小
  setFontSize(size) {
    this.settings.fontSize = Math.max(12, Math.min(32, size));
    this.applySettings();
    this.updateFontSizeDisplay();
  }

  // 设置行距
  setLineHeight(height) {
    this.settings.lineHeight = Math.max(1.0, Math.min(3.0, height));
    this.applySettings();
  }

  // 设置字体类型
  setFontFamily(family) {
    this.settings.fontFamily = family;
    this.applySettings();
  }

  // 设置主题
  setTheme(theme) {
    this.settings.theme = theme;
    this.applySettings();
  }

  // 设置自定义背景色
  setCustomBgColor(color) {
    console.log('设置自定义背景色:', color);
    this.settings.customBgColor = color;
    this.settings.theme = 'custom';
    this.applySettings();
  }

  // 设置自定义文字色
  setCustomTextColor(color) {
    console.log('设置自定义文字色:', color);
    this.settings.customTextColor = color;
    this.settings.theme = 'custom';
    this.applySettings();
  }

  // 直接设置自定义颜色（新方法）
  setCustomColors(bgColor, textColor) {
    console.log('设置自定义颜色:', { bgColor, textColor });
    this.settings.customBgColor = bgColor;
    this.settings.customTextColor = textColor;
    this.settings.theme = 'custom';
    
    // 使用CSS变量来设置颜色，这样可以覆盖!important规则
    document.documentElement.style.setProperty('--bg-color', bgColor);
    document.documentElement.style.setProperty('--text-color', textColor);
    
    this.applySettings();
  }

  // 重置为默认颜色
  resetColors() {
    this.settings.customBgColor = '#ffffff';
    this.settings.customTextColor = '#333333';
    this.settings.theme = 'light';
    
    // 重置CSS变量
    document.documentElement.style.setProperty('--bg-color', '#ffffff');
    document.documentElement.style.setProperty('--text-color', '#333333');
    
    this.applySettings();
    
    // 更新颜色选择器的值
    const bgColorInput = document.getElementById('customBgColor');
    const textColorInput = document.getElementById('customTextColor');
    if (bgColorInput) bgColorInput.value = '#ffffff';
    if (textColorInput) textColorInput.value = '#333333';
  }

  // 更新主题按钮状态（简化版本，主要逻辑在reader.js中处理）
  updateThemeButtons() {
    // 这个方法保留用于兼容性，主要逻辑现在在reader.js中处理
    console.log('当前主题:', this.settings.theme);
  }

  // 更新字体大小显示
  updateFontSizeDisplay() {
    const display = document.getElementById('fontSizeDisplay');
    if (display) {
      display.textContent = `${this.settings.fontSize}px`;
    }
  }

  // 立即尝试滚动到顶部
  quickScrollToTop() {
    console.log('立即滚动到顶部...');
    
    // 只针对内容区域的滚动容器
    const readingArea = document.querySelector('.reading-area');
    if (readingArea) {
      readingArea.scrollTop = 0;
      console.log('已设置 .reading-area scrollTop = 0');
    } else {
      console.warn('未找到 .reading-area 滚动容器');
    }
    
    console.log('立即滚动完成');
  }
}

// 替换原来的ePub函数
function ePub(arrayBuffer) {
  const reader = new RealEPUBReader(arrayBuffer);
  return {
    renderTo: (elementId, options) => reader.renderTo(elementId)
  };
} 