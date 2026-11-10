$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host '5G Live Lab Assist - checking saved progress...' -ForegroundColor Cyan
node .\scripts\resume.js
