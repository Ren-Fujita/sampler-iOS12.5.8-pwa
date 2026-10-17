/* Classic ES5 script: visible diagnosis even if the module graph cannot parse. */
(function () {
  window.sx12Started = false;
  if (!window.PointerEvent)document.documentElement.className += ' legacy-input';
  var timer = setTimeout(function () {
    if (window.sx12Started)return;
    var overlay = document.getElementById('busyOverlay');
    overlay.textContent = 'アプリを起動できませんでした。通信を確認して再読み込みしてください。更新直後は新旧のファイルが混在している可能性があります。サイトデータは削除しないでください。';
    overlay.classList.remove('hidden');
  }, 12000);
  window.sx12BootComplete = function () {
    window.sx12Started = true;
    clearTimeout(timer);
  };
}());
