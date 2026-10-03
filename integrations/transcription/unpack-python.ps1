param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [System.IO.Path]::GetFullPath($Destination)
[System.IO.Directory]::CreateDirectory($root) | Out-Null
$zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
try {
  foreach ($entry in $zip.Entries) {
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $entry.FullName))
    if (-not $target.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive entry.' }
    if ($entry.FullName.Contains(':') -or $entry.FullName.Contains('\') -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe archive entry.' }
  }
  [System.IO.Compression.ZipFileExtensions]::ExtractToDirectory($zip, $root)
} finally { $zip.Dispose() }
