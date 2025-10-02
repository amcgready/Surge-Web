# Email Configuration Guide for Surge.video

This guide helps you configure SMTP email sending for your Surge.video application.

## Quick Setup

### 1. Environment Variables
Create a `.env` file in your backend directory with your email provider settings:

```bash
# Email Provider Settings
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-app-password
MAIL_DEFAULT_SENDER=noreply@surge.video

# For production, also set:
FLASK_ENV=production
```

### 2. Popular Email Providers

#### Gmail
```bash
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-16-character-app-password
```
**Note**: Use Gmail App Passwords, not your regular password!
Setup: Gmail Settings → Security → 2-Step Verification → App Passwords

#### Outlook/Hotmail
```bash
MAIL_SERVER=smtp-mail.outlook.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-email@outlook.com
MAIL_PASSWORD=your-password
```

#### SendGrid (Recommended for Production)
```bash
MAIL_SERVER=smtp.sendgrid.net
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=apikey
MAIL_PASSWORD=your-sendgrid-api-key
```

#### Amazon SES
```bash
MAIL_SERVER=email-smtp.us-east-1.amazonaws.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-smtp-username
MAIL_PASSWORD=your-smtp-password
```

#### Mailgun
```bash
MAIL_SERVER=smtp.mailgun.org
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-mailgun-smtp-username
MAIL_PASSWORD=your-mailgun-smtp-password
```

### 3. Testing Your Configuration

Once configured, test with:
```bash
curl -X POST http://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "email": "test@yourdomain.com", "password": "TestPassword123!"}'
```

### 4. Production Considerations

- **Use a dedicated email service** (SendGrid, Mailgun, SES) instead of personal email
- **Set up SPF/DKIM records** for better deliverability
- **Use environment variables** for all sensitive data
- **Monitor bounce rates** and email reputation
- **Set up proper from/reply-to addresses**

### 5. Security Best Practices

- Never commit email credentials to git
- Use app passwords when available
- Enable 2FA on email provider accounts
- Regularly rotate SMTP passwords
- Use environment-specific configurations

## Troubleshooting

### Common Issues:
1. **"Authentication failed"** → Check username/password, use app passwords
2. **"Connection refused"** → Check MAIL_SERVER and MAIL_PORT
3. **"TLS errors"** → Verify MAIL_USE_TLS setting
4. **"Rate limiting"** → Use dedicated email service for production
5. **"Emails in spam"** → Configure SPF/DKIM/DMARC records

### Debug Mode:
Set `MAIL_DEBUG=true` in your environment to see detailed SMTP logs.