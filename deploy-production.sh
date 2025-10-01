#!/bin/bash

# Surge.video Production Deployment Script
# This script deploys the Surge Web Installer to your surge.video domain

set -e

echo "🚀 Deploying Surge Web Installer to surge.video"
echo "=============================================="

# Check if running as root (for SSL cert installation)
if [[ $EUID -eq 0 ]]; then
   echo "⚠️  Running as root. Make sure you have your SSL certificates ready."
fi

# Check dependencies
echo "🔍 Checking dependencies..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed."
    echo "   Install Docker: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is required but not installed."
    echo "   Install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ All dependencies found"

# Create SSL directory
echo "📁 Setting up SSL certificates..."
mkdir -p nginx/ssl

# Check for SSL certificates
if [ ! -f "nginx/ssl/surge.video.crt" ] || [ ! -f "nginx/ssl/surge.video.key" ]; then
    echo ""
    echo "🔒 SSL Certificate Setup Required"
    echo "================================="
    echo ""
    echo "You need SSL certificates for surge.video. Options:"
    echo ""
    echo "1. 🆓 Let's Encrypt (Recommended):"
    echo "   sudo apt install certbot python3-certbot-nginx"
    echo "   sudo certbot certonly --nginx -d surge.video -d www.surge.video"
    echo "   sudo cp /etc/letsencrypt/live/surge.video/fullchain.pem nginx/ssl/surge.video.crt"
    echo "   sudo cp /etc/letsencrypt/live/surge.video/privkey.pem nginx/ssl/surge.video.key"
    echo ""
    echo "2. 💰 Commercial Certificate:"
    echo "   Copy your .crt file to nginx/ssl/surge.video.crt"
    echo "   Copy your .key file to nginx/ssl/surge.video.key"
    echo ""
    echo "3. 🧪 Self-Signed (Development Only):"
    echo "   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\"
    echo "     -keyout nginx/ssl/surge.video.key \\"
    echo "     -out nginx/ssl/surge.video.crt \\"
    echo "     -subj '/CN=surge.video'"
    echo ""
    
    read -p "Do you want to create a self-signed certificate for testing? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout nginx/ssl/surge.video.key \
            -out nginx/ssl/surge.video.crt \
            -subj '/CN=surge.video'
        echo "✅ Self-signed certificate created"
    else
        echo "❌ Please set up SSL certificates and run this script again."
        exit 1
    fi
fi

# Create environment file
echo "⚙️  Creating environment configuration..."
if [ ! -f ".env.prod" ]; then
    cat > .env.prod << EOF
# Production Environment Configuration
PUID=1000
PGID=1000
TZ=UTC
FLASK_ENV=production

# Security (CHANGE THESE!)
SECRET_KEY=$(openssl rand -hex 32)

# Database
DATABASE_URL=sqlite:///data/surge.db

# Optional: Redis for session storage
REDIS_URL=redis://redis:6379/0
EOF
    echo "✅ Environment file created at .env.prod"
    echo "⚠️  Please review and customize .env.prod before production use!"
else
    echo "✅ Using existing .env.prod"
fi

# Build and deploy
echo "🏗️  Building and starting services..."
docker-compose -f docker-compose.prod.yml --env-file .env.prod down --remove-orphans
docker-compose -f docker-compose.prod.yml --env-file .env.prod pull
docker-compose -f docker-compose.prod.yml --env-file .env.prod build --no-cache
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo ""
echo "🎉 Deployment Complete!"
echo "======================"
echo ""
echo "🌐 Your Surge Web Installer is now running at:"
echo "   https://surge.video"
echo ""
echo "📊 Service Status:"
docker-compose -f docker-compose.prod.yml ps
echo ""
echo "📝 Next Steps:"
echo "1. 🔒 Point your domain surge.video to this server's IP"
echo "2. 🧪 Test the installation at https://surge.video"
echo "3. 📧 Set up proper user authentication (replace demo auth)"
echo "4. 📈 Configure monitoring and logging"
echo "5. 🔄 Set up automatic SSL renewal if using Let's Encrypt"
echo ""
echo "🛠️  Management Commands:"
echo "   View logs:    docker-compose -f docker-compose.prod.yml logs -f"
echo "   Stop:         docker-compose -f docker-compose.prod.yml down"
echo "   Restart:      docker-compose -f docker-compose.prod.yml restart"
echo "   Update:       ./deploy-production.sh"
echo ""
echo "📞 Need help? Check the README.md or visit https://surge.video/docs"