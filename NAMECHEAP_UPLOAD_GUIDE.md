# Namecheap Stellar Plus Upload Guide

## Files to Upload

### 1. Main Website Files
Upload contents of `web/` folder to `/home/amcgnwgb/public_html/`

Files to upload:
- index.html
- manifest.json
- favicon.ico
- asset-manifest.json
- static/ (entire folder with all images)
- assets/ (backup folder)

### 2. API Files  
Upload contents of `api/` folder to `/home/amcgnwgb/public_html/api/`

Files to upload:
- app.py
- requirements.txt
- .htaccess
- models.py
- email_templates/ (entire folder)
- All other Python files

### 3. Root Redirect
Upload `index.html` to `/home/amcgnwgb/public_html/` (if you want root redirect)

## Python App Setup in cPanel

1. Go to "Setup Python App" in cPanel
2. Click "Create Application"
3. Settings:
   - Python Version: 3.9+
   - Application Root: /home/amcgnwgb/public_html/api
   - Application URL: (leave blank or use /api)
   - Application Startup File: app.py

4. After creation, click "Enter to virtual environment"
5. Run: python -m pip install flask flask-cors requests python-dotenv

## Testing
- Main site: https://yoursite.com
- API test: https://yoursite.com/api/health