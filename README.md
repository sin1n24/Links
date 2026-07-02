# testLinks

[Links Web β](./index.html)

リンク機構シミュレータ「Links」（Win版, C++/DXライブラリ製）のWeb移植版です。`Links/`・`Common/` 以下がWin版の原典ソース、それ以外のルート直下のファイルがWeb版です。

全ての機能を使いたい場合はWin版をご利用頂き、使い方についても[Win版の取説](https://signed.bufsiz.jp/Links.html)をご覧下さい。なおWin版の開発は停止しており今後追加機能実装の予定はありません。

## 構成

ビルド不要の素のHTML/CSS/JS（`<script>` タグを直列に読み込むだけ）。DXF読み込みのみ [dxf](https://github.com/bjnortier/dxf) パッケージ（MIT）のブラウザ用ビルドを `vendor/dxf.umd.js` にvendorして使用しています（元のC++版の自作パーサはLWPOLYLINE/DXF2000形式を読めなかったため）。

| ファイル | 役割 |
|---|---|
| `index.html` | ページ構造・CSS |
| `datatypes.js` | `Point`/`Cyclo` などの幾何プリミティブ (`Common/cal.h` 相当) |
| `graphics.js` | Canvas描画・パン/ズーム (`Common/graphic.h` 相当) |
| `dxf_io.js` | DXF読み込み(vendor `dxf` 経由)・DXF/AutoCADコマンド書き出し (`Common/dxf.h` 相当) |
| `simulation.js` | `Hecken` クラス本体。運動学・最適化曲線・保存/読込 (`Links/hecken.h` 相当) |
| `graph_panel.js` | 速度/角度グラフパネル (`Hecken.prototype` に追加) |
| `cad_export.js` | AutoCADコマンド/DXF出力の組み立て |
| `animation.js` | 矩形選択+WebM動画出力（元のGIFアニメ機能の代替） |
| `config.js` | 背景色などの設定の localStorage 永続化 |
| `ui.js` | DOM UI（パラメータ表・メニュー・モーダル） |
| `main.js` | 起動処理・アニメーションループ |
| `vendor/dxf.umd.js` | vendorしたDXFパーサ（MIT License, [bjnortier/dxf](https://github.com/bjnortier/dxf)） |

## テスト

コア運動学・DXF入出力・シーンの保存/読込を [Vitest](https://vitest.dev/) でカバーしています（DOM/Canvas非依存の部分のみ；UI層はブラウザで手動確認済み）。

```
npm install
npm test
```

## ローカルでの動作確認

ビルド不要なので、任意の静的サーバで配信するだけで動作します。

```
python -m http.server 8000
```

