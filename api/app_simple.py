#!/usr/bin/env python3
"""
Simplified Surge WebUI Backend for Shared Hosting
Removes SocketIO and other complex dependencies
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_mail import Mail, Message
import json
import os
import logging
import uuid
from datetime import datetime, timedelta
import jwt
import hashlib
import secrets
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'surge-secret-key-change-in-production')
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'true').lower() == 'true'
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER', 'noreply@surge.video')

# Initialize extensions
CORS(app, origins=["https://surge.video", "http://localhost:3100"])
mail = Mail(app)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Simple in-memory storage (for demo purposes)
users_db = {}
sessions_db = {}

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'Surge Web API is running',
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/api/auth/register', methods=['POST'])
def register():
    """User registration"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not username or not email or not password:
            return jsonify({'error': 'All fields are required'}), 400
        
        # Check if user exists
        if email in users_db:
            return jsonify({'error': 'User already exists'}), 400
        
        # Create user
        user_id = str(uuid.uuid4())
        users_db[email] = {
            'id': user_id,
            'username': username,
            'email': email,
            'password_hash': hashlib.sha256(password.encode()).hexdigest(),
            'is_verified': False,
            'created_at': datetime.utcnow().isoformat()
        }
        
        # Generate verification token
        verification_token = secrets.token_urlsafe(32)
        verification_url = f"https://surge.video/verify-email?token={verification_token}"
        
        # Store verification token
        users_db[email]['verification_token'] = verification_token
        
        # Send verification email (simplified)
        try:
            msg = Message(
                subject='Confirm Your Surge.video Account 🚀',
                sender=app.config['MAIL_DEFAULT_SENDER'],
                recipients=[email]
            )
            msg.html = f'''
            <html>
            <body style="font-family: Arial, sans-serif; background: #0a0e27; color: #e0e6ed; padding: 40px;">
                <div style="max-width: 600px; margin: 0 auto; background: #1a1f3a; border-radius: 12px; padding: 40px;">
                    <h1 style="color: #14b8a6; text-align: center;">Welcome to Surge! 🚀</h1>
                    <h2>Hi {username}! 👋</h2>
                    <p>Thank you for joining Surge.video! Please verify your email address to get started.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="{verification_url}" 
                           style="background: linear-gradient(135deg, #07938f 0%, #14b8a6 100%); 
                                  color: white; padding: 15px 30px; text-decoration: none; 
                                  border-radius: 25px; font-weight: bold;">
                            Verify Email Address
                        </a>
                    </div>
                    <p style="color: #a7f3d0; font-size: 14px;">
                        If you didn't create this account, you can safely ignore this email.
                    </p>
                </div>
            </body>
            </html>
            '''
            mail.send(msg)
        except Exception as e:
            logger.error(f"Failed to send verification email: {e}")
            # Continue anyway - registration still works
        
        return jsonify({
            'success': True,
            'message': 'Registration successful! Please check your email for verification.',
            'user_id': user_id
        })
        
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return jsonify({'error': 'Registration failed'}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    """User login"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Email and password required'}), 400
        
        # Check user
        user = users_db.get(email)
        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Check password
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        if user['password_hash'] != password_hash:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Generate session token
        token = jwt.encode({
            'user_id': user['id'],
            'email': email,
            'exp': datetime.utcnow() + timedelta(days=7)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'is_verified': user.get('is_verified', False)
            }
        })
        
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'error': 'Login failed'}), 500

@app.route('/api/verify-email', methods=['POST'])
def verify_email():
    """Email verification"""
    try:
        data = request.get_json()
        token = data.get('token')
        
        # Find user by token
        for email, user in users_db.items():
            if user.get('verification_token') == token:
                user['is_verified'] = True
                user.pop('verification_token', None)
                return jsonify({
                    'success': True,
                    'message': 'Email verified successfully!'
                })
        
        return jsonify({'error': 'Invalid verification token'}), 400
        
    except Exception as e:
        logger.error(f"Verification error: {e}")
        return jsonify({'error': 'Verification failed'}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=False)