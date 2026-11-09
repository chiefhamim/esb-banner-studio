import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const LOG_FILE = path.join(__dirname, 'sync.log');
const PID_FILE = path.join(__dirname, '.sync.pid');

const POLL_INTERVAL_MS = 20000; // 20 seconds

function log(msg) {
  const line = `[${new Date().toISOString()}] [Git-AutoSync] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
}

// Single instance guard via PID file
if (fs.existsSync(PID_FILE)) {
  try {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!isNaN(existingPid)) {
      // Check if process is still running
      try {
        process.kill(existingPid, 0);
        log(`Another Git-AutoSync instance is already running (PID: ${existingPid}). Exiting.`);
        process.exit(0);
      } catch {
        // Process is dead, stale lockfile
        log(`Removing stale PID file from PID ${existingPid}.`);
      }
    }
  } catch {}
}

try {
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
} catch {}

const cleanup = () => {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {}
};

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

log(`Daemon started (PID: ${process.pid}). Monitoring origin/main for live updates (20s interval)...`);

let isSyncing = false;

function sync() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    // Only follow GitHub while the checkout is on main: on a work branch (or mid-rebase) it must never pull, stash or
    // rebuild under the person working. It used to compare HEAD with origin/main, so ANY local commit looked like
    // "new remote changes" and it rebased + ran `npm run build` every 20 s forever (2026-11-09).
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
    if (branch !== 'main') return;

    // 1. Fetch remote silently
    execSync('git fetch origin main', { cwd: ROOT_DIR, stdio: 'pipe' });

    // 2. Act only when this PC is BEHIND origin/main (local-only commits are left alone)
    const behind = parseInt(execSync('git rev-list --count HEAD..origin/main', { cwd: ROOT_DIR, encoding: 'utf8' }).trim(), 10) || 0;

    if (behind > 0) {
      log(`${behind} new commit(s) on origin/main.`);
      log('Fast-forwarding to origin/main...');
      const pullOut = execSync('git pull --ff-only origin main', { cwd: ROOT_DIR, encoding: 'utf8' });
      log(`Pull completed: ${pullOut.trim()}`);

      const newHead = execSync('git log -1 --oneline', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
      log(`Updated to latest commit: ${newHead}`);

      // Rebuild the production bundle so Electron serves the latest code immediately
      log('Rebuilding production bundle (npm run build)...');
      execSync('npm run build', { cwd: ROOT_DIR, stdio: 'pipe' });
      log('Build completed successfully. Local app is 1:1 with GitHub.');
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (!msg.includes('Could not resolve host') && !msg.includes('Connection refused')) {
      log(`Sync notice/error: ${msg}`);
    }
  } finally {
    isSyncing = false;
  }
}

// Run immediately on launch
sync();

// Poll periodically
setInterval(sync, POLL_INTERVAL_MS);
