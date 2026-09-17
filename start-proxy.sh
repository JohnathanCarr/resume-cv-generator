#!/bin/bash

echo "🚀 Starting AI Cover Letter & Resume Generator Server..."
echo ""
echo "✅ Server will run on http://localhost:8787"
echo "✅ Keep this terminal window open while using the extension"
echo "✅ Press Ctrl+C to stop the server when done"
echo ""

cd proxy

if [ ! -d "node_modules" ]; then
    echo "❌ ERROR: dependencies not installed. Run ./setup.sh first."
    exit 1
fi

npm start
