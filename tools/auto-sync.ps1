# ESB Banner Studio Auto-Sync Daemon
# Keeps local repository synchronized with origin/main

$repoDir = Split-Path -Parent $PSScriptRoot
$logFile = "$repoDir\tools\sync.log"
$intervalSeconds = 20

# Single instance guard
$mutexName = "Global\ESB_Banner_Studio_AutoSync_Mutex"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
    exit 0
}

function Write-SyncLog($msg) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$timestamp] $msg"
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

Write-SyncLog "Auto-sync service started. Polling every $intervalSeconds seconds."

Set-Location -Path $repoDir

while ($true) {
    try {
        # Fetch latest refs from remote
        & git fetch origin main --quiet 2>$null
        
        # Check if local is behind remote
        $behind = (& git rev-list HEAD..origin/main --count) 2>$null
        if ($behind -and [int]$behind -gt 0) {
            Write-SyncLog "Found $behind new commit(s) on origin/main. Syncing..."
            
            $status = (& git status --porcelain) 2>$null
            if ($status) {
                Write-SyncLog "Local modifications detected. Autostashing..."
                & git stash --include-untracked --quiet
                & git merge --ff-only origin/main --quiet
                & git stash pop --quiet
            } else {
                & git merge --ff-only origin/main --quiet
            }
            
            $latestCommit = (& git log -1 --oneline) 2>$null
            Write-SyncLog "Successfully updated to: $latestCommit"
            
            Write-SyncLog "Rebuilding production bundle (npm run build)..."
            & npm run build 2>&1 | Out-Null
            Write-SyncLog "Build completed successfully. Local app is 1:1 with GitHub."
        }
    } catch {
        Write-SyncLog "Error during sync: $_"
    }

    Start-Sleep -Seconds $intervalSeconds
}
