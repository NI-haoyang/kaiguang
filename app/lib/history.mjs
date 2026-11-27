// 本机历史快照：只存少量数字，用来做「和上周比」。
// 不存软件名、路径、序列号，文件在 %LOCALAPPDATA%\Kaiguang\history.json。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'Kaiguang');
const FILE = path.join(DIR, 'history.json');
const MAX = 160;

export function list() {
  try {
    const a = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(a) ? a.filter((x) => x && Number.isFinite(x.at)) : [];
  } catch { return []; }
}

function save(a) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(a.slice(-MAX)), 'utf8');
  } catch {}
}

export function snapshot(report, analysis, at = Date.now()) {
  const disks = Array.isArray(report && report.disks) ? report.disks : [];
  const c = disks.find((d) => String(d.drive || '').toUpperCase().startsWith('C'));
  const d = disks.find((x) => String(x.drive || '').toUpperCase().startsWith('D'));
  const health = (report && report.health) || {};
  const battery = health.battery || {};
  const counts = (report && report.counts) || {};
  const design = Number(battery.design) || 0;
  const full = Number(battery.full) || 0;
  return {
    at,
    score: analysis && Number.isFinite(analysis.score) ? analysis.score : null,
    freeC: c && Number.isFinite(c.freeGB) ? Number(c.freeGB.toFixed(1)) : null,
    freeD: d && Number.isFinite(d.freeGB) ? Number(d.freeGB.toFixed(1)) : null,
    apps: Number.isFinite(counts.apps) ? counts.apps : null,
    startup: Number.isFinite(counts.startup) ? counts.startup : null,
    services: Number.isFinite(counts.services) ? counts.services : null,
    batteryPct: design > 0 && full > 0 ? Math.round((full / design) * 100) : null,
    installDays: Number.isFinite(health.installDays) ? health.installDays : null,
  };
}

export function append(report, analysis, at = Date.now()) {
  const s = snapshot(report, analysis, at);
  const a = list();
  const last = a[a.length - 1];
  // 同一天多次扫描只保留最后一次，避免历史被手动体检刷满。
  if (last && new Date(last.at).toDateString() === new Date(at).toDateString()) a[a.length - 1] = s;
  else a.push(s);
  save(a);
  return s;
}