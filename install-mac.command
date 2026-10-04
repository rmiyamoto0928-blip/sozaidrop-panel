#!/bin/bash
# 素材｜効果音・BGM送り（SozaiDrop）を Premiere Pro に入れるスクリプト（macOS用）
# ダブルクリックで実行してください。素材ファイルには一切さわりません。
# 試すとき：SOZAI_TEST_DEST=<練習用の置き場所> SOZAI_NO_PAUSE=1 を付けると、本物の置き場所と設定に触れずに通せます。

cd "$(dirname "$0")" || exit 1
DEST="${SOZAI_TEST_DEST:-$HOME/Library/Application Support/Adobe/CEP/extensions}"
# 前の版の退避先。extensions の外に置く（中に置くと Premiere が同じパネルを2つ読もうとする）
BKROOT="$(dirname "$DEST")/SozaiDrop_前の版"

pause() { [ -n "${SOZAI_NO_PAUSE:-}" ] || read -n 1 -s -r -p "何かキーを押すと閉じます"; echo ""; }

echo "==============================================="
echo " 素材｜効果音・BGM送り（SozaiDrop）を入れます"
echo "==============================================="
echo ""

# 0) 中身がそろっているか・入れる先が「ショートカット」でないかを、何か変える前に全部確かめる
if [ ! -f "./SozaiDrop/CSXS/manifest.xml" ] || [ ! -f "./SozaiDrop/index.html" ]; then
  echo "❌ このスクリプトと同じ場所に SozaiDrop フォルダが無いか、中身が足りません。"
  echo "   zip を展開したフォルダの中で実行してください。"
  echo ""; pause; exit 1
fi
if [ -L "$DEST" ]; then
  echo "⚠️  パネルの置き場所そのものが「ショートカット」です。何も変えずに止めました。"
  echo "    $DEST"
  echo ""; pause; exit 1
fi
if [ -L "$DEST/SozaiDrop" ]; then
  # 開発者本人のMac向けの安全装置：ここがショートカット（シンボリックリンク）なら、
  # 作業中の本体を指している。上書きすると開発環境が壊れるので止める。
  echo "⚠️  すでに入っている SozaiDrop は「ショートカット」です。"
  echo "    開発中の本体を指している可能性が高いため、何も変えずに止めました。"
  echo "    （配布物を試したいだけなら、別のMacか、先にショートカットを外してください）"
  echo ""; pause; exit 1
fi

# 1) 署名なしパネルを読み込めるようにする（これが無いとメニューに出ない）
echo "1/3 署名なしパネルの許可を入れています…"
if [ -z "${SOZAI_TEST_DEST:-}" ]; then
  for v in 9 10 11 12; do
    defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null
  done
  killall cfprefsd 2>/dev/null
fi
echo "    OK"

# 2) 置き場所を作る
echo "2/3 置き場所を用意しています…"
mkdir -p "$DEST" || { echo "❌ 置き場所を作れませんでした: $DEST"; pause; exit 1; }
echo "    $DEST"

# 3) コピー（前のものがあれば日時つきで退避してから）
echo "3/3 パネルをコピーしています…"
# 古いスクリプトは前の版を extensions の中（SozaiDrop.backup-日時）に残していた。同じパネルが2つ読まれないよう外へ移す
for old in "$DEST"/SozaiDrop.backup-*; do
  [ -d "$old" ] && [ ! -L "$old" ] || continue
  to="$BKROOT/$(basename "$old")"
  [ ! -e "$to" ] && mkdir -p "$BKROOT" && mv "$old" "$to" || { echo "❌ 古い退避フォルダを外へ移せませんでした: $old"; pause; exit 1; }
  echo "    古い退避フォルダを外へ移しました: $to"
done
if [ -e "$DEST/SozaiDrop" ]; then
  BK="$BKROOT/$(date +%Y%m%d-%H%M%S)"
  n=2; while [ -e "$BK" ]; do BK="$BKROOT/$(date +%Y%m%d-%H%M%S)-$n"; n=$((n+1)); done
  mkdir -p "$BK" && mv "$DEST/SozaiDrop" "$BK/SozaiDrop" || { echo "❌ 前の SozaiDrop を退避できませんでした"; pause; exit 1; }
  echo "    前のものは退避しました: $BK"
fi
cp -R "./SozaiDrop" "$DEST/SozaiDrop" || { echo "❌ SozaiDrop をコピーできませんでした"; pause; exit 1; }
rm -f "$DEST/SozaiDrop/.debug"
echo "    OK"

echo ""
echo "✅ 完了しました。"
echo ""
echo "つぎにやること："
echo "  1. Premiere Pro を一度終了して、開き直す"
echo "  2. 上のメニュー「ウィンドウ」→「エクステンション」→「素材｜効果音・BGM送り」"
echo ""
pause
