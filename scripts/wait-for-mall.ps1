param([int]$PollSec=2,[int]$MaxPoll=40)
$ErrorActionPreference = 'Stop'

$ready = $false
$attempt = 0
do {
    Start-Sleep -Seconds $PollSec
    $attempt++
    try {
        $r = Invoke-RestMethod -Uri 'http://localhost:3000/api/mall/health' -TimeoutSec 3
        $ready = $true
        Write-Host 'READY_ATTEMPT' $attempt
        $r
        break
    } catch {
        if ($attempt -ge $MaxPoll) {
            Write-Host 'DID_NOT_BECOME_READY'
            Get-Content "$PSScriptRoot\tmp_server_stderr.txt" -Tail 80
            exit 1
        }
    }
} while (-not $ready)