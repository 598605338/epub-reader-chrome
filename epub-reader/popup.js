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

function saveBookToIndexedDB(arrayBuffer) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(['books'], 'readwrite');
      const store = transaction.objectStore('books');
      
      // 保存当前书籍，使用固定ID
      const bookData = {
        id: 'currentBook',
        data: arrayBuffer,
        timestamp: Date.now()
      };
      
      const request = store.put(bookData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

document.getElementById('fileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      
      try {
        // 将文件保存到IndexedDB
        await saveBookToIndexedDB(arrayBuffer);
        
        // 打开阅读器页面，使用扩展内部URL
        chrome.tabs.create({
          url: chrome.runtime.getURL('reader.html')
        });
      } catch (error) {
        console.error('保存文件失败:', error);
        alert('文件保存失败，请重试');
      }
    };
    reader.readAsArrayBuffer(file);
  }
}); 