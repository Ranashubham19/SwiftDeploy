# PowerShell script to start SwiftDeploy AI servers

Write-Host "Starting SwiftDeploy AI Servers..." -ForegroundColor Green
Write-Host ""

# Change to the project directory
Set-Location -Path "c:\Users\ranas\Downloads\swiftdeploy-ai (2)"

# Function to check if a port is in use
function Test-Port {
    param([int]$port)
    
    try {
        $tcpConnection = New-Object System.Net.Sockets.TcpClient
        $tcpConnection.Connect("localhost", $port)
        $tcpConnection.Close()
        return $true
    }
    catch {
        return $false
    }
}

# Check if servers are already running
$backendRunning = Test-Port -port 4000
$frontendRunning = Test-Port -port 3000

if ($backendRunning) {
    Write-Host "⚠️  Backend server already running on port 4000" -ForegroundColor Yellow
} else {
    Write-Host "Starting backend server..." -ForegroundColor Cyan
    Start-Process -FilePath "cmd" -ArgumentList "/c", "cd backend && npm run dev" -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

if ($frontendRunning) {
    Write-Host "⚠️  Frontend server already running on port 3000" -ForegroundColor Yellow
} else {
    Write-Host "Starting frontend server..." -ForegroundColor Cyan
    Start-Process -FilePath "cmd" -ArgumentList "/c", "npm run dev:frontend" -WindowStyle Hidden
}

Write-Host ""
Write-Host "Servers should be available shortly:" -ForegroundColor Green
Write-Host "  - Backend:  http://localhost:4000" -ForegroundColor Cyan
Write-Host "  - Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Access your SwiftDeploy app at http://localhost:3000" -ForegroundColor Green
Write-Host ""

# Wait a bit to let servers start
Start-Sleep -Seconds 5

# Try to open the browser
try {
    Start-Process "http://localhost:3000"
    Write-Host "Browser opened to http://localhost:3000" -ForegroundColor Green
}
catch {
    Write-Host "Could not automatically open browser. Please visit http://localhost:3000 manually." -ForegroundColor Yellow
}
