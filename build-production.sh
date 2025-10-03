#!/bin/bash
set -e

echo "🏗️  Building Surge Web for production..."

# Build the React app
echo "📦 Building React frontend..."
cd frontend
npm run build
cd ..

# Extract asset manifest and update backend
echo "🔗 Updating asset paths in backend..."
MANIFEST_FILE="frontend/build/asset-manifest.json"

if [ -f "$MANIFEST_FILE" ]; then
    # Extract the Surge logo path from manifest
    LOGO_PATH=$(grep -o '"static/media/Surge\.png": "[^"]*"' "$MANIFEST_FILE" | cut -d'"' -f4)
    BACKGROUND_PATH=$(grep -o '"static/media/background\.jpg": "[^"]*"' "$MANIFEST_FILE" | cut -d'"' -f4)
    
    echo "📸 Found logo at: $LOGO_PATH"
    echo "🖼️  Found background at: $BACKGROUND_PATH"
    
    # Update the email config with the correct paths
    if [ -n "$LOGO_PATH" ]; then
        # Use sed to update the hardcoded path in email_config.py
        sed -i "s|/static/media/Surge\.c18ed7a95cced26cabbb\.png|$LOGO_PATH|g" backend/email_templates/email_config.py
        echo "✅ Updated logo path in email config"
    fi
    
    if [ -n "$BACKGROUND_PATH" ]; then
        sed -i "s|/static/media/background\.790b9cc6eb4d45e257ef\.jpg|$BACKGROUND_PATH|g" backend/email_templates/email_config.py
        echo "✅ Updated background path in email config"
    fi
else
    echo "⚠️  Warning: Asset manifest not found at $MANIFEST_FILE"
fi

echo "🚀 Production build complete!"
echo ""
echo "Next steps:"
echo "1. Deploy with: docker-compose -f docker-compose.prod.yml up -d"
echo "2. Or use the deployment script: ./deploy-production.sh"