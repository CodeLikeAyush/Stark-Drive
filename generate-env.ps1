# generate-env.ps1
# Script to generate a secure .env file for StarkDrive

$envFile = ".env"

if (Test-Path $envFile) {
    Write-Host "Warning: $envFile already exists." -ForegroundColor Yellow
    $response = Read-Host "Do you want to overwrite it? (Y/N)"
    if ($response -notmatch "^[Yy]$") {
        Write-Host "Aborting." -ForegroundColor Red
        exit
    }
}

Write-Host "Generating secure credentials..." -ForegroundColor Cyan

# Function to generate a random alphanumeric string
function Get-RandomString($length) {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $bytes = New-Object Byte[] $length
    [Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($bytes)
    $result = ""
    foreach ($byte in $bytes) {
        $result += $chars[$byte % $chars.Length]
    }
    return $result
}

# Function to generate a Base64 encoded 32-byte key (for MinIO KMS)
function Get-Base64Key() {
    $bytes = New-Object Byte[] 32
    [Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

# Generate Values
$dbPassword = Get-RandomString 24
$minioPassword = Get-RandomString 32
$jwtSecret = Get-RandomString 64
$minioKmsKey = Get-Base64Key

# Create the .env content
$envContent = @"
# Stark Drive - Environment Configuration
# Automatically generated on $(Get-Date)

# PostgreSQL Configuration
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$dbPassword
POSTGRES_DB=family_drive

# MinIO Configuration
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=$minioPassword
MINIO_KMS_SECRET_KEY=family-key:$minioKmsKey

# RabbitMQ Configuration
RABBITMQ_DEFAULT_USER=starkadmin
RABBITMQ_DEFAULT_PASS=$(Get-RandomString 20)

# Backend JWT Secret
JWT_SECRET=$jwtSecret
"@

# Write to file
Set-Content -Path $envFile -Value $envContent -Encoding UTF8

Write-Host "`nSuccessfully created $envFile with secure, randomly generated credentials!" -ForegroundColor Green
Write-Host "Keep this file secure and never commit it to version control." -ForegroundColor Yellow
