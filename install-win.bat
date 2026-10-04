@echo off
chcp 65001 >nul
setlocal
rem 素材｜効果音・BGM送り（SozaiDrop）を Premiere Pro に入れるスクリプト（Windows用・未確認）
rem ダブルクリックで実行してください（自分のユーザーの設定だけを変えるので、管理者として実行する必要はありません）。

echo ===============================================
echo  素材^|効果音・BGM送り（SozaiDrop）を入れます
echo ===============================================
echo.

set "CEPDIR=%APPDATA%\Adobe\CEP"
set "DEST=%CEPDIR%\extensions"
rem 前の版の退避先。extensions の外に置く（中に置くと Premiere が同じパネルを2つ読もうとする）
rem 名前を英字にしているのは、バッチの中の日本語のパスは化けることがあるため
set "BKROOT=%CEPDIR%\SozaiDrop_backup"

rem 0) 中身がそろっているか・入れる先が「ショートカット」でないかを、何か変える前に全部確かめる
if not exist "%~dp0SozaiDrop\CSXS\manifest.xml" goto :missing
if not exist "%~dp0SozaiDrop\index.html" goto :missing
dir /AL /B "%CEPDIR%" 2>nul | findstr /X /I /C:"extensions" >nul && goto :destlink
dir /AL /B "%DEST%" 2>nul | findstr /X /I /C:"SozaiDrop" >nul && goto :panellink

echo 1/3 署名なしパネルの許可を入れています...
for %%v in (9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo     OK

echo 2/3 置き場所を用意しています...
if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%" goto :fail
echo     %DEST%

echo 3/3 パネルをコピーしています...
rem 古いスクリプトは前の版を extensions の中（SozaiDrop.backup-...）に残していた。同じパネルが2つ読まれないよう外へ移す
set "MOVEFAIL="
for /d %%d in ("%DEST%\SozaiDrop.backup-*") do call :movelegacy "%%~fd"
if defined MOVEFAIL goto :fail
if not exist "%DEST%\SozaiDrop" goto :copy
set "STAMP="
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss" 2^>nul`) do set "STAMP=%%t"
if not defined STAMP set "STAMP=%RANDOM%"
if exist "%BKROOT%\%STAMP%" set "STAMP=%STAMP%-%RANDOM%"
mkdir "%BKROOT%\%STAMP%" || goto :fail
move "%DEST%\SozaiDrop" "%BKROOT%\%STAMP%\SozaiDrop" >nul || goto :fail
echo     前のものは退避しました: %BKROOT%\%STAMP%
:copy
xcopy "%~dp0SozaiDrop" "%DEST%\SozaiDrop\" /E /I /Q /Y >nul || goto :fail
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
exit /b 0

:movelegacy
if not exist "%BKROOT%" mkdir "%BKROOT%"
if exist "%BKROOT%\%~nx1" (set "MOVEFAIL=1" & exit /b 1)
move "%~1" "%BKROOT%\%~nx1" >nul || (set "MOVEFAIL=1" & exit /b 1)
echo     古い退避フォルダを外へ移しました: %BKROOT%\%~nx1
exit /b 0

:missing
echo [エラー] このファイルと同じ場所に SozaiDrop フォルダが無いか、中身が足りません。
echo          zip を展開したフォルダの中で実行してください。
pause
exit /b 1

:destlink
echo [止めました] パネルの置き場所そのものが「ショートカット（リンク）」です。何も変えていません。
echo          %DEST%
pause
exit /b 1

:panellink
echo [止めました] すでに入っている SozaiDrop は「ショートカット（リンク）」です。
echo          開発中の本体を指している可能性が高いため、何も変えていません。
pause
exit /b 1

:fail
echo [エラー] 途中で失敗しました。Premiere Pro を閉じてから、もう一度実行してください。
echo          それでも同じなら、上に出たメッセージを作者に知らせてください。
pause
exit /b 1
