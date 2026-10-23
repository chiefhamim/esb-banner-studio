import { execSync } from 'node:child_process';

const POLL_INTERVAL_MS = 20000; // 20 seconds

console.log('[Git-AutoSync] Daemon started. Monitoring origin/main for live updates...');

function sync() {
  try {
    // 1. Fetch remote silently
    execSync('git fetch origin main', { stdio: 'pipe' });

    // 2. Check local vs remote commit SHAs
    const localSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const remoteSha = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();

    if (localSha !== remoteSha) {
      console.log(`[Git-AutoSync] New remote changes detected! Pulling from origin/main...`);
      const pullOut = execSync('git pull --rebase --autostash origin main', { encoding: 'utf8' });
      console.log(pullOut.trim());
      const newHead = execSync('git log -1 --oneline', { encoding: 'utf8' }).trim();
      console.log(`[Git-AutoSync] Updated to latest commit: ${newHead}`);
    }
  } catch (err) {
    // Ignore transient network errors (e.g. temporary DNS or offline)
    if (err && err.message && !err.message.includes('Could not resolve host')) {
      console.error('[Git-AutoSync] Sync error:', err.message);
    }
  }
}

// Run immediately on launch
sync();

// Poll periodically
setInterval(sync, POLL_INTERVAL_MS);
