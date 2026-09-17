@echo off
echo 🚀 Starting AI Cover Letter ^& Resume Generator Server...
echo.
echo ✅ Server will run on http://localhost:8787
echo ✅ Keep this window open while using the extension
echo ✅ Press Ctrl+C to stop the server when done
echo.

cd proxy

if not exist node_modules (
    echo ❌ ERROR: dependencies not installed. Run setup.bat first.
    pause
    exit /b 1
)

npm start
