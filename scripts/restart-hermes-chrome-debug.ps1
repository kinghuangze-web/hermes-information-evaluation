param(
  [string]$ChromePath = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  [string]$SourceUserDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data",
  [string]$HermesUserDataDir = "$env:LOCALAPPDATA\HermesChrome\User Data",
  [string]$ProfileDirectory = "Default",
  [int]$DebugPort = 9223,
  [switch]$ReseedProfile
)

$devtoolsFile = Join-Path $HermesUserDataDir "DevToolsActivePort"
$sourceProfilePath = Join-Path $SourceUserDataDir $ProfileDirectory
$targetProfilePath = Join-Path $HermesUserDataDir $ProfileDirectory
$sourceLocalState = Join-Path $SourceUserDataDir "Local State"
$targetLocalState = Join-Path $HermesUserDataDir "Local State"
$seedMarker = Join-Path $HermesUserDataDir ".hermes-profile-ready"

if (-not (Test-Path $ChromePath)) {
  throw "Chrome not found at: $ChromePath"
}

if (-not (Test-Path $sourceProfilePath)) {
  throw "Chrome source profile not found at: $sourceProfilePath"
}

function Stop-ChromeUsingPath {
  param(
    [string]$Needle
  )

  Get-CimInstance Win32_Process -Filter "name='chrome.exe'" -ErrorAction SilentlyContinue `
    | Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($Needle) } `
    | ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      } catch {
      }
    }
}

function Copy-HermesProfile {
  New-Item -ItemType Directory -Path $HermesUserDataDir -Force | Out-Null

  if (Test-Path $targetProfilePath) {
    Remove-Item -LiteralPath $targetProfilePath -Recurse -Force
  }

  if (Test-Path $targetLocalState) {
    Remove-Item -LiteralPath $targetLocalState -Force
  }

  if (Test-Path $sourceLocalState) {
    Copy-Item -LiteralPath $sourceLocalState -Destination $targetLocalState -Force
  }

  $excludeDirs = @(
    "Cache",
    "Code Cache",
    "GPUCache",
    "GrShaderCache",
    "DawnCache",
    "ShaderCache",
    "OptimizationGuidePredictionModels",
    "Service Worker\CacheStorage"
  )
  $excludeFiles = @(
    "LOCK",
    "SingletonCookie",
    "SingletonLock",
    "SingletonSocket"
  )

  $robocopyArgs = @(
    $sourceProfilePath,
    $targetProfilePath,
    "/E",
    "/COPY:DAT",
    "/R:1",
    "/W:1",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP"
  )

  if ($excludeDirs.Count -gt 0) {
    $robocopyArgs += "/XD"
    $robocopyArgs += $excludeDirs
  }

  if ($excludeFiles.Count -gt 0) {
    $robocopyArgs += "/XF"
    $robocopyArgs += $excludeFiles
  }

  $null = & robocopy @robocopyArgs
  $exitCode = $LASTEXITCODE
  if ($exitCode -gt 7) {
    throw "Failed to seed Hermes Chrome profile from $sourceProfilePath (robocopy exit code: $exitCode)"
  }

  Set-Content -LiteralPath $seedMarker -Value (Get-Date -Format "o") -Encoding ASCII
}

$needsSeed = $ReseedProfile.IsPresent -or -not (Test-Path $targetProfilePath) -or -not (Test-Path $seedMarker)

if ($needsSeed) {
  Stop-ChromeUsingPath -Needle $SourceUserDataDir
  Stop-ChromeUsingPath -Needle $HermesUserDataDir
  Start-Sleep -Seconds 2
  Copy-HermesProfile
} else {
  Stop-ChromeUsingPath -Needle $HermesUserDataDir
  Start-Sleep -Seconds 1
}

$arguments = @(
  "--remote-debugging-port=$DebugPort",
  "--remote-debugging-address=127.0.0.1",
  "--user-data-dir=$HermesUserDataDir",
  "--profile-directory=$ProfileDirectory"
)

Start-Process -FilePath $ChromePath -ArgumentList $arguments
Start-Sleep -Seconds 4

if (Test-Path $devtoolsFile) {
  if ($needsSeed) {
    Write-Output "Hermes Chrome profile seeded and remote debugging ready:"
  } else {
    Write-Output "Hermes Chrome remote debugging ready:"
  }
  Get-Content $devtoolsFile
} else {
  Write-Output "Hermes Chrome started, but DevToolsActivePort was not created yet."
}
