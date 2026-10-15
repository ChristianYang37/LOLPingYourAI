param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$existing = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'LOLPingYourAI' }
if ($existing) { throw 'Use a clean Windows account for installer regression; LOLPingYourAI is already installed' }
$testRoot = [IO.Path]::GetFullPath((Join-Path $env:TEMP ('lolping-install-' + [guid]::NewGuid().ToString('N'))))
$installDir = Join-Path $testRoot 'Application With Spaces'
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    # NSIS requires /D last, with no quotes around the value (even with spaces).
    $p = Start-Process -FilePath $installerPath -ArgumentList "/S /D=$installDir" -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Installer exited $($p.ExitCode)" }
    $app = Join-Path $installDir 'LOLPingYourAI.exe'
    if (!(Test-Path -LiteralPath $app)) { throw 'Installed executable missing' }
    node tools/windows/check-app.mjs $app
    if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed' }
    $uninstaller = Join-Path $installDir 'Uninstall LOLPingYourAI.exe'
    if (!(Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller missing' }
    $p = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$installDir" -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Uninstaller exited $($p.ExitCode)" }
    if (Test-Path -LiteralPath $app) { throw 'Application remains after uninstall' }
    Write-Output 'NSIS install, real app startup/restart and uninstall passed'
} finally {
    # Verify the generated absolute path remains a direct child of TEMP before deletion.
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($testRoot) -ne $tempRoot -or !(Split-Path $testRoot -Leaf).StartsWith('lolping-install-')) { throw 'Unsafe test cleanup path' }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
