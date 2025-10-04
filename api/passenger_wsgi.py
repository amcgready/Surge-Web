#!/home/amcgnwgb/virtualenv/surge.video/api/3.9/bin/python3

import sys
import os

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(__file__))

try:
    from app_simple import app as application
except ImportError as e:
    # Fallback minimal application for debugging
    from flask import Flask, jsonify
    application = Flask(__name__)
    
    @application.route('/health')
    def health():
        return jsonify({
            'status': 'passenger_wsgi_fallback',
            'error': f'Import error: {str(e)}',
            'python_executable': sys.executable,
            'python_version': sys.version,
            'cwd': os.getcwd(),
            'sys_path': sys.path[:3]
        })

# For compatibility with different WSGI servers
app = application