#!/bin/bash
set -e

echo "🛠️  Setting up Surge Web for development..."

# Ensure public assets exist
echo "📁 Setting up development assets..."
mkdir -p frontend/public/assets

# Copy assets to public folder for development access
if [ -f "frontend/src/assets/Surge.png" ]; then
    cp "frontend/src/assets/Surge.png" "frontend/public/assets/"
    echo "✅ Copied Surge logo to public/assets/"
fi

if [ -f "frontend/src/assets/background.jpg" ]; then
    cp "frontend/src/assets/background.jpg" "frontend/public/assets/"
    echo "✅ Copied background image to public/assets/"
fi

# Copy all service logos for consistency
if [ -d "frontend/src/assets/service-logos" ]; then
    mkdir -p frontend/public/assets/service-logos
    cp -r frontend/src/assets/service-logos/* frontend/public/assets/service-logos/ 2>/dev/null || true
    echo "✅ Copied service logos to public/assets/service-logos/"
fi

echo "🚀 Development setup complete!"
echo ""
echo "Start development with:"
echo "  Backend: cd backend && python app.py"
echo "  Frontend: cd frontend && npm start"
echo "  Full stack: docker-compose up"