# Libera el puerto 3001 y inicia el backend
$conn = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Puerto 3001 liberado."
}
Start-Sleep -Seconds 1
npm run dev
