(function () {
  var S = { rep: null, findings: [], profile: 'lite', plan: null, script: [] };
  var $ = function (s) { return document.querySelector(s); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fmtGB(n) { return n == null ? '--' : (Math.round(n * 10) / 10) + ' GB'; }
  function note(name) {
    for (var i = 0; i < KG.notes.length; i++) { if (KG.notes[i].re.test(name)) return KG.notes[i]; }
    return null;
  }
  function groupOf(list, g) { return list.filter(function (a) { return g.re.test(a.name); }); }

  /* ---------- 分析 ---------- */
  function analyze(rep) {
    var F = [], apps = rep.apps || [], st = rep.startup || [], sv = rep.services || [], sec = rep.security || {};

    /* 磁盘 */
    var disks = (rep.disks || []).filter(function (d) {
      return d.sizeGB >= 60 && !/RESTORE/i.test(d.label || '') && !/RECOVERY/i.test(d.label || '');
    });
    disks.forEach(function (d) {
      var ratio = d.freeGB / d.sizeGB;
      if (d.freeGB < 15 || ratio < 0.08) {
        F.push({ sev: 'high', cat: '磁盘', title: d.drive + ' 只剩 ' + fmtGB(d.freeGB),
          why: '系统盘低于 10% 会出现更新失败、软件装不上、休眠文件写不进去。' + d.drive + ' 总共 ' + fmtGB(d.sizeGB) + '，现在剩 ' + fmtGB(d.freeGB) + '（' + Math.round(ratio * 100) + '%）。',
          act: '把下载目录、微信/QQ 文件夹、游戏安装位置挪到别的盘，清理磁盘清理里的「临时文件」和「以前的 Windows 安装」。' });
      } else if (ratio < 0.18) {
        F.push({ sev: 'warn', cat: '磁盘', title: d.drive + ' 空间偏紧（剩 ' + fmtGB(d.freeGB) + '）',
          why: '还够用，但大版本更新可能需要 20 GB 以上的临时空间。',
          act: '先别急着装大软件，把不用的安装包和旧备份清一下。' });
      }
    });
    if (!F.some(function (f) { return f.cat === '磁盘'; })) {
      var c = disks[0];
      if (c) F.push({ sev: 'ok', cat: '磁盘', title: c.drive + ' 空间健康（剩 ' + fmtGB(c.freeGB) + '，' + Math.round(c.freeGB / c.sizeGB * 100) + '%）',
        why: '系统盘保持 20% 以上余量，更新和虚拟内存都不会卡。', act: '不用动。' });
    }

    /* 启动项 */
    var risky = st.filter(function (s) { return /\\Temp\\|\\Downloads\\/i.test(s.command || ''); });
    if (risky.length) {
      F.push({ sev: 'high', cat: '启动项', title: risky.length + ' 个启动项路径可疑',
        why: '启动项指向「临时目录/下载目录」，或者路径带空格却没加引号——这是被恶意程序劫持的常见特征，也可能是安装包没写好。',
        act: '一个个确认是不是你自己装的。不认识的就关掉。',
        items: risky.map(function (r) { return r.name + ' → ' + (r.command || '').slice(0, 60); }) });
    }
    var unq = st.filter(function (s) {
      var cmd = s.command || '';
      return /^[A-Za-z]:\\/.test(cmd) && !/^"/.test(cmd) && cmd.indexOf(' ') > -1;
    });
    if (unq.length && !risky.length) {
      F.push({ sev: 'info', cat: '启动项', title: unq.length + ' 个启动项路径带空格但没加引号',
        why: 'Windows 有时能自己猜对，有时猜错——表现就是「明明设了自启，开机却没起来」。不是安全问题。',
        act: '不影响用就不用管；想严谨一点，在任务管理器里关掉再重新添加一次即可。',
        items: unq.map(function (s) { return s.name + ' → ' + (s.command || '').slice(0, 56); }) });
    }
    if (st.length >= 26) {
      F.push({ sev: 'high', cat: '启动项', title: st.length + ' 个程序开机就要启动',
        why: '每个启动项都在开机时抢磁盘和 CPU。超过 25 个，开机时间通常要多出一分钟以上，而且它们在后台一直占内存。',
        act: '按下表挑出「只在用的时候才需要」的，剩下的关掉。',
        items: st.map(function (s) { return s.name; }) });
    } else if (st.length >= 16) {
      F.push({ sev: 'warn', cat: '启动项', title: st.length + ' 个程序开机自启，偏多',
        why: '系统自带之外的启动项，多数不是必须开机就起来的。',
        act: '把游戏平台、网盘、会议软件的启动项关掉——它们点图标再开完全一样。',
        items: st.map(function (s) { return s.name; }) });
    } else {
      F.push({ sev: 'ok', cat: '启动项', title: '开机自启 ' + st.length + ' 个，不多',
        why: '这个数量在正常范围。', act: '不用动。' });
    }

    /* 自启服务 */
    if (sv.length >= 20) {
      var byV = {};
      sv.forEach(function (s) {
        var g = KG.vendorGroups.find(function (v) { return v.re.test(s.display || s.name || ''); });
        var k = g ? g.label : '其他';
        byV[k] = (byV[k] || 0) + 1;
      });
      var top = Object.keys(byV).sort(function (a, b) { return byV[b] - byV[a]; })
        .map(function (k) { return k + ' ' + byV[k] + ' 个'; }).slice(0, 4).join('，');
      F.push({ sev: 'warn', cat: '服务', title: sv.length + ' 个第三方服务开机自启',
        why: '这些不是病毒，是厂商为了让「功能随时可用」装的常驻服务。代价是内存和后台唤醒。这一台主要是：' + top + '。',
        act: '在「服务」里把不用厂商服务的启动类型改成「手动」，系统需要时会自己拉起。',
        items: sv.slice(0, 14).map(function (s) { return s.display || s.name; }) });
    }

    /* 安全软件重复 */
    var secGroup = KG.dupGroups.find(function (g) { return g.key === 'security'; });
    var secApps = groupOf(apps, secGroup);
    /* 管家类常常只留在服务里，软件列表看不到——两边一起数，且按厂商去重
       （「迈克菲联网顾问」和「McAfee WebAdvisor」是同一个东西） */
    var canon = [
      { re: /火绒|Huorong/i, name: '火绒安全软件' },
      { re: /McAfee|迈克菲/i, name: 'McAfee 联网顾问（预装试用）' },
      { re: /PC Manager|电脑管家(?!.*腾讯)/i, name: '微软电脑管家' },
      { re: /腾讯电脑管家/i, name: '腾讯电脑管家' },
      { re: /360|Qihoo/i, name: '360 安全卫士' },
      { re: /金山|Kingsoft/i, name: '金山毒霸' }
    ];
    var secNames = [];
    apps.concat(sv).forEach(function (a) {
      var nm = a.display || a.name || '';
      var hit = canon.find(function (c) { return c.re.test(nm); });
      if (hit) { if (secNames.indexOf(hit.name) < 0) secNames.push(hit.name); }
      else if (secGroup.re.test(nm) && secNames.indexOf(nm) < 0) secNames.push(nm);
    });
    if (secNames.length >= 3) {
      F.push({ sev: 'high', cat: '安全', title: '同时装了 ' + secNames.length + ' 套安全/管家软件',
        why: '两套以上的实时防护会互相把对方扫一遍，文件操作明显变慢，还容易出现「一个拦一个放」的弹窗打架。Windows 只需要一套实时防护。',
        act: '只留一套（火绒这类轻量的就够），其余卸载干净，重启后再看安全中心有没有恢复正常。',
        items: secNames });
    } else if (secNames.length === 2) {
      F.push({ sev: 'warn', cat: '安全', title: '两套安全软件并存',
        why: '功能重叠，两边都会实时扫描同一批文件。平时感觉不到，装软件、编译、解压大文件时最明显。',
        act: '留一套即可，另一套卸载干净再去安全中心确认 Defender 有没有自动接管。', items: secNames });
    }

    /* Defender 让位：这是最容易被误判成「中毒了」的一条 */
    if (sec.defenderRealTime === false && secNames.length >= 1) {
      F.push({ sev: 'info', cat: '安全', title: 'Defender 实时防护显示为关闭——这次是正常的',
        why: 'Windows 的规矩是：只要装了第三方杀毒软件，Defender 就自动让位，避免两套防护打架。所以这里显示「关闭」不代表中招。',
        act: '不用处理。卸载多余的安全软件之后，Defender 会自己接管回来；去安全中心确认「谁在保护我」是你就行。' });
    }

    /* 防火墙 */
    var fw = (sec.firewall || []).filter(function (f) { return !f.enabled; });
    if (fw.length) {
      F.push({ sev: 'high', cat: '安全', title: '防火墙关闭：' + fw.map(function (f) { return f.name; }).join('、') + ' 网络',
        why: '在宿舍、咖啡店这类公共 Wi-Fi 下，防火墙是挡住局域网扫描的第一道门。关掉它通常是装某个软件时被引导关的，之后就忘了开回来。',
        act: '设置 → 隐私和安全性 → Windows 安全中心 → 防火墙和网络保护，把「专用」和「公用」都打开。' });
    } else if (sec.firewall && sec.firewall.length) {
      F.push({ sev: 'ok', cat: '安全', title: '防火墙开着', why: '所有网络配置文件的防火墙都是启用的。', act: '不用动。' });
    }

    /* 重复功能：聚合成一张卡，避免一个功能刷一排 */
    var dupHits = [];
    KG.dupGroups.forEach(function (g) {
      if (g.key === 'security') return;
      var hit = groupOf(apps, g);
      if (hit.length >= 3) dupHits.push({ g: g, hit: hit });
    });
    if (dupHits.length) {
      var big = dupHits.filter(function (d) { return d.hit.length >= 4; });
      F.push({ sev: big.length ? 'warn' : 'info', cat: '重复',
        title: dupHits.length === 1 ? ('装了 3 个' + dupHits[0].g.label) : (dupHits.length + ' 类软件各装了 3 个以上'),
        why: '同一件事有好几个客户端在抢「默认打开方式」，而且每个都注册了后台服务、开机自启和右键菜单。多半不是有意装的，是装别的软件时被捎带上的。',
        act: '每类挑一个主力留下，其余卸载；舍不得删的，至少把开机自启关掉——效果差不了多少。',
        items: dupHits.map(function (d) {
          return d.g.label + ' ' + d.hit.length + ' 个：' + d.hit.map(function (a) { return a.name.replace(/ 版本 .*$/, ''); }).join(' · ');
        }) });
    }

    /* 厂商全家桶 */
    var asus = KG.vendorGroups.find(function (v) { return v.key === 'asus'; });
    var asusApps = groupOf(apps, asus);
    if (asusApps.length >= 6) {
      var off = asusApps.filter(function (a) { var n = note(a.name); return n && n.v === 'off'; }).length;
      F.push({ sev: 'info', cat: '预装', title: '华硕预装组件 ' + asusApps.length + ' 个',
        why: '整机厂为了灯效、风扇曲线、投屏、桌宠装了一整套。功能是真的，但没必要全部开机就运行。',
        act: '灯效和桌宠留着手动用，把它们的自启关掉；' + (off ? '其中 ' + off + ' 个是纯装饰，可以先关。' : '接外接屏相关的组件留着。'),
        items: asusApps.map(function (a) { return a.name; }) });
    }

    /* 内存 */
    if (rep.system && rep.system.ramGB && rep.system.ramGB < 8) {
      F.push({ sev: 'info', cat: '硬件', title: '内存 ' + rep.system.ramGB + ' GB，偏小',
        why: '开浏览器十几个标签就会开始吃页面文件。', act: '少装常驻软件，接口别开太多。' });
    }

    /* 验机：新机最怕的不是全家桶，是「以为全新其实用过」 */
    var h = rep.health || null;
    if (h) {
      var bt = h.battery || {};
      var ratio = (bt.design && bt.full) ? bt.full / bt.design : null;
      if (ratio != null && ratio < 0.8) {
        F.push({ sev: 'high', cat: '验机', title: '电池健康只剩 ' + Math.round(ratio * 100) + '%',
          why: '设计容量 ' + bt.design + ' mWh，现在满充只有 ' + bt.full + ' mWh。电池是消耗件，衰减到 80% 以下续航会明显缩水，而全新机这一项应在 95% 以上。',
          act: '在保修期内可以拿这个数字去售后要求换电池；新机就这样，说明它已经被用过一段时间。' });
      } else if (ratio != null && ratio < 0.9) {
        F.push({ sev: 'warn', cat: '验机', title: '电池健康 ' + Math.round(ratio * 100) + '%，有衰减',
          why: '新机出厂测试也会有少量损耗，但正常在 95% 以上。' + Math.round(ratio * 100) + '% 说明充放电已经不少了。',
          act: '如果这是刚买的机器，值得问一句；自己用了一两年的话，这个数很正常。' });
      }
      if (bt.cycle != null && bt.cycle > 50) {
        F.push({ sev: 'warn', cat: '验机', title: '电池循环 ' + bt.cycle + ' 次',
          why: '循环次数是判断「用过多久」最硬的指标之一。新机通常在 5 次以内（出厂测试）。',
          act: '刚买就 50 次以上，基本可以确定不是全新机。' });
      }
      if (h.activated === false) {
        F.push({ sev: 'high', cat: '验机', title: 'Windows 未激活',
          why: '正版整机出厂就带数字许可证，开箱联网即自动激活。没激活可能是重装过系统，或者根本不是这台机器该有的授权。',
          act: '设置 → 系统 → 激活，看提示是「已链接到 Microsoft 账户」还是需要密钥。' });
      }
      if (h.secureBoot === false) {
        F.push({ sev: 'warn', cat: '验机', title: '安全启动（Secure Boot）是关的',
          why: 'Windows 11 要求开启它；部分游戏的反作弊、以及系统完整性保护也依赖它。整机厂有时为了兼容旧启动盘默认关掉。',
          act: '重启进 BIOS（开机连按 F2/Del），在 Security 里把 Secure Boot 打开。改之前先记下现在的设置。' });
      }
      if (h.problemDevices && h.problemDevices.length) {
        F.push({ sev: 'warn', cat: '验机', title: h.problemDevices.length + ' 个设备驱动异常',
          why: '设备管理器里有黄色感叹号，通常是缺驱动。新机出现这个，多半是装机时驱动没装全。',
          act: '用厂商自带的管家更新一次驱动，或者去官网按型号下芯片组/网卡驱动。',
          items: h.problemDevices.slice(0, 8).map(function (d) { return (d.name || '未知设备') + (d.cls ? '（' + d.cls + '）' : ''); }) });
      }
      if (h.tpm === false) {
        F.push({ sev: 'info', cat: '验机', title: 'TPM 未启用',
          why: 'TPM 是 Windows 11 的硬性要求之一，也用于 BitLocker 和部分登录方式。',
          act: 'BIOS 里把 PTT / fTPM 打开即可，不影响日常使用。' });
      }
    }

    var order = { high: 0, warn: 1, info: 2, ok: 3 };
    F.sort(function (a, b) { return order[a.sev] - order[b.sev]; });

    var score = 100;
    F.forEach(function (f) { score -= f.sev === 'high' ? 12 : f.sev === 'warn' ? 6 : f.sev === 'info' ? 1 : 0; });
    score = Math.max(35, Math.min(100, score));

    S.findings = F;
    S.secNames = secNames;
    S.health = rep.health || null;
    S.score = score;
    buildPlan(rep, F);
  }

  /* ---------- 开荒单 ---------- */
  function buildPlan(rep, F) {
    var apps = rep.apps || [], st = rep.startup || [];
    var p = S.profile;
    var today = [], week = [], later = [];

    F.filter(function (f) { return f.sev === 'high'; }).forEach(function (f) {
      today.push({ t: f.title, why: f.act });
    });

    var sec = F.filter(function (f) { return f.cat === '安全' && f.sev !== 'ok'; });
    if (!sec.length && st.length) today.push({ t: '把用不上的开机自启关掉', why: '任务管理器 → 启动应用，游戏平台/网盘/会议软件都可以关' });

    var short = function (n) { return String(n).replace(/ 版本 .*$/, '').replace(/ \(x64.*\)$/, ''); };

    if (p !== 'look') {
      var secs = S.secNames || [];
      if (secs.length > 1) {
        week.push({ t: '安全软件只留一套，其余卸载', why: '现在是 ' + secs.map(short).join(' + ') + '。留火绒这类轻量的就够，卸完重启让 Windows 重新接管' });
      }

      var content = apps.filter(function (a) { return /腾讯视频|哔哩哔哩|抖音|QQ音乐|汽水音乐|爱奇艺|优酷|酷狗/.test(a.name); });
      if (content.length >= 2) {
        week.push({ t: '收起 ' + content.length + ' 个内容客户端', why: content.slice(0, 3).map(function (a) { return short(a.name); }).join('、') + ' 等：网页版都能看，客户端只是多占内存和右键菜单' });
      }

      var hasWps = apps.some(function (a) { return /WPS Office/i.test(a.name); });
      var hasMs = apps.some(function (a) { return /Microsoft 365|OfficePLUS/i.test(a.name); });
      if (hasWps && hasMs) {
        week.push({ t: '办公套件只留一套', why: 'WPS 和 Microsoft 365 功能重叠，两个都常驻会抢默认打开方式；OfficePLUS 只是模板插件，可以先删' });
      }

      if (p === 'lite') {
        var games = apps.filter(function (a) { return /Steam|Epic|WeGame|无畏契约|Modern Warships|AntiCheatExpert|GameSDK/i.test(a.name); });
        if (games.length) {
          week.push({ t: '游戏相关的 ' + games.length + ' 项整组收起来', why: '平台、游戏本体、反作弊服务都是开机常驻；不玩了就整组卸，想玩再装回来' });
        }
      }

      var booster = apps.filter(function (a) { return /UU加速器|迅游|FlClash/i.test(a.name); });
      if (booster.length >= 2) {
        week.push({ t: '加速器别设开机自启', why: booster.map(function (a) { return short(a.name); }).join(' / ') + '：需要的时候手动开，开机就起只是白占端口' });
      }
    }

    week.push({ t: '装齐三件低调的必备工具', why: 'UniGetUI（统一装软件）、Everything（搜文件）、7-Zip（解压）——都能用 winget 装，不带捆绑' });
    week.push({ t: '建一个系统还原点', why: '改坏了能一键退回去，比事后重装省事' });

    later.push({ t: '每月跑一次体检', why: '装完新软件顺手看一眼自启和服务有没有变多' });
    later.push({ t: '装新软件前先查一遍', why: '优先官方安装包或 winget，避开「高速下载器」带的捆绑' });
    later.push({ t: '重要文件放非系统盘', why: '换电脑或重装时，系统盘是要被清掉的' });

    S.plan = [
      { title: '第一阶段', when: '今天 · 20 分钟', items: today },
      { title: '第二阶段', when: '这周 · 1 小时', items: week },
      { title: '第三阶段', when: '以后 · 每月 5 分钟', items: later }
    ];
  }

  /* ---------- 脚本 ---------- */
  function buildScript(rep) {
    var apps = rep.apps || [], st = rep.startup || [];
    var L = [];
    function h(t) { L.push({ k: 'h', t: t }); }
    function c(t) { L.push({ k: 'c', t: t }); }
    function b() { L.push({ k: 'b', t: '' }); }

    h('# ============================================');
    h('#  开机第一天 · 开荒脚本');
    h('#  所有命令默认被注释。逐条看，确认哪条要执行，');
    h('#  把行首的 # 删掉，再整段粘贴进 PowerShell。');
    h('# ============================================');
    b();
    h('# 0) 先建一个还原点，给自己留退路（需要管理员）');
    c('# Enable-ComputerRestore -Drive "C:\\"');
    c('# Checkpoint-Computer -Description "kaiguang-before" -RestorePointType MODIFY_SETTINGS');
    b();

    if (st.length) {
      h('# 1) 关掉开机自启（只处理当前用户 HKCU 项，最安全的一类）');
      c('# 先备份：');
      c('# $k = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"');
      c('# reg export "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" "$env:USERPROFILE\\Desktop\\run-backup.reg" /y');
      b();
      st.slice(0, 12).forEach(function (s) {
        var nm = (s.name || '').replace(/"/g, '');
        c('# Remove-ItemProperty -Path $k -Name "' + nm + '" -ErrorAction SilentlyContinue   # ' + (s.command || '').slice(0, 48));
      });
      b();
      c('# 提示：HKLM 下的启动项（所有用户共用）需要管理员，用「任务管理器 → 启动应用」关更稳。');
      b();
    }

    var rm = apps.filter(function (a) { var n = note(a.name); return n && (n.v === 'rm' || n.v === 'opt'); });
    if (rm.length) {
      h('# 2) 卸载重复/可选软件（用 winget，先 --dry-run 预览，确认后再去掉）');
      rm.slice(0, 10).forEach(function (a) {
        c('# winget uninstall "' + a.name.replace(/"/g, '') + '" --dry-run');
      });
      b();
    }

    h('# 3) 把这些工具补齐（都是开源/无捆绑）');
    c('# winget install --id 7zip.7zip -e');
    c('# winget install --id voidtools.Everything -e');
    c('# winget install --id MartiCliment.UniGetUI -e');
    b();

    h('# 4) 打开防火墙（相当于安全中心里点两下）');
    c('# Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True');
    b();

    h('# 5) 复查：改完之后再跑一次采集，对比前后差异');
    c('# .\\collect.ps1');
    b();
    h('# 说明：本脚本不会自动执行任何一条命令，也没有静默安装或改注册表的动作。');
    h('#       删掉 # 之后才会真的运行，跑之前请确认路径和软件名对得上你这一台。');
    S.script = L;
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var rep = S.rep;
    $('#drop').classList.add('hidden');
    $('#result').classList.remove('hidden');

    $('#score').textContent = S.score;
    $('#scoreHint').textContent = S.score >= 85 ? '基础不错，主要是「装得太多」' :
      S.score >= 70 ? '有几处需要动手，都不难' : '问题集中在后台和重复安装';

    var disks = (rep.disks || []).filter(function (d) { return /^[A-Z]:$/.test(d.drive) && !/RESTORE/i.test(d.label || ''); });
    $('#m-disk').textContent = disks.length ? Math.round(disks[0].freeGB / disks[0].sizeGB * 100) + '% 可用' : '--';
    $('#m-startup').textContent = (rep.startup || []).length + ' 个';
    $('#m-svc').textContent = (rep.services || []).length + ' 个';
    $('#m-apps').textContent = (rep.apps || []).length + ' 个';

    var sys = rep.system || {};
    $('#machine').innerHTML = [
      sys.manufacturer, sys.model, sys.osName, sys.cpu,
      sys.ramGB ? '内存 ' + sys.ramGB + ' GB' : ''
    ].filter(Boolean).map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('');

    $('#findings').innerHTML = S.findings.map(function (f) {
      var items = f.items && f.items.length
        ? '<ul class="f-items">' + f.items.slice(0, 16).map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'
        : '';
      return '<div class="f ' + f.sev + '">' +
        '<div class="f-top"><span class="f-title">' + esc(f.title) + '</span><span class="f-tag">' + esc(f.cat) + '</span></div>' +
        '<div class="f-why">' + esc(f.why) + '</div>' +
        (f.act ? '<div class="f-act">' + esc(f.act) + '</div>' : '') + items + '</div>';
    }).join('');

    $('#profiles').innerHTML = KG.profiles.map(function (p) {
      return '<button class="pf' + (p.key === S.profile ? ' on' : '') + '" data-p="' + p.key + '" title="' + esc(p.note) + '">' + esc(p.label) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('#profiles').children, function (btn) {
      btn.onclick = function () { S.profile = btn.dataset.p; buildPlan(S.rep, S.findings); renderPlan(); renderProfiles(); };
    });

    renderHealth();
    renderPlan();
    $('#script').innerHTML = S.script.map(function (l) {
      return '<span class="' + (l.k === 'c' ? 'c' : l.k === 'h' ? 'h' : '') + '">' + esc(l.t) + '</span>';
    }).join('\n');
  }

  function verdictOf(h) {
    var bt = (h && h.battery) || {};
    var ratio = (bt.design && bt.full) ? bt.full / bt.design : null;
    var days = h ? h.installDays : null;
    var cyc = bt.cycle;
    if (days == null && ratio == null) {
      return { k: 'unknown', t: '这台机器没上报安装时间和电池容量', d: '判断不了新旧，往下看清单就好。' };
    }
    var pc = ratio == null ? null : Math.round(ratio * 100);
    if (days != null && days <= 7 && (cyc == null || cyc <= 5) && (ratio == null || ratio >= 0.95)) {
      return { k: 'new', t: '看起来就是全新机',
        d: '系统 ' + days + ' 天前装好' + (pc == null ? '' : '，电池健康 ' + pc + '%') + (cyc == null ? '' : '，循环 ' + cyc + ' 次') +
           '。这个组合只有开箱机器才有，可以放心开荒。' };
    }
    if (days != null && days <= 45) {
      return { k: 'warn', t: '用过一小段时间，不算旧',
        d: '系统装好 ' + days + ' 天' + (pc == null ? '' : '，电池健康 ' + pc + '%') + '。不是刚拆封，但也没到要担心的程度。' };
    }
    return { k: 'bad', t: '这台不是刚拆封的机器',
      d: '系统装好 ' + (days == null ? '未知天数' : days + ' 天') + (pc == null ? '' : '，电池健康 ' + pc + '%') +
         '。如果是你刚买的，值得确认一下是不是样机或退换机；自己用了一段时间的话，就按开荒单往下走。' };
  }

  function renderHealth() {
    var h = S.health;
    var v = verdictOf(h);
    var cls = v.k === 'new' ? '' : v.k === 'warn' ? ' warn' : v.k === 'bad' ? ' bad' : ' unknown';
    $('#verdict').className = 'verdict' + cls;
    $('#verdict').innerHTML = '<b>' + esc(v.t) + '</b><span>' + esc(v.d) + '</span>';

    var bt = (h && h.battery) || {};
    var ratio = (bt.design && bt.full) ? bt.full / bt.design : null;
    var gpuList = (h && h.gpu) || [];
    var gpuArea = gpuList.slice().sort(function (a, b) { return ((b.width * b.height) || 0) - ((a.width * a.height) || 0); })[0] || {};
    var gpuHz = gpuList.reduce(function (m, g) { return (g.hz || 0) > m ? g.hz : m; }, 0);
    var gpu = { width: gpuArea.width, height: gpuArea.height, hz: gpuHz };
    var stor = (h && h.storage && h.storage[0]) || {};
    var stats = [
      { k: '电池健康', v: ratio == null ? '未上报' : Math.round(ratio * 100) + '%',
        s: bt.design && bt.full ? ('满充 ' + Math.round(bt.full / 1000) + ' / 设计 ' + Math.round(bt.design / 1000) + ' Wh') : '这块电池不报告设计容量' },
      { k: '电池循环', v: bt.cycle == null ? '未上报' : bt.cycle + ' 次', s: bt.cycle == null ? '多数笔记本不写这一项' : '新机通常 ≤ 5 次' },
      { k: '系统装好', v: (h && h.installDays != null) ? h.installDays + ' 天' : '未知', s: '从系统安装日期算起' },
      { k: '本次开机', v: (h && h.uptimeHours != null) ? (h.uptimeHours < 1 ? '不到 1 小时' : h.uptimeHours + ' 小时') : '未知', s: '开机时长，不是用电时长' }
    ];
    if (gpu.hz) stats.push({ k: '屏幕', v: gpu.width + '×' + gpu.height + ' @' + gpu.hz + 'Hz', s: '面板支持的最大值' });
    if (stor.name) stats.push({ k: '硬盘', v: stor.sizeGB + ' GB ' + stor.media, s: stor.name });

    $('#vstats').innerHTML = stats.map(function (s) {
      return '<div class="vstat"><span class="k">' + esc(s.k) + '</span><span class="v">' + esc(s.v) + '</span>' +
        '<small style="color:#6b7787;font-size:11.5px">' + esc(s.s) + '</small></div>';
    }).join('');
  }

  function screenTest() {
    var cols = [['#ff0000', '红'], ['#00ff00', '绿'], ['#0000ff', '蓝'], ['#ffffff', '白'], ['#000000', '黑']];
    var i = 0;
    var d = document.createElement('div');
    d.className = 'screenfx';
    var hint = document.createElement('i');
    d.appendChild(hint);
    function onKey(e) { if (e.key === 'Escape') { cleanup(); } }
    function cleanup() { document.removeEventListener('keydown', onKey); if (d.parentNode) d.parentNode.removeChild(d); }
    function draw() {
      if (i >= cols.length) { cleanup(); return; }
      d.style.background = cols[i][0];
      hint.textContent = cols[i][1] + '  ·  点击换下一屏  ·  Esc 退出   (' + (i + 1) + '/' + cols.length + ')';
    }
    d.onclick = function () { i++; draw(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(d);
    draw();
  }

  function renderProfiles() {
    Array.prototype.forEach.call($('#profiles').children, function (b) {
      b.classList.toggle('on', b.dataset.p === S.profile);
    });
  }

  function renderPlan() {
    $('#plan').innerHTML = S.plan.map(function (s) {
      return '<div class="stage"><h3>' + esc(s.title) + '</h3><div class="when">' + esc(s.when) + '</div><ul>' +
        s.items.map(function (i) { return '<li>' + esc(i.t) + (i.why ? '<span class="why">' + esc(i.why) + '</span>' : '') + '</li>'; }).join('') +
        '</ul></div>';
    }).join('');
  }

  /* ---------- 载入 ---------- */
  function load(rep) {
    if (!rep || !rep.system) { alert('这个文件不太对：缺少 system 字段。请确认是 collect.ps1 生成的 report.json。'); return; }
    S.rep = rep;
    analyze(rep);
    buildScript(rep);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function loadFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try { load(JSON.parse(fr.result)); }
      catch (e) { alert('JSON 解析失败：' + e.message); }
    };
    fr.readAsText(file, 'utf-8');
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    var drop = $('#drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('hot'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('hot'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    $('#file').addEventListener('change', function (e) {
      if (e.target.files[0]) loadFile(e.target.files[0]);
    });
    $('#demoNew').addEventListener('click', function () {
      if (window.KG_SAMPLE_NEW) load(window.KG_SAMPLE_NEW);
    });
    $('#demo').addEventListener('click', function () {
      if (window.KG_SAMPLE) load(window.KG_SAMPLE);
      else alert('示例数据没加载成功。');
    });
    $('#reset').addEventListener('click', function () {
      $('#result').classList.add('hidden');
      drop.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#copy').addEventListener('click', function () {
      var text = S.script.map(function (l) { return l.t; }).join('\r\n');
      navigator.clipboard.writeText(text).then(function () {
        $('#copy').textContent = '已复制';
        setTimeout(function () { $('#copy').textContent = '复制'; }, 1500);
      });
    });
    $('#download').addEventListener('click', function () {
      var text = S.script.map(function (l) { return l.t; }).join('\r\n');
      var blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kaiguang-plan.ps1';
      a.click();
    });
    $('#screenTest').addEventListener('click', screenTest);
    $('#ai').addEventListener('click', aiRead);
    if (window.KG_AUTO) load(window.KG_AUTO);
    else if (/[?&]demo/.test(location.search) && window.KG_SAMPLE) load(window.KG_SAMPLE);
  });

  /* ---------- 可选的 AI 深读（需要本地 server.mjs + key） ---------- */
  function aiRead() {
    var out = $('#aiOut');
    out.classList.remove('hidden');
    out.textContent = '正在读这份体检报告…';
    $('#ai').disabled = true;

    var payload = {
      system: S.rep.system,
      findings: S.findings.map(function (f) { return { sev: f.sev, title: f.title, why: f.why }; }),
      apps: (S.rep.apps || []).map(function (a) { return a.name; })
    };

    fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { out.textContent = d.text || '（返回为空）'; })
      .catch(function () {
        var first = S.findings.filter(function (f) { return f.sev === 'high'; }).slice(0, 2)
          .map(function (f) { return '· ' + f.title; }).join('\n');
        out.textContent = '本地模式：没有连上 AI 服务（未启动 server.mjs 或未配置 key）。\n\n' +
          '先做这两件，其他都可以往后放：\n' + (first || '· 没有紧急项，按开荒单第二阶段的顺序来做就行') +
          '\n\n这一步是可选的：体检和高亮本身不依赖 AI，规则都在你本地跑。';
      })
      .then(function () { $('#ai').disabled = false; });
  }

  window.KG_APP = { load: load };
})();
