[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PortablePath,
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [int]$StartupSeconds = 25
)

$ErrorActionPreference = 'Stop'
$portable = (Resolve-Path $PortablePath).Path
$installer = (Resolve-Path $InstallerPath).Path
$root = Join-Path $env:RUNNER_TEMP "dentiva-pro-smoke-$([guid]::NewGuid().ToString('N'))"
$userData = Join-Path $root 'user-data'
$installDir = Join-Path $root 'installed'
New-Item -ItemType Directory -Path $userData -Force | Out-Null

function Stop-ChildApp([System.Diagnostics.Process]$process) {
  if ($process -and !$process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

function Start-AndCheck([string]$path, [string]$dataDir, [string]$phase = 'verify') {
  Write-Host "Starting $path ($phase)"
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  $arguments = @('--disable-gpu', '--no-sandbox', "--user-data-dir=$dataDir")
  $logPath = Join-Path $root "$phase-$([guid]::NewGuid().ToString('N')).log"
  $previousUserData = $env:DENTIVA_USER_DATA
  $previousSmoke = $env:DENTIVA_SMOKE
  $previousPhase = $env:DENTIVA_SMOKE_PHASE
  $env:DENTIVA_USER_DATA = $dataDir
  $env:DENTIVA_SMOKE = '1'
  $env:DENTIVA_SMOKE_PHASE = $phase
  $process = $null
  try {
    $process = Start-Process -FilePath $path -ArgumentList $arguments -RedirectStandardOutput $logPath -RedirectStandardError "$logPath.err" -PassThru
  }
  finally {
    if ($null -eq $previousUserData) { Remove-Item Env:DENTIVA_USER_DATA -ErrorAction SilentlyContinue } else { $env:DENTIVA_USER_DATA = $previousUserData }
    if ($null -eq $previousSmoke) { Remove-Item Env:DENTIVA_SMOKE -ErrorAction SilentlyContinue } else { $env:DENTIVA_SMOKE = $previousSmoke }
    if ($null -eq $previousPhase) { Remove-Item Env:DENTIVA_SMOKE_PHASE -ErrorAction SilentlyContinue } else { $env:DENTIVA_SMOKE_PHASE = $previousPhase }
  }
  Start-Sleep -Seconds $StartupSeconds
  if (!$process.HasExited) {
    Write-Host "Application stayed alive for $StartupSeconds seconds (PID $($process.Id)); stopping after smoke phase."
    Stop-ChildApp $process
  } else {
    Write-Host "Application completed smoke phase with exit code $($process.ExitCode)."
  }
  $log = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
  $errorLog = Get-Content "$logPath.err" -Raw -ErrorAction SilentlyContinue
  if ($log -notmatch 'DENTIVA_SMOKE_RESULT:.*"ok":true') {
    $profileFiles = if (Test-Path $dataDir) { (Get-ChildItem $dataDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { "$($_.FullName.Replace($dataDir, '<profile>')):$($_.Length)" }) -join ', ' } else { '<profile missing>' }
    $diagnostic = (($log + "`n" + $errorLog + "`nprofile=$profileFiles").Trim() -replace "\r?\n", ' | ')
    if ($diagnostic.Length -gt 9000) { $diagnostic = $diagnostic.Substring(0, 9000) }
    Write-Host "::error title=Electron smoke phase $phase::$diagnostic"
    throw "Electron smoke phase $phase did not report success.`n$log`n$errorLog`nprofile=$profileFiles"
  }
  return $log
}

try {
  if (!(Test-Path $portable)) { throw "Portable executable not found: $portable" }
  if (!(Test-Path $installer)) { throw "Installer not found: $installer" }

  # Portable launch runs a real renderer workflow, quits, then verifies the
  # created patient and appointment after restarting the same SQLite profile.
  Start-AndCheck $portable $userData 'create' | Out-Null
  if (!(Test-Path $userData)) { throw 'Portable launch did not create a user-data profile.' }
  Start-AndCheck $portable $userData 'verify' | Out-Null

  # Install to a disposable per-user directory, launch the installed executable,
  # then run the generated uninstaller. This does not touch the runner profile.
  Write-Host "Installing NSIS package into $installDir"
  $install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "NSIS installer returned $($install.ExitCode)" }
  $installedExe = Get-ChildItem -Path $installDir -Filter '*.exe' -Recurse -File | Where-Object { $_.Name -notlike 'unins*.exe' } | Select-Object -First 1
  if (!$installedExe) { throw 'Installed application executable was not found.' }
  Start-AndCheck $installedExe.FullName $userData 'verify' | Out-Null
  $uninstaller = Get-ChildItem -Path $installDir -Filter 'unins*.exe' -Recurse -File | Select-Object -First 1
  if (!$uninstaller) { throw 'Generated uninstaller was not found.' }
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S') -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "Uninstaller returned $($uninstall.ExitCode)" }
  Write-Host 'Windows packaged launch/restart/install/uninstall smoke passed.'
}
catch {
  $diagnostic = ($_.Exception.ToString() -replace "\r?\n", ' | ')
  if ($diagnostic.Length -gt 9000) { $diagnostic = $diagnostic.Substring(0, 9000) }
  Write-Host "::error title=Windows smoke failure::$diagnostic"
  if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "### Windows smoke failure`n`n$diagnostic" }
  throw
}
finally {
  $evidenceDir = if ($env:GITHUB_WORKSPACE) { Join-Path $env:GITHUB_WORKSPACE 'windows-smoke-evidence' } else { Join-Path (Get-Location) 'windows-smoke-evidence' }
  New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
  if (Test-Path $root) { Get-ChildItem $root -Filter '*.log*' -File -ErrorAction SilentlyContinue | Copy-Item -Destination $evidenceDir -Force -ErrorAction SilentlyContinue }
  if (Test-Path $root) { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
}
