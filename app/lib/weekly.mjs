// 每周报告：用「这次」和「至少 6 天前」各一条历史快照做对比。
import * as history from './history.mjs';

const DAY = 24 * 60 * 60 * 1000;
const LEVEL = { high: '要处理', warn: '建议看看', info: '知道就行' };

function fmt(n, unit = '') { return n == null ? '—' : String(n) + unit; }
function diff(cur, prev, unit, label, lowerIsBetter = false) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < (unit === ' GB' ? 0.3 : 1)) return null;
  const word = d > 0 ? (lowerIsBetter ? '多了' : '增加了') : (lowerIsBetter ? '少了' : '减少了');
  return label + ' ' + fmt(cur, unit) + '，比上次' + word + ' ' + Math.abs(d).toFixed(unit === ' GB' ? 1 : 0) + unit.replace(' ', '') + '。';
}

export function buildWeekly({ report, analysis, now = Date.now() }) {
  const all = history.list();
  const prev = all.filter((x) => now - x.at >= 6 * DAY).slice(-1)[0] || null;
  const cur = history.snapshot(report, analysis, now);
  const findings = ((analysis && analysis.findings) || []).filter((f) => f.level === 'high' || f.level === 'warn');
  const lines = [];
  lines.push('本周体检：' + fmt(cur.score, ' 分') + '。');
  if (!findings.length) {
    lines.push('这周没有发现需要处理的问题，正常用就行。');
  } else {
    lines.push('有 ' + findings.length + ' 处值得看：');
    for (const f of findings.slice(0, 3)) lines.push('· ' + f.title + (LEVEL[f.level] ? '（' + LEVEL[f.level] + '）' : ''));
    if (findings.length > 3) lines.push('· 还有 ' + (findings.length - 3) + ' 条，打开小白助手能看到全部。');
  }
  if (prev) {
    const bits = [
      diff(cur.freeC, prev.freeC, ' GB', 'C 盘可用', true),
      diff(cur.freeD, prev.freeD, ' GB', 'D 盘可用', true),
      diff(cur.startup, prev.startup, ' 个', '开机自启', true),
      diff(cur.services, prev.services, ' 个', '第三方服务', true),
      diff(cur.batteryPct, prev.batteryPct, '%', '电池健康', true),
    ].filter(Boolean);
    if (bits.length) lines.push('', ...bits);
  } else {
    lines.push('', '这是第一次记录，下周可以拿它跟这次比。');
  }
  const short = (cur.score != null ? '体检 ' + cur.score + ' 分，' : '') + (findings.length ? '有 ' + findings.length + ' 处值得看' : '没发现要处理的问题');
  return { at: now, text: lines.join('\n'), short, first: !prev, snapshot: cur };
}