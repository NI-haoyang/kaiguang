// 生成 docs/agent-demo.html：把真实界面 + 真实规则引擎的结论，配一个假后端，做成可以点着玩的静态演示。
// 用法：node tools/build-agent-demo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFindings } from '../app/lib/analyze.mjs';
import { localStep } from '../app/lib/llm.mjs';
import { answer } from '../app/lib/ask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const report = JSON.parse(read('report.json'));
const analysis = buildFindings(report);
const slim = {
  score: analysis.score, findings: analysis.findings, counts: analysis.counts,
  verify: analysis.verify, metrics: analysis.metrics,
};
const data = {
  report: { counts: report.counts, machine: report.machine, system: report.system },
  analysis: slim,
  greet: localStep({ step: 0, facts: {} }, report, analysis),
  ask2: localStep({ step: 1, facts: {} }, report, analysis),
  variants: {
    wps: localStep({ step: 2, facts: { office: 'wps' } }, report, analysis),
    office: localStep({ step: 2, facts: { office: 'office' } }, report, analysis),
    keep: localStep({ step: 2, facts: {} }, report, analysis),
  },
  // 追问：跟桌面版同一套本地问答，构建时算好塞进页面
  answers: [
    { re: '哪些能删|能删什么|推荐删', say: answer('哪些能删', { report, analysis, facts: { office: 'wps' } }).say },
    { re: '怎么撤销|能退回|后悔', say: answer('怎么撤销', { report, analysis, facts: {} }).say },
    { re: '迈克菲|mcafee', say: answer('迈克菲能删吗', { report, analysis, facts: { office: 'wps' } }).say },
    { re: '火绒', say: answer('火绒能删吗', { report, analysis, facts: {} }).say },
  ],
};

const demoCss = read('app/ui/app.css') + [
  '.demo-bar{flex:0 0 auto;display:flex;gap:10px;align-items:center;justify-content:center;padding:7px 14px;font-size:12.5px;color:#08150e;background:linear-gradient(90deg,#3ddc84,#7ff0b4)}',
  '.demo-bar b{font-weight:700}',
  '.demo-bar span{opacity:.78}',
].join('\n');

const shim = read('app/ui/demo-shim.js').replace('__DATA__', JSON.stringify(data));
const banner = '<div class="demo-bar"><b>静态演示</b><span>动作都是模拟的，不会碰你的电脑；能真动手、能撤销的是桌面版，见 Releases</span></div>';

const out = read('app/ui/index.html')
  .replace('<link rel="stylesheet" href="app.css">', '<style>\n' + demoCss + '\n</style>')
  .replace('<script src="app.js"></script>', '<script>\n' + shim + '\n</script>\n<script>\n' + read('app/ui/app.js') + '\n</script>')
  .replace('<body>', '<body>' + banner);

fs.writeFileSync(path.join(ROOT, 'docs/agent-demo.html'), out, 'utf8');
console.log('docs/agent-demo.html', fs.statSync(path.join(ROOT, 'docs/agent-demo.html')).size, 'bytes');