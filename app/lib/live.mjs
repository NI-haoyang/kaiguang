import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

// 只读遥测：不装驱动、不提权、不改任何设置。
// CPU 使用率/内存来自 Node；频率、热区温度、NVIDIA 温度来自系统自带的只读接口。

let prev = null;
function cpuSample() {
  return os.cpus().map((c) => ({ ...c.times }));
}
function cpuUsage() {
  const now = cpuSample();
  if (!prev) { prev = now; return 0; }
  let idle = 0; let total = 0;
  for (let i = 0; i < now.length; i++) {
    const a = prev[i] || { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const b = now[i];
    idle += b.idle - a.idle;
    total += (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.idle - a.idle) + (b.irq - a.irq);
  }
  prev = now;
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0;
}

function disk(letter) {
  try {
    const s = fs.statfsSync(letter + ':\\');
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { letter, total, free, used: total - free, pct: total ? Math.round(((total - free) / total) * 100) : null };
  } catch { return null; }
}

function run(cmd, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

// PowerShell 只读查询：频率倍率 + ACPI 热区温度。
// PercentProcessorPerformance 是相对基准频率的百分比，用它估算瞬时频率。
function psScript() {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    "$p = Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ProcessorInformation | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1",
    "$t = Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation | Select-Object -First 1",
    "$c = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1",
    "[pscustomobject]@{ perf = $p.PercentProcessorPerformance; maxMhz = $c.MaxClockSpeed; temp = $t.HighPrecisionTemperature; tz = $t.Name } | ConvertTo-Json -Compress",
  ].join('; ');
}

let extra = { at: 0, data: null, busy: false };
async function probe() {
  if (process.platform !== 'win32' || extra.busy) return;
  extra.busy = true;
  const started = Date.now();
  try {
    const [psOut, gpuOut] = await Promise.all([
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript()]),
      run('nvidia-smi', ['--query-gpu=name,temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits']),
    ]);
    let perf = null; let maxMhz = null; let thermal = null;
    try {
      const j = JSON.parse(psOut);
      perf = Number(j.perf) > 0 ? Number(j.perf) : null;
      maxMhz = Number(j.maxMhz) > 0 ? Number(j.maxMhz) : null;
      const high = Number(j.temp);
      if (high > 0) {
        const c = high / 10 - 273.15;
        if (c > -20 && c < 120) thermal = { c: Math.round(c * 10) / 10, source: 'ACPI 热区' };
      }
    } catch {}
    let gpu = null;
    const line = String(gpuOut || '').trim().split(/\r?\n/)[0];
    if (line) {
      const [name, temp, util] = line.split(',').map((x) => x.trim());
      const t = Number(temp);
      gpu = {
        name: name || 'NVIDIA GPU',
        temp: Number.isFinite(t) && t > -20 && t < 130 ? Math.round(t * 10) / 10 : null,
        util: Number.isFinite(Number(util)) ? Number(util) : null,
      };
    }
    extra = { at: Date.now(), data: { perf, maxMhz, thermal, gpu, ms: Date.now() - started }, busy: false };
  } catch {
    extra = { at: Date.now(), data: { perf: null, thermal: null, gpu: null, ms: Date.now() - started }, busy: false };
  }
}

export async function live() {
  if (Date.now() - extra.at > 15000 && !extra.busy) probe();
  const cpus = os.cpus();
  const baseMhz = Number(cpus[0] && cpus[0].speed) || 0;
  const maxMhz = (extra.data && extra.data.maxMhz) || baseMhz;
  const perf = extra.data && extra.data.perf;
  const ghz = perf && maxMhz ? Math.round(maxMhz * (perf / 100)) / 1000 : null;
  const total = os.totalmem();
  const free = os.freemem();
  const mem = { total, free, used: total - free, pct: total ? Math.round(((total - free) / total) * 100) : null };
  const disks = [disk('C'), disk('D')].filter(Boolean);
  return {
    at: Date.now(),
    cpu: {
      model: String((cpus[0] && cpus[0].model) || 'CPU').replace(/\s+/g, ' ').trim(),
      cores: cpus.length,
      usage: cpuUsage(),
      baseGhz: maxMhz ? Math.round(maxMhz) / 1000 : null,
      ghz,
    },
    mem,
    disks,
    thermal: (extra.data && extra.data.thermal) || null,
    gpu: (extra.data && extra.data.gpu) || null,
    probeReady: !!(extra.data && (extra.data.thermal || extra.data.gpu || extra.data.perf)),
    probeMs: extra.data ? extra.data.ms : null,
    uptime: Math.round(os.uptime()),
  };
}