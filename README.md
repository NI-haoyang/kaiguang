# 开机第一天

> 新电脑开荒：先体检，再决定装什么。

**在线演示**：https://ni-haoyang.github.io/kaiguang/ （点「载入示例（刚开箱）」和「载入示例（已用 79 天）」，看同一台机器的两种结论）

一个给新笔记本（尤其是装满厂商预装软件的整机）用的**只读体检 + 可审阅开荒单**。不替你改系统，只替你把这台机器讲明白。

## 目录

| 文件 | 作用 |
|---|---|
| **`双击我.bat`** | **一条命令都不用敲：双击 → 采集 → 桌面直接出现一份 html 报告并打开** |
| `打开网页.bat` | 只打开网页看看（断网、没有 Node 也能用） |
| `启动服务.bat` | 想用「AI 深读」时才需要（要 Node.js 和 API key） |
| `make-report.ps1` | 把 `report.json` 和网页模板焊成一个独立 html（不联网） |
| `collect.ps1` | 只读采集，输出 `report.json`（不写注册表、不装软件、不联网） |
| `web/index.html` | 单页应用：拖入 report.json → 体检报告 → 开荒单 → 可审阅脚本 |
| `web/rules.js` | 规则库：同类软件分组、厂商分组、常见软件的「它是干嘛的」 |
| `web/app.js` | 分析与渲染逻辑（纯前端，无框架、无构建） |
| `web/sample.js` | 一台真机（ASUS 天选 / Win11，已用 79 天）的示例数据 |
| `web/sample-new.js` | 模拟「刚开箱」的同一台机器（只留整机厂组件），用来演示全新机路径 |
| `server.mjs` | 可选：静态服务器 + `/api/analyze`（接 LLM 的「AI 深读」） |
| `docs/一页纸方案.md` | 报名材料 |
| `docs/路演脚本.md` | 90 秒 / 3 分钟讲稿 + 追问准备 |

## 怎么跑（给同学的版本）

0. 下载[开荒工具包](https://github.com/NI-haoyang/kaiguang/releases/download/v0.1/kaiguang-kit-v0.1.zip)（35 KB），解压
1. 双击 `双击我.bat`
2. 等 30 秒，桌面出现 `我的电脑体检报告-日期.html`
3. 双击那个 html 就能看。可以发微信、拷 U 盘、断网打开——它是独立的一个文件。

全程不需要联网，不需要装任何东西，不需要管理员权限。

## 怎么跑（开发版）

**只用页面（最简单）**

1. PowerShell 里跑采集：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\collect.ps1
   ```
2. 双击 `web/index.html`（直接用 file:// 打开就行）。
3. 把生成的 `report.json` 拖进页面。
   没有报告？点「载入示例」，用的是这台天选的真实数据。

**带本地服务（可演示 AI 深读）**

```bash
node server.mjs            # http://127.0.0.1:4173/?demo=1
```

设置 `DEEPSEEK_API_KEY` 才会启用 `/api/analyze`；不设置时页面会退回本地建议，其它功能不受影响。

## 隐私

- 采集脚本只读取信息，源码里没有任何 `Set-Item` / `Remove-Item` / `New-Item` 之类的写入动作。
- 用户名会被替换成 `*`，不采集 MAC、不采集文件内容、不采集浏览器历史。
- 所有分析在浏览器本地完成。只有你主动点「AI 深读」，才会把报告摘要发出去。

## 已知边界

- 只支持 Windows 10/11（采集脚本依赖 WMI/CIM 与注册表）。
- 规则是「可解释的启发式」，不是杀毒引擎：它判的是「该不该整理」，不是「安不安全」。
- `report.json` 里的软件列表按注册表 Uninstall 键统计，绿色版/便携软件可能统计不到。

## 30 秒录制清单（报名 Demo）

1. 开 PowerShell，跑 `collect.ps1`，让「只读」「采集完成」两行出现在画面里。
2. 把 `report.json` 拖进网页，停在开荒指数和第一张红色卡片上。
3. 念一句卡片上的解释：「Defender 显示关闭是正常的，你装了火绒，它让位了，不是中毒。」
4. 滚到脚本区，指着满屏的 `#` 说：「这些我都不会替你执行。」
5. 切一下档位，让开荒单变一次，收尾。
