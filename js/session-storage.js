import { STORAGE_NAME, STORAGE_VERSION } from './config.js';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Error('保存の応答がありません。'));
      try { transaction.abort(); } catch (error) {}
    }, timeoutMs);
    transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
    const failed = () => { clearTimeout(timer); reject(transaction.error || Error('保存できませんでした。')); };
    transaction.onerror = failed;
    transaction.onabort = failed;
  });
}

export function openSessionDatabase({ timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => fail(Error('保存領域の応答がありません。')), timeoutMs);
    function fail(error) {
      finished = true;
      clearTimeout(timer);
      reject(error);
    }
    let request;
    try { request = indexedDB.open(STORAGE_NAME, STORAGE_VERSION); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      if (finished) { request.transaction.abort(); return; }
      request.result.createObjectStore('session');
      request.result.createObjectStore('sounds', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      finished = true;
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(Error('別の画面が保存領域を使用中です。'));
  });
}

export async function readSession(database, { timeoutMs = 5000 } = {}) {
  const transaction = database.transaction(['session', 'sounds'], 'readonly');
  let timer;
  const failure = new Promise((_, reject) => {
    transaction.onabort = () => reject(transaction.error || Error('保存データの読み込みを中止しました。'));
    timer = setTimeout(() => {
      reject(Error('保存データの応答がありません。'));
      try { transaction.abort(); } catch (error) {}
    }, timeoutMs);
  });
  try {
    // Queue both requests before yielding: old Safari closes idle transactions.
    const [stored, sounds] = await Promise.race([Promise.all([
      requestResult(transaction.objectStore('session').get('current')),
      requestResult(transaction.objectStore('sounds').getAll())
    ]), failure]);
    return { stored, sounds };
  } finally {
    clearTimeout(timer);
  }
}

export function writeSession(database, settings, samples, changedIndices, { timeoutMs = 5000 } = {}) {
  const transaction = database.transaction(['session', 'sounds'], 'readwrite');
  transaction.objectStore('session').put(settings, 'current');
  for (const index of changedIndices) {
    transaction.objectStore('sounds').put({ id: index, audio: samples[index].audio });
  }
  return transactionComplete(transaction, timeoutMs);
}
