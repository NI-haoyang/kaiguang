/* 规则库：全部是「可解释的判断」，没有黑盒评分 */
window.KG = {
  /* 同一功能装了多个：不是错误，但每个都在后台吃资源 */
  dupGroups: [
    { key:'browser',  label:'浏览器',        re:/(^|\W)(chrome|edge|firefox|opera|brave|vivaldi|夸克|QQ浏览器|360安全浏览器|搜狗高速浏览器|猎豹)/i },
    { key:'booster',  label:'网络/游戏加速器', re:/(UU加速器|迅游|雷神加速|奇游|小黑盒加速|FlClash|Clash|v2ray|加速器)/i },
    { key:'video',    label:'视频/音乐客户端', re:/(腾讯视频|哔哩哔哩|爱奇艺|优酷|抖音|快手|QQ音乐|网易云音乐|汽水音乐|酷狗|酷我)/i },
    { key:'cloud',    label:'网盘/同步',      re:/(百度网盘|OneDrive|夸克|阿里云盘|坚果云|Dropbox|微云)/i },
    { key:'meeting',  label:'会议/协作',      re:/(腾讯会议|飞书|钉钉|Zoom|Teams|企业微信|WPS会议)/i },
    { key:'office',   label:'办公套件',       re:/(WPS Office|Microsoft 365|OfficePLUS|永中|LibreOffice)/i },
    { key:'security', label:'安全/管家类',    re:/(火绒|360安全|360杀毒|腾讯电脑管家|迈克菲|McAfee|PC Manager|电脑管家|金山|百度卫士|鲁大师|Norton|卡巴斯基)/i },
    { key:'compress', label:'压缩工具',       re:/(7-Zip|WinRAR|Bandizip|360压缩|好压|快压)/i },
    { key:'player',   label:'本地播放器',     re:/(PotPlayer|VLC|QQ影音|暴风影音|MPC-HC)/i }
  ],

  /* 同厂商全家桶 */
  vendorGroups: [
    { key:'asus',   label:'华硕/ROG 组件', re:/(ASUS|ROG|Armoury|AURA|GlideX|天选|TX Mascot|ScreenXpert|AI Noise)/i },
    { key:'nvidia', label:'NVIDIA 组件',   re:/(NVIDIA)/i },
    { key:'ms',     label:'微软运行库/服务', re:/(Visual C\+\+|\.NET Runtime|Windows Desktop Runtime|Application Compatibility Fix)/i }
  ],

  /* 常见软件：它是干嘛的 + 我的建议。用于把「一堆陌生名字」变成人话 */
  notes: [
    { re:/Armoury Crate/i,           what:'华硕性能/灯效中心',       v:'off',  adv:'留着调风扇和灯效，但没必要开机自启' },
    { re:/AURA/i,                    what:'华硕灯效服务',             v:'off',  adv:'只在你改灯效时才需要' },
    { re:/ROG Live/i,                what:'ROG 直播/推流组件',        v:'off',  adv:'不直播就可以关' },
    { re:/GlideX/i,                  what:'手机投屏到电脑',           v:'off',  adv:'三个服务常驻，不用投屏就关' },
    { re:/TX Mascot|天选姬/i,        what:'天选姬桌宠',               v:'off',  adv:'纯装饰，占内存' },
    { re:/ASUS (Monitor|Smart Display|MS) Control/i, what:'华硕显示器控制', v:'keep', adv:'接外接屏会用到' },
    { re:/Hotplug Controller/i,      what:'华硕热插拔控制器',         v:'keep', adv:'系统组件，别动' },
    { re:/McAfee|迈克菲/i,           what:'迈克菲安全（多为试用预装）', v:'rm',  adv:'有火绒或 Defender 就够了，留着只是多一层弹窗' },
    { re:/火绒/i,                    what:'火绒安全',                 v:'keep', adv:'轻量，留着' },
    { re:/PC Manager/i,              what:'微软电脑管家',             v:'rm',  adv:'和火绒功能重叠，两套同时扫会变慢' },
    { re:/Everything/i,              what:'本地文件秒搜',             v:'keep', adv:'好用，常驻很轻' },
    { re:/FlClash/i,                 what:'网络代理客户端',           v:'keep', adv:'需要就连，不需要时别设开机自启' },
    { re:/UU加速器|迅游/i,           what:'游戏加速器',               v:'keep', adv:'玩游戏才开，别设自启' },
    { re:/VMware/i,                  what:'虚拟机',                   v:'keep', adv:'两个服务常驻，不常开虚拟机可以改手动启动' },
    { re:/Steam|Epic|WeGame/i,       what:'游戏平台',                 v:'keep', adv:'自启关掉，玩的时候再开' },
    { re:/OneDrive/i,                what:'微软云同步',               v:'keep', adv:'不用云盘就退出登录，别让它在后台同步' },
    { re:/百度网盘|夸克/i,           what:'网盘客户端',               v:'keep', adv:'自启关掉' },
    { re:/WPS Office/i,              what:'WPS 办公',                 v:'keep', adv:'留一个办公套件就够' },
    { re:/Microsoft 365|OfficePLUS/i,what:'Office 订阅/模板插件',      v:'opt',  adv:'有 WPS 的话这个可以不装，或只留 Word/Excel' },
    { re:/NVIDIA (图形|Graphics)/i,  what:'显卡驱动',                 v:'keep', adv:'必须留' },
    { re:/NVIDIA App|GeForce Experience/i, what:'NVIDIA 控制面板',    v:'keep', adv:'留，但关掉游戏内覆盖能省一点' },
    { re:/Visual C\+\+|\.NET Runtime|Desktop Runtime/i, what:'运行库', v:'keep', adv:'很多软件靠它跑，别删' },
    { re:/腾讯会议|飞书|钉钉/i,      what:'会议/协作',                v:'keep', adv:'自启关掉，开会再开' },
    { re:/哔哩哔哩|腾讯视频|抖音|QQ音乐|汽水音乐/i, what:'内容客户端', v:'opt',  adv:'网页版能替代，客户端只是多占内存' },
    { re:/剪映/i,                    what:'视频剪辑',                 v:'keep', adv:'留着' },
    { re:/Git|GitHub CLI|Node|DeepSeek|OpenCode|WorkBuddy|VS Code/i, what:'开发工具', v:'keep', adv:'留着，但别让它们开机自启' },
    { re:/MCHOSE/i,                  what:'键盘鼠标驱动',             v:'keep', adv:'留着调灯光/宏，自启可选' },
    { re:/THX|Audio/i,               what:'音频增强',                 v:'opt',  adv:'不带耳机时可以不装' },
    { re:/Quicker/i,                 what:'快捷动作面板',             v:'keep', adv:'常用就留' },
    { re:/UniGetUI/i,                what:'软件包管理器图形界面',     v:'keep', adv:'装软件用它比官网下安装包干净' },
    { re:/7-Zip/i,                   what:'解压缩',                   v:'keep', adv:'免费无广告，留' },
    { re:/Snow Shot/i,               what:'截图工具',                 v:'keep', adv:'留' },
    { re:/AntiCheatExpert|GameSDK|无畏契约|Modern Warships/i, what:'游戏反作弊/游戏本体', v:'keep', adv:'玩游戏必须留，不玩了可整组删' },
    { re:/AppStoreService/i,         what:'应用商店服务',             v:'opt',  adv:'不用商店可关自启' },
    { re:/Office Click-to-Run/i,     what:'Office 更新服务',          v:'keep', adv:'装了 Office 就必须留' }
  ],

  /* 开荒档位 */
  profiles: [
    { key:'lite',  label:'学习办公为主', note:'把游戏平台和内容客户端收起来，留一个浏览器 + 一套办公' },
    { key:'game',  label:'游戏为主',     note:'保显卡和加速器，砍掉办公插件和内容客户端' },
    { key:'look',  label:'我先看看',     note:'只关自启，不卸载任何东西' }
  ]
};
