$ErrorActionPreference = 'SilentlyContinue'
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'server.ts' } | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Write-Host 'stopped any server.ts node processes'