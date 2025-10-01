#!/bin/bash

# Surge Local Daemon Installer
# This script installs and runs the Surge daemon that connects your machine to the Surge web installer

set -e

echo "🚀 Surge Local Daemon Installer"
echo "================================"

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed. Please install Python 3 and try again."
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed. Please install Docker and try again."
    exit 1
fi

# Check if Git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is required but not installed. Please install Git and try again."
    exit 1
fi

echo "✅ All prerequisites found"

# Create daemon directory
DAEMON_DIR="$HOME/.surge-daemon"
mkdir -p "$DAEMON_DIR"

echo "📁 Created daemon directory: $DAEMON_DIR"

# Download daemon files
echo "⬇️  Downloading Surge daemon..."

# In production, these would be downloaded from your server
# For now, we'll copy from the current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/surge-daemon.py" ]; then
    cp "$SCRIPT_DIR/surge-daemon.py" "$DAEMON_DIR/"
    cp "$SCRIPT_DIR/requirements.txt" "$DAEMON_DIR/"
else
    # Download from server (implement this for production)
    curl -sSL "https://surge.video/daemon/surge-daemon.py" > "$DAEMON_DIR/surge-daemon.py"
    curl -sSL "https://surge.video/daemon/requirements.txt" > "$DAEMON_DIR/requirements.txt"
fi

# Create virtual environment
echo "🐍 Setting up Python environment..."
cd "$DAEMON_DIR"
python3 -m venv venv
source venv/bin/activate

# Install dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt

# Create start script
cat > "$DAEMON_DIR/start.sh" << 'EOF'
#!/bin/bash
cd "$HOME/.surge-daemon"
source venv/bin/activate
python3 surge-daemon.py "$@"
EOF

chmod +x "$DAEMON_DIR/start.sh"

# Create desktop shortcut (optional)
if command -v xdg-desktop-menu &> /dev/null; then
    cat > "$DAEMON_DIR/surge-daemon.desktop" << EOF
[Desktop Entry]
Name=Surge Daemon
Comment=Connect to Surge Web Installer
Exec=$DAEMON_DIR/start.sh
Icon=applications-internet
Terminal=true
Type=Application
Categories=Network;
EOF
    
    xdg-desktop-menu install "$DAEMON_DIR/surge-daemon.desktop" || true
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "🔗 To connect to the Surge web installer:"
echo "   1. Visit https://surge.video"
echo "   2. Login with your account"
echo "   3. Run this daemon: $DAEMON_DIR/start.sh"
echo "   4. Your browser will show 'Connected' and you can begin installation"
echo ""
echo "💡 Pro tip: You can also run the daemon with custom server:"
echo "   $DAEMON_DIR/start.sh --server wss://surge.video/socket.io/ --token YOUR_TOKEN"
echo ""

# Ask if user wants to start now
read -p "🚀 Start the daemon now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Starting Surge daemon..."
    "$DAEMON_DIR/start.sh"
fi