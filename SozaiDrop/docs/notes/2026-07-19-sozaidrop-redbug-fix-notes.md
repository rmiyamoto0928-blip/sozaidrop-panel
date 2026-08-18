# SozaiDrop 🔴重大バグ修正ノート（2026-07-19）

クロスチェック(GPT-5.6×Claude)確定分。対象: js/main.js, jsx/hostscript.jsx。ES3厳守(jsx)。

## 変えたこと / 理由

### 🔴1 NFC/NFD不一致による挿入失敗＋重複import増殖
- 変えた: パネル側で `it.path`(原文NFD) と `it.pathN`(NFC) の両方をJSXへ渡す。JSXの `sdSearchBin` は `getMediaPath()` を両方と文字列比較。`sdImportItem` にimport直後の新規クリップを返すフォールバック(`sdNewestClipInBin`)を追加。
- 理由: ES3に `String.normalize` が無く、濁点入り(ガ/ド/バ等)で事前検索が外れ→毎回re-import＋null返しで「読み込み失敗」。両形比較で一致させ、取りこぼしは新規クリップで救う。

### 🔴2a 非上書き複数挿入の位置累積ズレ
- 変えた: 非上書き(insertClip)は挿入位置を降順(後ろのクリップから)で処理。上書きは従来どおり昇順。
- 理由: insertClipが後続を右シフトするため昇順だと2個目以降が古い座標＝前クリップ内に刺さる。後ろから処理すれば前の位置計算が狂わない。

### 🔴2b overwrite失敗時の暗黙insertフォールバック削除
- 変えた: overwriteClip例外時に黙ってinsertClipへ切替える処理を削除し、失敗(ng)として数える。
- 理由: 上書き指定なのにinsertで後続が右ずれ＆音ズレし、成功カウントで気づけないため。

### 🟡5 settings.json 非アトミック書き込みでデータ消失
- 変えた: 一時ファイル→renameSyncで原子的差し替え＋.bak1世代保持。読み込みは本体破損時に.bakから復旧、両方破損時のみ生ファイルを.corruptへ退避し警告表示して空起動(空で上書き確定させない)。
- 理由: 書込中クラッシュ→半端JSON→次回parse失敗→空設定→saveSettingsが空で上書き確定、の消失連鎖を断つ。

### 🟡3 "EvalScript error." の成功表示
- 変えた: `result.indexOf('OK:')!==0` を失敗扱いにするホワイトリスト方式へ(insertItem/bulkInsert両方)。
- 理由: 旧実装はERR:とundefinedしか弾かず、JSX未ロード時の "EvalScript error." を緑successで表示していた。

## 却下した案
- JSX側でNFC正規化して比較する案: ES3にnormalizeが無く実装不能。パネル側で両形を作って渡す方式を採用。
- 🔴2bで「インサートで代替n件」と明示表示する案: 上書き指定時の暗黙シフト自体が音ズレ源なので、代替せず失敗計上に統一(既存の「失敗n件」表示に集約)。
- 🟡5で破損時に既存を絶対上書き禁止(保存不能)にする案: アプリが使えなくなるため不採用。.corrupt退避＋復旧で無言消失のみ防止。

## 検証
- pure logic: scratchpad/sozaidrop_test.js 17件PASS(アトミック保存/復旧9・降順order3・OK判定5)。
- 構文: node --check(jsx/main.js)OK、jsxのES3禁止構文grepクリーン。
- 実機必須(Node検証不能): NFD日本語SEの実挿入で重複importなし・挿入成功、非上書き20連続でズレなし、上書き失敗時の「失敗n件」表示、JSX未ロード時の赤エラー表示。

## PENDING(今回未着手)
🟡4 kindByName祖先フォルダ名判定 / 🟡6 autotag短英字部分一致 / ⚪7 zip -j同名衝突 / ⚪8 rescan競合 /
⚪9 checkedPaths生パスキー / ⚪10 特殊文字 / ⚪11 デッドコード(sdInsert/D&D) / ⚪12 usage統計インフレ / ⚪13 duration失敗フォールバック1秒。
