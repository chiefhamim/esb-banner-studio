@echo off
cd /d "%~dp0"
echo Checking for latest updates from GitHub...
git pull --rebase --autostash origin main
start "" ".\node_modules\electron\dist\electron.exe" .
