#!/bin/bash
set -e

echo "🧪 Testing Asset Path Configuration..."
echo "=================================="

# Test 1: Check if development assets exist
echo "📁 Checking development assets..."
DEV_ASSETS=(
    "frontend/public/assets/Surge.png"
    "frontend/public/assets/background.jpg"
    "frontend/src/assets/Surge.png"
    "frontend/src/assets/background.jpg"
)

for asset in "${DEV_ASSETS[@]}"; do
    if [ -f "$asset" ]; then
        echo "✅ $asset exists"
    else
        echo "❌ $asset missing"
    fi
done

# Test 2: Check if build assets exist (if built)
echo ""
echo "📦 Checking production build assets..."
if [ -d "frontend/build" ]; then
    if [ -f "frontend/build/asset-manifest.json" ]; then
        echo "✅ Asset manifest exists"
        
        # Check for Surge logo in manifest
        if grep -q "Surge.png" "frontend/build/asset-manifest.json"; then
            SURGE_PATH=$(grep -o '"static/media/Surge\.png": "[^"]*"' frontend/build/asset-manifest.json | cut -d'"' -f4)
            echo "✅ Surge logo found at: $SURGE_PATH"
            
            # Check if actual file exists
            if [ -f "frontend/build$SURGE_PATH" ]; then
                echo "✅ Surge logo file exists"
            else
                echo "❌ Surge logo file missing at: frontend/build$SURGE_PATH"
            fi
        else
            echo "❌ Surge logo not found in manifest"
        fi
    else
        echo "❌ Asset manifest missing"
    fi
else
    echo "⚠️  No build directory found (run 'npm run build' first)"
fi

# Test 3: Check backend configuration
echo ""
echo "🔧 Checking backend configuration..."
if grep -q "_get_logo_url" "backend/email_templates/email_config.py"; then
    echo "✅ Logo URL function exists in email config"
else
    echo "❌ Logo URL function missing"
fi

# Test 4: Check API endpoint (if server is running)
echo ""
echo "🌐 Testing asset manifest API..."
if curl -s -f "http://localhost:5001/api/assets/manifest" > /dev/null 2>&1; then
    echo "✅ Asset manifest API responding"
    RESPONSE=$(curl -s "http://localhost:5001/api/assets/manifest")
    echo "📄 Response: $RESPONSE"
else
    echo "⚠️  Asset manifest API not available (server may not be running)"
fi

echo ""
echo "🎯 Test Summary:"
echo "- Run './setup-development.sh' if development assets are missing"
echo "- Run './build-production.sh' to create production build"
echo "- Start backend with 'cd backend && python app.py' to test API"