#!/usr/bin/env python3
"""
Quick SMTP Server Finder for Domain Emails
Tests common SMTP server patterns for your domain
"""

import smtplib
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
import os

def test_smtp_config(server, port, use_tls, use_ssl, timeout=10):
    """Test a specific SMTP configuration"""
    try:
        if use_ssl:
            smtp = smtplib.SMTP_SSL(server, port, timeout=timeout)
        else:
            smtp = smtplib.SMTP(server, port, timeout=timeout)
            if use_tls:
                smtp.starttls()
        
        smtp.quit()
        return True, f"✅ {server}:{port} ({'TLS' if use_tls else 'SSL' if use_ssl else 'Plain'})"
    except Exception as e:
        return False, f"❌ {server}:{port} - {str(e)[:50]}"

def find_smtp_servers(domain, email=None, password=None):
    """Find working SMTP servers for a domain"""
    print(f"🔍 Testing SMTP servers for domain: {domain}")
    print("=" * 60)
    
    # Common SMTP server patterns
    servers = [
        f"mail.{domain}",
        f"smtp.{domain}",
        f"email.{domain}",
        f"send.{domain}",
        domain,
        f"{domain}",
        # Common hosting providers
        "smtp.gmail.com",  # Gmail Workspace
        "smtp-mail.outlook.com",  # Microsoft 365
        "smtp.secureserver.net",  # GoDaddy
        "mail.privateemail.com",  # Namecheap
        "secure.emailsrvr.com",  # Rackspace
    ]
    
    # Port and security combinations
    configs = []
    for server in servers:
        configs.extend([
            (server, 587, True, False),   # TLS
            (server, 465, False, True),   # SSL
            (server, 25, False, False),   # Plain
            (server, 2525, True, False),  # Alternative TLS
        ])
    
    # Test configurations in parallel
    working_configs = []
    
    print("🧪 Testing configurations (this may take a moment)...")
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_config = {
            executor.submit(test_smtp_config, server, port, use_tls, use_ssl): 
            (server, port, use_tls, use_ssl)
            for server, port, use_tls, use_ssl in configs
        }
        
        for future in as_completed(future_to_config):
            server, port, use_tls, use_ssl = future_to_config[future]
            try:
                success, message = future.result()
                if success:
                    working_configs.append((server, port, use_tls, use_ssl))
                    print(message)
            except Exception as e:
                pass
    
    if working_configs:
        print(f"\n🎉 Found {len(working_configs)} working SMTP configurations!")
        print("\nRecommended configurations:")
        
        for i, (server, port, use_tls, use_ssl) in enumerate(working_configs[:3], 1):
            print(f"\nOption {i}:")
            print(f"MAIL_SERVER={server}")
            print(f"MAIL_PORT={port}")
            print(f"MAIL_USE_TLS={str(use_tls).lower()}")
            print(f"MAIL_USE_SSL={str(use_ssl).lower()}")
            
        # Test authentication if credentials provided
        if email and password:
            print(f"\n🔐 Testing authentication with {email}...")
            for server, port, use_tls, use_ssl in working_configs[:3]:
                try:
                    if use_ssl:
                        smtp = smtplib.SMTP_SSL(server, port, timeout=10)
                    else:
                        smtp = smtplib.SMTP(server, port, timeout=10)
                        if use_tls:
                            smtp.starttls()
                    
                    smtp.login(email, password)
                    smtp.quit()
                    print(f"✅ Authentication successful with {server}:{port}")
                    
                    # Update .env file with working config
                    update_env_file(server, port, use_tls, use_ssl, email, password)
                    return
                    
                except Exception as e:
                    print(f"❌ Authentication failed with {server}:{port} - {e}")
        
    else:
        print("\n😔 No working SMTP configurations found.")
        print("\n💡 This might mean:")
        print("   - Your domain doesn't have SMTP service set up")
        print("   - The SMTP server uses non-standard configuration")
        print("   - Firewall/network restrictions")
        print("\n📞 Contact your hosting provider for SMTP settings")

def update_env_file(server, port, use_tls, use_ssl, email, password):
    """Update .env file with working configuration"""
    env_content = f"""# Surge.video Email Configuration
# Auto-detected working configuration

# === Domain Email Settings ===
MAIL_SERVER={server}
MAIL_PORT={port}
MAIL_USE_TLS={str(use_tls).lower()}
MAIL_USE_SSL={str(use_ssl).lower()}
MAIL_USERNAME={email}
MAIL_PASSWORD={password}
MAIL_DEFAULT_SENDER={email}

# === Optional Settings ===
MAIL_DEBUG=true
FLASK_ENV=development

# === Security ===
SECRET_KEY=surge-secret-key-change-in-production

# === Database (Optional - uses SQLite by default) ===
# DATABASE_URL=postgresql://user:password@localhost:5432/surge_db
"""
    
    with open('.env', 'w') as f:
        f.write(env_content)
    
    print(f"\n✅ Updated .env file with working configuration!")
    print("🚀 You can now start your Flask app and test email sending!")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) >= 2:
        domain = sys.argv[1]
        email = sys.argv[2] if len(sys.argv) > 2 else None
        password = sys.argv[3] if len(sys.argv) > 3 else None
    else:
        domain = input("Enter your domain (e.g., surge.video): ").strip()
        email = input("Enter your email (optional, for auth test): ").strip() or None
        password = input("Enter your password (optional): ").strip() or None
    
    find_smtp_servers(domain, email, password)