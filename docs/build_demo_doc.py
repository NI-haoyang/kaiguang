
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

FONT = "微软雅黑"
GREEN = RGBColor(0x1F, 0x6F, 0x54)
GREY = RGBColor(0x5A, 0x63, 0x70)
DARK = RGBColor(0x1A, 0x1D, 0x22)

doc = Document()

# 页面设置
for s in doc.sections:
    s.top_margin = Cm(2.2); s.bottom_margin = Cm(2.2)
    s.left_margin = Cm(2.4); s.right_margin = Cm(2.4)

# 默认字体
st = doc.styles["Normal"]
st.font.name = FONT
st.font.size = Pt(10.5)
st.font.color.rgb = DARK
st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
st.paragraph_format.space_after = Pt(6)
st.paragraph_format.line_spacing = 1.45


def cn(run, size=None, bold=None, color=None, italic=None):
    run.font.name = FONT
    r = run._element
    rPr = r.get_or_add_rPr()
    rf = rPr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts"); rPr.append(rf)
    rf.set(qn("w:eastAsia"), FONT)
    rf.set(qn("w:ascii"), FONT)
    rf.set(qn("w:hAnsi"), FONT)
    if size: run.font.size = Pt(size)
    if bold is not None: run.bold = bold
    if italic is not None: run.italic = italic
    if color is not None: run.font.color.rgb = color
    return run


def para(text="", size=10.5, bold=False, color=None, space_after=6, align=None, indent=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    if align: p.alignment = align
    if indent: p.paragraph_format.left_indent = Cm(indent)
    if text:
        cn(p.add_run(text), size=size, bold=bold, color=color)
    return p


def h1(num, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_with_next = True
    cn(p.add_run(num + "  "), size=15, bold=True, color=GREEN)
    cn(p.add_run(text), size=15, bold=True, color=GREEN)
    return p


def bullet(text, bold_head=None):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.35
    if bold_head:
        cn(p.add_run(bold_head), bold=True)
    cn(p.add_run(text))
    return p


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hexcolor)
    tcPr.append(shd)


def _row_flags(row, header=False):
    trPr = row._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:cantSplit"))
    if header:
        trPr.append(OxmlElement("w:tblHeader"))


def table(headers, rows, widths=None, header_fill="E8F2EC", font_size=9.5):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    _row_flags(t.rows[0], header=True)
    hdr = t.rows[0].cells
    for i, htext in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.space_before = Pt(2)
        cn(p.add_run(htext), size=font_size, bold=True, color=GREEN)
        shade(hdr[i], header_fill)
    for row in rows:
        r_ = t.add_row()
        _row_flags(r_)
        cells = r_.cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.line_spacing = 1.25
            cn(p.add_run(str(val)), size=font_size)
    if widths:
        for r in t.rows:
            for i, w in enumerate(widths):
                r.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def code(lines):
    t = doc.add_table(rows=1, cols=1)
    t.style = "Table Grid"
    _row_flags(t.rows[0])
    c = t.rows[0].cells[0]
    c.text = ""
    shade(c, "F4F6F8")
    p = c.paragraphs[0]
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.0
    for i, line in enumerate(lines):
        r = p.add_run(("\n" if i else "") + line)
        r.font.name = "Consolas"
        r.font.size = Pt(9)
        r._element.get_or_add_rPr()
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


# ============ 封面 ============
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(40)
cn(p.add_run("小白助手"), size=30, bold=True, color=GREEN)

p = doc.add_paragraph()
cn(p.add_run("Agent 版 · 初步方案与 Demo 说明"), size=15, color=GREY)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(10)
cn(p.add_run("v0.2 草案   ·   2026-11-14   ·   校园黑客松「AI+X」参赛作品"), size=9.5, color=GREY)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(26)
cn(p.add_run("一台新电脑，先验它是不是真的全新，再看清它装了什么，"), size=12, color=DARK)
p2 = doc.add_paragraph()
cn(p2.add_run("然后替你把它收拾干净——每改一处，都能一键退回去。"), size=12, color=DARK)

doc.add_page_break()

# ============ 1 ============
h1("一", "我们要做什么")
para("给刚拆封的笔记本电脑做两件事：先「验」，再「开荒」。")
para("验，是回答「这台是不是真的全新」——电池设计容量与满充容量、循环次数、系统安装天数、安全启动、驱动异常，这些数字比看外观可靠。")
para("开荒，是回答「里面这一堆东西，哪些该留、哪些能删、哪些千万别动」。上一版只做到这里，把结论写成一张清单和一份可审阅的脚本，剩下的交给用户自己敲。")
para("这一版往下走一步：用户勾选，机器动手，随时可撤。因为开荒最难的不是判断，是执行——大部分人不缺清单，缺的是「敢按下去」的理由。", bold=False)

# ============ 2 ============
h1("二", "这一版换掉了什么")
para("上一版最硬的承诺是「我一行都不执行」。执行一旦发生，这句话就没了，必须用一句新的顶上：", space_after=4)
para("「我不保证不出错，但我保证每个动作都能退回去。」", bold=True, color=GREEN, space_after=10)

table(
    ["", "上一版：只读工具", "这一版：可撤销的 Agent"],
    [
        ["承诺", "只读、不执行、脚本你自己跑", "每一步可撤销、失败即停、全程留痕"],
        ["用户动作", "看完清单，自己动手", "勾选 → 执行 → 不满意就撤回"],
        ["风险", "几乎为零，但也帮不上手", "有真实副作用，用撤销兜底"],
        ["适合谁", "懂一点电脑、想自己掌控的人", "不敢动手、但确实需要收拾的人"],
    ],
    widths=[2.6, 6.4, 6.6],
)

# ============ 3 ============
h1("三", "用户怎么用（五步）")
steps = [
    ("第 1 步　打开", "双击 exe，20 秒后浏览器自动弹出体检报告。窗口里只有一个进度条，不需要选任何选项。"),
    ("第 2 步　看结论", "报告顶部是开荒指数，往下是三条「最值得做的事」，每条写明：为什么、影响什么、能不能退。"),
    ("第 3 步　勾选", "三条里挑要做的，点「执行」。默认全选，但每条都能取消。"),
    ("第 4 步　看着它做", "逐条变绿，右侧滚动出耗时和结果。任何一条失败，后面的立刻停下，不会硬着头皮往下做。"),
    ("第 5 步　不满意就撤", "点「全部撤销」，三秒回到原样；也可以只撤其中一条。"),
]
for head, body in steps:
    bullet(body, bold_head=head + "：")

# ============ 4 ============
h1("四", "页面长什么样")
para("三栏：左边诊断，中间方案，右边执行日志。执行时页面不跳转，日志就在原地滚。", space_after=8)
table(
    ["左：诊断", "中：方案", "右：执行日志"],
    [
        ["开荒指数 61\n\n系统盘剩余 46%\n开机自启 10 个\n第三方服务 23 个\n三套安全软件", "□ 关掉 3 个装饰性自启\n   为什么：桌宠和灯效服务不参与系统功能\n\n□ 卸载 McAfee 联网顾问\n   为什么：已有火绒，两套实时防护互相扫描\n\n□ 把 GlideX 三个服务改手动\n   为什么：不投屏时它们是纯占用\n\n[ 执行选中的 3 项 ]  [ 全部撤销 ]", "09:41:02  关自启 TX Mascot\n           ✓ 完成 0.3s   ↩ 可撤销\n\n09:41:03  服务 GlideX Service\n           ✓ 完成 0.8s   ↩ 可撤销\n\n09:41:05  卸载 McAfee\n           ✗ 需要管理员\n           已停止，后续未执行"],
    ],
    widths=[5.0, 6.6, 5.0],
)

# ============ 5 ============
h1("五", "技术架构：为什么必须有一个本地进程")
para("浏览器改不了系统，这是硬限制。所以链路只能是：", space_after=6)
code([
    "网页（方案 + 确认）",
    "      ↓  本地 HTTP  127.0.0.1",
    "小白助手.exe（Agent 宿主：跑采集、跑执行、推日志）",
    "      ↓  受限执行器（白名单动作 + 撤销记录）",
    "动作库（每个动作 = 描述 + 执行 + 撤销）",
])
para("这一层已经有雏形：exe 本来就在本机开服务、跑采集、把报告交给浏览器。现在只是多挂一个「执行」接口，架构不用重写。")

# ============ 6 ============
h1("六", "AI 只挑动作，不写命令")
para("这是整个方案的安全底线，也是它和「让 AI 写 PowerShell 然后跑」的根本区别。", space_after=6)
para("错误做法：AI 直接输出命令，执行器照着跑。一次幻觉就可能删错东西，而且拦不住。", bold=True, size=10)
code([
    "AI 输出：Remove-Item -Path \"C:\\Program Files\\XXX\" -Recurse -Force",
    "执行器：直接执行   ← 没有校验，没有退路",
])
para("我们的做法：动作库是写死的、有限的，AI 只能从里面挑，并且只能带有限的参数。", bold=True, size=10)
code([
    "{ \"action\": \"disable_startup\",",
    "  \"target\": \"TX Mascot\",",
    "  \"reason\": \"桌宠，纯装饰\" }",
])
para("执行器只认这几种 action，参数还要过白名单（比如卸载只接受 winget 里存在的包 ID）。")
para("结果：AI 判断失误最多导致「选错动作」，永远不会导致「命令注入」。这一点会在答辩时作为核心技术点讲——它证明我们假设了 AI 会犯错，而不是假设它不会。", space_after=8)

# ============ 7 ============
h1("七", "动作分级")
table(
    ["级别", "例子", "授权方式", "撤销方式"],
    [
        ["L0 只读", "采集、分析、生成报告", "不需要", "—"],
        ["L1 可逆低风险", "关开机自启、winget 装软件、清临时文件", "点一次「执行」", "记录原值 / 卸载"],
        ["L2 需明确授权", "改服务启动类型、开防火墙、改电源计划", "每次弹确认，列出将改什么", "记录原值"],
        ["L3 永不提供", "卸驱动、改 BIOS、删系统组件、动分区", "不提供", "—"],
    ],
    widths=[2.8, 6.4, 4.6, 2.8],
)
para("第一版只做 L1 里的一条链路：关开机自启 + 撤销。理由很实际——一天时间，L2 的提权、依赖关系、失败回滚，任何一项都能吃掉半天。", space_after=6)

# ============ 8 ============
h1("八", "安全三条线")
three = [
    ("线一　动作白名单", "有限动词 + 参数校验。AI 不碰命令字符串，只产出动作 ID。"),
    ("线二　执行前留退路", "改之前先把原值写进日志：注册表项导出、服务启动类型记下、装了什么记下包 ID。撤销就是把原值写回去。"),
    ("线三　失败即停 + 全程留痕", "任何一步失败，后续不再执行；日志可导出，评委可以逐条看它做了什么、为什么、怎么退。"),
]
for head, body in three:
    bullet(body, bold_head=head + "：")

# ============ 9 ============
h1("九", "一次完整交互的样子")
para("下面是真实执行时会留下的日志形态（示例数据）：", space_after=6)
table(
    ["时间", "动作", "结果", "撤销"],
    [
        ["09:41:02", "disable_startup · TX Mascot", "✓ 0.3s", "恢复 HKCU Run 原值"],
        ["09:41:03", "set_service_manual · GlideX Service", "✓ 0.8s", "改回 Auto"],
        ["09:41:05", "uninstall_app · McAfee 联网顾问", "✗ 需要管理员权限", "未执行，已停止后续"],
    ],
    widths=[2.4, 7.2, 3.6, 3.4],
)

# ============ 10 ============
h1("十", "三分钟演示脚本")
table(
    ["时间", "画面", "台词"],
    [
        ["0:00", "拖入报告，61 分", "这是你这台机器现在的样子。"],
        ["0:30", "滚到三条建议", "它不只是说，它还能做。"],
        ["0:50", "点执行，逐条变绿", "每条都有耗时和结果，失败的会停。"],
        ["1:20", "任务管理器对比", "启动项真的少了一条。"],
        ["1:40", "点撤销，恢复原样", "做错的代价，是三秒。"],
        ["2:10", "打开动作日志", "做了什么、为什么、怎么退，全在这里。"],
        ["2:40", "收尾", "AI 负责想，人负责点头，机器负责能退。"],
    ],
    widths=[1.8, 6.4, 8.4],
)

# ============ 11 ============
h1("十一", "一天的工作量")
table(
    ["模块", "时间", "能不能砍"],
    [
        ["动作库骨架（4 个动作 + 撤销实现）", "3 小时", "不能"],
        ["exe 增加执行接口与进度推送", "2 小时", "不能"],
        ["页面执行 / 撤销 UI 与日志", "2 小时", "不能"],
        ["权限处理（UAC、失败恢复）", "2 小时", "砍掉 L2 就不需要"],
        ["演示机准备与彩排", "1 小时", "不能，别省"],
    ],
    widths=[8.0, 3.0, 4.6],
)

# ============ 12 ============
h1("十二", "风险与对策")
table(
    ["风险", "会发生什么", "对策"],
    [
        ["UAC 提权失败", "L2 动作执行不了", "第一版不碰 L2；失败即停并如实报告"],
        ["杀毒软件拦截", "脚本或 exe 被隔离", "提前在演示机加白名单，并准备录屏兜底"],
        ["现场网络", "下载类动作卡住", "演示不演下载，只演「改 + 撤」"],
        ["改完系统不稳定", "个别软件异常", "只做可逆动作；撤销在 3 秒内完成"],
        ["评委质疑安全", "整场被打断", "主动亮出日志和撤销，不等被问"],
    ],
    widths=[4.2, 5.6, 7.4],
)

# ============ 13 ============
h1("十三", "我们不做的事")
for t_, in [("不卸驱动、不改 BIOS、不碰分区、不删系统组件。",),
            ("没有用户点击，不执行任何动作。",),
            ("不上传任何本机数据；报告与日志只留在本机。",),
            ("不承诺「一键变快」，只承诺「改了什么你能看见，改错了你能退回」。",)]:
    bullet(t_)

# ============ 14 ============
h1("十四", "下一步")
para("1. 把「关闭自启 + 撤销」这一条链路跑通，做成可演示的完整闭环。")
para("2. 用 AI 补齐规则库认不出的软件（覆盖率从 42/76 提到 76/76），让方案本身更可信。")
para("3. 演示机准备：一台干净的 Windows，提前装好并彩排三次，包括「故意失败一次」的走位。")

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(18)
cn(p.add_run("附：本方案对应的可运行原型为「小白助手」v0.1（只读体检部分已完整实现），本文描述的是在其上增加执行层后的 v0.2 形态。"), size=9, color=GREY)

out = r"C:\Users\Frankni\Documents\deepseek-harness\default-workspace\kaiguang\docs\小白助手-Agent版初步方案.docx"
doc.save(out)
print("saved:", out)
