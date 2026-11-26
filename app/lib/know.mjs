// 常见预装 / 常用软件的小知识库：只写「是什么、能不能动」，不写命令。
// 用途：① 给 AI 当事实底料；② 没网 / 没 key 时本地问答也能答得像样。
const KB = [
  { re: /tx\s*mascot/i, what: '华硕天选（TUF Gaming）系列预装的桌宠 / 主题组件，负责桌面吉祥物、灯效联动那套装饰', can: '可以关开机自启，不影响系统功能，手动打开照样能用' },
  { re: /aura|lighting\s*service|lighting effect/i, what: '华硕 AURA 灯效组件，负责机箱、键盘、外设的 RGB 同步', can: '不调灯效时可以关自启；关了灯效停在你上次的颜色' },
  { re: /armoury\s*crate/i, what: '华硕 Armoury Crate 整机控制中心，管性能模式、风扇曲线、灯效和驱动更新', can: '常用就留着；不常用可以关自启，需要时再打开' },
  { re: /asus\s*framework\s*service/i, what: '华硕预装的框架服务，给 Armoury Crate / AURA 这类组件打底', can: '单独关掉通常没影响，但可能让华硕控制中心功能残缺；不确定就留着' },
  { re: /hotplug\s*controller/i, what: '华硕的外设热插拔控制组件，管耳机、鼠标这类设备的即插即用', can: '关掉可能影响外设识别，建议留着' },
  { re: /glidex/i, what: '华硕 GlideX 多屏协同 / 投屏组件，把平板或手机当扩展屏', can: '不投屏时它只是占后台，可以关自启' },
  { re: /myasus/i, what: '华硕 MyASUS 支持中心，管驱动更新、保修和诊断', can: '可以关自启，需要更新时手动打开' },
  { re: /rog\s*live\s*service|falchion/i, what: 'ROG 外设 / 键盘的配套服务，负责灯效和按键配置', can: '不用 ROG 外设时可以关' },
  { re: /mcafee|迈克菲/i, what: '迈克菲（McAfee）杀毒 / 联网顾问，整机厂常见的预装试用版', can: '可以卸，但我不代劳；已经有火绒的话两套实时防护会互相扫，建议只留一套' },
  { re: /officeplus/i, what: '微软 OfficePLUS 模板 / 素材插件，不是 Office 本体，装不装都不影响打开文档', can: '可以卸，但我不代劳；卸了装不回原版本，只带你到设置页' },
  { re: /microsoft\s*365|office\s*365/i, what: '微软 365 订阅版 Office，Word / Excel / PowerPoint 的正经本体', can: '要留就留一个办公套件；重复的可以卸，但我不代劳' },
  { re: /wps/i, what: '金山 WPS Office，国产办公套件，和微软 Office 抢默认打开方式', can: '留一个办公套件就够；重复的可以卸，但我不代劳' },
  { re: /everything/i, what: 'voidtools 的文件名搜索工具，建索引后秒搜全盘文件', can: '很轻，建议留着；嫌它开机占位可以关自启，用时手动开' },
  { re: /sysdiag|火绒/i, what: '火绒安全的实时防护组件，国产轻量杀毒', can: '建议留这一套，其他安全软件可以卸（但我不代劳）' },
  { re: /vmware/i, what: 'VMware 虚拟机平台的托盘 / 网络组件，管虚拟网卡和虚拟机设备', can: '不常开虚拟机可以关自启，用的时候手动打开' },
  { re: /edge\s*autolaunch|microsoftedge/i, what: 'Edge 浏览器的开机预加载，让浏览器启动快一点', can: '关掉不影响手动打开，只是首次启动慢半秒' },
  { re: /onedrive/i, what: '微软 OneDrive 网盘同步客户端', can: '不用云同步可以关自启；卸载会停止同步，文件本身还在' },
  { re: /迅雷|thunder/i, what: '迅雷下载工具，带后台服务和右键菜单', can: '不常用可以卸，但我不代劳；至少把自启关掉' },
  { re: /网易云|qq音乐|酷狗|spotify/i, what: '音乐客户端，网页版也能听', can: '同类留一个就够；其余可以卸，但我不代劳' },
  { re: /哔哩哔哩|bilibili|腾讯视频|爱奇艺|优酷|抖音/i, what: '视频客户端，网页版也能看', can: '同类留一个就够；其余可以卸，但我不代劳' },
  { re: /clash|v2ray|vpn|proxy|加速器/i, what: '网络代理 / 游戏加速器，常驻后台维持连接', can: '你自己装的网络工具，别乱动；不用时可以关自启' },
  { re: /夸克/i, what: '夸克浏览器，Chromium 内核', can: '浏览器留常用的就行；重复的可以卸，但我不代劳' },
];

export function lookup(name) {
  const s = String(name || '');
  for (const e of KB) if (e.re.test(s)) return e;
  return null;
}

export function factsFor(text) {
  const s = String(text || '');
  const out = [];
  for (const e of KB) {
    const m = s.match(e.re);
    if (m) out.push('- ' + m[0] + '：' + e.what + '；' + e.can + '。');
  }
  return out.slice(0, 6);
}

export function allFacts() { return KB.map(e => '- ' + e.what + '；' + e.can + '。'); }
