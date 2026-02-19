# PowerShell script to start both backend and frontend servers

Write-Host "Starting SwiftDeploy AI Development Servers..." -ForegroundColor Green

# Start backend server in background
Start-Process -FilePath "cmd" -ArgumentList "/c", "cd backend && npm run dev" -WindowStyle Hidden

Write-Host "Backend server starting on http://localhost:4000" -ForegroundColor Yellow

# Give backend a moment to start
Start-Sleep -Seconds 3

# Start frontend server
Write-Host "Starting frontend server on http://localhost:3000" -ForegroundColor Yellow
Start-Process -FilePath "cmd" -ArgumentList "/c", "npm run dev:frontend"

Write-Host ""
Write-Host "Both servers are now running:" -ForegroundColor Green
Write-Host "  - Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "  - Backend:  http://localhost:4000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Access your SwiftDeploy app at http://localhost:3000" -ForegroundColor Green
