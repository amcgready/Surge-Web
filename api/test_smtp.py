#!/usr/bin/env python3
"""
SMTP Configuration Test Script for Surge.video
Tests your email settings before using them in production.
"""

import os
import sys
from flask import Flask
from flask_mail import Mail, Message
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib

def test_smtp_connection():
    """Test basic SMTP connection"""
    print("🔧 Testing SMTP Configuration...")
    print("=" * 50)
    
    # Get configuration from environment
    mail_server = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
    mail_port = int(os.environ.get('MAIL_PORT', '587'))
    mail_use_tls = os.environ.get('MAIL_USE_TLS', 'true').lower() in ['true', 'on', '1']
    mail_use_ssl = os.environ.get('MAIL_USE_SSL', 'false').lower() in ['true', 'on', '1']
    mail_username = os.environ.get('MAIL_USERNAME')
    mail_password = os.environ.get('MAIL_PASSWORD')
    
    print(f"📧 Mail Server: {mail_server}")
    print(f"🔌 Port: {mail_port}")
    print(f"🔒 TLS: {mail_use_tls}")
    print(f"🔐 SSL: {mail_use_ssl}")
    print(f"👤 Username: {mail_username}")
    print(f"🔑 Password: {'*' * len(mail_password) if mail_password else 'Not set'}")
    print()
    
    if not mail_username or not mail_password:
        print("❌ ERROR: MAIL_USERNAME and MAIL_PASSWORD must be set!")
        print("💡 Set these environment variables and try again.")
        return False
    
    try:
        # Test SMTP connection with proper SSL/TLS handling
        print("🔄 Connecting to SMTP server...")
        
        if mail_use_ssl:
            print("🔒 Using SSL connection...")
            server = smtplib.SMTP_SSL(mail_server, mail_port)
        else:
            server = smtplib.SMTP(mail_server, mail_port)
            if mail_use_tls:
                print("🔒 Starting TLS...")
                server.starttls()
        
        print("🔐 Authenticating...")
        server.login(mail_username, mail_password)
        
        print("✅ SMTP connection successful!")
        server.quit()
        return True
        
    except smtplib.SMTPAuthenticationError as e:
        print(f"❌ Authentication failed: {e}")
        print("💡 Check your username and password. For Gmail, use App Passwords!")
        return False
    except smtplib.SMTPConnectError as e:
        print(f"❌ Connection failed: {e}")
        print("💡 Check your MAIL_SERVER and MAIL_PORT settings.")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def test_flask_mail():
    """Test Flask-Mail integration"""
    print("\n🧪 Testing Flask-Mail Integration...")
    print("=" * 50)
    
    try:
        # Create Flask app with mail config
        app = Flask(__name__)
        app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
        app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', '587'))
        app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'true').lower() in ['true', 'on', '1']
        app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
        app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
        app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER', 'noreply@surge.video')
        
        mail = Mail(app)
        
        with app.app_context():
            # Create test message
            msg = Message(
                subject="Surge.video SMTP Test",
                recipients=[os.environ.get('MAIL_USERNAME')],  # Send to self for testing
                body="This is a test email from your Surge.video SMTP configuration!"
            )
            
            print("📧 Sending test email...")
            mail.send(msg)
            print("✅ Test email sent successfully!")
            print(f"📬 Check your inbox at: {os.environ.get('MAIL_USERNAME')}")
            
        return True
        
    except Exception as e:
        print(f"❌ Flask-Mail test failed: {e}")
        return False

def main():
    print("🚀 Surge.video SMTP Configuration Tester")
    print("=" * 50)
    
    # Load environment variables from .env file if it exists
    env_file = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(env_file):
        print(f"📁 Loading environment from: {env_file}")
        with open(env_file, 'r') as f:
            for line in f:
                if line.strip() and not line.startswith('#'):
                    key, value = line.strip().split('=', 1)
                    os.environ[key] = value
        print("✅ Environment loaded")
    else:
        print("⚠️  No .env file found, using system environment variables")
    
    print()
    
    # Run tests
    smtp_ok = test_smtp_connection()
    
    if smtp_ok:
        flask_ok = test_flask_mail()
        
        if flask_ok:
            print("\n🎉 All tests passed! Your SMTP configuration is working correctly.")
            print("💡 You can now use email confirmation in your Surge.video app.")
        else:
            print("\n⚠️  SMTP works but Flask-Mail integration failed.")
    else:
        print("\n❌ SMTP configuration failed. Please fix the issues above.")
    
    print("\n" + "=" * 50)

if __name__ == "__main__":
    main()