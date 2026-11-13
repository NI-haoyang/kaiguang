<#
  collect.ps1  —  「开机第一天」只读采集脚本
  ------------------------------------------------------------
  做什么：读取本机系统信息、已装软件、启动项、自启服务、安全状态，
          输出一个 report.json，交给网页端分析。
  不做什么：不修改任何系统设置、不安装/卸载、不联网上传。
  隐私：  不含用户名、序列号、IP、MAC；路径中的用户名会被替换成 *。
  用法：  pwsh -ExecutionPolicy Bypass -File .\collect.ps1
#>
[CmdletBinding()]
param(
  [string]$Out
)

if (-not $Out) {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  if (-not $here) { $here = (Get-Location).Path }
  $Out = Join-Path $here 'report.json'
}

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

function Sanitize([string]$s) {
  if (-not $s) { return $s }
  $s = $s -replace '(?i)([A-Z]:\\Users\\)[^\\]+', '$1*'
  $s = $s -replace '(?i)(\\Users\\)[^\\]+', '$1*'
  $s = $s -replace '(?i)\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b', '<mac>'
  return $s.Trim()
}
function ToDate($v) {
  try { return ([Management.ManagementDateTimeConverter]::ToDateTime($v)).ToString('yyyy-MM-dd') } catch { return $null }
}

# ---------- 系统 ----------
$os  = Get-CimInstance Win32_OperatingSystem
$cs  = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1

$sys = [ordered]@{
  osName      = Sanitize $os.Caption
  osBuild     = $os.BuildNumber
  arch        = $os.OSArchitecture
  installedAt = ToDate $os.InstallDate
  lastBoot    = ToDate $os.LastBootUpTime
  manufacturer= Sanitize $cs.Manufacturer
  model       = Sanitize $cs.Model
  ramGB       = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  cpu         = Sanitize $cpu.Name
  cpuCores    = $cpu.NumberOfCores
  cpuThreads  = $cpu.NumberOfLogicalProcessors
}

# ---------- 磁盘 ----------
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [ordered]@{
    drive  = $_.DeviceID
    label  = Sanitize $_.VolumeName
    sizeGB = [math]::Round($_.Size / 1GB, 1)
    freeGB = [math]::Round($_.FreeSpace / 1GB, 1)
  }
})

# ---------- 已装软件（注册表，不用 Win32_Product，快且不触发 MSI 修复） ----------
$keys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$seen = @{}
$apps = New-Object System.Collections.ArrayList
foreach ($k in $keys) {
  Get-ItemProperty $k | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } | ForEach-Object {
    $n = ($_.DisplayName -replace '\s+', ' ').Trim()
    if ($n -and -not $seen.ContainsKey($n.ToLower())) {
      $seen[$n.ToLower()] = 1
      $dt = $null
      $raw = [string]$_.InstallDate
      if ($raw -match '^\d{8}$') { $dt = $raw.Substring(0,4) + '-' + $raw.Substring(4,2) + '-' + $raw.Substring(6,2) }
      [void]$apps.Add([ordered]@{
        name        = Sanitize $n
        version     = [string]$_.DisplayVersion
        publisher   = Sanitize ([string]$_.Publisher)
        installDate = $dt
      })
    }
  }
}

# ---------- 启动项 ----------
$startup = New-Object System.Collections.ArrayList
Get-CimInstance Win32_StartupCommand | ForEach-Object {
  [void]$startup.Add([ordered]@{ name = Sanitize $_.Name; command = Sanitize $_.Command; source = Sanitize $_.Location })
}
$runKeys = @(
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
)
foreach ($rk in $runKeys) {
  $item = Get-ItemProperty $rk
  if ($item) {
    $item.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
      [void]$startup.Add([ordered]@{ name = Sanitize $_.Name; command = Sanitize ([string]$_.Value); source = $rk.Replace('HKCU:','HKCU').Replace('HKLM:','HKLM') })
    }
  }
}
$startup = @($startup | Group-Object { $_.name } | ForEach-Object { $_.Group[0] } | Sort-Object name)

# ---------- 自启的第三方服务 ----------
$services = @(Get-CimInstance Win32_Service |
  Where-Object { $_.StartMode -eq 'Auto' -and $_.State -eq 'Running' -and $_.PathName -and $_.PathName -notmatch 'System32|SysWOW64|\\Windows\\' } |
  ForEach-Object {
    $p = Sanitize ($_.PathName -replace '^"([^"]+)".*$', '$1' -replace '^-k.*$','')
    [ordered]@{ name = $_.Name; display = Sanitize $_.DisplayName; path = $p }
  })

# ---------- 安全与系统状态 ----------
$def = Get-MpComputerStatus
$fw  = @(Get-NetFirewallProfile | Select-Object Name, Enabled)
$hibernate = (Get-Item "$env:SystemDrive\hiberfil.sys").Length

$security = [ordered]@{
  defenderRealTime = if ($def) { [bool]$def.RealTimeProtectionEnabled } else { $null }
  defenderUpdated  = if ($def -and $def.AntivirusSignatureLastUpdated) { ([datetime]$def.AntivirusSignatureLastUpdated).ToString('yyyy-MM-dd') } else { $null }
  firewall         = @($fw | ForEach-Object { @{ name = $_.Name; enabled = [bool]$_.Enabled } })
  hibernateGB      = if ($hibernate) { [math]::Round($hibernate / 1GB, 1) } else { 0 }
  pageFileGB       = $null
  restorePoints    = $null
}

# ---------- 验机：判断「是不是全新机」的硬证据 ----------
# 新机出厂会通电测试，所以不会全是 0；关键看量级对不对得上。
# 电池：优先用系统自带的 powercfg 报告（最通用），WMI 只做兜底
# 报告写到临时文件，读完立刻删除，不落盘到用户目录
$batt = [ordered]@{ design = $null; full = $null; cycle = $null }
try {
  $tmp = Join-Path $env:TEMP ('kg_batt_' + [guid]::NewGuid().ToString('N') + '.html')
  powercfg /batteryreport /output $tmp /duration 1 | Out-Null
  if (Test-Path $tmp) {
    $txt = ((Get-Content $tmp -Raw) -replace '<[^>]+>', ' ') -replace '\s+', ' '
    $dm = [regex]::Match($txt, 'DESIGN CAPACITY\s+([\d,]+)\s*mWh')
    $fm = [regex]::Match($txt, 'FULL CHARGE CAPACITY\s+([\d,]+)\s*mWh')
    $cm = [regex]::Match($txt, 'CYCLE COUNT\s+(\d{1,5})\b')
    if ($dm.Success) { $batt.design = [int]($dm.Groups[1].Value -replace ',', '') }
    if ($fm.Success) { $batt.full   = [int]($fm.Groups[1].Value -replace ',', '') }
    if ($cm.Success) { $batt.cycle  = [int]$cm.Groups[1].Value }
    Remove-Item $tmp -Force
  }
} catch {}
if (-not $batt.full) { try { $bf = Get-CimInstance -Namespace root\WMI -ClassName BatteryFullChargedCapacity; if ($bf) { $batt.full = [int]$bf.FullChargedCapacity } } catch {} }

$stor = @(Get-PhysicalDisk | ForEach-Object {
  $d = $_
  $rc = $d | Get-StorageReliabilityCounter
  [ordered]@{
    name         = Sanitize $d.FriendlyName
    media        = [string]$d.MediaType
    sizeGB       = [math]::Round($d.Size / 1GB, 0)
    powerOnHours = if ($rc) { $rc.PowerOnHours } else { $null }
    wear         = if ($rc) { $rc.Wear } else { $null }
    readErrors   = if ($rc) { $rc.ReadErrorsTotal } else { $null }
  }
})

$bios = Get-CimInstance Win32_BIOS
$sn   = [string]$bios.SerialNumber
$snMask = if ($sn -and $sn.Length -gt 4) { '****' + $sn.Substring($sn.Length - 4) } else { $null }

# 安全启动 / TPM：读注册表和 CIM，不依赖管理员权限
$sb = $null
try { $sb = [int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -Name UEFISecureBootEnabled).UEFISecureBootEnabled -eq 1 } catch {}
$tpm = $null
try { $t = Get-CimInstance -Namespace root\CIMV2\Security\MicrosoftTpm -ClassName Win32_Tpm; if ($t) { $tpm = [bool]$t.IsEnabled_InitialValue } } catch {}
$act = $null
try {
  $lic = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND Name LIKE 'Windows%'" | Select-Object -First 1
  if ($lic) { $act = ($lic.LicenseStatus -eq 1) }
} catch {}

$pnp = @(Get-PnpDevice -Status Error | ForEach-Object { [ordered]@{ name = Sanitize $_.FriendlyName; cls = $_.Class } })
$gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [ordered]@{
    name    = Sanitize $_.Name
    driver  = [string]$_.DriverVersion
    driverDate = if ($_.DriverDate) { ([datetime]$_.DriverDate).ToString('yyyy-MM-dd') } else { $null }
    width   = $_.CurrentHorizontalResolution
    height  = $_.CurrentVerticalResolution
    hz      = $_.CurrentRefreshRate
  }
})

# 装系统至今多少天：Win32_OperatingSystem 的 InstallDate 在部分机器上是空的，退到注册表
$installDays = $null
$inst = $null
try { $inst = ([Management.ManagementDateTimeConverter]::ToDateTime($os.InstallDate)) } catch {}
if (-not $inst) {
  try {
    $u = [int64](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').InstallDate
    if ($u -gt 1000000000) { $inst = [DateTimeOffset]::FromUnixTimeSeconds($u).LocalDateTime }
  } catch {}
}
if ($inst) { $installDays = [int]((Get-Date) - $inst).TotalDays }
$uptimeH = [math]::Round([Environment]::TickCount64 / 3600000, 1)

$health = [ordered]@{
  battery      = $batt
  storage      = $stor
  biosVersion  = [string]$bios.SMBIOSBIOSVersion
  biosDate     = if ($bios.ReleaseDate) { ([datetime]$bios.ReleaseDate).ToString('yyyy-MM-dd') } else { $null }
  serialMasked = $snMask
  secureBoot   = $sb
  tpm          = $tpm
  activated    = $act
  problemDevices = $pnp
  gpu          = $gpu
  installDays  = $installDays
  uptimeHours  = $uptimeH
}

# ---------- 组装 ----------
$report = [ordered]@{
  schema     = 'kaiguang/1'
  generatedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  machine    = "$env:COMPUTERNAME"
  system     = $sys
  disks      = $disks
  apps       = @($apps)
  startup    = $startup
  services   = $services
  security   = $security
  health     = $health
  counts     = [ordered]@{
    apps     = @($apps).Count
    startup  = @($startup).Count
    services = @($services).Count
  }
}

$json = $report | ConvertTo-Json -Depth 8 -Compress:$false
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "  [OK] 采集完成 -> $Out" -ForegroundColor Green
Write-Host ("  软件 {0} 个 / 启动项 {1} 个 / 第三方自启服务 {2} 个" -f $report.counts.apps, $report.counts.startup, $report.counts.services)
Write-Host "  本脚本只读取信息，未修改任何系统设置。"
