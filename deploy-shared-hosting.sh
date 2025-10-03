#!/bin/bash

# Simple deployment script for shared hosting without Docker
# This script should be run on the server after git sync

echo "🚀 Deploying Surge Web to shared hosting environment"
echo "================================================"

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_DIR="$SCRIPT_DIR"

echo "📂 Project directory: $PROJECT_DIR"

# Check if we have the built frontend
if [ ! -d "$PROJECT_DIR/frontend/build" ]; then
    echo "❌ Frontend build directory not found!"
    echo "   The React app needs to be built locally and committed to Git"
    echo "   Run 'npm run build' in the frontend directory locally, then commit and push"
    exit 1
fi

echo "✅ Found frontend build directory"

# Create a web directory if it doesn't exist
WEB_DIR="$PROJECT_DIR/web"
mkdir -p "$WEB_DIR"

echo "📋 Copying frontend files to web directory..."
cp -r "$PROJECT_DIR/frontend/build/"* "$WEB_DIR/"

echo "🔧 Setting up backend API..."
# Copy backend files to a separate directory
API_DIR="$PROJECT_DIR/api"
mkdir -p "$API_DIR"
cp -r "$PROJECT_DIR/backend/"* "$API_DIR/"

echo "📝 Creating index.html redirect in project root..."
cat > "$PROJECT_DIR/index.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Surge Web Installer</title>
    <meta http-equiv="refresh" content="0; url=./web/">
    <script>
        window.location.href = './web/';
    </script>
</head>
<body>
    <p>Redirecting to <a href="./web/">Surge Web Installer</a>...</p>
</body>
</html>
EOF

echo "✅ Deployment complete!"
echo ""
echo "📁 Structure:"
echo "   - Main app: $WEB_DIR"
echo "   - Backend API: $API_DIR" 
echo "   - Redirect: $PROJECT_DIR/index.html"
echo ""
echo "🌐 Your app should now be accessible at your domain"
echo "   Main URL will redirect to /web/ where the React app is served"