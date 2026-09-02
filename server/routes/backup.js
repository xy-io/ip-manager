// ============================================================
//  Cloud backup routes
//
//  Scheduled backup of the database to any rclone-supported remote —
//  S3, SFTP, Dropbox, Google Drive, or a local path.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { exec, execFile, execSync, execFileSync } = require('child_process');

module.exports = function registerBackupRoutes(app, deps) {
  const { dbGet, dbSet, requireAuth } = deps;
  // ── Cloud Backup ──────────────────────────────────────────────────────────────
  // Uses rclone for cloud storage (S3-compatible, SFTP, Dropbox, Google Drive).
  // rclone config is stored at server/rclone.conf (owned by www-data, mode 600).
  // Scheduling is handled in-process with setTimeout (no system cron needed).

  // '..' because this module lives in server/routes/ — install.sh creates and
  // chmods server/rclone.conf, and existing installs already have it there.
  const RCLONE_CONF = path.join(__dirname, '..', 'rclone.conf');

  function getBackupConfig() {
    return dbGet('backup_config') || {
      enabled:     false,
      schedule:    'daily',   // 'daily' | 'weekly' | 'manual'
      time:        '02:00',
      dayOfWeek:   0,         // 0=Sunday … 6=Saturday (weekly only)
      remoteName:  '',
      remotePath:  'ip-manager-backups/',
      retention:   7,
      lastRun:     null,
      lastStatus:  null,      // 'ok' | 'error'
      lastError:   null,
    };
  }

  function isRcloneAvailable() {
    try { require('child_process').execSync('which rclone', { timeout: 3000 }); return true; }
    catch { return false; }
  }

  // Build the backup payload (same schema as the manual browser backup)
  function buildBackupPayload() {
    return JSON.stringify({
      version:    '1.8',
      exportedAt: new Date().toISOString(),
      networks:   dbGet('networks')  || [],
      ipData:     dbGet('ip_data')   || [],
    }, null, 2);
  }

  let backupTimer   = null;
  let backupRunning = false;

  // Delete files in a remote path that exceed the retention count.
  // File names embed a sortable timestamp so lexicographic order = age order.
  async function pruneOldBackups(remoteName, remotePath) {
    const retention = getBackupConfig().retention;
    if (!retention || retention <= 0) return;
    return new Promise((resolve) => {
      execFile('rclone', ['--config', RCLONE_CONF, 'lsf', `${remoteName}:${remotePath}`],
        { timeout: 20000 }, (err, stdout) => {
          if (err) return resolve();
          const files = stdout.trim().split('\n')
            .map(f => f.trim())
            .filter(f => f.startsWith('ip-manager-backup-') && f.endsWith('.json'))
            .sort(); // lexicographic = chronological for our filename format
          if (files.length <= retention) return resolve();
          const toDelete = files.slice(0, files.length - retention);
          let pending = toDelete.length;
          if (!pending) return resolve();
          toDelete.forEach(file => {
            execFile('rclone', ['--config', RCLONE_CONF, 'deletefile', `${remoteName}:${remotePath}${file}`],
              { timeout: 15000 }, () => { if (--pending === 0) resolve(); });
          });
        });
    });
  }

  async function runBackup() {
    if (backupRunning) return { ok: false, message: 'Backup already running' };
    const config = getBackupConfig();
    if (!config.remoteName) return { ok: false, message: 'No remote configured' };
    if (!isRcloneAvailable()) return { ok: false, message: 'rclone not installed' };

    backupRunning = true;
    const ts      = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const fname   = `ip-manager-backup-${ts}.json`;
    const tmpFile = `/tmp/${fname}`;
    const remotePath = config.remotePath.endsWith('/') ? config.remotePath : config.remotePath + '/';

    try {
      fs.writeFileSync(tmpFile, buildBackupPayload());

      await new Promise((resolve, reject) => {
        execFile('rclone', ['--config', RCLONE_CONF, 'copy', tmpFile,
          `${config.remoteName}:${remotePath}`, '--log-level', 'ERROR'],
          { timeout: 60000 }, (err, _out, stderr) => {
            err ? reject(new Error((stderr || err.message).trim())) : resolve();
          });
      });

      await pruneOldBackups(config.remoteName, remotePath);

      const now     = new Date().toISOString();
      const updated = { ...config, lastRun: now, lastStatus: 'ok', lastError: null };
      dbSet('backup_config', updated);
      console.log(`[backup] Uploaded ${fname} → ${config.remoteName}:${remotePath}`);
      return { ok: true };
    } catch (err) {
      const now     = new Date().toISOString();
      const updated = { ...config, lastRun: now, lastStatus: 'error', lastError: err.message };
      dbSet('backup_config', updated);
      console.error('[backup] Failed:', err.message);
      return { ok: false, message: err.message };
    } finally {
      backupRunning = false;
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  function scheduleBackup() {
    if (backupTimer) { clearTimeout(backupTimer); backupTimer = null; }
    const config = getBackupConfig();
    if (!config.enabled || !config.remoteName || config.schedule === 'manual') return;

    const now  = new Date();
    const [h, m] = (config.time || '02:00').split(':').map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    if (config.schedule === 'weekly') {
      const target = config.dayOfWeek ?? 0;
      while (next.getDay() !== target) next.setDate(next.getDate() + 1);
    }

    const delay = next - now;
    console.log(`[backup] Next run: ${next.toISOString()} (in ${Math.round(delay / 60000)} min)`);
    backupTimer = setTimeout(async () => {
      await runBackup();
      scheduleBackup(); // reschedule for next run
    }, delay);
  }

  // GET /api/backup/config
  app.get('/api/backup/config', requireAuth, (req, res) => {
    const c = getBackupConfig();
    res.json({ ...c, rcloneAvailable: isRcloneAvailable(), rcloneConfExists: fs.existsSync(RCLONE_CONF) });
  });

  // POST /api/backup/config — save and reschedule
  app.post('/api/backup/config', requireAuth, (req, res) => {
    const { enabled, schedule, time, dayOfWeek, remoteName, remotePath, retention } = req.body || {};
    const updated = {
      ...getBackupConfig(),
      enabled:    enabled === true,
      schedule:   ['daily', 'weekly', 'manual'].includes(schedule) ? schedule : 'daily',
      time:       /^\d{1,2}:\d{2}$/.test(time) ? time : '02:00',
      dayOfWeek:  Math.min(6, Math.max(0, parseInt(dayOfWeek) || 0)),
      remoteName: (remoteName || '').trim(),
      remotePath: (remotePath || 'ip-manager-backups/').trim(),
      retention:  Math.max(0, parseInt(retention) || 7),
    };
    dbSet('backup_config', updated);
    scheduleBackup();
    res.json({ ok: true });
  });

  // GET /api/backup/status
  app.get('/api/backup/status', requireAuth, (req, res) => {
    const c = getBackupConfig();
    res.json({ running: backupRunning, lastRun: c.lastRun, lastStatus: c.lastStatus, lastError: c.lastError });
  });

  // POST /api/backup/run — manual trigger (fire-and-forget; poll /status)
  app.post('/api/backup/run', requireAuth, (req, res) => {
    if (backupRunning) return res.json({ ok: false, message: 'Backup already running' });
    res.json({ ok: true, message: 'Backup started' });
    runBackup();
  });

  // GET /api/backup/remotes — list rclone remotes from rclone.conf
  app.get('/api/backup/remotes', requireAuth, (req, res) => {
    if (!fs.existsSync(RCLONE_CONF)) return res.json({ remotes: [] });
    execFile('rclone', ['--config', RCLONE_CONF, 'listremotes'], { timeout: 8000 }, (err, stdout) => {
      if (err) return res.json({ remotes: [] });
      const remotes = stdout.trim().split('\n').filter(r => r.endsWith(':')).map(r => r.slice(0, -1));
      res.json({ remotes });
    });
  });

  // POST /api/backup/configure-remote — write rclone config section for GUI-configurable providers
  app.post('/api/backup/configure-remote', requireAuth, (req, res) => {
    const { provider, name, config: cfg } = req.body || {};
    if (!name || !provider) return res.status(400).json({ error: 'name and provider required' });

    const remoteName = name.replace(/[^a-zA-Z0-9_-]/g, '-');
    let lines = [];

    if (provider === 's3') {
      const { accessKey, secretKey, endpoint, region, s3Provider } = cfg || {};
      lines = [
        `[${remoteName}]`, `type = s3`,
        `provider = ${s3Provider || 'Other'}`,
        `access_key_id = ${(accessKey || '').trim()}`,
        `secret_access_key = ${(secretKey || '').trim()}`,
      ];
      if (endpoint && endpoint.trim()) lines.push(`endpoint = ${endpoint.trim()}`);
      if (region  && region.trim())   lines.push(`region = ${region.trim()}`);
    } else if (provider === 'sftp') {
      const { host, port, user, password } = cfg || {};
      // Obscure the password using rclone's own tool (XOR-based, reversible)
      let obscuredPass = '';
      if (password) {
        try {
          // execFileSync — the password is passed as an argument, never through a
          // shell. JSON.stringify quotes for JavaScript, not for sh: a password
          // containing $(...) or backticks would previously have been executed.
          obscuredPass = require('child_process')
            .execFileSync('rclone', ['obscure', password], { timeout: 5000 })
            .toString().trim();
        } catch { obscuredPass = password; }
      }
      lines = [
        `[${remoteName}]`, `type = sftp`,
        `host = ${(host || '').trim()}`,
        `port = ${parseInt(port) || 22}`,
        `user = ${(user || '').trim()}`,
      ];
      if (obscuredPass) lines.push(`pass = ${obscuredPass}`);
    } else if (provider === 'local') {
      const { localPath } = cfg || {};
      lines = [`[${remoteName}]`, `type = alias`, `remote = ${(localPath || '/mnt/backup').trim()}`];
    } else if (provider === 'dropbox' || provider === 'gdrive') {
      // OAuth providers: token pasted in by the user
      const { token } = cfg || {};
      if (!token) return res.status(400).json({ error: 'token required for OAuth providers' });
      const rcloneType = provider === 'gdrive' ? 'drive' : 'dropbox';
      lines = [`[${remoteName}]`, `type = ${rcloneType}`, `token = ${token.trim()}`];
      if (provider === 'gdrive') lines.push('scope = drive.file');
    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    // Merge into existing config file — replace any section with the same name
    let existing = fs.existsSync(RCLONE_CONF) ? fs.readFileSync(RCLONE_CONF, 'utf8') : '';
    // Strip the old section (everything from [remoteName] to the next [ or EOF)
    existing = existing.replace(new RegExp(`\\[${remoteName}\\][^\\[]*`, 'g'), '').trim();
    const newConf = (existing ? existing + '\n\n' : '') + lines.join('\n') + '\n';
    fs.writeFileSync(RCLONE_CONF, newConf, { mode: 0o600 });

    res.json({ ok: true, remoteName });
  });

  // POST /api/backup/test — verify rclone can reach the configured remote
  app.post('/api/backup/test', requireAuth, (req, res) => {
    const { remoteName, remotePath } = req.body || {};
    if (!remoteName) return res.status(400).json({ error: 'remoteName required' });
    if (!fs.existsSync(RCLONE_CONF)) return res.status(400).json({ error: 'No rclone config found — add a remote first' });
    const dest = `${remoteName}:${(remotePath || '').trim()}`;
    execFile('rclone', ['--config', RCLONE_CONF, 'lsd', dest, '--max-depth', '1'],
      { timeout: 20000 }, (err, _out, stderr) => {
        if (err) return res.json({ ok: false, error: (stderr || err.message).trim() });
        res.json({ ok: true });
      });
  });

  // Restore backup schedule on server startup
  scheduleBackup();
};
