// 巡检/周报的本地状态，和 API key 分开存，避免设置文件被误读或打包带走。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'Kaiguang');
const FILE = path.join(DIR, 'schedule.json');

export function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

export function save(patch) {
  const next = { ...load(), ...patch };
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8'); } catch {}
  return next;
}

export const where = () => FILE;