// 本地问答：只用这次体检的真实数据回答「这是什么 / 能不能删 / 怎么退」。
// 不调 AI。答不上来就说不知道，不编。
import { lookup } from './know.mjs';
const AV = /mcafee|迈克菲|360|火绒|huorong|电脑管家|defender|卡巴|avast|诺顿/i;
const OFFICE = /wps|office|365|word|excel|libreoffice/i;
const BROWSER = /chrome|edge|firefox|夸克|浏览器|opera|brave/i;
const VIDEO = /视频|bilibili|哔哩|爱奇艺|优酷|抖音|netflix|vlc|potplayer/i;
const MUSIC = /音乐|网易云|酷狗|spotify|foobar/i;
const ACCEL = /加速|clash|v2ray|vpn|proxy|迅游|雷神/i;
const CLOUD = /网盘|云盘|onedrive|dropbox|坚果云|迅雷/i;
const OEM = /asus|rog|armoury|aura|glidex|myasus/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[\s·\-_()（）【】\[\]…]/g, '');

function kindOf(name) {
  if (AV.test(name)) return { id: 'av', label: '安全 / 管家软件', note: '实时防护' };
  if (OFFICE.test(name)) return { id: 'office', label: '办公套件', note: '抢默认打开方式' };
  if (BROWSER.test(name)) return { id: 'browser', label: '浏览器', note: '' };
  if (VIDEO.test(name)) return { id: 'video', label: '视频客户端', note: '网页版也能看' };
  if (MUSIC.test(name)) return { id: 'music', label: '音乐客户端', note: '网页版也能听' };
  if (ACCEL.test(name)) return { id: 'accel', label: '网络 / 游戏加速器', note: '' };
  if (CLOUD.test(name)) return { id: 'cloud', label: '网盘 / 同步工具', note: '' };
  if (OEM.test(name)) return { id: 'oem', label: '厂商预装组件', note: '不影响系统功能' };
  return { id: 'other', label: '软件', note: '' };
}

function findEntity(text, report) {
  const t = norm(text);
  if (!t) return null;
  const cands = [];
  for (const a of report.apps || []) cands.push({ kind: 'app', name: a.name, meta: a });
  for (const s of report.startup || []) cands.push({ kind: 'startup', name: s.name, meta: s });
  const hits = cands.filter((x) => t.includes(norm(x.name)));
  if (hits.length) return hits.sort((a, b) => b.name.length - a.name.length)[0];
  // 中文简称：迈克菲 → McAfee
  const alias = [[/迈克菲|麦咖啡/, /迈克菲|mcafee/i], [/火绒/, /火绒|huorong/i], [/电脑管家/, /管家/], [/网盘/, /网盘|云盘|onedrive|dropbox/i], [/浏览器/, /chrome|edge|firefox/i]];
  for (const [re, nameRe] of alias) {
    if (re.test(t)) {
      const hit = cands.find((x) => nameRe.test(x.name + ' ' + ((x.meta && x.meta.publisher) || '')));
      if (hit) return hit;
    }
  }
  return null;
}

const WHAT = /是什么|干什么|做什么|干啥|是啥|干嘛|有什么用/;
const REMOVE = /能删|可以删|删了|要不要删|卸载|能不能删|删掉/;
const UNDO = /撤销|退回|恢复原样|后悔|怎么退/;
const ADMIN = /管理员|uac|权限/;
const LIST = /哪个能删|哪些能删|能删什么|有什么能删|推荐删|清理什么|该删什么/;
const INSTALL = /装|安装|下载/;

function removableNotes(report, analysis, facts) {
  const byId = Object.fromEntries((analysis.findings || []).map((f) => [f.id, f]));
  const out = [];
  const av = byId.av_overlap;
  if (av) {
    const keep = (av.items || []).find((n) => /火绒|huorong/i.test(n)) || (av.items || [])[0];
    for (const n of (av.items || []).filter((x) => x !== keep).slice(0, 1)) out.push({ name: n, why: '已经有 ' + keep + ' 在做实时防护，两套会互相扫同一批文件。' });
  }
  const dup = byId.dup_office;
  if (dup && facts && facts.office) {
    const keepRe = facts.office === 'wps' ? /wps/i : /office|365/i;
    for (const n of (dup.items || []).filter((x) => !keepRe.test(x))) out.push({ name: n, why: '你说留 ' + (facts.office === 'wps' ? 'WPS' : 'Office') + '，这个就重复了。' });
  }
  return out.slice(0, 4);
}

export function answer(text, ctx) {
  const report = (ctx && ctx.report) || {};
  const analysis = (ctx && ctx.analysis) || {};
  const facts = (ctx && ctx.facts) || {};
  const t = String(text || '').trim();
  if (!t) return null;

  const byId = Object.fromEntries((analysis.findings || []).map((f) => [f.id, f]));
  const ent = findEntity(t, report);

  // 1) 泛问：哪些能删
  if (LIST.test(t)) {
    const list = removableNotes(report, analysis, facts);
    if (!list.length) return { say: '按这次的体检数据，没有哪一条是「必须删」的。真要塞空间，先把不用的开机自启关掉更划算。' };
    return {
      say: '按你这台机器的数据，这几条是最值得动的：\n' + list.map((x, i) => (i + 1) + '. ' + x.name + '——' + x.why).join('\n') +
        '\n\n卸载我不代劳：这类软件卸了装不回，我只把你带到设置页，你自己点。',
    };
  }

  // 2) 撤销 / 管理员这类通用问题
  if (UNDO.test(t) && !ent) {
    return { say: '我只动能撤回的东西：关自启的撤销是把注册表原标记写回去，基本是精确还原。卸载我不代劳——这类软件卸了装不回，我只带你到设置页。所以「能退」是真的能退，不是我嘴上说说。' };
  }
  if (ADMIN.test(t) && !ent) {
    return { say: '分两种：你这个账号自己的开机自启，不用管理员；整机级的（HKLM 那几条）要弹一次 UAC，你点「是」才动。改服务、开防火墙这类它不代劳，只把你带到设置页。' };
  }

  // 3) 要装软件：只引导到左侧装机清单，不在聊天里执行
  if (INSTALL.test(t) && !REMOVE.test(t)) {
    return { say: '装软件可以，但安装要你点一下：左边「装软件」里勾微信、QQ、网易云这些，我只从内置清单里装，装完还能从日志里撤销（卸载刚装的）。' };
  }

  // 4) 针对某个具体软件 / 自启项
  if (!ent) {
    if (WHAT.test(t) || REMOVE.test(t)) {
      return { say: '这个我没把握。我手上只有这次体检采到的名字，没法凭空判断一个我没见过的软件。把名字打全一点再问我——比如「迈克菲联网顾问」；或者问「哪些能删」，我按数据给你列。' };
    }
    return null;
  }

  const name = ent.name;
  const k = kindOf(name);
  const av = byId.av_overlap;
  const dupOffice = byId.dup_office;
  const oem = byId.oem_bloat;
  const inAv = !!(av && (av.items || []).includes(name));
  const inOffice = !!(dupOffice && (dupOffice.items || []).includes(name));
  const inOem = !!(oem && (oem.items || []).includes(name));

  const kb = lookup(name);
  if (ent.kind === 'startup') {
    const where = /^HKLM/i.test(String(ent.meta.source || '')) ? '整机级（要一次 UAC）' : '当前用户';
    if (kb) return { say: '「' + name + '」是' + kb.what + '。' + kb.can + '。它是' + where + '的开机自启，撤销就是把原标记写回去，基本是精确还原。' };
    return {
      say: '「' + name + '」是一个开机自启项，属于' + where + '。它不参与系统功能，开机时只是提前把程序拉起来；关掉以后你手动打开照样能用。撤销是把原标记写回去，基本是精确还原。',
    };
  }

  const meta = ent.meta || {};
  const factsLine = [meta.publisher ? '发布者 ' + meta.publisher : '', meta.installDate ? meta.installDate + ' 装上的' : ''].filter(Boolean).join('，');
  const head = '「' + name + '」是' + k.label + (factsLine ? '（' + factsLine + '）' : '') + '。';

  if (WHAT.test(t) && !REMOVE.test(t)) {
    let tail = '';
    if (inAv) tail = av.items.length > 1 ? '你现在装了好几套安全软件，它会和别的实时防护互相扫同一批文件。' : '';
    else if (inOffice) tail = '它和另外几个办公套件在抢「默认打开方式」。';
    else if (inOem) tail = '它是整机厂预装的，管灯效、风扇曲线、投屏这类东西。';
    else if (k.note) tail = k.note + '。';
    return { say: head + tail };
  }

  if (REMOVE.test(t)) {
    const keepAv = av && ((av.items || []).find((n) => /火绒|huorong/i.test(n)) || (av.items || [])[0]);
    if (inAv && name !== keepAv) {
      return {
        say: head + '可以卸，但我不代劳——这类软件没有「静默卸载 + 一键装回」的入口，自动卸了就等于撤不回。我带你到设置页，你点一下卸载。',
        cards: [{ action: 'open_settings', target: { uri: 'ms-settings:appsfeatures' }, title: '去设置里卸载 ' + name, why: '已经有 ' + keepAv + ' 在做实时防护，两套会互相扫同一批文件。', badge: '需要你自己点' }],
      };
    }
    if (inAv && name === keepAv) return { say: head + '这一套是我建议留下的，其余的卸掉就行。' };
    if (inOffice) {
      const keep = facts.office === 'wps' ? /wps/i : facts.office === 'office' ? /office|365/i : null;
      if (keep && !keep.test(name)) {
        return {
          say: head + '可以卸——你说留 ' + (facts.office === 'wps' ? 'WPS' : 'Office') + '，这个就重复了。但我不代劳：卸了装不回，我带你到设置页，你自己点。',
          cards: [{ action: 'open_settings', target: { uri: 'ms-settings:appsfeatures' }, title: '去设置里卸载 ' + name, why: '你已经选了留 ' + (facts.office === 'wps' ? 'WPS' : 'Office') + '，这个重复了。', badge: '需要你自己点' }],
        };
      }
      return { say: head + '你和另外两个办公套件里，留一个就够了。想留哪个跟我说一声，我把该卸的换过来。' };
    }
    if (inOem) {
      return { say: head + '删掉系统照样跑，但没必要删——更划算的是把它的开机自启关掉，用的时候再打开。' };
    }
    return { say: head + '这个不在我的规则库里，我不装懂：删了会不会影响你，我判断不了。要稳，就留着，只把它的开机自启关掉。' };
  }

  return { say: head };
}