# llm-check.ps1 —— 30 秒验证 DeepSeek 官方 API 通不通
# 用法：先 $env:DEEPSEEK_API_KEY="sk-..."，再跑本脚本
param(
  [string]$Key = $env:DEEPSEEK_API_KEY,
  [string]$Model = "deepseek-flash"
)

if (-not $Key) {
  Write-Host "没有找到 key。" -ForegroundColor Yellow
  Write-Host "先在 https://platform.deepseek.com 申请，然后："
  Write-Host '  $env:DEEPSEEK_API_KEY="sk-..."'
  exit 1
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$payload = @{
  model    = $Model
  messages = @(@{ role = "user"; content = "用一句话说明你能帮一台新电脑做什么" })
  max_tokens = 64
  stream   = $false
} | ConvertTo-Json -Depth 6 -Compress

$bytes = [Text.Encoding]::UTF8.GetBytes($payload)
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  $res = Invoke-RestMethod -Uri "https://api.deepseek.com/chat/completions" `
    -Method Post -TimeoutSec 90 -Body $bytes `
    -Headers @{ Authorization = "Bearer $Key"; "Content-Type" = "application/json; charset=utf-8" }
  $sw.Stop()
  Write-Host ("[OK] 模型=" + $res.model + "  耗时=" + $sw.ElapsedMilliseconds + "ms") -ForegroundColor Green
  Write-Host ("用量: prompt=" + $res.usage.prompt_tokens + " completion=" + $res.usage.completion_tokens)
  Write-Host ""
  Write-Host $res.choices[0].message.content
} catch {
  $sw.Stop()
  $code = "?"
  $body = $_.Exception.Message
  if ($_.Exception.Response) {
    $code = [int]$_.Exception.Response.StatusCode
    try {
      $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
      $body = $sr.ReadToEnd()
    } catch {}
  }
  Write-Host ("[FAIL] HTTP " + $code + "  耗时=" + $sw.ElapsedMilliseconds + "ms") -ForegroundColor Red
  Write-Host $body
  if ($code -eq 401) { Write-Host "→ 网络和格式都没问题，只是 key 不对。" -ForegroundColor Yellow }
  exit 1
}
