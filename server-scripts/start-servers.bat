@echo off
echo Starting SwiftDeploy AI Servers...
echo.

REM Change to the project directory
cd /d "c:\Users\ranas\Downloads\swiftdeploy-ai (2)"

echo Starting backend server...
REM Start backend server in background
start "SwiftDeploy Backend" cmd /k "cd backend && npm run dev"

echo Waiting for backend to initialize...
timeout /t 5 /nobreak >nul

echo Starting frontend server...
REM Start frontend server in background
start "SwiftDeploy Frontend" cmd /k "npm run dev:frontend"

echo.
echo Servers are starting...
echo Backend: http://localhost:4000
echo Frontend: http://localhost:3000
echo.
echo Access your SwiftDeploy app at http://localhost:3000
echo.
pause
