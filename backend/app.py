#!/usr/bin/env python3
"""
Surge WebUI Backend with WebSocket support for local daemon communication
"""

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from flask_socketio import SocketIO, emit, disconnect, join_room, leave_room
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

# Import database models
from models import db, init_database, User, UserSession, DeploymentLog, create_test_user

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Database Configuration
database_url = os.environ.get('DATABASE_URL')
if not database_url:
    # Default PostgreSQL configuration
    db_user = os.environ.get('DB_USER', 'surge_user')
    db_password = os.environ.get('DB_PASSWORD', 'surge_password')
    db_host = os.environ.get('DB_HOST', 'localhost')
    db_port = os.environ.get('DB_PORT', '5432')
    db_name = os.environ.get('DB_NAME', 'surge_db')
    database_url = f'postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}'

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'surge-secret-key-change-in-production')
app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

CORS(app, origins=["http://localhost:3000", "http://localhost:3100"])

# Initialize database
init_database(app)

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins=["http://localhost:3000", "http://localhost:3100"])

# In-memory storage for connected clients (use Redis in production)
connected_clients = {}

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
        
        # Create new user
        new_user = User(
            username=username,
            email=email,
            password=password
        )
        
        db.session.add(new_user)
        db.session.commit()
        
        logger.info(f"New user registered: {username} from {request.remote_addr}")
        
        return jsonify({
            'success': True,
            'message': 'User registered successfully',
            'user_id': new_user.id
        })
        
    except Exception as e:
        logger.error(f"Registration error: {e}")
        db.session.rollback()
        return jsonify({'error': 'Registration failed. Please try again.'}), 500

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