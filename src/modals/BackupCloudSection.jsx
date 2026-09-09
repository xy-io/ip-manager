import { useState, useEffect } from 'react';
import { Zap, Plus, Save, AlertCircle, Upload, CheckCircle } from 'lucide-react';

function BackupCloudSection() {
  const PROVIDERS = [
    { id: 's3',      label: 'S3 / Object Storage', desc: 'Backblaze B2, Cloudflare R2, AWS S3, Wasabi, MinIO' },
    { id: 'sftp',    label: 'SFTP',                desc: 'Any SSH server, NAS, or remote host' },
    { id: 'local',   label: 'Local / Network Path', desc: 'NFS mount, SMB share, or local directory' },
    { id: 'dropbox', label: 'Dropbox',             desc: 'Requires one-time terminal step for auth' },
    { id: 'gdrive',  label: 'Google Drive',        desc: 'Requires one-time terminal step for auth' },
  ];
  const S3_PROVIDERS = [
    { value: 'Backblaze', label: 'Backblaze B2' },
    { value: 'Cloudflare', label: 'Cloudflare R2' },
    { value: 'AWS',       label: 'AWS S3' },
    { value: 'Wasabi',    label: 'Wasabi' },
    { value: 'Minio',     label: 'MinIO' },
    { value: 'Other',     label: 'Other S3-compatible' },
  ];
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const [cfg, setCfg]             = useState(null);
  const [remotes, setRemotes]     = useState([]);
  const [provider, setProvider]   = useState('s3');
  const [remoteName, setRemoteName] = useState('mybackup');
  const [creds, setCreds]         = useState({});
  const [schedule, setSchedule]   = useState('daily');
  const [time, setTime]           = useState('02:00');
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [retention, setRetention] = useState(7);
  const [remotePath, setRemotePath] = useState('ip-manager-backups/');
  const [enabled, setEnabled]     = useState(false);
  const [status, setStatus]       = useState(null);
  const [saving, setSaving]       = useState(false);
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [running, setRunning]     = useState(false);
  const [msg, setMsg]             = useState(null);
  const [configuring, setConfiguring] = useState(false);
  const [showRemoteForm, setShowRemoteForm] = useState(false);

  const load = async () => {
    try {
      const [cfgRes, statusRes, remotesRes] = await Promise.all([
        fetch('/api/backup/config'),
        fetch('/api/backup/status'),
        fetch('/api/backup/remotes'),
      ]);
      const c = await cfgRes.json();
      const s = await statusRes.json();
      const r = await remotesRes.json();
      setCfg(c);
      setStatus(s);
      setRemotes(r.remotes || []);
      setSchedule(c.schedule || 'daily');
      setTime(c.time || '02:00');
      setDayOfWeek(c.dayOfWeek ?? 0);
      setRetention(c.retention ?? 7);
      setRemotePath(c.remotePath || 'ip-manager-backups/');
      setEnabled(c.enabled || false);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  // Poll status while a backup is running
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(async () => {
      try {
        const s = await fetch('/api/backup/status').then(r => r.json());
        setStatus(s);
        if (!s.running) { setRunning(false); load(); }
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [running]);

  const handleSaveRemote = async () => {
    if (!remoteName.trim()) return setMsg({ type: 'error', text: 'Remote name is required.' });
    setConfiguring(true); setMsg(null);
    try {
      const r = await fetch('/api/backup/configure-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, name: remoteName, config: creds }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Failed');
      setMsg({ type: 'ok', text: `Remote "${d.remoteName}" saved.` });
      setShowRemoteForm(false);
      await load();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setConfiguring(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const selectedRemote = cfg?.remoteName;
      const r = await fetch('/api/backup/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteName: selectedRemote, remotePath }),
      });
      const d = await r.json();
      setTestResult(d.ok ? 'ok' : (d.error || 'Connection failed'));
    } catch (e) { setTestResult(e.message); }
    finally { setTesting(false); }
  };

  const handleSaveSchedule = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch('/api/backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, schedule, time, dayOfWeek, remoteName: cfg?.remoteName || '', remotePath, retention }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error('Save failed');
      setMsg({ type: 'ok', text: 'Schedule saved.' });
      await load();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setSaving(false); }
  };

  const handleRunNow = async () => {
    setRunning(true); setMsg(null);
    try {
      const r = await fetch('/api/backup/run', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) { setRunning(false); setMsg({ type: 'error', text: d.message }); }
    } catch (e) { setRunning(false); setMsg({ type: 'error', text: e.message }); }
  };

  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm";
  const labelCls = "block text-sm font-medium text-slate-700 mb-1";

  if (!cfg) return <div className="py-4 text-center text-sm text-slate-400">Loading…</div>;

  // Not available in local mode
  if (!cfg.rcloneAvailable) {
    return (
      <div className="mt-6 pt-5 border-t border-slate-200 space-y-3">
        <h4 className="text-sm font-semibold text-slate-700">Scheduled Cloud Backup</h4>
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">rclone is not installed yet.</p>
            <p>Go to <strong>Settings → Updates</strong> and run the update — the update script will install rclone automatically as part of the process. Return here once it's done.</p>
            <p className="text-amber-700 text-xs mt-1">If you've already updated once since v1.26, run it a second time. The installer was added in this release and takes effect from the next update onwards.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 pt-5 border-t border-slate-200 space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">Scheduled Cloud Backup</h4>
        <span className="text-xs text-slate-400 font-mono">via rclone</span>
      </div>

      {/* Existing remotes + add button */}
      <div>
        <p className={labelCls}>Cloud remote</p>
        {remotes.length > 0 ? (
          <div className="flex flex-wrap gap-2 mb-2">
            {remotes.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => { setCfg(c => ({ ...c, remoteName: r })); setTestResult(null); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  cfg.remoteName === r
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'
                }`}
              >{r}</button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 mb-2">No remotes configured yet. Add one below.</p>
        )}
        <button
          type="button"
          onClick={() => { setShowRemoteForm(v => !v); setMsg(null); setTestResult(null); }}
          className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
        >
          <Plus className="w-3.5 h-3.5" />
          {showRemoteForm ? 'Cancel' : 'Add / replace remote'}
        </button>
      </div>

      {/* Remote configuration form */}
      {showRemoteForm && (
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
          <div>
            <label className={labelCls}>Remote name <span className="text-slate-400 font-normal">(letters, numbers, hyphens)</span></label>
            <input className={inputCls} value={remoteName} onChange={e => setRemoteName(e.target.value)} placeholder="mybackup" />
          </div>

          <div>
            <p className={labelCls}>Provider</p>
            <div className="grid grid-cols-1 gap-1.5">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setProvider(p.id); setCreds({}); }}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    provider === p.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${provider === p.id ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'}`} />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{p.label}</p>
                    <p className="text-xs text-slate-400">{p.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* S3 fields */}
          {provider === 's3' && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>S3 Provider</label>
                <select className={inputCls} value={creds.s3Provider || 'Other'} onChange={e => setCreds(c => ({ ...c, s3Provider: e.target.value }))}>
                  {S3_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Access Key ID</label>
                  <input className={inputCls} value={creds.accessKey || ''} onChange={e => setCreds(c => ({ ...c, accessKey: e.target.value }))} placeholder="keyid123" />
                </div>
                <div>
                  <label className={labelCls}>Secret Access Key</label>
                  <input className={inputCls} type="password" value={creds.secretKey || ''} onChange={e => setCreds(c => ({ ...c, secretKey: e.target.value }))} placeholder="••••••••" />
                </div>
              </div>
              {(creds.s3Provider !== 'AWS') && (
                <div>
                  <label className={labelCls}>Endpoint URL <span className="text-slate-400 font-normal">(leave blank for AWS)</span></label>
                  <input className={inputCls} value={creds.endpoint || ''} onChange={e => setCreds(c => ({ ...c, endpoint: e.target.value }))} placeholder="s3.us-west-004.backblazeb2.com" />
                </div>
              )}
              {creds.s3Provider === 'AWS' && (
                <div>
                  <label className={labelCls}>Region</label>
                  <input className={inputCls} value={creds.region || ''} onChange={e => setCreds(c => ({ ...c, region: e.target.value }))} placeholder="us-east-1" />
                </div>
              )}
            </div>
          )}

          {/* SFTP fields */}
          {provider === 'sftp' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Hostname / IP</label>
                  <input className={inputCls} value={creds.host || ''} onChange={e => setCreds(c => ({ ...c, host: e.target.value }))} placeholder="nas.local" />
                </div>
                <div>
                  <label className={labelCls}>Port</label>
                  <input className={inputCls} value={creds.port || '22'} onChange={e => setCreds(c => ({ ...c, port: e.target.value }))} placeholder="22" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Username</label>
                  <input className={inputCls} value={creds.user || ''} onChange={e => setCreds(c => ({ ...c, user: e.target.value }))} placeholder="backup" />
                </div>
                <div>
                  <label className={labelCls}>Password</label>
                  <input className={inputCls} type="password" value={creds.password || ''} onChange={e => setCreds(c => ({ ...c, password: e.target.value }))} placeholder="••••••••" />
                </div>
              </div>
            </div>
          )}

          {/* Local path */}
          {provider === 'local' && (
            <div>
              <label className={labelCls}>Local / mount path</label>
              <input className={inputCls} value={creds.localPath || ''} onChange={e => setCreds(c => ({ ...c, localPath: e.target.value }))} placeholder="/mnt/nas/backups" />
            </div>
          )}

          {/* OAuth providers — token paste */}
          {(provider === 'dropbox' || provider === 'gdrive') && (
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
                <p className="font-semibold">One-time terminal step required</p>
                <p>Run this on a machine with a web browser (your laptop is fine):</p>
                <code className="block mt-1 bg-blue-100 rounded px-2 py-1 font-mono text-xs">
                  rclone authorize {provider === 'gdrive' ? 'drive' : 'dropbox'}
                </code>
                <p className="mt-1">Follow the browser prompt, then paste the token JSON it outputs below.</p>
              </div>
              <div>
                <label className={labelCls}>Token JSON</label>
                <textarea
                  className={`${inputCls} h-24 font-mono text-xs resize-none`}
                  value={creds.token || ''}
                  onChange={e => setCreds(c => ({ ...c, token: e.target.value }))}
                  placeholder='{"access_token":"...","token_type":"bearer","refresh_token":"...","expiry":"..."}'
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleSaveRemote}
            disabled={configuring}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors text-sm"
          >
            {configuring ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            Save remote config
          </button>
        </div>
      )}

      {/* Schedule & retention */}
      {remotes.length > 0 && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Destination path</label>
            <input className={inputCls} value={remotePath} onChange={e => setRemotePath(e.target.value)} placeholder="ip-manager-backups/" />
            <p className="text-xs text-slate-400 mt-1">Folder within the remote to store backups (will be created if missing).</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Schedule</label>
              <select className={inputCls} value={schedule} onChange={e => setSchedule(e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="manual">Manual only</option>
              </select>
            </div>
            {schedule !== 'manual' && (
              <div>
                <label className={labelCls}>Time</label>
                <input className={inputCls} type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            )}
          </div>

          {schedule === 'weekly' && (
            <div>
              <label className={labelCls}>Day of week</label>
              <select className={inputCls} value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))}>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Keep last <span className="text-emerald-600 font-semibold">{retention}</span> backups</label>
            <input type="range" min="1" max="30" value={retention} onChange={e => setRetention(Number(e.target.value))} className="w-full accent-emerald-600" />
            <div className="flex justify-between text-xs text-slate-400 mt-0.5"><span>1</span><span>30</span></div>
          </div>

          {/* Enable toggle + save */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <p className="text-sm font-medium text-slate-700">Enable automatic backups</p>
              <p className="text-xs text-slate-400">{schedule === 'manual' ? 'Run manually using the button below' : `Runs ${schedule} at ${time}`}</p>
            </div>
            <button
              type="button"
              onClick={() => setEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${enabled ? 'bg-emerald-600' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button type="button" onClick={handleTest} disabled={testing || !cfg.remoteName}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 text-sm font-medium rounded-lg transition-colors">
              {testing ? <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" /> : <Zap className="w-4 h-4" />}
              Test connection
            </button>
            <button type="button" onClick={handleSaveSchedule} disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              Save schedule
            </button>
            <button type="button" onClick={handleRunNow} disabled={running || status?.running}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {(running || status?.running) ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Upload className="w-4 h-4" />}
              Back up now
            </button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${
              testResult === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {testResult === 'ok' ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
              {testResult === 'ok' ? 'Connection successful — rclone can reach the remote.' : testResult}
            </div>
          )}

          {/* Last backup status */}
          {status?.lastRun && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-xs border ${
              status.lastStatus === 'ok' ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {status.lastStatus === 'ok'
                ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-emerald-600" />
                : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
              <span>
                Last backup: {new Date(status.lastRun).toLocaleString()}
                {status.lastStatus !== 'ok' && status.lastError && ` — ${status.lastError}`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Inline message */}
      {msg && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${
          msg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {msg.type === 'ok' ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── Support Tab ───────────────────────────────────────────────────────────────

export default BackupCloudSection;
