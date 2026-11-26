// 设置：只有 apiKey 和 model 两项，存在本机 %LOCALAPPDATA%\Kaiguang\settings.json。
// 环境变量优先（开发时方便），其次是这个文件（普通用户填 key 的地方）。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'Kaiguang');
const FILE = path.join(DIR, 'settings.json');

export function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

export function save(patch) {
  const next = { ...load(), ...patch };
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8'); } catch {}
  return next;
}

// 演示构建会在同目录放一个 builtin-key.mjs（不进仓库）；公开构建里没有这个文件。
let BUILTIN = '';
try { const m = await import('./builtin-key.mjs'); BUILTIN = m.BUILTIN_KEY || ''; } catch {}

export const apiKey = () => process.env.DEEPSEEK_API_KEY || BUILTIN || load().apiKey || '';
export const hasBuiltin = () => !!BUILTIN;
export const model = () => process.env.LLM_MODEL || load().model || 'deepseek-flash';
export const where = () => FILE;