# iOS 12 Safari対応版 — 変更点と検証結果

作成日：2026年10月17日（日本時間）  
対象：[Ren-Fujita/sampler-pwa](https://github.com/Ren-Fujita/sampler-pwa)  
調査したmainのコミット：`66eab07cb2e80c93f2dfaacd4270e4dd47ae43a0`  
修正版：v8 / package version 1.0.8  
GitHubへのコミット・push・公開サイトの更新は行っていません。ZIPはそのまま差し替えられるソース一式、PATCHは上記コミットとの差分です。

## 原因

PADはHTMLに固定配置されておらず、`js/app.js`の初期化時に生成されます。元のコードにはiOS 12で構文エラーになる`?.`、`??`、`??=`が含まれていました。インポート先も含めて解析できず、PAD生成と音量イベントの登録が実行されないことが、ソースから特定できる主要因です。元の8ファイルで旧構文の解析エラーを再現しました。実機のエラーログを採取した結果ではありません。

この起動停止を直しても、Pointer Eventsだけの操作、Blobの新しい読込API、Promiseだけを想定した音声デコード、縦型rangeのCSSなどが次の不具合になります。

| 確認対象 | 修正 |
| --- | --- |
| JavaScript構文・API | 未対応の演算子を明示的な条件分岐へ置換。`Array.at()`を通常の添字へ置換。FileListも`Array.from()`で取得 |
| モジュール読込 | 相対パス・拡張子付きのES Modulesを維持。iOS 12の通常のページではモジュール自体を利用可能。全依存ファイルを同じ配信先に配置する前提。外部CDN・ビルド処理への依存は追加せず |
| 起動失敗時の表示 | ES5の`js/boot.js`を追加。モジュールが起動できない場合も、待機画面に確認方法を表示 |
| タッチ操作 | Pointer Eventsのない環境ではTouch Eventsへ切替。指ごとの識別、複数指、離した位置がPAD外の場合のGATE解除、キャンセル、マウス入力を処理。対応ブラウザでは従来のPointer Eventsを使用 |
| 全体音量 | 旧環境では縦位置から音量を計算し、縦フェーダーを描画。実際のWeb AudioのGainNodeに即時反映。細かな音量値、ミュート解除、キー操作と保存を維持 |
| ファイル読込 | `Blob.arrayBuffer()`と`Blob.text()`がない場合にFileReaderを使用。バックアップは従来どおり分割して読込 |
| 音声再生 | `webkitAudioContext`対応を維持。コールバック型`decodeAudioData()`をPromiseで包む。操作中に無音バッファを開始してからresume。チャンネル転送は`getChannelData().set()`を使用。ノード接続も戻り値への依存を解消 |
| CSS | Gridの旧名のgap指定を併記。旧環境のFlexboxの余白をmarginで補完。`inset`を上下左右の指定へ置換。複数位置の色停止点を従来のグラデーション表記へ変換。`clamp()`に横画面・編集ハンドルの代替指定を追加 |
| 画面サイズ | VisualViewportとResizeObserverがなくてもinnerWidth/innerHeight、resize、画面回転で再計算。旧環境では波形も再描画 |
| 自動保存 | IndexedDBのDB名・バージョン・保存形式を維持。起動・読込・書込が応答しない場合のタイムアウトを追加。読込失敗時は既存データを上書きするDB接続を使わず、演奏画面を出して保存エラーを案内 |
| バックアップ | バイナリ`.sx12`と従来のJSON/base64形式を維持。旧環境の書き出しは、生成後に利用者がタップする保存リンクを表示。OS上の保存完了とは区別 |
| オフライン・更新 | SWも旧構文へ変更。キャッシュ識別子を`2026-10-17-v8-ios12`へ更新し、追加した実行ファイルをオフライン対象へ登録。メニューが起動しない場合に備え、独立した`update-ios12.html`を追加 |

`navigator.audioSession`、永続保存要求、ResizeObserver、VisualViewportなどは、機能の有無を確認してから使用します。未対応であることだけで起動を止めません。

## 維持した機能

10バンク×12PAD、12種類の初期音、GATE/LOOP、同時発音、ファイル取込、音源名、トリム、サンプル音量、ピッチ、試聴、編集時の再生・一時停止・波形シーク、波形設定、キーボード操作、ミュート、細かな主音量、自動保存・再起動復元、旧バックアップの読込、PWA更新・オフライン配信を維持しています。保存形式の移行や全データの初期化は行いません。

## 検証結果

1. **自動テスト58件すべて成功**。既存48件に、旧FileReader経路、旧・新バックアップ往復、失敗・中止、コールバックだけの音声デコード、音声有効化、複数指・キャンセル、縦音量、IndexedDBの利用不可・停止時の10件を追加しました。以前とバイト単位で同じ初期音・バックアップ形式になる確認も通過しています。
2. **実行用JavaScript 19ファイルが構文チェックを通過**。Acorn 8.17.0のECMAScript 2019文法で、元の8ファイルにあったエラーがなくなったことを確認しました。起動診断と更新補助ページのスクリプトはES5でも解析成功。これはSafari 12のエンジンによる試験の代用ではありません。
3. **ブラウザでの操作確認24項目を通過**。WindowsのChromiumで通常経路と、iOS 12にないAPIを使えなくした経路を確認。375×667の縦表示と667×375の横表示、タッチ再生、実際のGainNodeへの音量反映、ミュート、PAD外でのGATE解除、ファイル選択、WAV取込、日本語名、編集・一時停止、旧経路のタッチトリムと波形シーク、IndexedDBへのPCM・設定の保存と再読込、バックアップ生成と再読込、サブフォルダーでのオフライン再起動を確認しました。
4. **更新補助ページもブラウザで確認**。新しい待機中SWを明示操作で適用し、保存した音量設定が残ったままアプリを開けることを確認しました。

旧経路の試験ではPointerEvent、ResizeObserver、VisualViewport、Blob.arrayBuffer/text、AudioBuffer.copyToChannel、Array.at、navigator.audioSession/storageを利用不可にし、webkitAudioContextとコールバック型デコードを通しています。iOS 12のUser-Agentだけを変更した試験ではありません。ただし、実行エンジンとOSはChromium/Windowsのままです。

ZIP内の`validation/`にテスト出力・ブラウザ確認結果・構文確認結果・画面画像を入れています。

## 導入手順

1. ZIPを展開し、現在のリポジトリで`index.html`がある場所へ、展開した中身をすべて上書きします。`js/`内の新しい3ファイルと`update-ios12.html`も必要です。ZIPそのものをアップロードするのではなく、中身を配置してください。アプリのビルドやnpm installは不要です。
2. 現在と同じHTTPSのドメイン・配信パスで公開します。GitHub Pagesのbranch/root設定はそのまま利用できます。`tests/`、`validation/`、ドキュメントはアプリ実行には不要です。
3. iOS 12のSafariで公開URLをオンラインで開きます。PADが12個出たら「再生」を一度タップし、端末の消音スイッチを解除し、端末側の音量も上げて確認します。
4. 起動できる旧版ではメニューから更新を確認して適用できます。メニューも動かない・古い画面が残る場合は、公開URLの末尾に`update-ios12.html`を付けて開き、「更新を確認」→必要なら「更新を適用」→「サンプラーを開く」を選びます。ほかの画面で行っている編集・取込は保存完了後に閉じてください。
5. 「オフライン準備済み」を確認した後、通信を切って再起動します。最後に短い音源を取り込み、編集、音量、再起動復元、バックアップを実機で確認してください。

**サイトデータの削除やアプリの削除による入れ直しは不要です。** 保存音源を失う可能性があるため、通常の更新方法として行わないでください。更新補助ページは開いた側の保存領域・SWだけに作用します。Safariとホーム画面アプリの領域が異なる場合、Safari側の操作がホーム画面側まで更新する保証はありません。

差分で適用する場合、対象コミットのチェックアウトで`git apply sampler-pwa-ios12.patch`を実行できます。以後に別の変更が加わっている場合は競合の確認が必要です。

## 残る制約

- **iOS 12実機・当時のSafari/WebKitでは未検証です。** 聴感、発音遅延、複数指の実機挙動、VoiceOver、ホーム画面起動、バックグラウンド・ロック後の復旧、Bluetooth/AirPlayは最終確認が必要です。
- **iOS 12の外部ファイルへのバックアップ保存は保証できません。** `.sx12`の生成・検証・再読込は確認済みですが、Safari/ホーム画面アプリがBlobの別画面や共有から「ファイルに保存」を扱えるかは端末側の制限が残ります。手動リンクの案内を表示し、保存成功とは表示しません。保存できない端末で端末データを削除しないでください。
- iOS 12では新しいaudioSessionによる消音モード回避を利用できません。消音スイッチを解除し、Web Audioを利用者のタップで開始する必要があります。Volumeはアプリ内の音量であり、端末のシステム音量は端末ボタンで操作します。
- 再生可能な圧縮形式は実機Safariのデコーダー次第です。WAV/MP3/AACを優先し、OGG・FLACなどの対応は保証しません。ブラウザ試験の入力は合成した2秒のPCM WAVです。
- 10分・200MBの取込上限など既存値は維持しましたが、古い端末のメモリで処理できる量を保証するものではありません。大量・長時間の音源は未負荷試験です。
- IndexedDBが利用不可・ブロック・応答停止の場合は演奏できても自動保存できません。タイムアウトは各操作5秒です。大容量のデータの復元が5秒を超える端末でも保存エラー扱いになる可能性があります。保存失敗時に既存領域を初期化する処理はありません。
- OSの容量管理・サイトデータ削除などによる永続保存の保証はできません。Safariとホーム画面アプリ、異なるドメインや配信パスの間で音源が自動移動する保証もありません。
- HTMLを端末の「ファイル」から直接開く方法は対象外です。モジュールの正しいMIMEとHTTP/HTTPS配信が必要で、PWAにはHTTPS（開発時localhostを除く）が必要です。

## 確認に使用した一次資料

- [WebKit: Safari 13.1の新機能](https://webkit.org/blog/10247/new-webkit-features-in-safari-13-1/) — nullish coalescing、ResizeObserverなどの追加時期。
- [Apple: Safari 13 Release Notes](https://developer.apple.com/documentation/safari-release-notes/safari-13-release-notes) — Pointer Events、Visual Viewportの追加。
- [WebKit: Safari 14.1の新機能](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/) — Flexbox gapとWeb Audioの対応改善。
- [Apple: Playing Sounds with the Web Audio API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/PlayingandSynthesizingSounds/PlayingandSynthesizingSounds.html) — iOSの操作起点の音声開始と旧Web Audio。
