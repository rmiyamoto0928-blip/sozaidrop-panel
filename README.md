# 素材｜効果音・BGM送り（SozaiDrop）

Premiere Pro の中から、**効果音やBGMをクリック1回でタイムラインに置ける**パネルです。
素材フォルダを1回登録しておけば、あとは「① 種類 → ② 場所 → ③ 場面 → ④ 中身」と
上から順にしぼり込んで、聴きながら選んで、そのまま挿入できます。

![段階](https://img.shields.io/badge/Premiere%20Pro-22.0%20以降-blue) ![確認](https://img.shields.io/badge/動作確認-macOS-green)

---

## できること

- **クリック1回で挿入** … 効果音は指定トラック（例：A3）、BGMは別トラック（例：A4）へ自動で振り分け
- **マウスを乗せるだけで試聴** … いちいち開かなくても音が確認できる
- **4段階のしぼり込み** … 種類（効果音／BGM）→ 場所（プロジェクト内／PCフォルダ）→ 場面 → 中身
- **タグの自動付け** … ファイル名から「衝撃」「笑い」などのタグを自動で付ける
- **★よく使う / ☑チェック** … 定番はお気に入り登録、まとめて挿入したいときはチェックして一括挿入
- **書き出し** … チェックした素材を zip にまとめて人に送れる

---

## 動作条件

| 項目 | 内容 |
|---|---|
| ソフト | Adobe Premiere Pro 22.0 以降 |
| OS | macOS（**動作確認ずみ**）／ Windows（作りの上では動くはずですが**未確認**です） |
| その他 | 追加のインストールは不要（Node.js などは要りません） |

---

## 入れ方（Mac）

### かんたんな方法（おすすめ）

1. このページの緑の「**Code**」ボタン →「**Download ZIP**」でダウンロード
2. ダウンロードした zip をダブルクリックして展開する
3. 出てきたフォルダの中の `install-mac.command` を**ダブルクリック**
   - 「開発元が未確認」と出たら、そのファイルを**右クリック →「開く」**を選ぶ
4. 「完了しました」と出たら、**Premiere Pro を一度終了して開き直す**
5. Premiere の上のメニュー「**ウィンドウ**」→「**エクステンション**」→「**素材｜効果音・BGM送り**」

前の版が入っていたときは、`~/Library/Application Support/Adobe/CEP/SozaiDrop_前の版` に日時つきで退避されます
（パネルの置き場所の外なので、Premiere が同じパネルを2つ読むことはありません）。

### 手でやる方法

1. 下のフォルダを開く（Finder の「移動」メニュー →「フォルダへ移動…」に貼る）

   ```text
   ~/Library/Application Support/Adobe/CEP/extensions
   ```

2. この中に `SozaiDrop` フォルダをそのままコピーする
   - 前の版があって「置き換えますか？」と聞かれたら「**置き換える**」を選ぶ
     （「両方とも残す」を選ぶと同じパネルが2つになり、正しく動きません）
3. 署名のないパネルを読み込めるようにする（**これをやらないとメニューに出ません**）。
   ターミナルに貼って実行：

   ```bash
   for v in 9 10 11 12; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done; killall cfprefsd
   ```

4. Premiere Pro を終了して開き直す

## 入れ方（Windows・未確認）

1. zip を展開する
2. 中の `install-win.bat` を**ダブルクリック**（管理者として実行する必要はありません）
   - 青い「Windows によって PC が保護されました」が出たら「詳細情報」→「実行」
3. 「完了しました」と出たら、Premiere Pro を終了して開き直す

前の版が入っていたときは、`%APPDATA%\Adobe\CEP\SozaiDrop_backup` に日時つきで退避されます。

手でやる場合は、`SozaiDrop` フォルダを次の場所へコピーし（前の版があれば先に消してから）、

```text
C:\Users\(あなたの名前)\AppData\Roaming\Adobe\CEP\extensions
```

コマンドプロンプトに次を貼って実行してから、Premiere Pro を開き直します。

```bat
for %v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%v" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

---

## 使い方（最初の1回だけ）

1. パネル右上の「**⋯**」を押す
2. 「**＋ 素材フォルダを登録**」で、効果音やBGMが入っているフォルダを選ぶ
3. 「**⟳ 更新**」を押すと一覧に出てきます
4. 一覧をクリック → タイムラインの再生ヘッドの位置に挿入されます

挿入先のトラック（A3 / A4）や「上書きするか」は、パネル下の「**⚙**」の中で変えられます。
一覧が狭いと感じたら、「④ 中身」の見出しの右の「**絞り込み ▲**」を押すと上の段がたたまれて広くなります。

---

## 消したいとき

`~/Library/Application Support/Adobe/CEP/extensions/SozaiDrop` フォルダを
ゴミ箱に入れて、Premiere を開き直すだけです。素材そのものには一切さわりません。
前の版の控え（`~/Library/Application Support/Adobe/CEP/SozaiDrop_前の版`）も、要らなければゴミ箱へ。

---

## 中身について（開発する人向け）

- `index.html` / `css/` / `js/` … パネルの画面と動き（CEP11・ES5のみ）
- `jsx/hostscript.jsx` … Premiere 本体を操作する部分（ExtendScript / ES3）
- `test/harness.html` … 自動チェック（1174件）。ブラウザで直接開くとキャッシュで古いHTMLを掴むため、
  ヘッドレスChrome（`--headless=new --dump-dom --virtual-time-budget`）で回してください
- `docs/notes/` … 改修時の設計メモ

---

## 使用条件

- **自由に使えます** … 個人でも、お仕事の動画編集でも、無料で使ってかまいません
- **やめてほしいこと** … このパネルそのものを**再配布・販売すること**（改造したものも含みます）
- 不具合があっても責任は負えません（自己責任でお願いします）

（作者：© 2026 tomitachimare / All rights reserved）

---

## 注意

- このパネルは**署名されていません**。そのため上の「PlayerDebugMode」の設定が必要です
- 素材ファイルを**書き換えたり消したりはしません**（読み取りと、Premiereへの配置のみ）
- 不具合や要望があれば Issues へどうぞ
