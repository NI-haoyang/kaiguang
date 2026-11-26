// 规则引擎：把 report.json 变成「分数 + 体检条目 + 卡片候选」
// 这一层不调 AI。有 key 时 AI 在它上面加解释，没 key 时它自己就是全部产品。

const CATS = [
  { id: 'office', label: '办公套件', kw: ['office', 'wps', 'word', 'excel', '365', 'libreoffice', '永中'] },
  { id: 'browser', label: '浏览器', kw: ['chrome', 'edge', 'firefox', '夸克', '360浏览器', 'qq浏览器', 'opera', 'brave'] },
  { id: 'video', label: '视频客户端', kw: ['哔哩哔哩', 'bilibili', '腾讯视频', '爱奇艺', '优酷', '抖音', 'netflix', 'potplayer', 'vlc'] },
  { id: 'music', label: '音乐客户端', kw: ['qq音乐', '网易云', '酷狗', '汽水', 'spotify', 'foobar'] },
  { id: 'accel', label: '网络/游戏加速器', kw: ['加速器', 'accelerator', '迅游', '雷神', 'uu加速', 'flclash', 'clash', 'v2ray'] },
  { id: 'cloud', label: '网盘/同步', kw: ['百度网盘', '阿里云盘', '夸克网盘', '迅雷', 'onedrive', 'dropbox', '坚果云'] },
  { id: 'av', label: '安全/管家', kw: ['火绒', '360安全', '360杀毒', '腾讯电脑管家', 'mcafee', '迈克菲', '卡巴斯基', 'avast', '诺顿', '联想电脑管家', '微软电脑管家', 'huorong', 'kaspersky'] },
];
const OEM = ['asus', 'rog', 'armoury', 'aura', 'armory', 'myasus', 'asusupdate', 'glidex'];

const has = (s, k) => String(s || '').toLowerCase().includes(k);
const catOf = (name) => CATS.find(c => c.kw.some(k => has(name, k)));

function groupByCat(apps) {
  const out = {};
  for (const a of apps) {
    const c = catOf(a.name);
    if (!c) continue;
    (out[c.id] = out[c.id] || { label: c.label, items: [] }).items.push(a);
  }
  return out;
}

export function buildFindings(r) {
  const findings = [];
  const push = (f) => findings.push({ level: 'info', tone: 'info', ...f });

  const apps = r.apps || [];
  const startup = r.startup || [];
  const services = r.services || [];
  const sec = r.security || {};
  const h = r.health || {};
  const disk = (r.disks || []).find(x => x.drive === 'C:') || (r.disks || [])[0] || {};
  const groups = groupByCat(apps);

  // —— 验机 ——
  const design = h.battery && h.battery.design;
  const full = h.battery && h.battery.full;
  const battHealth = design && full ? Math.round(full / design * 100) : null;
  const days = h.installDays;
  let verify = { tone: 'ok', title: '看起来就是全新机', detail: '' };
  if (days == null) verify = { tone: 'muted', title: '装了多少天：读不到', detail: '系统没有留下记录，不影响开荒。' };
  else if (days <= 7 && (battHealth == null || battHealth >= 95)) {
    verify = { tone: 'ok', title: '看起来就是全新机', detail: '系统 ' + days + ' 天前装好' + (battHealth ? '，电池健康 ' + battHealth + '%' : '') + '，这个组合只有开箱机器才有。' };
  } else if (days <= 45) {
    verify = { tone: 'warn', title: '应该刚用没多久', detail: '系统装好 ' + days + ' 天，自己用了一段时间的话，就按开荒单往下走。' };
  } else {
    verify = { tone: 'high', title: '这台不是刚拆封的机器', detail: '系统装好 ' + days + ' 天' + (battHealth ? '，电池健康 ' + battHealth + '%' : '') + '。如果你是按新机买的，值得确认一下是不是样机或退换机。' };
  }

  // —— 防火墙 ——
  const off = (sec.firewall || []).filter(f => !f.enabled).map(f => f.name);
  if (off.length) {
    push({ id: 'firewall_off', level: 'high', title: '防火墙关着：' + off.join('、') + ' 网络',
      detail: '在宿舍、咖啡店这类公共 Wi-Fi 下，防火墙是挡住局域网扫描的第一道门。关掉它通常是装某个软件时被引导关的，之后就忘了开回来。',
      fix: '设置 → 隐私和安全性 → Windows 安全中心 → 防火墙和网络保护，把「专用」和「公用」都打开。',
      action: 'open_settings', args: { uri: 'ms-settings:windowsdefender' }, badge: '带到设置页', cta: '打开设置页' });
  }

  // —— 安全软件 ——
  const avs = (groups.av && groups.av.items) || [];
  if (avs.length >= 2) {
    push({ id: 'av_overlap', level: 'warn', title: '同时装了 ' + avs.length + ' 套安全/管家软件',
      detail: '两套以上的实时防护会互相把对方扫一遍，文件操作明显变慢，还容易出现「一个拦一个」的弹窗打架。Windows 只需要一套实时防护。',
      fix: '只留一套（火绒这类轻量的就够），其余卸载干净，重启后再看安全中心有没有恢复正常。',
      items: avs.map(a => a.name), tone: 'warn' });
  }

  // —— Defender 状态 ——
  if (sec.defenderRealTime === false && avs.length === 0) {
    push({ id: 'defender_off', level: 'high', title: '没有任何实时防护在跑', detail: 'Defender 关了，也没装第三方杀毒，这台机器目前是裸奔状态。', fix: '打开 Windows 安全中心 → 病毒和威胁防护 → 实时保护。', action: 'open_settings', args: { uri: 'ms-settings:windowsdefender' }, badge: '带到设置页' });
  }

  // —— 启动项 ——
  const n = startup.length;
  if (n >= 12) {
    push({ id: 'startup_many', level: 'warn', title: '开机自启 ' + n + ' 个', detail: '这个数量偏多。启动项拖慢的是开机那几十秒，不影响用起来之后的速度。', tone: 'warn' });
  } else if (n > 0) {
    push({ id: 'startup_ok', level: 'ok', title: '开机自启 ' + n + ' 个，不多', detail: '这个数量在正常范围。', tone: 'ok' });
  }

  // —— 可疑启动路径 ——
  const suspicious = startup.filter(s => /\\temp\\|\\downloads\\|appdata\\local\\temp/i.test(s.command || '') && !/^"/.test(s.command || ''));
  for (const s of suspicious) {
    push({ id: 'startup_suspect_' + s.name, level: 'high', title: '启动路径可疑：' + s.name,
      detail: '启动项指向「临时目录/下载目录」，或者路径带空格却没加引号。这是被恶意程序劫持的常见特征，也可能是安装包没写好。',
      items: [s.name + ' → ' + s.command], tone: 'high' });
  }

  // —— 服务 ——
  if (services.length >= 20) {
    push({ id: 'svc_many', level: 'info', title: services.length + ' 个第三方服务开机自启',
      detail: '这些不是病毒，是厂商为了让「功能随时可用」装的常驻服务。代价是内存和后台唤醒。', tone: 'info' });
  }

  // —— 磁盘 ——
  const freePct = disk.sizeGB ? Math.round(disk.freeGB / disk.sizeGB * 100) : null;
  if (freePct != null && freePct < 15) {
    push({ id: 'disk_low', level: 'high', title: 'C: 盘只剩 ' + freePct + '%', detail: '系统盘低于 15% 会明显拖慢更新和虚拟内存。', tone: 'high' });
  } else if (freePct != null && freePct < 30) {
    push({ id: 'disk_warn', level: 'warn', title: 'C: 盘剩余 ' + freePct + '%', detail: '还够用，但清一批临时文件会更稳。', tone: 'warn' });
  } else if (freePct != null) {
    push({ id: 'disk_ok', level: 'ok', title: 'C: 空间健康（剩 ' + freePct + '%，' + disk.freeGB + ' GB）', detail: '系统盘保持 20% 以上余量，更新和虚拟内存都不会卡。', tone: 'ok' });
  }

  // —— 同类重复 ——
  const dupOrder = ['office', 'browser', 'video', 'music', 'accel', 'cloud'];
  for (const id of dupOrder) {
    const g = groups[id];
    if (!g) continue;
    const min = id === 'office' ? 2 : 3;
    if (g.items.length < min) continue;
    push({ id: 'dup_' + id, level: id === 'office' ? 'warn' : 'info', title: '装了 ' + g.items.length + ' 个' + g.label,
      detail: '同一件事有好几个客户端在抢「默认打开方式」，而且每个都注册了后台服务、开机自启和右键菜单。多半不是有意的，是装别的软件时被捎带上的。',
      fix: '每类挑一个主力留下，其余卸载；舍不得删的，至少把开机自启关掉——效果差不了多少。',
      items: g.items.map(a => a.name), catId: id, tone: id === 'office' ? 'warn' : 'info' });
  }

  // —— 品牌预装 ——
  const oem = apps.filter(a => OEM.some(k => has(a.name, k)));
  if (oem.length >= 6) {
    push({ id: 'oem_bloat', level: 'info', title: '品牌预装组件 ' + oem.length + ' 个',
      detail: '整机厂为了灯效、风扇曲线、投屏、桌宠装了一整套。功能是真的，但没必要全部开机就运行。',
      items: oem.map(a => a.name), tone: 'info' });
  }

  // —— Secure Boot ——
  if (h.secureBoot === false) {
    push({ id: 'secureboot_off', level: 'info', title: '安全启动是关的', detail: '关掉通常是为了装双系统或某些驱动。日常使用开着更安全，但它不影响开荒，先记一笔。', tone: 'info' });
  }

  const score = Math.max(30, Math.min(100, 100 - findings.reduce((s, f) => s + (f.level === 'high' ? 12 : f.level === 'warn' ? 6 : f.level === 'info' ? 1 : 0), 0)));
  const counts = {
    high: findings.filter(f => f.level === 'high').length,
    warn: findings.filter(f => f.level === 'warn').length,
    info: findings.filter(f => f.level === 'info').length,
  };
  return { score, findings, counts, verify, groups, metrics: { freePct, battHealth, days } };
}

export function digest(r, a) {
  const apps = (r.apps || []).map(x => x.name).join('、');
  const startup = (r.startup || []).map(s => s.name + (s.path ? '（' + String(s.path).slice(0, 90) + '）' : '') + (s.source.startsWith('HKLM') ? '(系统级)' : '')).join('、');
  const svc = (r.services || []).map(s => s.display || s.name).slice(0, 30).join('、');
  const fw = (r.security.firewall || []).map(f => f.name + (f.enabled ? '开' : '关')).join('/');
  return [
    '机器：' + (r.system.manufacturer || '') + ' ' + (r.system.model || '') + '，' + r.system.osName + ' build ' + r.system.osBuild,
    'CPU ' + r.system.cpu + '，内存 ' + r.system.ramGB + ' GB，C: 剩 ' + a.metrics.freePct + '%',
    '系统装好 ' + a.metrics.days + ' 天，电池健康 ' + (a.metrics.battHealth || '未知') + '%',
    '软件 ' + (r.counts.apps) + ' 个：' + apps,
    '开机自启 ' + (r.counts.startup) + ' 个：' + startup,
    '第三方服务 ' + (r.counts.services) + ' 个：' + svc,
    '防火墙 ' + fw + '；Defender 实时保护 ' + (r.security.defenderRealTime ? '开' : '关'),
    '规则引擎结论：' + a.findings.filter(f => f.level !== 'ok').map(f => f.title).join('；'),
  ].join('\n');
}
