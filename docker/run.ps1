# Plex Poster Helper - one-command Docker launcher (Windows / PowerShell).
#
#   ./docker/run.ps1                    build (if needed) + start the GUI on :3939 (HTTP) / :3940 (HTTPS)
#   ./docker/run.ps1 headless           start the optional headless scheduler (no window)
#   ./docker/run.ps1 both               start the GUI and the scheduler together
#   ./docker/run.ps1 [target] -Build    force a rebuild first
#   ./docker/run.ps1 [target] -Stop     stop & remove container(s); default: both
#   ./docker/run.ps1 -Port 8095         use a different host port for the GUI HTTP port (HTTPS = Port+1)
#
# The GUI and the headless scheduler mount the same named volume (ppsh-config)
# at /config, so the scheduler automatically reuses the Plex sign-in and the
# schedules you set up in the GUI - no tokens or env vars to copy around.
param(
  [Parameter(Position = 0)]
  [ValidateSet('gui', 'headless', 'both')]
  [string]$Target,
  [switch]$Build,
  [switch]$Stop,
  [int]$Port = 3939,
  [int]$HttpsPort = 3940
)

$ErrorActionPreference = 'Stop'
$guiName  = 'plex-poster-helper-2'
$guiImage = 'plex-poster-helper-2'
$hlName   = 'plex-poster-helper-2-scheduler'
$hlImage  = 'plex-poster-helper-2:headless'
$volume   = 'ppsh-config'
$root     = Split-Path $PSScriptRoot -Parent

# Timezone jobs run in: an explicit TZ env wins, otherwise convert the host's
# Windows id to the IANA name (America/New_York) that containers expect.
$tz = if ($env:TZ) { $env:TZ } else { 'UTC' }
if (-not $env:TZ) {
  try {
    $iana = $null
    if ([TimeZoneInfo]::TryConvertWindowsIdToIanaId((Get-TimeZone).Id, [ref]$iana)) { $tz = $iana }
  } catch { }
}

if ($Stop) {
  if (-not $Target) { $Target = 'both' }
  if ($Target -ne 'headless') { docker rm -f $guiName 2>$null | Out-Null }
  if ($Target -ne 'gui')      { docker rm -f $hlName  2>$null | Out-Null }
  Write-Host "Stopped ($Target). Config volume '$volume' is preserved." -ForegroundColor Yellow
  return
}
if (-not $Target) { $Target = 'gui' }

function Build-ImageIfNeeded([string]$Image, [string]$Dockerfile) {
  $exists = docker images -q $Image
  if ($Build -or -not $exists) {
    Write-Host "Building $Image (first build takes a few minutes)…" -ForegroundColor Cyan
    docker build -f "$PSScriptRoot/$Dockerfile" -t $Image $root
    if ($LASTEXITCODE -ne 0) { throw "docker build failed for $Image" }
  }
}

function Start-Gui {
  Build-ImageIfNeeded $guiImage 'Dockerfile'
  docker rm -f $guiName 2>$null | Out-Null
  docker run -d --name $guiName `
    -p "${Port}:3000" `
    -p "${HttpsPort}:3001" `
    -e PUID=1000 -e PGID=1000 -e "TZ=$tz" `
    -v "${volume}:/config" `
    --shm-size=1g `
    --restart unless-stopped `
    $guiImage | Out-Null
  Write-Host "✓ GUI running:        http://localhost:$Port" -ForegroundColor Green
  Write-Host "  Clipboard support:  https://localhost:$HttpsPort  (accept the self-signed cert once)" -ForegroundColor Cyan
}

function Start-Headless {
  Build-ImageIfNeeded $hlImage 'Dockerfile.headless'
  docker rm -f $hlName 2>$null | Out-Null
  # Optional overrides; not needed when the GUI shares the same config volume.
  $extra = @()
  if ($env:PLEX_BASEURL) { $extra += @('-e', "PLEX_BASEURL=$($env:PLEX_BASEURL)") }
  if ($env:PLEX_TOKEN)   { $extra += @('-e', "PLEX_TOKEN=$($env:PLEX_TOKEN)") }
  docker run -d --name $hlName `
    -e "TZ=$tz" `
    -v "${volume}:/config" `
    @extra `
    --shm-size=1g `
    --restart unless-stopped `
    $hlImage | Out-Null
  Write-Host "✓ Headless scheduler: running (shares the GUI's sign-in & schedules)" -ForegroundColor Green
}

docker volume create $volume | Out-Null

switch ($Target) {
  'gui'      { Start-Gui }
  'headless' { Start-Headless }
  'both'     { Start-Gui; Start-Headless }
}

Write-Host ''
if ($Target -ne 'gui') {
  Write-Host "  Tip:  sign in to Plex and build schedules in the GUI first -"
  Write-Host "        the scheduler picks them up automatically from '$volume'."
}
Write-Host "  Logs: docker logs -f $guiName      (GUI)"
Write-Host "        docker logs -f $hlName       (headless)"
Write-Host '  Stop: ./docker/run.ps1 -Stop [gui|headless|both]'
