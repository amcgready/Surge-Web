#!/bin/bash
# Quick SMTP Setup Script for Surge.video

echo "🚀 Surge.video SMTP Configuration Helper"
echo "========================================"

cd "$(dirname "$0")/backend"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📁 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Please edit the .env file with your email settings:"
    echo "   - Set MAIL_USERNAME to your email address"
    echo "   - Set MAIL_PASSWORD to your email password/app password"
    echo "   - Adjust MAIL_SERVER if not using Gmail"
    echo ""
    echo "💡 For Gmail users:"
    echo "   1. Enable 2-Factor Authentication"
    echo "   2. Generate an App Password: https://support.google.com/accounts/answer/185833"
    echo "   3. Use the App Password (not your regular password)"
    echo ""
else
    echo "📁 .env file already exists"
fi

echo "🔧 Available commands:"
echo ""
echo "1. Test SMTP configuration:"
echo "   python test_smtp.py"
echo ""
echo "2. Start backend with email support:"
echo "   python app.py"
echo ""
echo "3. Test via API:"
echo "   curl -X POST http://localhost:5001/api/email/test-smtp \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"email\": \"your-test-email@example.com\"}'"
echo ""

# Check if virtual environment exists
if [ -d "../.venv" ]; then
    echo "🐍 Virtual environment detected at ../.venv"
    echo "💡 To activate: source ../.venv/bin/activate"
else
    echo "⚠️  No virtual environment found"
    echo "💡 Consider creating one: python -m venv ../.venv"
fi

echo ""
echo "📚 For detailed setup instructions, see: ../EMAIL_SETUP.md"