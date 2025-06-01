// IndexedDB操作函数
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('EPUBReaderDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
    };
  });
}

function getBookFromIndexedDB() {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(['books'], 'readonly');
      const store = transaction.objectStore('books');
      
      const request = store.get('currentBook');
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.data);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

// 创建关闭按钮的事件监听器
function createCloseButton() {
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '关闭';
  closeBtn.style.cssText = 'padding: 10px 20px; margin-top: 20px; background: #007cba; color: white; border: none; border-radius: 4px; cursor: pointer;';
  closeBtn.addEventListener('click', () => {
    window.close();
  });
  return closeBtn;
}

// 设置工具栏控件事件监听器
function setupToolbarControls(reader) {
  // 字体选择
  const fontSelect = document.getElementById('fontSelect');
  if (fontSelect) {
    fontSelect.addEventListener('change', (e) => {
      reader.setFontFamily(e.target.value);
    });
  }

  // 字体大小控制
  const fontSizeUp = document.getElementById('fontSizeUp');
  const fontSizeDown = document.getElementById('fontSizeDown');
  
  if (fontSizeUp) {
    fontSizeUp.addEventListener('click', () => {
      reader.setFontSize(reader.settings.fontSize + 1);
    });
  }
  
  if (fontSizeDown) {
    fontSizeDown.addEventListener('click', () => {
      reader.setFontSize(reader.settings.fontSize - 1);
    });
  }

  // 行距控制
  const lineHeightRange = document.getElementById('lineHeightRange');
  const lineHeightDisplay = document.getElementById('lineHeightDisplay');
  
  if (lineHeightRange) {
    lineHeightRange.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      reader.setLineHeight(value);
      if (lineHeightDisplay) {
        lineHeightDisplay.textContent = value.toFixed(1);
      }
    });
  }

  // 主题控制
  const themeButtons = {
    light: document.getElementById('themeLight'),
    sepia: document.getElementById('themeSepia'),
    green: document.getElementById('themeGreen'),
    dark: document.getElementById('themeDark'),
    custom: document.getElementById('themeCustom')
  };

  Object.entries(themeButtons).forEach(([theme, button]) => {
    if (button) {
      button.addEventListener('click', () => {
        // 移除所有主题按钮的active类
        Object.values(themeButtons).forEach(btn => {
          if (btn) btn.classList.remove('active');
        });
        
        // 添加当前按钮的active类
        button.classList.add('active');
        
        // 设置主题
        if (theme === 'custom') {
          // 如果点击自定义按钮，使用当前的自定义颜色
          reader.setTheme('custom');
        } else {
          reader.setTheme(theme);
        }
      });
    }
  });

  // 自定义颜色控制
  const customBgColor = document.getElementById('customBgColor');
  const customTextColor = document.getElementById('customTextColor');
  const applyColors = document.getElementById('applyColors');
  const resetColors = document.getElementById('resetColors');

  // 应用自定义颜色的函数
  function applyCustomColors() {
    const bgColor = customBgColor ? customBgColor.value : '#ffffff';
    const textColor = customTextColor ? customTextColor.value : '#333333';
    
    console.log('准备应用自定义颜色:', { bgColor, textColor });
    
    // 使用新的组合方法应用颜色
    reader.setCustomColors(bgColor, textColor);
    
    // 激活自定义主题按钮
    Object.values(themeButtons).forEach(btn => {
      if (btn) btn.classList.remove('active');
    });
    if (themeButtons.custom) {
      themeButtons.custom.classList.add('active');
    }
    
    console.log('自定义颜色应用完成');
  }

  // 颜色选择器实时预览（可选）
  if (customBgColor) {
    customBgColor.addEventListener('input', (e) => {
      // 实时预览效果（仅更新显示，不保存）
      const readingContent = document.querySelector('.reading-content');
      const readingArea = document.querySelector('.reading-area');
      if (readingContent) {
        readingContent.style.backgroundColor = e.target.value;
      }
      if (readingArea) {
        readingArea.style.backgroundColor = e.target.value;
      }
    });
  }

  if (customTextColor) {
    customTextColor.addEventListener('input', (e) => {
      // 实时预览效果（仅更新显示，不保存）
      const readingContent = document.querySelector('.reading-content');
      if (readingContent) {
        readingContent.style.color = e.target.value;
      }
    });
  }

  // 应用按钮
  if (applyColors) {
    applyColors.addEventListener('click', () => {
      applyCustomColors();
    });
  }

  // 重置按钮
  if (resetColors) {
    resetColors.addEventListener('click', () => {
      reader.resetColors();
      // 重置后激活默认主题按钮
      Object.values(themeButtons).forEach(btn => {
        if (btn) btn.classList.remove('active');
      });
      if (themeButtons.light) {
        themeButtons.light.classList.add('active');
      }
    });
  }

  // 初始化显示
  reader.updateFontSizeDisplay();
}

document.addEventListener('DOMContentLoaded', async () => {
  const readerElement = document.getElementById('reader');
  
  try {
    // 显示加载状态
    readerElement.innerHTML = `
      <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
        <h2>正在加载EPUB文件...</h2>
        <p>请稍候，正在解析电子书内容</p>
      </div>
    `;
    
    // 从IndexedDB获取书籍数据
    const arrayBuffer = await getBookFromIndexedDB();
    
    if (arrayBuffer) {
      // 创建EPUB阅读器实例
      const book = ePub(arrayBuffer);
      const rendition = book.renderTo('reader', {
        width: '100%',
        height: '100%'
      });

      // 初始化阅读器
      const reader = new RealEPUBReader(arrayBuffer);
      const initSuccess = await reader.init();
      
      if (initSuccess) {
        // 显示第一章
        reader.displayCurrentChapter();

        // 添加翻页控制
        document.getElementById('prev').addEventListener('click', () => {
          reader.prevChapter();
        });

        document.getElementById('next').addEventListener('click', () => {
          reader.nextChapter();
        });

        // 设置工具栏控件
        setupToolbarControls(reader);

        // 添加键盘控制 - 更新为用户要求的功能
        document.addEventListener('keydown', (e) => {
          // 防止在输入框中触发快捷键
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
          }
          
          const readingArea = document.querySelector('.reading-area');
          
          switch(e.key) {
            case 'ArrowLeft':
              // 左键：上一章
              e.preventDefault();
              reader.prevChapter();
              break;
              
            case 'ArrowRight':
              // 右键：下一章
              e.preventDefault();
              reader.nextChapter();
              break;
              
            case 'ArrowUp':
              // 上键：向上滚动
              e.preventDefault();
              if (readingArea) {
                readingArea.scrollBy({
                  top: -200, // 向上滚动200px
                  behavior: 'smooth'
                });
              }
              break;
              
            case 'ArrowDown':
              // 下键：向下滚动
              e.preventDefault();
              if (readingArea) {
                readingArea.scrollBy({
                  top: 200, // 向下滚动200px
                  behavior: 'smooth'
                });
              }
              break;
          }
        });
        
        // 更新按钮状态
        const updateButtons = () => {
          const prevBtn = document.getElementById('prev');
          const nextBtn = document.getElementById('next');
          
          if (prevBtn) prevBtn.disabled = reader.currentChapterIndex === 0;
          if (nextBtn) nextBtn.disabled = reader.currentChapterIndex >= reader.chapters.length - 1;
        };
        
        // 初始更新按钮状态
        updateButtons();
        
        // 监听章节变化来更新按钮状态
        const originalPrev = reader.prevChapter.bind(reader);
        const originalNext = reader.nextChapter.bind(reader);
        
        reader.prevChapter = () => {
          originalPrev();
          updateButtons();
          // 确保滚动到顶部
          setTimeout(() => {
            reader.scrollToTop();
          }, 500);
        };
        
        reader.nextChapter = () => {
          originalNext();
          updateButtons();
          // 确保滚动到顶部
          setTimeout(() => {
            reader.scrollToTop();
          }, 500);
        };
        
      } else {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'text-align: center; padding: 50px; font-family: Arial, sans-serif;';
        errorDiv.innerHTML = '<h2>解析失败</h2><p>无法解析EPUB文件，请确保文件格式正确</p>';
        errorDiv.appendChild(createCloseButton());
        readerElement.innerHTML = '';
        readerElement.appendChild(errorDiv);
      }
    } else {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'text-align: center; padding: 50px; font-family: Arial, sans-serif;';
      errorDiv.innerHTML = '<h2>未找到书籍数据</h2><p>请重新选择EPUB文件</p>';
      errorDiv.appendChild(createCloseButton());
      readerElement.innerHTML = '';
      readerElement.appendChild(errorDiv);
    }
  } catch (error) {
    console.error('读取书籍失败:', error);
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'text-align: center; padding: 50px; font-family: Arial, sans-serif;';
    errorDiv.innerHTML = `<h2>加载失败</h2><p>错误信息: ${error.message}</p>`;
    errorDiv.appendChild(createCloseButton());
    readerElement.innerHTML = '';
    readerElement.appendChild(errorDiv);
  }
}); 