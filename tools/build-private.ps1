param(
  [Parameter(Mandatory=$true)][string]$Key,
  [string]$Dist = "C:\下载\开机第一天-交付\开机第一天",
  [string]$ZipOut = "C:\下载\开机第一天-交付\kaiguang-demo-win64.zip",
  [int]$Cap = 100
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$appDst = Join-Path $Dist 'resources\app\app'
if (-not (Test-Path $appDst)) { throw "打包目录不存在: $Dist" }

# 1) 写入内置体验 key（该文件在 .gitignore 里，不会进公开仓库）
$keyFile = Join-Path $root 'app\lib\builtin-key.mjs'
$nl = [Environment]::NewLine
$txt = "// built by tools/build-private.ps1 - DO NOT COMMIT" + $nl + "export const BUILTIN_KEY = '" + $Key.Trim() + "';" + $nl + "export const BUILTIN_CAP = " + $Cap + ";" + $nl
[IO.File]::WriteAllText($keyFile, $txt, (New-Object Text.UTF8Encoding($false)))
Write-Host "key written: $keyFile"

# 2) 关掉正在运行的旧窗口，否则 exe 被占用
Get-Process | Where-Object { $_.Path -and $_.Path -like ($Dist + '\*') } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600

# 3) 同步代码
robocopy (Join-Path $root 'app') $appDst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $root 'collect.ps1') (Join-Path $Dist 'resources\app\collect.ps1') -Force
Write-Host "code synced"

# 4) 打 zip
if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }
# 保留顶层文件夹（开箱解压后是「开机第一天\」，和公开包一致）
Compress-Archive -Path $Dist -DestinationPath $ZipOut -CompressionLevel Optimal
$mb = [math]::Round((Get-Item $ZipOut).Length / 1MB, 1)
Write-Host "built: $ZipOut ($mb MB)"