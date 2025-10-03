# Image Path Troubleshooting Guide

## Problem
Images (logos, service icons, backgrounds) not showing up when switching between local development and server production versions.

## Root Cause
Different environments handle static assets differently:
- **Development**: Uses webpack dev server with direct asset imports and /assets/ paths
- **Production**: Uses built static assets with hashed filenames in /static/media/

## Solutions Implemented

### 1. Dual Asset Structure
- **Development**: Assets available at `/assets/` (copied to `public/assets/`)
- **Production**: Assets available at `/static/media/` (webpack build output)

### 2. Environment-Aware Asset URLs
- Backend email templates now detect environment and use appropriate paths
- API endpoint `/api/assets/manifest` provides correct asset URLs

### 3. Nginx Configuration
- Updated to serve both `/assets/` and `/static/` paths
- Proper caching headers for static assets

### 4. Production Docker Build
- Created `Dockerfile.prod` with multi-stage build
- Properly builds static assets and serves with nginx
- Updated `docker-compose.prod.yml` to use production Dockerfile

## Quick Fixes

### If Images Still Don't Show:

1. **Development Mode**:
   ```bash
   ./setup-development.sh
   ```

2. **Production Mode**:
   ```bash
   ./build-production.sh
   docker-compose -f docker-compose.prod.yml up -d --build
   ```

3. **Shared Hosting**:
   ```bash
   npm run build  # in frontend directory
   ./deploy-shared-hosting.sh
   ```

### Manual Verification:

1. **Check Asset Manifest**:
   ```bash
   cat frontend/build/asset-manifest.json | grep -E "(Surge|background)"
   ```

2. **Check API Response**:
   ```bash
   curl http://localhost:5001/api/assets/manifest
   ```

3. **Verify File Paths**:
   - Development: `frontend/public/assets/Surge.png`
   - Production: `frontend/build/static/media/Surge.[hash].png`

## Environment Variables

Make sure these are set correctly:
- `FLASK_ENV=development` (for local)
- `FLASK_ENV=production` (for server)

## File Structure
```
frontend/
├── public/assets/           # Development assets
│   ├── Surge.png
│   ├── background.jpg
│   └── service-logos/
├── src/assets/             # Source assets (imported by webpack)
│   ├── Surge.png
│   ├── background.jpg
│   └── service-logos/
└── build/static/media/     # Production built assets (hashed)
    ├── Surge.[hash].png
    ├── background.[hash].jpg
    └── [service].[hash].png
```

## Scripts Available
- `./setup-development.sh` - Sets up development environment
- `./build-production.sh` - Builds for production with correct paths
- `./deploy-production.sh` - Full production deployment
- `./deploy-shared-hosting.sh` - Shared hosting deployment