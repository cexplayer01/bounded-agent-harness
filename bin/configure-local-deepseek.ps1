$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env"

$form = [System.Windows.Forms.Form]::new()
$form.Text = "Configure DeepSeek"
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.ClientSize = [System.Drawing.Size]::new(520, 150)
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = [System.Windows.Forms.Label]::new()
$label.Text = "Paste the DeepSeek API key below. It is masked and saved only in this computer's ignored .env file."
$label.AutoSize = $false
$label.Location = [System.Drawing.Point]::new(16, 14)
$label.Size = [System.Drawing.Size]::new(488, 38)
$form.Controls.Add($label)

$keyBox = [System.Windows.Forms.TextBox]::new()
$keyBox.UseSystemPasswordChar = $true
$keyBox.Location = [System.Drawing.Point]::new(16, 58)
$keyBox.Size = [System.Drawing.Size]::new(488, 24)
$form.Controls.Add($keyBox)

$saveButton = [System.Windows.Forms.Button]::new()
$saveButton.Text = "Save key"
$saveButton.DialogResult = [System.Windows.Forms.DialogResult]::None
$saveButton.Location = [System.Drawing.Point]::new(330, 101)
$saveButton.Size = [System.Drawing.Size]::new(82, 30)
$form.Controls.Add($saveButton)

$cancelButton = [System.Windows.Forms.Button]::new()
$cancelButton.Text = "Cancel"
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancelButton.Location = [System.Drawing.Point]::new(422, 101)
$cancelButton.Size = [System.Drawing.Size]::new(82, 30)
$form.Controls.Add($cancelButton)
$form.AcceptButton = $saveButton
$form.CancelButton = $cancelButton

$saveButton.Add_Click({
    $candidate = $keyBox.Text.Trim()
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        [void][System.Windows.Forms.MessageBox]::Show("Paste the key first.", "Key needed", "OK", "Warning")
        return
    }
    if ($candidate -match "\s|[\x00-\x1F\x7F]") {
        [void][System.Windows.Forms.MessageBox]::Show("The key contains whitespace or a control character. Paste the key by itself.", "Key format", "OK", "Warning")
        return
    }
    $form.Tag = $candidate
    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
})

$form.Add_Shown({ $form.Activate(); $keyBox.Focus() })
$dialogResult = $form.ShowDialog()
if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK) {
    $keyBox.Clear()
    $form.Dispose()
    Write-Output "CANCELLED: no file was changed."
    exit 0
}

$key = [string]$form.Tag
$keyBox.Clear()
$form.Tag = $null
$form.Dispose()

try {
    $utf8NoBom = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($envPath, "DEEPSEEK_API_KEY=$key`r`n", $utf8NoBom)
}
finally {
    $key = $null
}

# Verify presence only; never read the secret into output.
$loaded = [IO.File]::ReadAllText($envPath)
if ($loaded -notmatch "(?m)^DEEPSEEK_API_KEY=.+$") {
    throw "The local .env file was not written with a non-empty DeepSeek key."
}

Write-Output "CONFIGURED: local .env contains a non-empty DEEPSEEK_API_KEY; the value was not displayed."
Write-Output "Run the bounded probe from this project to use the key."
