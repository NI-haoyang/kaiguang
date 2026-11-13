import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const BASE = process.env.LLM_BASE || 'https://api.deepseek.com/chat/completions';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const SYS = [
  '你是一个帮大一新生整理新电脑的人。用户刚拿到一台新笔记本，装满厂商预装软件，不知道从哪下手。',
  '下面是一份只读体检报告（JSON）。请用中文、口语、对具体型号说话，不要罗列全部项目。',
  '输出格式固定三段，每段不超过 3 句话：',
  '1) 现在就要处理的一件事（只挑一件，说明为什么它最急）',
  '2) 这周顺手做的两件事',
  '3) 千万别动的（明确劝阻那些"看起来像垃圾但删了会出事"的东西）',
  '不要使用 markdown 标题，不要编造报告里没有的数据。'
].join('\n');

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/analyze') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 400_000) { return send(res, 413, JSON.stringify({ error: 'payload too large' })); }
    }
    if (!KEY) {
      return send(res, 501, JSON.stringify({ error: 'no-key', hint: '启动前设置 DEEPSEEK_API_KEY 才启用 AI 深读；其余功能不依赖它。' }));
    }
    try {
      const report = JSON.parse(raw);
      const r = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.4,
          messages: [
            { role: 'system', content: SYS },
            { role: 'user', content: JSON.stringify(report) }
          ]
        })
      });
      const data = await r.json();
      if (!r.ok) return send(res, 502, JSON.stringify({ error: data?.error?.message || 'upstream error' }));
      const text = data?.choices?.[0]?.message?.content || '';
      return send(res, 200, JSON.stringify({ text }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: String(e.message || e) }));
    }
  }

  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(ROOT, normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain; charset=utf-8');
  try {
    const buf = await readFile(file);
    send(res, 200, buf, MIME[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'not found', 'text/plain; charset=utf-8');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('开机第一天  ->  http://127.0.0.1:' + PORT + '/?demo=1');
  console.log(KEY ? 'AI 深读：已启用 (' + MODEL + ')' : 'AI 深读：未启用（设置 DEEPSEEK_API_KEY 后重启即可）');
});
