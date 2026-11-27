// 装机清单：只允许装这里列出的包。
// 服务端按 id 还原名字和说明，页面和模型都不能自己拼包 id / 命令。
// match 只用于「这台是不是已经装了」的本地判断，不参与执行。
export const INSTALL_APPS = [
  { id: 'Tencent.WeChat', name: '微信', tag: '必装', desc: '聊天、传文件、扫码登录', match: /微信|wechat/i },
  { id: 'Tencent.QQ', name: 'QQ', tag: '常用', desc: '聊天、传文件、群', match: /^QQ(\s|$)/i },
  { id: 'Tencent.TencentMeeting', name: '腾讯会议', tag: '常用', desc: '上网课、开线上会', match: /腾讯会议/i },
  { id: 'Kingsoft.WPSOffice', name: 'WPS Office', tag: '办公', desc: '文档、表格、演示', match: /WPS/i },
  { id: 'NetEase.CloudMusic', name: '网易云音乐', tag: '影音', desc: '听歌、播客', match: /网易云音乐|cloudmusic/i },
  { id: 'Google.Chrome', name: 'Chrome', tag: '浏览器', desc: '备用浏览器，网页兼容性好', match: /Google Chrome/i },
  { id: '7zip.7zip', name: '7-Zip', tag: '工具', desc: '解压 zip / 7z / rar', match: /7-Zip/i },
  { id: 'voidtools.Everything', name: 'Everything', tag: '工具', desc: '秒搜本机文件', match: /^Everything/i },
  { id: 'Microsoft.VisualStudioCode', name: 'VS Code', tag: '开发', desc: '写代码、看文本', match: /Visual Studio Code/i },
  { id: 'Git.Git', name: 'Git', tag: '开发', desc: '版本控制、拉代码', match: /^Git(\s|$)/i },
];

export function appById(id) {
  return INSTALL_APPS.find((a) => a.id === String(id || '')) || null;
}

export function appInstalled(app, apps) {
  if (!app || !Array.isArray(apps)) return false;
  return apps.some((a) => app.match.test(String((a && a.name) || '')));
}

// 给页面用的安全视图：不带正则，只带展示字段和是否已装。
export function catalogView(apps) {
  return INSTALL_APPS.map((a) => ({
    id: a.id, name: a.name, tag: a.tag, desc: a.desc,
    installed: appInstalled(a, apps),
  }));
}