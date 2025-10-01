#!/usr/bin/env python3
"""
Database models for Surge Web Installer
Handles user authentication and encrypted data storage
"""

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, text
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import bcrypt
import hashlib
from cryptography.fernet import Fernet
import os
import base64

db = SQLAlchemy()

class EncryptionManager:
    """Handles encryption/decryption of sensitive data"""
    
    def __init__(self, key=None):
        if key:
            self.key = key
        else:
            # Generate key from environment variable or create new one
            key_string = os.environ.get('ENCRYPTION_KEY')
            if key_string:
                self.key = key_string.encode()
            else:
                # Generate a new key (save this to environment!)
                self.key = Fernet.generate_key()
                print(f"Generated new encryption key: {self.key.decode()}")
                print("IMPORTANT: Save this key to ENCRYPTION_KEY environment variable!")
        
        self.cipher_suite = Fernet(self.key)
    
    def encrypt(self, data):
        """Encrypt data and return base64 encoded string"""
        if data is None:
            return None
        encrypted_data = self.cipher_suite.encrypt(data.encode('utf-8'))
        return base64.b64encode(encrypted_data).decode('utf-8')
    
    def decrypt(self, encrypted_data):
        """Decrypt base64 encoded data and return original string"""
        if encrypted_data is None:
            return None
        try:
            decoded_data = base64.b64decode(encrypted_data.encode('utf-8'))
            decrypted_data = self.cipher_suite.decrypt(decoded_data)
            return decrypted_data.decode('utf-8')
        except Exception as e:
            print(f"Decryption error: {e}")
            return None

# Global encryption manager instance
encryption_manager = EncryptionManager()

class User(db.Model):
    """User model with encrypted fields"""
    
    __tablename__ = 'users'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    username_hash = Column(String(64), unique=True, nullable=False, index=True)  # SHA256 hash for lookups
    username_encrypted = Column(Text, nullable=False)  # Encrypted actual username
    email_encrypted = Column(Text, nullable=False)  # Encrypted email
    password_hash = Column(String(128), nullable=False)  # bcrypt hash
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    
    def __init__(self, username, email, password):
        """Create new user with encrypted data"""
        # Hash username for fast lookups (non-reversible)
        self.username_hash = hashlib.sha256(username.lower().encode()).hexdigest()
        
        # Encrypt actual username and email (reversible)
        self.username_encrypted = encryption_manager.encrypt(username)
        self.email_encrypted = encryption_manager.encrypt(email)
        
        # Hash password with bcrypt (non-reversible)
        self.password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        self.created_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()
    
    @property
    def username(self):
        """Decrypt and return username"""
        return encryption_manager.decrypt(self.username_encrypted)
    
    @property
    def email(self):
        """Decrypt and return email"""
        return encryption_manager.decrypt(self.email_encrypted)
    
    def check_password(self, password):
        """Verify password against stored hash"""
        return bcrypt.checkpw(password.encode('utf-8'), self.password_hash.encode('utf-8'))
    
    def update_password(self, new_password):
        """Update password with new hash"""
        self.password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        self.updated_at = datetime.utcnow()
    
    def update_email(self, new_email):
        """Update encrypted email"""
        self.email_encrypted = encryption_manager.encrypt(new_email)
        self.updated_at = datetime.utcnow()
    
    def record_login(self):
        """Record successful login"""
        self.last_login = datetime.utcnow()
        self.login_attempts = 0
        self.locked_until = None
        db.session.commit()
    
    def record_failed_login(self):
        """Record failed login attempt"""
        self.login_attempts += 1
        if self.login_attempts >= 5:
            # Lock account for 30 minutes after 5 failed attempts
            from datetime import timedelta
            self.locked_until = datetime.utcnow() + timedelta(minutes=30)
        db.session.commit()
    
    def is_locked(self):
        """Check if account is locked"""
        if self.locked_until and datetime.utcnow() < self.locked_until:
            return True
        return False
    
    def to_dict(self):
        """Return user data as dictionary (safe for JSON)"""
        return {
            'id': self.id,
            'username': self.username,  # This will be decrypted
            'email': self.email,  # This will be decrypted
            'created_at': self.created_at.isoformat(),
            'last_login': self.last_login.isoformat() if self.last_login else None,
            'is_active': self.is_active
        }
    
    @staticmethod
    def find_by_username(username):
        """Find user by username (using hash for lookup)"""
        username_hash = hashlib.sha256(username.lower().encode()).hexdigest()
        return User.query.filter_by(username_hash=username_hash).first()
    
    @staticmethod
    def find_by_email(email):
        """Find user by email (requires decrypting all emails - use sparingly)"""
        # Note: This is inefficient for large datasets
        # In production, consider adding email hash for lookups
        users = User.query.all()
        for user in users:
            if user.email and user.email.lower() == email.lower():
                return user
        return None
    
    def __repr__(self):
        return f'<User {self.id}: {self.username}>'

class UserSession(db.Model):
    """User session tracking"""
    
    __tablename__ = 'user_sessions'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, db.ForeignKey('users.id'), nullable=False)
    session_token = Column(String(128), unique=True, nullable=False, index=True)
    daemon_token = Column(String(128), unique=True, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    last_activity = Column(DateTime, default=datetime.utcnow)
    ip_address = Column(String(45), nullable=True)  # IPv6 compatible
    user_agent = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    
    user = db.relationship('User', backref=db.backref('sessions', lazy=True))
    
    def __init__(self, user_id, session_token, expires_at, ip_address=None, user_agent=None):
        self.user_id = user_id
        self.session_token = session_token
        self.expires_at = expires_at
        self.ip_address = ip_address
        self.user_agent = user_agent
        self.created_at = datetime.utcnow()
        self.last_activity = datetime.utcnow()
    
    def is_expired(self):
        """Check if session is expired"""
        return datetime.utcnow() > self.expires_at
    
    def update_activity(self):
        """Update last activity timestamp"""
        self.last_activity = datetime.utcnow()
    
    def deactivate(self):
        """Deactivate session"""
        self.is_active = False
    
    @staticmethod
    def find_active_session(session_token):
        """Find active, non-expired session"""
        session = UserSession.query.filter_by(
            session_token=session_token, 
            is_active=True
        ).first()
        
        if session and not session.is_expired():
            session.update_activity()
            db.session.commit()
            return session
        elif session:
            # Session expired, deactivate it
            session.deactivate()
            db.session.commit()
        
        return None

class DeploymentLog(db.Model):
    """Log deployment activities"""
    
    __tablename__ = 'deployment_logs'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, db.ForeignKey('users.id'), nullable=False)
    deployment_id = Column(String(36), nullable=False, index=True)  # UUID
    action = Column(String(50), nullable=False)  # 'started', 'progress', 'completed', 'failed'
    service_name = Column(String(50), nullable=True)
    message = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    ip_address = Column(String(45), nullable=True)
    
    user = db.relationship('User', backref=db.backref('deployments', lazy=True))
    
    def __init__(self, user_id, deployment_id, action, service_name=None, message=None, ip_address=None):
        self.user_id = user_id
        self.deployment_id = deployment_id
        self.action = action
        self.service_name = service_name
        self.message = message
        self.ip_address = ip_address
        self.timestamp = datetime.utcnow()

def init_database(app):
    """Initialize database with Flask app"""
    db.init_app(app)
    
    with app.app_context():
        # Create all tables
        db.create_all()
        
        # Create indexes for better performance using modern SQLAlchemy syntax
        with db.engine.connect() as connection:
            connection.execute(text('CREATE INDEX IF NOT EXISTS idx_users_username_hash ON users(username_hash);'))
            connection.execute(text('CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token);'))
            connection.execute(text('CREATE INDEX IF NOT EXISTS idx_sessions_daemon_token ON user_sessions(daemon_token);'))
            connection.execute(text('CREATE INDEX IF NOT EXISTS idx_deployments_user_id ON deployment_logs(user_id);'))
            connection.execute(text('CREATE INDEX IF NOT EXISTS idx_deployments_deployment_id ON deployment_logs(deployment_id);'))
            connection.commit()
        
        print("Database initialized successfully!")

def create_test_user():
    """Create a test user for development"""
    try:
        # Check if test user already exists
        existing_user = User.find_by_username('testuser')
        if existing_user:
            print("Test user already exists")
            return existing_user
        
        # Create new test user
        test_user = User(
            username='testuser',
            email='test@surge.video',
            password='TestPassword123!'
        )
        
        db.session.add(test_user)
        db.session.commit()
        
        print("Test user created successfully!")
        print(f"Username: testuser")
        print(f"Email: test@surge.video")
        print(f"Password: TestPassword123!")
        
        return test_user
        
    except Exception as e:
        db.session.rollback()
        print(f"Error creating test user: {e}")
        return None