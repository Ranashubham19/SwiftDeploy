@echo off
echo Starting SwiftDeploy AI Development Servers...

REM Start backend server in a new window
start "Backend Server" cmd /k "cd backend && npm run dev"

echo Backend server starting on http://localhost:4000
timeout /t 3 /nobreak >nul

REM Start frontend server in a new window
start "Frontend Server" cmd /k "npm run dev:frontend"

echo.
echo Both servers are now running:
echo   - Frontend: http://localhost:3000
echo   - Backend:  http://localhost:4000
echo.
echo Access your SwiftDeploy app at http://localhost:3000
pause
