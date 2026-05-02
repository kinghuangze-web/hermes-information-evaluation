$Port = if ($env:HERMES_CHROME_PROXY_PORT) { [int]$env:HERMES_CHROME_PROXY_PORT } else { 3456 }
$DebugPort = if ($env:HERMES_CHROME_DEBUG_PORT) { [int]$env:HERMES_CHROME_DEBUG_PORT } else { 9223 }
$DevToolsFile = if ($env:HERMES_CHROME_DEVTOOLS_FILE) { $env:HERMES_CHROME_DEVTOOLS_FILE } else { Join-Path $env:LOCALAPPDATA "HermesChrome\User Data\DevToolsActivePort" }
$ScriptPath = Join-Path $PSScriptRoot "chrome-session-proxy.js"
$HealthUrl = "http://127.0.0.1:$Port/health"

try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2
  if ($health.StatusCode -eq 200) {
    Write-Output "Hermes Chrome session proxy already running on port $Port"
    node (Join-Path $PSScriptRoot "chrome-session-health-check.js")
    exit 0
  }
} catch {
}

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue `
  | Select-Object -ExpandProperty OwningProcess -Unique `
  | ForEach-Object {
    try {
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    } catch {
    }
  }

$childCommand = "& { `$env:HERMES_CHROME_PROXY_BIND_HOST = '0.0.0.0'; `$env:HERMES_CHROME_DEBUG_PORT = '$DebugPort'; `$env:HERMES_CHROME_DEVTOOLS_FILE = '$DevToolsFile'; node `"$ScriptPath`" }"
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-Command", $childCommand) -WindowStyle Hidden
Start-Sleep -Seconds 3
node (Join-Path $PSScriptRoot "chrome-session-health-check.js")
