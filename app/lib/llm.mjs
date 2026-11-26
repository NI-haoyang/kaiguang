// 大脑：有 key 走 DeepSeek，没 key 走本地规则。
// 两条路输出同一种东西：{ say, ask?, cards? } —— 页面不用知道是谁在说话。
import https from 'node:https';
import { ACTIONS, CATALOG } from './actions.mjs';
import { digest } from './analyze.mjs';
import * as settings from './settings.mjs';
import * as budget from './budget.mjs';

const KEY = () => settings.apiKey();
const MODEL = () => settings.model();
export const aiOn = () => !!KEY();
// 有 key 且今天的额度还没用完，才真的走 AI；否则本地规则接管
export const aiReady = () => aiOn() && budget.ok();

function post(body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY(), 'Content-Length': Buffer.byteLength(payload) },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + data.slice(0, 300)));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const SYSTEM = [
  '你在一个叫「开机第一天」的 Windows 新电脑整理工具里工作。你能看到这台机器的真实体检数据，任务是用 2-3 轮对话问清用户意图，然后给出不超过 4 条可执行建议。',
  '',
  '硬性要求：',
  '1. 只输出 JSON，不要 markdown 代码块，不要解释。',
  '2. 你只能说人话，不能输出命令。你唯一能做的事是从下面的动作目录里挑动作，参数必须原样来自我给你的数据。',
  '3. 宁可少说，不要编。你没看到的软件不要提，你不知道的事就说不知道。',
  '4. 语气：像一个懂电脑的朋友，不用「亲」「哦」这类语气词，不说「建议您」。短句。一次最多问一个问题。',
  '',
  '动作目录：',
  ...CATALOG.map(c => '- ' + c.action + '：' + c.desc + ' 参数：' + JSON.stringify(c.params)),
  '',
  '输出格式（二选一）：',
  '{"say":"一段话","ask":{"question":"一个问题","chips":["选项1","选项2"]}}',
  '{"say":"一段话","cards":[{"action":"disable_startup","target":{"name":"自启项原名","source":"HKU"},"title":"卡片标题","why":"一句话说清为什么"}]}',
  'ask 和 cards 不能同时出现。如果没有可做的事，cards 给空数组并说明原因。',
].join('\n');

export function normalizeCards(raw, report) {
  const startups = report.startup || [];
  const apps = report.apps || [];
  const out = [];
  for (const c of raw || []) {
    if (!c || typeof c.action !== 'string') continue;
    const def = ACTIONS[c.action];
    if (!def) continue;
    const t = c.target || {};
    let action = c.action, target = null, badge = '可撤销';
    let title = String(c.title || def.label), why = String(c.why || '');
    if (c.action === 'disable_startup') {
      const hit = startups.find(s => s.name === t.name) || startups.find(s => s.name.toLowerCase() === String(t.name || '').toLowerCase());
      if (!hit) continue;
      target = { name: hit.name, source: hit.source };
      const needAdmin = /^HKLM/i.test(String(hit.source || ''));
      badge = '可撤销 · 约 0.3 秒';
    } else if (c.action === 'uninstall_app') {
      // OEM 软件卸了装不回：一律降级成「带你到设置页」，不代劳
      const hit = apps.find(a => a.name === t.name) || apps.find(a => a.name.toLowerCase() === String(t.name || '').toLowerCase());
      if (!hit) continue;
      action = 'open_settings';
      target = { uri: 'ms-settings:appsfeatures' };
      title = '去设置里卸载 ' + hit.name;
      why = '系统不允许我自动卸载再装回；带你到设置页，你自己点一下。';
      badge = '需要你自己点';
    } else if (c.action === 'open_settings') {
      const uri = String(t.uri || 'ms-settings:');
      if (!uri.startsWith('ms-settings:')) continue;
      target = { uri };
      badge = String(c.badge || '带到设置页');
    }
    out.push({
      action, target, needAdmin: /^HKLM/i.test(String((target && target.source) || '')),
      title: title.length > 28 ? title.slice(0, 27) + '…' : title,
      why: why.slice(0, 160),
      badge,
    });
    if (out.length >= 5) break;
  }
  return out;
}

// ---------- 本地规则版 ----------
export function localStep(state, report, analysis) {
  const a = analysis;
  const apps = report.apps || [];
  const startup = report.startup || [];
  const f = a.findings;
  const byId = Object.fromEntries(f.map(x => [x.id, x]));

  if (state.step === 0) {
    const oemCount = (byId.oem_bloat && byId.oem_bloat.items || []).length;
    return {
      say: '体检完了。这台是 ' + (report.system.manufacturer || '') + ' ' + (report.system.model || '') + '，' + report.system.osName.replace('Microsoft ', '') +
        '，装了 ' + (report.counts.apps) + ' 个软件' + (oemCount ? '——其中华硕自己就占了 ' + oemCount + ' 个' : '') + '。' +
        (a.metrics.freePct >= 30 ? 'C: 盘还剩 ' + a.metrics.freePct + '%，这块不用管。' : ''),
      ask: { question: '先问一句：这台主要拿来干嘛？', chips: ['学习为主', '打游戏', '剪视频 / 做设计', '写代码', '什么都干'] },
    };
  }

  if (state.step === 1) {
    const dup = byId.dup_office;
    if (dup) {
      return {
        say: '明白。第二个问题跟你手上的软件有关：你现在有三个办公套件——' + dup.items.join('、') + '。三个都装着，每次打开文档它们都在抢「默认打开方式」。',
        ask: { question: '留哪个？', chips: ['留 WPS', '留 Office', '都留着，别动'] },
      };
    }
    if (byId.av_overlap) {
      return {
        say: '明白。第二个问题：你装了 ' + byId.av_overlap.items.length + ' 套安全软件（' + byId.av_overlap.items.join('、') + '），两套以上的实时防护会互相扫对方的文件，装软件和解压的时候最明显。',
        ask: { question: '这些是你自己装的吗？', chips: ['自己装的', '买电脑时就带的', '不知道'] },
      };
    }
    return { say: '明白。那我按你机器的情况列几条，你看看要不要做。', cards: buildCards(state, report, a) };
  }

  if (state.step >= 99) {
    return { say: '上面那几条想动哪条直接说；想问我某个软件能不能删，把名字打全一点。' };
  }
  return { say: '按你的情况我列了下面几条。每条都写清了为什么，不想要的取消勾选就行。', cards: buildCards(state, report, a) };
}

const KEEP_RE = /deepseek|clash|v2ray|vpn|proxy|代理|input|输入法|ime\b|driver|驱动|nvidia|radeon|intel|audio|声卡|realtek|defender|securityhealth|sysdiag|huorong|火绒|everything/i;
const DECO = /mascot|aura|armoury|armory|rog\b|asus\b|glidex|myasus|桌宠|olympus|framework/i;
const PRELOAD = /autolaunch|preload|updater|update|assistant|助手/i;

function cardIsDecor(s) { return DECO.test(s.name); }

export function buildCards(state, report, a) {
  const cards = [];
  const byId = Object.fromEntries(a.findings.map(x => [x.id, x]));
  const startup = report.startup || [];
  const apps = report.apps || [];
  const room = () => 5 - cards.length;

  // ① 防火墙（唯一的高危项，放最前面）
  if (byId.firewall_off) {
    cards.push({ action: 'open_settings', target: { uri: 'ms-settings:windowsdefender' },
      title: '打开防火墙（专用 + 公用）',
      why: '两个网络配置的防火墙都是关的。在宿舍、咖啡店的 Wi-Fi 下，这是挡局域网扫描的第一道门。',
      badge: '带到设置页' });
  }

  // ② 重复软件：合并成一张「带路」卡。OEM 软件卸了装不回，一律不代劳。
  const drop = [];
  const av = byId.av_overlap;
  if (av) {
    const keep = av.items.find(n => /火绒|huorong/i.test(n)) || av.items[0];
    for (const name of av.items.filter(n => n !== keep).slice(0, 1)) {
      if (apps.some(x => x.name === name)) drop.push(name);
    }
  }
  const dup = byId.dup_office;
  if (dup && (state.facts || {}).office !== 'none') {
    const want = (state.facts && state.facts.office) || '';
    let keep = dup.items[0];
    if (want === 'wps') keep = dup.items.find(n => /WPS/i.test(n)) || keep;
    else if (want === 'office') keep = dup.items.find(n => /Office|365/i.test(n)) || keep;
    for (const name of dup.items.filter(n => n !== keep).slice(0, 2)) {
      if (apps.some(x => x.name === name) && !drop.includes(name)) drop.push(name);
    }
  }
  if (drop.length && room() > 0) {
    const shown = drop.slice(0, 3).join('、') + (drop.length > 3 ? ' 等 ' + drop.length + ' 个' : '');
    cards.push({ action: 'open_settings', target: { uri: 'ms-settings:appsfeatures' },
      title: '去设置里卸载 ' + (drop.length === 1 ? drop[0] : drop.length + ' 个重复软件'),
      why: shown + ' 是重复的：两套安全软件会互相扫同一批文件，多个办公套件会抢「默认打开方式」。系统不允许我自动卸载再装回，所以我只带你到设置页，你自己点。',
      badge: '需要你自己点' });
  }

  // ④ 开机自启：装饰类 > 预加载类 > 一般第三方，人工维护一张「千万别动」的清单
  const KEEP = KEEP_RE;
  const cand = startup.filter(s2 => !KEEP.test(s2.name));
  const t1 = cand.filter(s2 => DECO.test(s2.name));
  const t2 = cand.filter(s2 => !DECO.test(s2.name) && PRELOAD.test(s2.name));
  const t3 = cand.filter(s2 => !DECO.test(s2.name) && !PRELOAD.test(s2.name));
  const order = [...t1, ...t2, ...t3].slice(0, Math.max(0, room()));
  for (const s2 of order) {
    const why = DECO.test(s2.name)
      ? '厂商的装饰类组件（灯效、桌宠、风扇面板这类），不参与系统功能，开机时纯占位。'
      : PRELOAD.test(s2.name)
        ? '开机预加载。关掉不影响你手动打开，只是省下开机那几秒和一点内存。'
        : '这是它自己要求开机启动的，不是系统要的。不常用的话关掉，用的时候手动打开就行。';
    const needAdmin = /^HKLM/i.test(String(s2.source || ''));
    cards.push({ action: 'disable_startup', target: { name: s2.name, source: s2.source }, needAdmin,
      title: '关掉 ' + (s2.name.length > 22 ? s2.name.slice(0, 21) + '…' : s2.name) + ' 的开机自启',
      why, badge: '可撤销 · 约 0.3 秒' });
  }

  return cards.slice(0, 5);
}

export async function aiStep(state, report, analysis, history) {
  const msgs = [{ role: 'system', content: SYSTEM }];
  msgs.push({ role: 'user', content: '这台机器的体检数据：\n' + digest(report, analysis) });
  for (const m of history) msgs.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text });
  msgs.push({ role: 'user', content: '（现在是第 ' + (state.step + 1) + ' 轮，最多 3 轮。信息够了就直接给 cards。）' });

  const res = await post({ model: MODEL(), messages: msgs, temperature: 0.6, max_tokens: 900, response_format: { type: 'json_object' } });
  budget.spend();
  let text = (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '';
  text = text.trim().replace(/^\u0060\u0060\u0060(?:json)?/i, '').replace(/\u0060\u0060\u0060$/, '').trim();
  const j = JSON.parse(text);
  const out = { say: String(j.say || '').slice(0, 500) };
  if (j.ask && j.ask.question) out.ask = { question: String(j.ask.question).slice(0, 120), chips: (j.ask.chips || []).slice(0, 5).map(String) };
  if (Array.isArray(j.cards)) out.cards = normalizeCards(j.cards, report);
  if (!out.ask && !out.cards) out.cards = [];
  return out;
}

// 卡片出来以后的追问：允许它说人话，也允许补一张卡，但只能引用体检数据里有的名字。
const ASK_SYSTEM = [
  '你在一个叫「开机第一天」的 Windows 新电脑整理工具里，负责回答用户关于这台机器的追问。',
  '',
  '硬性要求：',
  '1. 只输出 JSON，不要 markdown，不要解释。',
  '2. 只能引用体检数据里真实出现过的软件名 / 自启项名。数据里没有的，直接说「这个不在这台机器的清单里，我不确定」，不要编。',
  '3. 不要说「建议您」「亲」，像一个懂电脑的朋友，短句，2-4 句说完。',
  '4. 不要输出任何命令。',
  '5. 只有用户明确想删某个软件、而且这个软件确实在数据里时，才可以带 1 张卡；其余情况只说话。',
  '',
  '动作目录（只允许这些）：',
  ...CATALOG.map(c => '- ' + c.action + '：' + c.desc + ' 参数：' + JSON.stringify(c.params)),
  '',
  '输出格式：',
  '{"say":"回答"}',
  '{"say":"回答","cards":[{"action":"uninstall_app","target":{"name":"软件原名"},"title":"卡片标题","why":"一句话"}]}',
].join('\n');

export async function aiAsk(state, report, analysis, history, question) {
  if (!budget.ok()) throw new Error('quota');
  const msgs = [{ role: 'system', content: ASK_SYSTEM }];
  msgs.push({ role: 'user', content: '这台机器的体检数据：\n' + digest(report, analysis) });
  for (const m of history.slice(-6)) msgs.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text });
  msgs.push({ role: 'user', content: '用户刚刚问：' + question });
  const res = await post({ model: MODEL(), messages: msgs, temperature: 0.3, max_tokens: 500, response_format: { type: 'json_object' } });
  budget.spend();
  let text = (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '';
  const FENCE = String.fromCharCode(96).repeat(3);
  text = text.trim();
  if (text.startsWith(FENCE)) text = text.slice(3);
  if (text.startsWith('json')) text = text.slice(4);
  if (text.endsWith(FENCE)) text = text.slice(0, -3);
  text = text.trim();
  const j = JSON.parse(text);
  const out = { say: String(j.say || '').slice(0, 500) };
  if (Array.isArray(j.cards)) out.cards = normalizeCards(j.cards, report);
  return out;
}