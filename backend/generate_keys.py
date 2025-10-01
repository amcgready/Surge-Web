#!/usr/bin/env python3
"""
Generate encryption key for Surge Web Installer
Run this to generate a secure encryption key for your .env file
"""

from cryptography.fernet import Fernet
import secrets
import string

def generate_encryption_key():
    """Generate a Fernet encryption key"""
    key = Fernet.generate_key()
    return key.decode()

def generate_secret_key(length=32):
    """Generate a random secret key for Flask"""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()_+-="
    return ''.join(secrets.choice(alphabet) for i in range(length))

def generate_password(length=16):
    """Generate a secure random password"""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(secrets.choice(alphabet) for i in range(length))

if __name__ == '__main__':
    print("🔐 Surge Web Installer - Security Key Generator")
    print("=" * 50)
    print()
    
    print("1. ENCRYPTION_KEY (for database field encryption):")
    encryption_key = generate_encryption_key()
    print(f"   {encryption_key}")
    print()
    
    print("2. SECRET_KEY (for Flask sessions and JWT):")
    secret_key = generate_secret_key()
    print(f"   {secret_key}")
    print()
    
    print("3. DB_PASSWORD (for PostgreSQL database):")
    db_password = generate_password()
    print(f"   {db_password}")
    print()
    
    print("🚨 IMPORTANT SECURITY NOTES:")
    print("- Save these keys in your .env file")
    print("- NEVER commit these keys to version control")
    print("- Use different keys for production vs development")
    print("- Back up these keys securely")
    print("- If you lose the ENCRYPTION_KEY, encrypted data cannot be recovered")
    print()
    
    print("📝 Add these to your .env file:")
    print(f"ENCRYPTION_KEY={encryption_key}")
    print(f"SECRET_KEY={secret_key}")
    print(f"DB_PASSWORD={db_password}")
    print()
    
    print("✅ Keys generated successfully!")