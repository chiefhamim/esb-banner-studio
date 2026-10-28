@echo off
cd /d "%~dp0"
echo Checking for latest updates from GitHub...
git pull --rebase --autostash origin main
echo Starting Git 1:1 Auto-Sync background daemon...
start "" /b node tools\git-sync.mjs
start "" ".\node_modules\electron\dist\electron.exe" .
