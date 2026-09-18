param([switch]$Wait)
$ErrorActionPreference = 'Stop'
$env:SEED_FROM_SEEDER = ''
$env:SEED_PRODUCTS = ''
$env:CLOUDFLARE_D1_DATABASE_ID = ''
$env:CLOUDFLARE_D1_DATABASE_ID_TARGET = ''
$env:CLOUDFLARE_ACCOUNT_ID = ''
$env:CLOUDFLARE_API_TOKEN = ''
$env:NPM_CONFIG_USE_BUN = ''
$env:BUN_INSTALL = ''

Start-Sleep -Seconds 1
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'server.ts' } | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

$stdout = "$PSScriptRoot\tmp_server_stdout.txt"
$stderr = "$PSScriptRoot\tmp_server_stderr.txt"
if (Test-Path $stdout) { Remove-Item $stdout -Force -ErrorAction SilentlyContinue }
if (Test-Path $stderr) { Remove-Item $stderr -Force -ErrorAction SilentlyContinue }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'npx'
$psi.Arguments = 'tsx server.ts'
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
Start-Sleep -Seconds 1

if ($Wait) {
    do {
        Start-Sleep -Seconds 1
        if ($proc.HasExited) {
            Write-Host 'SERVER_EXITED' $proc.ExitCode
            Get-Content $stderr -Tail 80
            exit $proc.ExitCode
        }
        try {
            $r = Invoke-RestMethod -Uri 'http://localhost:3000/api/mall/health' -TimeoutSec 3
            Write-Host 'READY' $r
            do { Start-Sleep -Seconds 1 } while (-not $proc.HasExited)
            exit 0
        } catch {
            # not ready yet
        }
    } while ($true)
}

# fire-and-forget: just ensure it started
Start-Sleep -Seconds 1
if (-not $proc.HasExited) {
    Write-Host 'SERVER_STARTED_PID' $proc.Id
} else {
    Write-Host 'SERVER_FAILED' $proc.ExitCode
    Get-Content $stderr -Tail 80
    exit $proc.ExitCode
}