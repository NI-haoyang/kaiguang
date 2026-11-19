import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = path.join(os.homedir(), 'AppData', 'Local', 'Kaiguang');
const FILE = path.join(DIR, 'journal.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { entries: [] }; }
}
function save(db) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8');
}
export function append(entry) {
  const db = load();
  entry.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  entry.ts = Date.now();
  entry.undone = false;
  db.entries.push(entry);
  save(db);
  return entry;
}
export function update(id, patch) {
  const db = load();
  const e = db.entries.find(x => x.id === id);
  if (e) { Object.assign(e, patch); save(db); }
  return e;
}
export function list() { return load().entries; }
export function pending() { return load().entries.filter(e => !e.undone && e.revert); }
export function dir() { return DIR; }
