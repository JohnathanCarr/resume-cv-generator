@echo off
echo 🚀 Setting up AI Cover Letter ^& Resume Generator...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Node.js is not installed.
    echo Please install Node.js from https://nodejs.org/
    echo Then restart Command Prompt and run this script again.
    pause
    exit /b 1
)

echo ✅ Node.js found
node --version

REM Navigate to proxy directory and install dependencies
cd proxy
if not exist package.json (
    echo ❌ ERROR: package.json not found in proxy directory
    pause
    exit /b 1
)

echo.
echo 📦 Installing dependencies...
npm install
if errorlevel 1 (
    echo ❌ ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ✅ Setup complete!
echo.
echo 🔑 NEXT STEPS:
echo 1. Run 'start-proxy.bat' to start the local server
echo 2. Load the Chrome extension from the 'extension' folder
echo 3. Click the gear icon in the extension and paste your OpenAI API key
echo    (create one at https://platform.openai.com/api-keys)
echo.
echo 📖 See README.md for detailed instructions!
echo.
pause
