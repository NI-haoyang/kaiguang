# make-report.ps1
# 把 report.json 和网页模板焊成一份【独立的】html 报告。
# 不联网、不上传、不改系统设置。
param(
  [string]$Json,
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$web  = $root

if (-not $Json)   { $Json   = Join-Path $root 'report.json' }
if (-not $OutDir) { $OutDir = [Environment]::GetFolderPath('Desktop') }

if (-not (Test-Path $Json)) {
  Write-Host ""
  Write-Host "  找不到 report.json，请先运行 collect.ps1。" -ForegroundColor Yellow
  exit 1
}

$nl    = [Environment]::NewLine
$data  = Get-Content $Json -Raw -Encoding UTF8
$html  = Get-Content (Join-Path $web 'index.html') -Raw -Encoding UTF8
$css   = Get-Content (Join-Path $web 'style.css')  -Raw -Encoding UTF8
$rules = Get-Content (Join-Path $web 'rules.js')   -Raw -Encoding UTF8
$app   = Get-Content (Join-Path $web 'app.js')     -Raw -Encoding UTF8

# 把外部文件一个个焊进 html 里，焊完就只剩一个文件
$html = $html.Replace('<link rel="stylesheet" href="style.css">', "<style>$nl$css$nl</style>")
$html = $html.Replace('<script src="rules.js"></script>',     "<script>$nl$rules$nl</script>")
$html = $html.Replace('<script src="sample.js"></script>',     "")
$html = $html.Replace('<script src="sample-new.js"></script>', "")
$html = $html.Replace('<script src="app.js"></script>',       "<script>window.KG_AUTO=$data;</script>$nl<script>$nl$app$nl</script>")
$html = $html.Replace('<h2>把 report.json 拖进来</h2>', '<h2>这份报告已经装好数据了</h2>')

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$out = Join-Path $OutDir ("我的电脑体检报告-$stamp.html")

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$utf8 = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($out, $html, $utf8)

Write-Host ""
Write-Host "  报告已生成：" -ForegroundColor Green
Write-Host "  $out"
Write-Host ""
Write-Host "  这一个文件就能看，可以拷到 U 盘、发微信、断网打开。" -ForegroundColor DarkGray

Start-Process $out
