// 对话里的「方案层」：AI 先像人一样给方案，再只从候选动作里挑。
// 模型永远拿不到命令，也拼不出 target：它只能返回候选编号。
import { buildCards, startupCandidates, startupCard, aiPost, aiModel } from './llm.mjs';
import { digest } from './analyze.mjs';
import { answer } from './ask.mjs';
import * as budget from './budget.mjs';

const MAX_CARDS = 5;

function makeCandidate(key, card) {
  const tag = card.action === 'open_settings' ? '需要你自己点' : '可撤销';
  return { key, card, label: card.title + '｜' + tag + '｜' + card.why };
}

export function buildCandidatePool(report, analysis) {
  const pool = [];
  const base = buildCards({ facts: { usage: 'all' } }, report, analysis).filter((c) => c.action === 'open_settings');
  for (const c of base) {
    const key = c.target && c.target.uri === 'ms-settings:windowsdefender' ? 'firewall' : 'cleanup';
    if (!pool.some((p) => p.key === key)) pool.push(makeCandidate(key, c));
  }
  const seen = new Set();
  for (const s of startupCandidates(report)) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    pool.push(makeCandidate('startup:' + s.name, startupCard(s)));
  }
  return pool;
}

function cardKeys(pool, keys) {
  const out = [];
  const seen = new Set();
  for (const k of keys) {
    const hit = pool.find((p) => p.key === k);
    if (hit && !seen.has(k)) { seen.add(k); out.push(hit.card); }
  }
  return out.slice(0, MAX_CARDS);
}

function labelsOf(cards) {
  return cards.filter((c) => c.action === 'disable_startup').map((c) => c.target.name).slice(0, 3);
}

function defaultKeys(pool) {
  const keys = [];
  for (const k of ['firewall', 'cleanup']) if (pool.some((p) => p.key === k)) keys.push(k);
  for (const p of pool.filter((x) => x.card.action === 'disable_startup').slice(0, 3)) keys.push(p.key);
  return keys.slice(0, MAX_CARDS);
}

const SYSTEM = [
  '你在「小白助手」里，陪用户收拾一台刚到手的新 Windows 电脑。你能看到这台机器的真实体检数据和一份候选动作清单。',
  '',
  '你不是表单，也不是 FAQ。用户说「打游戏」「剪视频」「写代码」「学习」，你就直接按这个用途给一套具体方案，不要再反问用途。',
  '每次回复先给结论和方案（2-4 条，每条说清为什么、影响什么、能不能退），再让用户决定做不做。',
  '',
  '硬性边界：',
  '1. 只能从下面的候选动作里挑；在正文最后单独一行写 <<PICKS:1,3>>（编号来自候选，最多 5 个）。不要发明动作、命令、路径、注册表键。',
  '2. 候选里没有的事（装驱动、改 BIOS、卸 OEM），只能用嘴说「这个我不代劳」，不能编一张卡。',
  '3. 用户在问问题（这是什么、能不能删、怎么退）就正常回答；不挑卡时最后一行写 <<PICKS:>>，表示保留上一组卡片。',
  '4. 用户说「不用了 / 都别动」时，最后一行写 <<CLEAR>>，把卡片撤掉。',
  '5. 用户说「就按这个来 / 执行吧」时，不要再改方案：说「方案不变，勾选保留，点下面的执行」，<<PICKS:...>> 照旧。',
  '6. 正文用正常中文，不要 markdown 代码块；<<...>> 标记只能出现在最后一行。',
  '7. 重复软件的卡片只是「带到设置页」，不是你卸的；不要说「可退」「我帮你卸」，要说「你自己点，卸了想装回得自己重装」。',
  '8. Defender 实时保护显示关闭是正常的（第三方杀软在位），不要把它当成问题。',
  '9. 磁盘清理不在候选里：让用户点左侧「磁盘空间」，只清 7 天前的临时文件和回收站，需要二次确认，不要承诺替他删文件。',
  '',
  '语气像一个懂电脑的朋友：短句，不说「建议您」「亲」，不要一次问三个问题。',
  '候选里带 UAC 的，要在话里提醒「会弹一次权限确认」。',
].join('\n');

export async function aiPlan({ report, analysis, history, pool, greeting }) {
  if (!budget.ok()) throw new Error('quota');
  const catalog = pool.map((p, i) => (i + 1) + '. ' + p.label).join('\n');
  const msgs = [{ role: 'system', content: SYSTEM + '\n\n候选动作（只能选这些编号）：\n' + catalog }];
  msgs.push({ role: 'user', content: '这台机器的体检数据：\n' + digest(report, analysis) });
  for (const m of history.slice(-8)) msgs.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text });
  if (greeting) msgs.push({ role: 'user', content: '（用户刚打开，还没有说话。先给体检结论 + 一个通用方案，最后邀请他说用途。）' });
  const ask = async () => {
    const res = await aiPost({ model: aiModel(), messages: msgs, temperature: 0.55, max_tokens: 1800 }, 60000);
    budget.spend();
    return String((res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '').trim();
  };
  let text = await ask();
  if (!text) { console.error('aiPlan empty, retrying'); text = await ask(); }
  if (!text) throw new Error('empty content');
  const clear = /<<\s*CLEAR\s*>>/i.test(text);
  const m = text.match(/<<\s*PICKS\s*:\s*([\d,\s]*)\s*>>/i);
  const picks = m
    ? m[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= pool.length).slice(0, MAX_CARDS)
    : [];
  const say = text.replace(/<<[\s\S]*?>>/g, '').trim().slice(0, 1600);
  if (!say) throw new Error('empty say');
  return { say, picks, clear };
}

const GAME = /打游戏|游戏|开黑|网游|联机|3A/;
const CREATE = /剪视频|剪辑|设计|画画|修图|达芬奇|adobe/i;
const CODE = /写代码|编程|开发|代码|前端|后端|全栈|嵌入式/;
const STUDY = /学习|上课|作业|论文|考研|办公|学生/;
const CONFIRM = /就按这个|按这个来|执行吧|开始吧|就这样|定了|可以执行|照这个做/;
const STOP = /不用了|都别动|先不动|先别|算了|都不做/;

function usageOf(text) {
  if (GAME.test(text)) return 'game';
  if (CREATE.test(text)) return 'create';
  if (CODE.test(text)) return 'code';
  if (STUDY.test(text)) return 'study';
  return '';
}

function summary(report, analysis) {
  const m = analysis.metrics || {};
  const sys = report.system || {};
  return '这台是 ' + (sys.manufacturer || '') + ' ' + (sys.model || '') + '，' + String(sys.osName || 'Windows') + '，装了 ' + ((report.counts && report.counts.apps) || 0) + ' 个软件' +
    (m.freePct != null ? '，C: 盘还剩 ' + m.freePct + '%' : '') + '。';
}

function planForUsage(usage, pool) {
  const firewall = pool.find((p) => p.key === 'firewall');
  const cleanup = pool.find((p) => p.key === 'cleanup');
  const starts = pool.filter((p) => p.card.action === 'disable_startup');
  const takeStarts = starts.slice(0, usage === 'game' ? 3 : 2);
  const keys = [];
  if (usage === 'game') {
    for (const p of takeStarts) keys.push(p.key);
    if (firewall) keys.push(firewall.key);
    if (cleanup) keys.push(cleanup.key);
  } else if (usage === 'create') {
    for (const p of takeStarts) keys.push(p.key);
    if (firewall) keys.push(firewall.key);
    if (cleanup) keys.push(cleanup.key);
  } else if (usage === 'code') {
    for (const p of takeStarts) keys.push(p.key);
    if (firewall) keys.push(firewall.key);
  } else {
    if (cleanup) keys.push(cleanup.key);
    if (firewall) keys.push(firewall.key);
    for (const p of takeStarts) keys.push(p.key);
  }
  return { keys: keys.slice(0, MAX_CARDS), starts: takeStarts.map((p) => p.card), firewall, cleanup };
}

function localUsagePlan(usage, pool) {
  const plan = planForUsage(usage, pool);
  const names = labelsOf(plan.starts);
  const nameLine = names.length ? names.join('、') : '几条装饰类自启';
  let say = '';
  if (usage === 'game') {
    say = '打游戏这台，方案按优先级来：\n1. 先关装饰类自启（' + nameLine + '）——不进系统功能，开机少几个后台；\n2. 防火墙现在是关的，打开（宿舍 Wi-Fi 第一道门）；\n3. 重复的安全软件只带你到设置页，卸不卸你定。\n显卡驱动和 Steam / 游戏平台我不动。';
  } else if (usage === 'create') {
    say = '剪视频 / 做设计主要吃显卡和内存：\n1. 先关装饰类和预加载自启（' + nameLine + '），预览和导出会稳一点；\n2. 防火墙现在是关的，打开；\n3. C: 盘留出 20% 以上余量，素材别堆在系统盘。\n显卡驱动和剪辑软件本身我不动。';
  } else if (usage === 'code') {
    say = '写代码主要吃内存和多开：\n1. 先关装饰类自启（' + nameLine + '），开 IDE 和浏览器会轻一点；\n2. 防火墙现在是关的，打开；\n3. VS Code 和 Git 没装的话，去左边「装软件」里补，装完也能撤。';
  } else {
    say = '学习为主，方案就三块：\n1. 重复的软件只带到设置页，卸不卸你定；\n2. 防火墙现在是关的，打开；\n3. 关掉装饰类自启（' + nameLine + '），开机少几个后台。';
  }
  return { say, cards: cardKeys(pool, plan.keys) };
}

export function localPlan({ text, report, analysis, pool, history, hasPlan }) {
  const q = String(text || '').trim();
  if (!q) {
    const keys = defaultKeys(pool);
    return {
      say: summary(report, analysis) + '\n我先按通用情况列了几条：防火墙、重复软件、装饰类自启。\n你这台主要拿来干嘛？打游戏、剪视频、写代码、学习，说一声我按用途换一套。',
      cards: cardKeys(pool, keys),
    };
  }
  if (STOP.test(q)) return { say: '行，那这次不动。上面的卡片我撤掉了；想改哪条直接说。', clear: true };
  if (CONFIRM.test(q)) return { say: '好，方案不变。上面勾好的直接点「执行选中的 N 项」；每一步都会记原值，随时能撤销。', keepPrev: true };
  const usage = usageOf(q);
  if (usage) return localUsagePlan(usage, pool);
  const a = answer(q, { report, analysis, facts: {} });
  if (a && a.say) return { say: a.say, cards: a.cards || null, keepPrev: !!a.cards || !!hasPlan };
  if (hasPlan) return { say: '这句我没把握从体检数据里答。上面那套方案还在，想动哪条直接说；想问某个软件，把名字打全一点。', keepPrev: true };
  const keys = defaultKeys(pool);
  return { say: summary(report, analysis) + '\n我先按通用情况列几条，你主要拿它干嘛？', cards: cardKeys(pool, keys) };
}