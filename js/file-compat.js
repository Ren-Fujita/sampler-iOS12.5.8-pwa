// Blob.arrayBuffer()/text() are newer than iOS 12. Keep bounded slice reads.
function readWithFileReader(blob, method) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || Error('ファイルを読み込めません。'));
    reader.onabort = () => reject(Error('ファイルの読み込みを中止しました。'));
    reader[method](blob);
  });
}

export function readBlobBuffer(blob) {
  return typeof blob.arrayBuffer === 'function' ? blob.arrayBuffer() : readWithFileReader(blob, 'readAsArrayBuffer');
}

export function readBlobText(blob) {
  return typeof blob.text === 'function' ? blob.text() : readWithFileReader(blob, 'readAsText');
}
