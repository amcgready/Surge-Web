# Surge Web Installer

A web-based installer that allows users to deploy Docker containers and manage services on their local machines through a secure, authenticated web interface.

## 🌟 Features

- **🔐 Web Authentication**: Secure login system for personalized installations
- **🖥️ Remote Deployment**: Deploy Docker containers to local machines via web interface
- **📡 Real-time Communication**: Live progress updates during deployment
- **🎯 Service Configuration**: Configure Plex/Jellyfin/Emby media stacks
- **🛠️ Media Automation**: Set up Radarr, Sonarr, Prowlarr, Bazarr, and more
- **📊 Live Monitoring**: Real-time deployment progress and status
- **🔒 Secure Connection**: Encrypted communication between web app and local daemon

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Browser   │◄──►│  Surge Server   │◄──►│ Local Machine   │
│   (React App)   │    │ (Flask + WS)    │    │ (Python Daemon) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
     Authentication         WebSocket              Docker
     Configuration         Real-time Updates      Git Operations
     Live Monitoring       Command Routing        File Management
```

## 🚀 Quick Start

### 1. Start the Web Installer

```bash
git clone https://github.com/your-repo/surge-web
cd surge-web
./deploy.sh
```

The web interface will be available at: https://surge.video

### 2. Create Account & Login

1. Visit https://surge.video
2. Register a new account or login
3. You'll see the Surge setup wizard

### 3. Connect Your Local Machine

1. In the Deploy step, click "Setup Instructions"
2. Generate a connection token
3. Run the provided command on your local machine:

```bash
curl -sSL https://surge.video/install-daemon.sh | bash
~/.surge-daemon/start.sh --server wss://surge.video/socket.io/ --token YOUR_TOKEN
```

### 4. Configure & Deploy

1. Configure your media server (Plex/Jellyfin/Emby)
2. Set storage paths and API keys
3. Select additional services
4. Click "Deploy Services"
5. Watch real-time progress as services are installed

## 📋 Requirements

### Web Server Requirements
- Docker & Docker Compose
- Ports 3100 (frontend) and 5001 (backend) available

### Local Machine Requirements
- **Linux/macOS** (Windows WSL2 supported)
- **Docker** installed and running
- **Git** installed
- **Python 3.7+** installed
- **Internet connection** for downloading containers

## 🛠️ Development Setup

### Quick Setup (Recommended)
```bash
# Run the development setup script to configure assets
./setup-development.sh

# Start backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py

# Start frontend (new terminal)
cd frontend
npm install
npm start
```

### Manual Setup
#### Backend Setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

#### Frontend Setup
```bash
cd frontend
npm install
npm start
```

### Local Daemon Setup
```bash
cd local-daemon
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 surge-daemon.py --server ws://localhost:5001/socket.io/
```

## 🏗️ Production Deployment

### Automated Build & Deploy
```bash
# Build for production with proper asset paths
./build-production.sh

# Deploy to production
docker-compose -f docker-compose.prod.yml up -d
```

### Manual Production Build
```bash
# Build frontend with optimized assets
cd frontend
npm run build
cd ..

# Deploy with production docker-compose
docker-compose -f docker-compose.prod.yml up -d
```

### Shared Hosting Deployment
```bash
# For shared hosting without Docker
./deploy-shared-hosting.sh
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Security
SECRET_KEY=your-secret-key-here

# Server Configuration
FLASK_ENV=production
PUID=1000
PGID=1000
TZ=UTC

# Database (optional - uses in-memory by default)
DATABASE_URL=sqlite:///surge.db
```

### Supported Services

**Media Servers:**
- Plex Media Server
- Jellyfin
- Emby Server

**Media Automation:**
- Radarr (Movies)
- Sonarr (TV Shows)
- Prowlarr (Indexers)
- Bazarr (Subtitles)
- CineSync (Library Management)

**Download Clients:**
- NZBGet (Usenet)
- RDT-Client (Real-Debrid)
- qBittorrent (Torrents)

**Monitoring & Enhancement:**
- Overseerr (Request Management)
- Tautulli (Plex Monitoring)
- Kometa (Metadata Management)

## 🔒 Security

### Authentication
- JWT-based authentication system
- Session management with automatic expiration
- Secure password hashing (implement bcrypt in production)

### Communication Security
- WebSocket connections with token authentication
- All daemon commands are signed and verified
- Local daemon runs with minimal privileges

### Best Practices
- Change default SECRET_KEY in production
- Use HTTPS in production deployments
- Regularly update daemon tokens
- Monitor daemon connections and activity

## 🌐 Production Deployment

### Using Docker Swarm
```bash
docker swarm init
docker stack deploy -c docker-compose.prod.yml surge
```

### Using Kubernetes
```bash
kubectl apply -f k8s/
```

### Reverse Proxy (Nginx)
```nginx
server {
    listen 443 ssl http2;
    server_name surge.video;
    
    location / {
        proxy_pass http://localhost:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /socket.io/ {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## 🐛 Troubleshooting

### Common Issues

**Daemon Won't Connect:**
```bash
# Check daemon logs
~/.surge-daemon/start.sh --server ws://your-server/socket.io/ --token YOUR_TOKEN

# Verify token is valid
curl -H "Authorization: Bearer YOUR_TOKEN" http://your-server/api/client/status
```

**Docker Permission Errors:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER
# Logout and login again
```

**Port Conflicts:**
```bash
# Check what's using ports
sudo netstat -tlnp | grep :3100
sudo netstat -tlnp | grep :5001

# Kill conflicting processes or change ports in docker-compose.yml
```

### Debug Mode

Enable debug logging:
```bash
# Backend debug
FLASK_ENV=development python app.py

# Daemon debug
python3 surge-daemon.py --server ws://localhost:5001/socket.io/ --log-level DEBUG
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔮 Roadmap

- [ ] **Multi-machine Support**: Deploy to multiple servers
- [ ] **Service Templates**: Pre-configured service stacks
- [ ] **Backup Management**: Automated configuration backups
- [ ] **Health Monitoring**: Service health checks and alerts
- [ ] **Plugin System**: Custom service integrations
- [ ] **Mobile App**: Native mobile client
- [ ] **Team Management**: Multi-user organizations
- [ ] **Advanced Analytics**: Deployment metrics and insights

## 📞 Support

- **Documentation**: [Wiki](https://github.com/your-repo/surge-web/wiki)
- **Issues**: [GitHub Issues](https://github.com/your-repo/surge-web/issues)
- **Discord**: [Community Server](https://discord.gg/your-server)
- **Email**: support@your-domain.com

---

**Made with ❤️ by the Surge Team**