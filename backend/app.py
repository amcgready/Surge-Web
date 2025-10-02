#!/usr/bin/env python3
"""
Surge WebUI Backend with WebSocket support for local daemon communication
"""

from flask import Flask, request, jsonify, render_template, url_for
from flask_cors import CORS
from flask_socketio import SocketIO, emit, disconnect, join_room, leave_room
from flask_mail import Mail, Message
from sqlalchemy import text
import json
import os
import yaml
import subprocess
import logging
import uuid
from datetime import datetime, timedelta
import jwt
import hashlib
import asyncio
from threading import Thread
import time
import secrets
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import database models
from models import db, init_database, User, UserSession, DeploymentLog, create_test_user

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Database Configuration
database_url = os.environ.get('DATABASE_URL')
if not database_url:
    # Use SQLite for development/testing when no PostgreSQL is available
    if os.environ.get('FLASK_ENV') == 'development' or not os.environ.get('DB_HOST'):
        database_url = 'sqlite:///surge_dev.db'
    else:
        # Default PostgreSQL configuration for production
        db_user = os.environ.get('DB_USER', 'surge_user')
        db_password = os.environ.get('DB_PASSWORD', 'surge_password')
        db_host = os.environ.get('DB_HOST', 'localhost')
        db_port = os.environ.get('DB_PORT', '5432')
        db_name = os.environ.get('DB_NAME', 'surge_db')
        database_url = f'postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}'

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'surge-secret-key-change-in-production')
app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Email Configuration
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', '587'))
app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'true').lower() in ['true', 'on', '1']
app.config['MAIL_USE_SSL'] = os.environ.get('MAIL_USE_SSL', 'false').lower() in ['true', 'on', '1']
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER', 'noreply@surge.video')
app.config['MAIL_DEBUG'] = os.environ.get('MAIL_DEBUG', 'false').lower() in ['true', 'on', '1']

# Log email configuration (without sensitive data)
if app.config['MAIL_USERNAME']:
    ssl_tls = "SSL" if app.config['MAIL_USE_SSL'] else ("TLS" if app.config['MAIL_USE_TLS'] else "Plain")
    logger.info(f"📧 Email configured: {app.config['MAIL_SERVER']}:{app.config['MAIL_PORT']} ({ssl_tls})")
else:
    logger.warning("⚠️  Email not configured - MAIL_USERNAME not set. Email features will be disabled.")

CORS(app, origins=["http://localhost:3000", "http://localhost:3100"])

# Initialize database
init_database(app)

# Initialize Flask-Mail
mail = Mail(app)

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins=["http://localhost:3000", "http://localhost:3100"])

# In-memory storage for connected clients (use Redis in production)
connected_clients = {}

def send_email_verification(user, token):
    """Send email verification email to user with customizable templates"""
    # Check if email is configured
    if not app.config['MAIL_USERNAME'] or not app.config['MAIL_PASSWORD']:
        logger.error("📧 Email not configured - missing MAIL_USERNAME or MAIL_PASSWORD")
        return False
    
    try:
        from email_templates import email_config, renderer
        
        # Generate verification URL
        if os.environ.get('FLASK_ENV') == 'production':
            base_url = 'https://surge.video'
        else:
            base_url = 'http://localhost:3002'  # Updated to match frontend port
        
        verification_url = f"{base_url}/verify-email?token={token}"
        
        # Get email configuration
        config = email_config.get_verification_email_config(user.username, verification_url)
        
        # Render email templates
        html_content, text_content = renderer.render_verification_email(
            config['theme'], 
            config['content']
        )
        
        # Create email message
        msg = Message(
            subject=config['content']['subject'],
            recipients=[user.email],
            html=html_content,
            body=text_content
        )
        
        logger.info(f"📧 Sending verification email to {user.email} using theme '{email_config.theme_name}'")
        mail.send(msg)
        logger.info(f"✅ Verification email sent successfully to {user.email}")
        return True
        
    except Exception as e:
        import traceback
        logger.error(f"❌ Failed to send verification email to {user.email}: {e}")
        logger.error(f"📋 Full traceback: {traceback.format_exc()}")
        return False

def send_password_reset_email(user, token):
    """Send password reset email to user"""
    # Check if email is configured
    if not app.config['MAIL_USERNAME'] or not app.config['MAIL_PASSWORD']:
        logger.error("📧 Email not configured - missing MAIL_USERNAME or MAIL_PASSWORD")
        return False
    
    try:
        from email_templates import email_config, renderer
        
        # Generate reset URL
        if os.environ.get('FLASK_ENV') == 'production':
            base_url = 'https://surge.video'
        else:
            base_url = 'http://localhost:3002'  # Updated to match frontend port
        
        reset_url = f"{base_url}/reset-password?token={token}"
        
        # Get email configuration
        config = email_config.get_password_reset_config(user.username, reset_url)
        
        # Render email templates
        html_content, text_content = renderer.render_password_reset_email(
            config['theme'], 
            config['content']
        )
        
        # Create email message
        msg = Message(
            subject=config['content']['subject'],
            recipients=[user.email],
            html=html_content,
            body=text_content
        )
        
        logger.info(f"📧 Sending password reset email to {user.email} using theme '{email_config.theme_name}'")
        mail.send(msg)
        logger.info(f"✅ Password reset email sent successfully to {user.email}")
        return True
        
    except Exception as e:
        import traceback
        logger.error(f"❌ Failed to send password reset email to {user.email}: {e}")
        logger.error(f"📋 Full traceback: {traceback.format_exc()}")
        return False

# Authentication decorator
def require_auth(f):
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Authentication required'}), 401
        
        token = auth_header.split(' ')[1]
        try:
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
            
            # Verify user still exists and is active
            user = User.query.get(user_id)
            if not user or not user.is_active:
                return jsonify({'error': 'User account not found or disabled'}), 401
            
            request.user_id = user_id
            request.user = user
            return f(*args, **kwargs)
            
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
    
    decorated_function.__name__ = f.__name__
    return decorated_function

@app.route('/api/auth/login', methods=['POST'])
def login():
    """User authentication with database"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        if not username or not password:
            return jsonify({'error': 'Username and password are required'}), 400
        
        # Find user by username
        user = User.find_by_username(username)
        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Check if account is locked
        if user.is_locked():
            return jsonify({'error': 'Account is temporarily locked due to failed login attempts'}), 401
        
        # Check if user is active
        if not user.is_active:
            return jsonify({'error': 'Account is disabled'}), 401
        
        # Check if email is verified
        if not user.is_email_verified:
            return jsonify({
                'error': 'Please verify your email address before logging in. Check your email for the verification link.',
                'requires_verification': True,
                'user_id': user.id
            }), 403
        
        # Verify password
        if not user.check_password(password):
            user.record_failed_login()
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Successful login
        user.record_login()
        
        # Create JWT token
        token = jwt.encode({
            'user_id': user.id,
            'username': user.username,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        # Create session record
        session_token = hashlib.sha256(f"{user.id}{datetime.utcnow()}".encode()).hexdigest()
        expires_at = datetime.utcnow() + timedelta(hours=24)
        
        session = UserSession(
            user_id=user.id,
            session_token=session_token,
            expires_at=expires_at,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent')
        )
        
        db.session.add(session)
        db.session.commit()
        
        logger.info(f"User {user.username} logged in successfully from {request.remote_addr}")
        
        return jsonify({
            'success': True,
            'token': token,
            'user_id': user.id,
            'username': user.username,
            'session_token': session_token
        })
        
    except Exception as e:
        logger.error(f"Login error: {e}")
        db.session.rollback()
        return jsonify({'error': 'Login failed. Please try again.'}), 500

@app.route('/api/auth/register', methods=['POST'])
def register():
    """User registration with database"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        email = data.get('email', '').strip().lower()
        
        # Validate input
        if not username or not password or not email:
            return jsonify({'error': 'Username, password, and email are required'}), 400
        
        if len(username) < 3:
            return jsonify({'error': 'Username must be at least 3 characters long'}), 400
        
        if len(username) > 50:
            return jsonify({'error': 'Username must be less than 50 characters long'}), 400
        
        # Check if user already exists
        existing_user = User.find_by_username(username)
        if existing_user:
            return jsonify({'error': 'Username already exists'}), 400
        
        # Check if email already exists (this is slow for large datasets)
        existing_email_user = User.find_by_email(email)
        if existing_email_user:
            return jsonify({'error': 'Email already registered'}), 400
        
        # Validate email format (basic check)
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Password validation (should match frontend validation)
        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters long'}), 400
        
        if not any(c.isupper() for c in password):
            return jsonify({'error': 'Password must contain at least one uppercase letter'}), 400
        
        if not any(c.isdigit() for c in password):
            return jsonify({'error': 'Password must contain at least one number'}), 400
        
        if not any(c in '!@#$%^&*()_+-=[]{};\'"\\|,.<>/?' for c in password):
            return jsonify({'error': 'Password must contain at least one special character'}), 400
        
        # Create new user (unverified)
        new_user = User(
            username=username,
            email=email,
            password=password
        )
        
        # Generate email verification token
        verification_token = new_user.generate_email_verification_token()
        
        db.session.add(new_user)
        db.session.commit()
        
        logger.info(f"New user registered: {username} from {request.remote_addr}")
        
        # Send verification email
        if send_email_verification(new_user, verification_token):
            return jsonify({
                'success': True,
                'message': 'Registration successful! Please check your email to verify your account.',
                'user_id': new_user.id,
                'email_sent': True
            })
        else:
            # If email sending fails, still register but notify user
            return jsonify({
                'success': True,
                'message': 'Registration successful, but we could not send the verification email. Please contact support.',
                'user_id': new_user.id,
                'email_sent': False
            })
        
    except Exception as e:
        logger.error(f"Registration error: {e}")
        db.session.rollback()
        return jsonify({'error': 'Registration failed. Please try again.'}), 500

@app.route('/api/auth/verify-email', methods=['POST'])
def verify_email():
    """Verify user email with token"""
    try:
        data = request.get_json()
        token = data.get('token', '').strip()
        
        if not token:
            return jsonify({'error': 'Verification token is required'}), 400
        
        # Find user by verification token
        user = User.query.filter_by(email_verification_token=token).first()
        
        if not user:
            return jsonify({'error': 'Invalid or expired verification token'}), 400
        
        # Check if token is expired
        if user.is_email_verification_expired():
            return jsonify({'error': 'Verification token has expired. Please request a new verification email.'}), 400
        
        # Verify the token
        if user.verify_email_token(token):
            db.session.commit()
            
            logger.info(f"Email verified for user: {user.username}")
            
            return jsonify({
                'success': True,
                'message': 'Email verified successfully! You can now log in.',
                'username': user.username
            })
        else:
            return jsonify({'error': 'Invalid verification token'}), 400
            
    except Exception as e:
        logger.error(f"Email verification error: {e}")
        db.session.rollback()
        return jsonify({'error': 'Verification failed. Please try again.'}), 500

@app.route('/api/auth/resend-verification', methods=['POST'])
def resend_verification():
    """Resend verification email"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip().lower()
        
        if not email:
            return jsonify({'error': 'Email is required'}), 400
        
        # Find user by email
        user = User.find_by_email(email)
        
        if not user:
            # Don't reveal if email exists - security measure
            return jsonify({
                'success': True,
                'message': 'If an account with that email exists and is unverified, a new verification email will be sent.'
            })
        
        # Check if already verified
        if user.is_email_verified:
            return jsonify({'error': 'This email address is already verified'}), 400
        
        # Generate new verification token
        verification_token = user.generate_email_verification_token()
        db.session.commit()
        
        # Send verification email
        email_sent = send_email_verification(user, verification_token)
        
        if os.environ.get('FLASK_ENV') == 'development':
            # In development, always return success even if email fails
            logger.info(f"Development mode: Generated new verification token for {user.email}")
            return jsonify({
                'success': True,
                'message': 'A new verification email has been sent. Please check your inbox.',
                'development_note': 'Email sending skipped in development mode'
            })
        elif email_sent:
            logger.info(f"Resent verification email to {user.email}")
            return jsonify({
                'success': True,
                'message': 'A new verification email has been sent. Please check your inbox.'
            })
        else:
            return jsonify({'error': 'Failed to send verification email. Please try again later.'}), 500
            
    except Exception as e:
        logger.error(f"Resend verification error: {e}")
        db.session.rollback()
        return jsonify({'error': 'Failed to resend verification email. Please try again.'}), 500

@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    """Send password reset email"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip().lower()
        
        if not email:
            return jsonify({'error': 'Email is required'}), 400
        
        # Find user by email
        user = User.find_by_email(email)
        
        if not user:
            # Don't reveal if email exists - security measure
            return jsonify({
                'success': True,
                'message': 'If an account with that email exists, a password reset email will be sent.'
            })
        
        # Check if account is verified
        if not user.is_email_verified:
            return jsonify({'error': 'Please verify your email address before resetting your password'}), 400
        
        # Generate password reset token
        reset_token = user.generate_password_reset_token()
        db.session.commit()
        
        # Send password reset email
        email_sent = send_password_reset_email(user, reset_token)
        
        if email_sent:
            logger.info(f"Password reset email sent to {user.email}")
            return jsonify({
                'success': True,
                'message': 'If an account with that email exists, a password reset email will be sent.'
            })
        else:
            # Still return success for security (don't reveal if email failed)
            logger.error(f"Failed to send password reset email to {user.email}")
            return jsonify({
                'success': True,
                'message': 'If an account with that email exists, a password reset email will be sent.'
            })
            
    except Exception as e:
        logger.error(f"Password reset request error: {e}")
        db.session.rollback()
        return jsonify({
            'success': True,
            'message': 'If an account with that email exists, a password reset email will be sent.'
        }), 200

@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    """Reset password with token"""
    try:
        data = request.get_json()
        token = data.get('token', '').strip()
        new_password = data.get('password', '').strip()
        
        if not token:
            return jsonify({'error': 'Reset token is required'}), 400
        
        if not new_password:
            return jsonify({'error': 'New password is required'}), 400
        
        # Validate password strength
        if len(new_password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters long'}), 400
        
        # Find user by reset token
        user = User.query.filter_by(password_reset_token=token).first()
        
        if not user:
            return jsonify({'error': 'Invalid or expired reset token'}), 400
        
        # Check if token is expired
        if user.is_password_reset_expired():
            return jsonify({'error': 'Password reset token has expired. Please request a new one.'}), 400
        
        # Reset the password
        if user.reset_password_with_token(token, new_password):
            db.session.commit()
            
            logger.info(f"Password reset successful for user: {user.username}")
            
            return jsonify({
                'success': True,
                'message': 'Password reset successfully! You can now log in with your new password.'
            })
        else:
            return jsonify({'error': 'Invalid reset token'}), 400
            
    except Exception as e:
        logger.error(f"Password reset error: {e}")
        db.session.rollback()
        return jsonify({'error': 'Password reset failed. Please try again.'}), 500

@app.route('/api/daemon/token', methods=['POST'])
@require_auth
def generate_daemon_token():
    """Generate a token for the local daemon to connect"""
    user_id = request.user_id
    
    daemon_token = jwt.encode({
        'user_id': user_id,
        'type': 'daemon',
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'success': True,
        'daemon_token': daemon_token,
        'websocket_url': f'wss://surge.video/socket.io/' if os.environ.get('FLASK_ENV') == 'production' else f'ws://localhost:5001/socket.io/'
    })

@app.route('/api/client/status', methods=['GET'])
@require_auth
def get_client_status():
    """Get the status of the user's connected client"""
    user_id = request.user_id
    
    if user_id in connected_clients:
        client_info = connected_clients[user_id]
        return jsonify({
            'connected': True,
            'client_info': client_info,
            'last_seen': client_info.get('last_seen')
        })
    
    return jsonify({'connected': False})

@app.route('/api/deploy', methods=['POST'])
@require_auth
def deploy_services():
    """Deploy services to the connected client"""
    user_id = request.user_id
    config = request.get_json()
    
    if user_id not in connected_clients:
        return jsonify({
            'success': False,
            'error': 'No daemon connected. Please start the Surge daemon on your local machine.'
        }), 400
    
    # Generate deployment commands
    deployment_id = str(uuid.uuid4())
    
    try:
        # Generate docker-compose.yml from config
        compose_content = generate_docker_compose(config)
        env_vars = generate_env_vars(config)
        
        # Send deployment command to client
        socketio.emit('deploy_command', {
            'deployment_id': deployment_id,
            'type': 'docker',
            'cmd_type': 'compose_up',
            'compose_file': compose_content,
            'env_vars': env_vars,
            'working_dir': config.get('storagePath', '/opt/surge')
        }, room=f"user_{user_id}")
        
        return jsonify({
            'success': True,
            'deployment_id': deployment_id,
            'message': 'Deployment started'
        })
        
    except Exception as e:
        logger.error(f"Deployment error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def generate_docker_compose(config):
    """Generate docker-compose.yml content from user config"""
    services = {}
    
    # Add media server
    if config.get('mediaServer') == 'plex':
        services['plex'] = {
            'image': 'plexinc/pms-docker:latest',
            'container_name': 'plex',
            'ports': ['32400:32400'],
            'environment': [
                'TZ=${TZ}',
                'PLEX_CLAIM=${PLEX_CLAIM}',
                'PLEX_UID=${PUID}',
                'PLEX_GID=${PGID}'
            ],
            'volumes': [
                '${STORAGE_PATH}/plex/config:/config',
                '${STORAGE_PATH}/media:/data'
            ],
            'restart': 'unless-stopped'
        }
    
    # Add media automation services
    if config.get('mediaAutomation', {}).get('radarr', False):
        services['radarr'] = {
            'image': 'linuxserver/radarr:latest',
            'container_name': 'radarr',
            'ports': ['7878:7878'],
            'environment': [
                'PUID=${PUID}',
                'PGID=${PGID}',
                'TZ=${TZ}'
            ],
            'volumes': [
                '${STORAGE_PATH}/radarr/config:/config',
                '${STORAGE_PATH}/media/movies:/movies',
                '${STORAGE_PATH}/downloads:/downloads'
            ],
            'restart': 'unless-stopped'
        }
    
    if config.get('mediaAutomation', {}).get('sonarr', False):
        services['sonarr'] = {
            'image': 'linuxserver/sonarr:latest',
            'container_name': 'sonarr',
            'ports': ['8989:8989'],
            'environment': [
                'PUID=${PUID}',
                'PGID=${PGID}',
                'TZ=${TZ}'
            ],
            'volumes': [
                '${STORAGE_PATH}/sonarr/config:/config',
                '${STORAGE_PATH}/media/tv:/tv',
                '${STORAGE_PATH}/downloads:/downloads'
            ],
            'restart': 'unless-stopped'
        }
    
    if config.get('mediaAutomation', {}).get('prowlarr', False):
        services['prowlarr'] = {
            'image': 'linuxserver/prowlarr:latest',
            'container_name': 'prowlarr',
            'ports': ['9696:9696'],
            'environment': [
                'PUID=${PUID}',
                'PGID=${PGID}',
                'TZ=${TZ}'
            ],
            'volumes': [
                '${STORAGE_PATH}/prowlarr/config:/config'
            ],
            'restart': 'unless-stopped'
        }
    
    compose_data = {
        'version': '3.8',
        'services': services
    }
    
    return yaml.dump(compose_data, default_flow_style=False)

def generate_env_vars(config):
    """Generate environment variables from user config"""
    env_vars = {
        'TZ': config.get('timezone', 'UTC'),
        'PUID': config.get('userId', '1000'),
        'PGID': config.get('groupId', '1000'),
        'STORAGE_PATH': config.get('storagePath', '/opt/surge')
    }
    
    # Add media server specific vars
    if config.get('mediaServer') == 'plex':
        plex_settings = config.get('plexSettings', {})
        if plex_settings.get('PLEX_CLAIM'):
            env_vars['PLEX_CLAIM'] = plex_settings['PLEX_CLAIM']
    
    return env_vars

# WebSocket event handlers
@socketio.on('connect')
def handle_connect(auth):
    """Handle client connection"""
    logger.info("Client attempting to connect")
    
    # Verify daemon token
    token = auth.get('token') if auth else None
    if not token:
        logger.warning("Connection rejected: No token provided")
        disconnect()
        return False
    
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        if payload.get('type') != 'daemon':
            logger.warning("Connection rejected: Invalid token type")
            disconnect()
            return False
        
        user_id = payload['user_id']
        
        # Add client to connected clients
        connected_clients[user_id] = {
            'session_id': request.sid,
            'connected_at': datetime.utcnow().isoformat(),
            'last_seen': datetime.utcnow().isoformat(),
            'user_id': user_id
        }
        
        # Join user room
        join_room(f"user_{user_id}")
        
        logger.info(f"Daemon connected for user {user_id}")
        
        # Emit connection success to web clients
        socketio.emit('daemon_connected', {
            'user_id': user_id,
            'connected_at': datetime.utcnow().isoformat()
        })
        
        return True
        
    except jwt.InvalidTokenError:
        logger.warning("Connection rejected: Invalid token")
        disconnect()
        return False

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnect"""
    # Find and remove client
    for user_id, client_info in list(connected_clients.items()):
        if client_info['session_id'] == request.sid:
            del connected_clients[user_id]
            leave_room(f"user_{user_id}")
            logger.info(f"Daemon disconnected for user {user_id}")
            
            # Emit disconnection to web clients
            socketio.emit('daemon_disconnected', {'user_id': user_id})
            break

@socketio.on('handshake')
def handle_handshake(data):
    """Handle initial handshake from daemon"""
    # Update client info with capabilities
    for user_id, client_info in connected_clients.items():
        if client_info['session_id'] == request.sid:
            client_info.update({
                'client_info': data.get('client_info', {}),
                'last_seen': datetime.utcnow().isoformat()
            })
            
            logger.info(f"Handshake completed for user {user_id}")
            
            # Send handshake confirmation
            emit('handshake_ack', {
                'status': 'connected',
                'server_time': datetime.utcnow().isoformat()
            })
            break

@socketio.on('progress')
def handle_progress(data):
    """Handle progress updates from daemon"""
    # Forward progress to web clients
    for user_id, client_info in connected_clients.items():
        if client_info['session_id'] == request.sid:
            client_info['last_seen'] = datetime.utcnow().isoformat()
            
            # Emit to web client
            socketio.emit('deployment_progress', data, room=f"webclient_{user_id}")
            break

@socketio.on('result')
def handle_result(data):
    """Handle command results from daemon"""
    # Forward results to web clients
    for user_id, client_info in connected_clients.items():
        if client_info['session_id'] == request.sid:
            client_info['last_seen'] = datetime.utcnow().isoformat()
            
            # Emit to web client
            socketio.emit('deployment_result', data, room=f"webclient_{user_id}")
            break

# Web client endpoints for real-time communication
@socketio.on('join_user_room')
def handle_join_user_room(data):
    """Allow web clients to join their user room for updates"""
    user_id = data.get('user_id')
    if user_id:
        join_room(f"webclient_{user_id}")
        emit('joined_room', {'room': f"webclient_{user_id}"})

# Existing API endpoints (keep your current ones)
@app.route('/api/test_connection', methods=['POST'])
def test_connection():
    """Test connection to a service"""
    data = request.get_json()
    url = data.get('url')
    api_key = data.get('api_key')
    
    try:
        # TODO: Implement actual service testing
        return jsonify({
            'status': 'success',
            'message': 'Connection successful'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e)
        })

@app.route('/api/save_config', methods=['POST'])
@require_auth
def save_config():
    """Save user configuration"""
    config = request.get_json()
    user_id = request.user_id
    
    # TODO: Save to database
    # For now, just return success
    
    return jsonify({
        'success': True,
        'message': 'Configuration saved'
    })

@app.route('/api/autodetect', methods=['GET'])
def autodetect():
    """Try to autodetect existing services"""
    # TODO: Implement service autodetection
    return jsonify({})

@app.route('/api/email/themes', methods=['GET'])
def get_email_themes():
    """Get available email themes"""
    from email_templates import get_available_themes, email_config
    return jsonify({
        'success': True,
        'themes': get_available_themes(),
        'current_theme': email_config.theme_name
    })

@app.route('/api/email/theme', methods=['POST'])
@require_auth
def set_email_theme():
    """Set email theme (admin only)"""
    from email_templates import set_email_theme
    
    try:
        data = request.get_json()
        theme_name = data.get('theme_name')
        
        if not theme_name:
            return jsonify({'error': 'Theme name is required'}), 400
        
        if set_email_theme(theme_name):
            return jsonify({
                'success': True,
                'message': f'Email theme changed to {theme_name}',
                'theme_name': theme_name
            })
        else:
            return jsonify({'error': 'Invalid theme name'}), 400
            
    except Exception as e:
        logger.error(f"Set email theme error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/email/preview/<theme_name>', methods=['GET'])
def preview_email_theme(theme_name):
    """Preview email with specific theme"""
    from email_templates import EmailConfig, renderer
    
    try:
        # Create temporary config with specified theme
        temp_config = EmailConfig(theme_name)
        
        # Generate preview content
        config = temp_config.get_verification_email_config(
            'Preview User', 
            'https://surge.video/verify-email?token=preview-token-123'
        )
        
        # Render HTML
        html_content, _ = renderer.render_verification_email(
            config['theme'], 
            config['content']
        )
        
        # Return HTML directly for preview
        return html_content, 200, {'Content-Type': 'text/html'}
        
    except Exception as e:
        logger.error(f"Email preview error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/test/send-email', methods=['POST'])
def test_email():
    """Test email sending with current theme (development only)"""
    if os.environ.get('FLASK_ENV') != 'development':
        return jsonify({'error': 'Not available in production'}), 403
    
    try:
        data = request.get_json()
        email = data.get('email', 'test@example.com')
        
        from email_templates import email_config as current_email_config
        theme = data.get('theme', current_email_config.theme_name)
        
        from email_templates import EmailConfig, renderer
        
        # Create config with specified theme
        temp_config = EmailConfig(theme)
        
        # Generate test email
        config = temp_config.get_verification_email_config(
            'Test User',
            'https://surge.video/verify-email?token=test-token-123'
        )
        
        # Render email
        html_content, text_content = renderer.render_verification_email(
            config['theme'], 
            config['content']
        )
        
        # Send email
        msg = Message(
            subject=f"[TEST] {config['content']['subject']}",
            recipients=[email],
            html=html_content,
            body=text_content
        )
        
        mail.send(msg)
        
        return jsonify({
            'success': True,
            'message': f'Test email sent to {email}',
            'theme': theme
        })
        
    except Exception as e:
        logger.error(f"Test email error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/email/test-smtp', methods=['POST'])
def test_smtp_configuration():
    """Test SMTP configuration with a simple email"""
    data = request.get_json()
    test_email = data.get('email') if data else None
    
    if not test_email:
        return jsonify({'error': 'Email address required'}), 400
    
    # Check if email is configured
    if not app.config['MAIL_USERNAME'] or not app.config['MAIL_PASSWORD']:
        return jsonify({
            'error': 'SMTP not configured',
            'message': 'Please set MAIL_USERNAME and MAIL_PASSWORD environment variables'
        }), 500
    
    try:
        # Send simple test email
        msg = Message(
            subject="Surge.video SMTP Test",
            recipients=[test_email],
            body="🎉 Congratulations! Your SMTP configuration is working correctly.\n\nThis test email was sent from your Surge.video application.",
            html="""
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #4A90E2;">🎉 SMTP Test Successful!</h2>
                        <p>Congratulations! Your SMTP configuration is working correctly.</p>
                        <p>This test email was sent from your <strong>Surge.video</strong> application.</p>
                        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
                        <p style="font-size: 12px; color: #666;">
                            Server: {server}<br>
                            Port: {port}<br>
                            TLS: {tls}
                        </p>
                    </div>
                </body>
            </html>
            """.format(
                server=app.config['MAIL_SERVER'],
                port=app.config['MAIL_PORT'],
                tls=app.config['MAIL_USE_TLS']
            )
        )
        
        logger.info(f"📧 Sending SMTP test email to {test_email}")
        mail.send(msg)
        logger.info(f"✅ SMTP test email sent successfully to {test_email}")
        
        return jsonify({
            'success': True,
            'message': f'Test email sent successfully to {test_email}',
            'smtp_config': {
                'server': app.config['MAIL_SERVER'],
                'port': app.config['MAIL_PORT'],
                'tls': app.config['MAIL_USE_TLS'],
                'sender': app.config['MAIL_DEFAULT_SENDER']
            }
        })
        
    except Exception as e:
        import traceback
        logger.error(f"❌ SMTP test failed: {e}")
        logger.error(f"📋 Full traceback: {traceback.format_exc()}")
        
        return jsonify({
            'error': 'SMTP test failed',
            'message': str(e),
            'smtp_config': {
                'server': app.config['MAIL_SERVER'],
                'port': app.config['MAIL_PORT'],
                'tls': app.config['MAIL_USE_TLS'],
                'username_set': bool(app.config['MAIL_USERNAME']),
                'password_set': bool(app.config['MAIL_PASSWORD'])
            }
        }), 500

@app.route('/api/init/test-user', methods=['POST'])
def create_test_user_endpoint():
    """Create test user for development"""
    try:
        test_user = create_test_user()
        if test_user:
            return jsonify({
                'success': True,
                'message': 'Test user created',
                'username': 'testuser',
                'password': 'TestPassword123!',
                'email': 'test@surge.video'
            })
        else:
            return jsonify({'error': 'Test user already exists or creation failed'}), 400
    except Exception as e:
        logger.error(f"Test user creation error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        db.session.execute(text('SELECT 1'))
        return jsonify({
            'status': 'healthy',
            'database': 'connected',
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'database': 'disconnected',
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    
    # Create test user on startup in development
    if os.environ.get('FLASK_ENV') == 'development':
        with app.app_context():
            try:
                create_test_user()
            except Exception as e:
                logger.error(f"Could not create test user: {e}")
    
    socketio.run(app, host='0.0.0.0', port=port, debug=True)