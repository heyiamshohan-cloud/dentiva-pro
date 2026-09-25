[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PortablePath,
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [int]$StartupSeconds = 25,
  [switch]$PortableOnly
)

$ErrorActionPreference = 'Stop'
$portable = (Resolve-Path $PortablePath).Path
$installer = (Resolve-Path $InstallerPath).Path
$smokeId = [guid]::NewGuid().ToString('N')
$root = Join-Path $env:RUNNER_TEMP "dentiva-pro-smoke-$smokeId"
$userData = Join-Path $root 'user-data'
$installDir = Join-Path $env:RUNNER_TEMP "dentiva-pro-installed-$smokeId"
$preInstallProfile = ''
$postInstallProfile = ''
New-Item -ItemType Directory -Path $userData -Force | Out-Null

function Profile-Snapshot([string]$directory) {
  if (!(Test-Path $directory)) { return '<profile missing>' }
  return ((Get-ChildItem $directory -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { "$($_.FullName.Replace($directory, '<profile>')):$($_.Length)" }) -join ', ')
}

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
  # Surface per-phase diagnostics as job annotations (visible without artifacts).
  foreach ($entry in @(@('log', $log), @('err', $errorLog))) {
    $kind = $entry[0]; $text = $entry[1]
    if (!$text) { continue }
    $safe = ($text -replace '%', '%25') -replace "\r?\n", ' | '
    if ($safe.Length -gt 8000) { $safe = $safe.Substring(0, 8000) }
    Write-Host "::warning title=smoke-$kind-$phase::$safe"
  }
  $profileFiles = Profile-Snapshot $dataDir
  $streams = "$log`n$errorLog"
  # v1.5.1 hardening: a module-load defect (e.g. the v1.5.0 app.asar src/**
  # omission) must fail the gate loudly and never be masked by a hanging or
  # half-booted process, so detect the exact startup-error families first.
  $moduleLoadPattern = 'ERR_MODULE_NOT_FOUND|ERR_REQUIRE|Cannot find module|Cannot find package|Failed to resolve module|MODULE_NOT_FOUND'
  if ($streams -match $moduleLoadPattern) {
    $diagnostic = ($streams.Trim() -replace "\r?\n", ' | ')
    if ($diagnostic.Length -gt 9000) { $diagnostic = $diagnostic.Substring(0, 9000) }
    Write-Host "::error title=Electron smoke phase $phase module-load failure::$diagnostic"
    throw "Electron smoke phase $phase hit a startup module-load error (app.asar packaging defect).`n$streams"
  }
  if ($log -notmatch 'DENTIVA_SMOKE_RESULT:.*"ok":true') {
    $diagnostic = (($streams + "`nprofile=$profileFiles`npreInstall=$preInstallProfile`npostInstall=$postInstallProfile").Trim() -replace "\r?\n", ' | ')
    if ($diagnostic.Length -gt 9000) { $diagnostic = $diagnostic.Substring(0, 9000) }
    Write-Host "::error title=Electron smoke phase $phase::$diagnostic"
    throw "Electron smoke phase $phase did not report success.`n$streams`nprofile=$profileFiles"
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
  Start-AndCheck $portable $userData 'portable-verify' | Out-Null
  if ($PortableOnly) {
    Write-Host 'Portable create/restart persistence smoke passed. WARNING: -PortableOnly skips the installed-app gate and is NOT sufficient for release verification (it masked the v1.5.0 installed-app startup crash).'
    return
  }

  # Install to a disposable per-user directory, launch the installed executable,
  # then run the generated uninstaller. This does not touch the runner profile.
  $preInstallProfile = Profile-Snapshot $userData
  Write-Host "Portable profile before NSIS install: $preInstallProfile"
  Write-Host "Installing NSIS package into $installDir"
  $install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "NSIS installer returned $($install.ExitCode)" }
  $postInstallProfile = Profile-Snapshot $userData
  Write-Host "Portable profile after NSIS install: $postInstallProfile"
  $installedExe = Get-ChildItem -Path $installDir -Filter '*.exe' -Recurse -File | Where-Object { @('DentivaPro.exe', 'Dentiva Pro.exe') -contains $_.Name } | Select-Object -First 1
  if (!$installedExe) { throw "Installed Dentiva Pro application executable was not found under $installDir." }
  # Persistency probe BEFORE installed launch: if the portable phases really
  # wrote to $userData, its database must be non-trivial here. Cadence matters
  # — a missing DB at this point means the installed phase environments differ.
  $profileDb = Join-Path $userData 'dentiva-pro.sqlite'
  $profileDbSize = if (Test-Path $profileDb) { (Get-Item $profileDb).Length } else { -1 }
  Write-Host "user-data database before installed launch: $profileDb ($profileDbSize bytes)"
  if ($profileDbSize -le 0) { throw "Portable phases produced no persistent database at $profileDb; installed launch would see a fresh workspace." }
  # The installed copy is what real users run from Program Files: prove its
  # app.asar contains the complete runtime module closure before launching.
  $installedAsar = Join-Path $installDir 'resources/app.asar'
  if (!(Test-Path $installedAsar)) { throw "Installed application is missing resources/app.asar: $installDir" }
  & node (Join-Path $PSScriptRoot 'verify-packaged-runtime.mjs') $installedAsar
  if ($LASTEXITCODE -ne 0) { throw 'Installed app.asar failed the runtime module closure verification.' }
  $preLaunchProfile = Profile-Snapshot $userData
  Write-Host "user-data profile before installed launch: $preLaunchProfile"
  Start-AndCheck $installedExe.FullName $userData 'installed-verify' | Out-Null
  # Production document workflows on THIS build (v2.0.0 gate): prescription /
  # invoice / receipt / statement preview + PDF (A4/A5/Letter/80mm, long names,
  # many rows, Unicode clinical text incl. Bengali patient names) via
  # smoke-deterministic PDF paths under %TEMP%. The interface and document
  # copy are English-only; patient-typed text is Unicode.
  Start-AndCheck $installedExe.FullName $userData 'docs' | Out-Null
  $smokePdfDir = Join-Path $env:TEMP 'dentiva-smoke-pdf'
  if (Test-Path $smokePdfDir) {
    Get-ChildItem $smokePdfDir -Filter '*.pdf' -File | ForEach-Object { Write-Host ("DOCS-PDF {0} {1} bytes" -f $_.Name, $_.Length) }
  } else { Write-Warning 'docs phase produced no PDF directory' }
  $postLaunchProfile = Profile-Snapshot $userData
  Write-Host "user-data profile after installed launch: $postLaunchProfile"
  $uninstaller = Get-ChildItem -Path $installDir -Filter 'unins*.exe' -Recurse -File | Select-Object -First 1
  if (!$uninstaller) { throw 'Generated uninstaller was not found.' }
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S') -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "Uninstaller returned $($uninstall.ExitCode)" }
  Write-Host 'Windows packaged launch/restart/install/uninstall smoke passed.'
}
catch {
  $diagnostic = (($_.Exception.ToString() + "`npreInstall=$preInstallProfile`npostInstall=$postInstallProfile") -replace "\r?\n", ' | ')
  if ($diagnostic.Length -gt 9000) { $diagnostic = $diagnostic.Substring(0, 9000) }
  Write-Host "::error title=Windows smoke failure::$diagnostic"
  if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "### Windows smoke failure`n`n$diagnostic" }
  throw
}
finally {
  $evidenceDir = if ($env:GITHUB_WORKSPACE) { Join-Path $env:GITHUB_WORKSPACE 'windows-smoke-evidence' } else { Join-Path (Get-Location) 'windows-smoke-evidence' }
  New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
  if (Test-Path $root) { Get-ChildItem $root -Filter '*.log*' -File -ErrorAction SilentlyContinue | Copy-Item -Destination $evidenceDir -Force -ErrorAction SilentlyContinue }
  $smokePdfResultDir = Join-Path $env:TEMP 'dentiva-smoke-pdf'
  if (Test-Path $smokePdfResultDir) { New-Item -ItemType Directory -Path (Join-Path $evidenceDir 'document-pdfs') -Force | Out-Null; Get-ChildItem $smokePdfResultDir -Filter '*.pdf' -File | Copy-Item -Destination (Join-Path $evidenceDir 'document-pdfs') -Force -ErrorAction SilentlyContinue }
  if (Test-Path $root) { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue }
}
