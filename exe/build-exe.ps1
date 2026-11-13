$ErrorActionPreference = 'Stop'
# Build 开机第一天.exe with the .NET Framework compiler that ships with Windows.
# Usage: powershell -ExecutionPolicy Bypass -File build-exe.ps1
$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$proj  = Split-Path -Parent $here
$csc   = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$out   = Join-Path $proj 'dist\kaiguang.exe'
$assets = @('index.html','style.css','rules.js','app.js','sample.js','sample-new.js','collect.ps1')

New-Item -ItemType Directory -Path (Split-Path $out) -Force | Out-Null

$cargs = @('/nologo','/target:winexe','/optimize+','/debug-','/codepage:65001','/platform:anycpu',('/out:' + $out))
foreach ($a in $assets) { $cargs += ('/resource:' + (Join-Path $proj $a)) }
$cargs += (Join-Path $here 'KaiguangApp.cs')

& $csc $cargs
if ($LASTEXITCODE -ne 0) { throw "compile failed: $LASTEXITCODE" }

$size = (Get-Item $out).Length
'{0} bytes ({1:N0} KB)' -f $size, ($size / 1kb)
