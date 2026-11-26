// 每日调用上限：演示 key 是限额的，客户端自己也设一道闸，免得一个人把额度刷光。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'Kaiguang');
const FILE = path.join(DIR, 'budget.json');
const CAP = () => Number(process.env.KG_DAILY_CAP || 400);

function today() { return new Date().toISOString().slice(0, 10); }

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return j && j.date === today() ? j : { date: today(), n: 0 };
  } catch { return { date: today(), n: 0 }; }
}

export function used() { return read().n; }
export function left() { return Math.max(0, CAP() - used()); }
export function ok() { return left() > 0; }

export function spend() {
  const j = read();
  j.n += 1;
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(j), 'utf8'); } catch {}
  return j.n;
}
