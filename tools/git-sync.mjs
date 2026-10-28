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
    // 1. Fetch remote silently
    execSync('git fetch origin main', { cwd: ROOT_DIR, stdio: 'pipe' });

    // 2. Check local vs remote commit SHAs
    const localSha = execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
    const remoteSha = execSync('git rev-parse origin/main', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();

    if (localSha !== remoteSha) {
      log(`New remote changes detected! Local: ${localSha.slice(0, 7)} -> Remote: ${remoteSha.slice(0, 7)}`);
      log('Pulling latest commits from origin/main...');
      const pullOut = execSync('git pull --rebase --autostash origin main', { cwd: ROOT_DIR, encoding: 'utf8' });
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
