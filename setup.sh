#!/bin/bash

echo "🚀 Setting up AI Cover Letter & Resume Generator..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ ERROR: Node.js is not installed."
    echo "Please install Node.js from https://nodejs.org/"
    echo "Then restart your terminal and run this script again."
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Navigate to proxy directory
cd proxy

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ ERROR: package.json not found in proxy directory"
    exit 1
fi

# Install proxy dependencies
echo "📦 Installing dependencies..."
if ! npm install; then
    echo "❌ ERROR: Failed to install dependencies"
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "🔑 NEXT STEPS:"
echo "1. Run './start-proxy.sh' to start the local server"
echo "2. Load the Chrome extension from the 'extension' folder"
echo "3. Click the gear icon in the extension and paste your OpenAI API key"
echo "   (create one at https://platform.openai.com/api-keys)"
echo ""
echo "📖 See README.md for detailed instructions!"
