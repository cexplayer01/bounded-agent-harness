$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env"

if (Test-Path -LiteralPath $envPath) {
    $answer = Read-Host "A local .env already exists. Replace its DeepSeek key? (y/N)"
    if ($answer -notmatch "^(?i:y|yes)$") {
        Write-Output "UNCHANGED"
        exit 0
    }
}

$secureKey = Read-Host "Paste the new DeepSeek API key (input is hidden)" -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}

if ([string]::IsNullOrWhiteSpace($key)) {
    throw "A non-empty DeepSeek API key is required. Nothing was written."
}

$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($envPath, "DEEPSEEK_API_KEY=$key`r`n", $utf8NoBom)

# Do not print or otherwise expose the key. This check only reports presence.
$loaded = [IO.File]::ReadAllText($envPath)
if ($loaded -notmatch "(?m)^DEEPSEEK_API_KEY=.+$") {
    throw "The local .env file was not written with a non-empty DeepSeek key."
}

Write-Output "CONFIGURED: local .env exists with a non-empty DEEPSEEK_API_KEY; the value was not displayed."
Write-Output "NEXT: pnpm run deepseek:probe -- --prompt 'Review the current bounded harness proof work and identify one useful next step.' --max-tokens 128 --budget-tokens 768"
