#!/usr/bin/env python3
"""
Domain Email Configuration Helper for Surge.video
Helps detect and configure SMTP settings for custom domains
"""

import os
import socket
import smtplib
import dns.resolver
import sys

def detect_mail_server(domain):
    """Try to detect mail server settings for a domain"""
    print(f"🔍 Detecting mail server for domain: {domain}")
    
    # Common SMTP servers for different providers
    common_configs = {
        'gmail.com': {'server': 'smtp.gmail.com', 'port': 587, 'tls': True},
        'outlook.com': {'server': 'smtp-mail.outlook.com', 'port': 587, 'tls': True},
        'hotmail.com': {'server': 'smtp-mail.outlook.com', 'port': 587, 'tls': True},
        'yahoo.com': {'server': 'smtp.mail.yahoo.com', 'port': 587, 'tls': True},
    }
    
    if domain in common_configs:
        return common_configs[domain]
    
    # Try to find MX records
    try:
        print(f"📡 Looking up MX records for {domain}...")
        mx_records = dns.resolver.resolve(domain, 'MX')
        if mx_records:
            primary_mx = str(mx_records[0].exchange).rstrip('.')
            print(f"📫 Primary MX record: {primary_mx}")
            
            # Common patterns for SMTP servers
            smtp_candidates = [
                f"smtp.{domain}",
                f"mail.{domain}", 
                f"email.{domain}",
                primary_mx.replace('mail.', 'smtp.'),
                primary_mx
            ]
            
            return {'server': smtp_candidates[0], 'port': 587, 'tls': True, 'candidates': smtp_candidates}
    except Exception as e:
        print(f"⚠️  Could not resolve MX records: {e}")
    
    # Fallback
    return {'server': f'mail.{domain}', 'port': 587, 'tls': True}

def test_smtp_server(server, port, use_tls=True):
    """Test if SMTP server is reachable"""
    try:
        print(f"🔌 Testing connection to {server}:{port}...")
        smtp = smtplib.SMTP(server, port, timeout=10)
        if use_tls:
            smtp.starttls()
        smtp.quit()
        print(f"✅ Connection successful!")
        return True
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False

def interactive_config():
    """Interactive configuration helper"""
    print("🎯 Domain Email Configuration Helper")
    print("=" * 50)
    
    # Get domain/email
    email = input("📧 Enter your domain email address (e.g., admin@yourdomain.com): ").strip()
    if not email or '@' not in email:
        print("❌ Invalid email address")
        return
    
    domain = email.split('@')[1]
    print(f"🌐 Domain detected: {domain}")
    
    # Detect settings
    config = detect_mail_server(domain)
    
    print("\n🔧 Suggested SMTP Configuration:")
    print(f"   Server: {config['server']}")
    print(f"   Port: {config['port']}")
    print(f"   TLS: {config['tls']}")
    
    # Test suggested server
    if test_smtp_server(config['server'], config['port'], config['tls']):
        smtp_server = config['server']
        smtp_port = config['port']
        smtp_tls = config['tls']
    else:
        # Try alternatives if available
        if 'candidates' in config:
            print("\n🔄 Trying alternative servers...")
            smtp_server = None
            for candidate in config['candidates']:
                if test_smtp_server(candidate, 587, True):
                    smtp_server = candidate
                    smtp_port = 587
                    smtp_tls = True
                    break
                if test_smtp_server(candidate, 465, False):  # Try SSL
                    smtp_server = candidate
                    smtp_port = 465
                    smtp_tls = False
                    break
        
        if not smtp_server:
            print("⚠️  Automatic detection failed. Please enter manually:")
            smtp_server = input("SMTP Server: ").strip() or f"mail.{domain}"
            smtp_port = int(input("SMTP Port (587/465/25): ").strip() or "587")
            smtp_tls = input("Use TLS? (y/n): ").strip().lower().startswith('y')
    
    # Get password
    password = input(f"🔑 Enter password for {email}: ").strip()
    
    # Generate .env content
    env_content = f"""# Surge.video Email Configuration
# Generated for: {email}

# === Domain Email Settings ===
MAIL_SERVER={smtp_server}
MAIL_PORT={smtp_port}
MAIL_USE_TLS={str(smtp_tls).lower()}
MAIL_USE_SSL=false
MAIL_USERNAME={email}
MAIL_PASSWORD={password}
MAIL_DEFAULT_SENDER={email}

# === Optional Settings ===
MAIL_DEBUG=false
FLASK_ENV=development

# === Security ===
SECRET_KEY=surge-secret-key-change-in-production-{os.urandom(8).hex()}

# === Database (Optional - uses SQLite by default) ===
# DATABASE_URL=postgresql://user:password@localhost:5432/surge_db
"""
    
    # Write to .env file
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    with open(env_path, 'w') as f:
        f.write(env_content)
    
    print(f"\n✅ Configuration saved to: {env_path}")
    print("\n🧪 Testing configuration...")
    
    # Test the configuration
    os.environ.update({
        'MAIL_SERVER': smtp_server,
        'MAIL_PORT': str(smtp_port),
        'MAIL_USE_TLS': str(smtp_tls).lower(),
        'MAIL_USERNAME': email,
        'MAIL_PASSWORD': password
    })
    
    try:
        smtp = smtplib.SMTP(smtp_server, smtp_port)
        if smtp_tls:
            smtp.starttls()
        smtp.login(email, password)
        smtp.quit()
        print("✅ SMTP authentication successful!")
        print("\n🎉 Your domain email is now configured for Surge.video!")
        print("\n🚀 Next steps:")
        print("1. Start your Flask backend: python app.py")
        print("2. Test email sending: python test_smtp.py")
        print("3. Try user registration with email confirmation")
    except Exception as e:
        print(f"❌ SMTP test failed: {e}")
        print("💡 Please check your email and password, or contact your email provider")

if __name__ == "__main__":
    try:
        interactive_config()
    except KeyboardInterrupt:
        print("\n👋 Configuration cancelled")
    except Exception as e:
        print(f"\n❌ Error: {e}")