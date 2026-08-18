#!/bin/bash
# 素材｜効果音・BGM送り（SozaiDrop）を Premiere Pro に入れるスクリプト（macOS用）
# ダブルクリックで実行してください。素材ファイルには一切さわりません。

cd "$(dirname "$0")" || exit 1
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"

echo "==============================================="
echo " 素材｜効果音・BGM送り（SozaiDrop）を入れます"
echo "==============================================="
echo ""

if [ ! -d "./SozaiDrop" ]; then
  echo "❌ このスクリプトと同じ場所に SozaiDrop フォルダがありません。"
  echo "   zip を展開したフォルダの中で実行してください。"
  echo ""
  read -n 1 -s -r -p "何かキーを押すと閉じます"
  exit 1
fi

# 1) 署名なしパネルを読み込めるようにする（これが無いとメニューに出ない）
echo "1/3 署名なしパネルの許可を入れています…"
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null
done
killall cfprefsd 2>/dev/null
echo "    OK"

# 2) 置き場所を作る
echo "2/3 置き場所を用意しています…"
mkdir -p "$DEST"
echo "    $DEST"

# 3) コピー（前のものがあれば日時つきで退避してから）
echo "3/3 パネルをコピーしています…"
if [ -L "$DEST/SozaiDrop" ]; then
  # 開発者本人のMac向けの安全装置：ここがショートカット（シンボリックリンク）なら、
  # 作業中の本体を指している。上書きすると開発環境が壊れるので止める。
  echo ""
  echo "⚠️  すでに入っている SozaiDrop は「ショートカット」です。"
  echo "    開発中の本体を指している可能性が高いため、上書きしませんでした。"
  echo "    （配布物を試したいだけなら、別のMacか、先にショートカットを外してください）"
  echo ""
  read -n 1 -s -r -p "何かキーを押すと閉じます"
  exit 1
fi

if [ -e "$DEST/SozaiDrop" ]; then
  BK="$DEST/SozaiDrop.backup-$(date +%Y%m%d-%H%M%S)"
  mv "$DEST/SozaiDrop" "$BK"
  echo "    前のものは $BK に退避しました"
fi
cp -R "./SozaiDrop" "$DEST/SozaiDrop"
rm -f "$DEST/SozaiDrop/.debug"
echo "    OK"

echo ""
echo "✅ 完了しました。"
echo ""
echo "つぎにやること："
echo "  1. Premiere Pro を一度終了して、開き直す"
echo "  2. 上のメニュー「ウィンドウ」→「エクステンション」→「素材｜効果音・BGM送り」"
echo ""
read -n 1 -s -r -p "何かキーを押すと閉じます"
echo ""
