@echo off
chcp 65001 >nul
rem 素材｜効果音・BGM送り（SozaiDrop）を Premiere Pro に入れるスクリプト（Windows用・未確認）
rem 右クリック →「管理者として実行」してください。

echo ===============================================
echo  素材^|効果音・BGM送り（SozaiDrop）を入れます
echo ===============================================
echo.

if not exist "%~dp0SozaiDrop" (
  echo [エラー] このファイルと同じ場所に SozaiDrop フォルダがありません。
  echo          zip を展開したフォルダの中で実行してください。
  pause
  exit /b 1
)

set DEST=%APPDATA%\Adobe\CEP\extensions

echo 1/3 署名なしパネルの許可を入れています...
for %%v in (9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo     OK

echo 2/3 置き場所を用意しています...
if not exist "%DEST%" mkdir "%DEST%"
echo     %DEST%

echo 3/3 パネルをコピーしています...
if exist "%DEST%\SozaiDrop" (
  ren "%DEST%\SozaiDrop" "SozaiDrop.backup-%RANDOM%"
  echo     前のものは SozaiDrop.backup-... に退避しました
)
xcopy "%~dp0SozaiDrop" "%DEST%\SozaiDrop\" /E /I /Q /Y >nul
if exist "%DEST%\SozaiDrop\.debug" del "%DEST%\SozaiDrop\.debug"
echo     OK

echo.
echo 完了しました。
echo.
echo つぎにやること：
echo   1. Premiere Pro を一度終了して、開き直す
echo   2. 上のメニュー「ウィンドウ」→「エクステンション」→「素材^|効果音・BGM送り」
echo.
pause
