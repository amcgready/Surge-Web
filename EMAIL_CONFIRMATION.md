# Email Confirmation Setup Guide

## Overview
The Surge Web Installer now includes email confirmation for user registration. Users must verify their email address before they can log in and access the installer.

## Email Configuration

### Environment Variables
Add these variables to your `.env` file:

```bash
# Email Configuration
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USERNAME=your-email@gmail.com
MAIL_PASSWORD=your-app-password  # Use App Password for Gmail
MAIL_DEFAULT_SENDER=noreply@surge.video
```

### Gmail Setup
1. Enable 2-factor authentication on your Google account
2. Generate an App Password:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate a new app password for "Surge Web Installer"
3. Use the generated password (not your regular password) as `MAIL_PASSWORD`

### Other Email Providers
Update `MAIL_SERVER` and `MAIL_PORT` for your provider:
- **Outlook/Hotmail**: `smtp.live.com:587`
- **Yahoo**: `smtp.mail.yahoo.com:587`
- **Custom SMTP**: Your server details

## User Flow

### Registration Process
1. User visits the site and clicks "Register"
2. User enters username, email, and password
3. Account is created but remains **unverified**
4. Verification email is sent to the user's email address
5. User clicks the verification link in their email
6. Account is marked as **verified**
7. User can now log in normally

### Email Verification
- Verification tokens expire after **24 hours**
- Users can request a new verification email if needed
- Unverified users cannot log in

## Development & Testing

### Test User
A test user is automatically created in development mode:
- **Username**: `testuser`
- **Password**: `TestPassword123!`
- **Email**: `test@surge.video`
- **Status**: Pre-verified (no email confirmation needed)

### Email Testing
In development mode, you can test email sending:
```bash
curl -X POST http://localhost:5001/api/test/send-email \
  -H "Content-Type: application/json" \
  -d '{"email": "your-test@example.com"}'
```

### Disable Email for Development
To disable email verification during development, you can modify the registration endpoint to auto-verify users by setting `is_email_verified = True` immediately after user creation.

## Production Deployment

### SSL/HTTPS Required
- Verification links use HTTPS in production
- Set `FLASK_ENV=production` to generate HTTPS links
- Ensure your domain has valid SSL certificates

### Email Deliverability
1. **SPF Record**: Add SPF record for your sending domain
2. **DKIM**: Configure DKIM signing if supported
3. **From Address**: Use a domain you control (e.g., `noreply@yourdomain.com`)
4. **Rate Limiting**: Monitor email sending rates to avoid spam flags

### Monitoring
- Check application logs for email sending errors
- Monitor bounce rates and delivery failures
- Set up alerts for high failure rates

## Troubleshooting

### Common Issues

**Email not sending:**
```bash
# Check logs
docker-compose logs webui-backend

# Test email configuration
curl -X POST http://localhost:5001/api/test/send-email
```

**Gmail "Less secure apps" error:**
- Use App Passwords instead of your regular password
- Ensure 2FA is enabled on your Google account

**Verification link not working:**
- Check if token is expired (24 hour limit)
- Ensure HTTPS is configured in production
- Check for URL encoding issues

**Users not receiving emails:**
- Check spam/junk folders
- Verify email address is correct
- Test with different email providers

### Database Migration
If upgrading from a version without email verification:
```sql
-- Add new columns to existing users table
ALTER TABLE users ADD COLUMN is_email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN email_verification_token VARCHAR(128) UNIQUE;
ALTER TABLE users ADD COLUMN email_verification_expires TIMESTAMP;

-- Verify existing users (optional)
UPDATE users SET is_email_verified = TRUE WHERE created_at < NOW();
```

## Security Considerations

### Token Security
- Tokens are cryptographically secure (64 bytes, URL-safe)
- Tokens are single-use and expire after 24 hours
- Tokens are invalidated after successful verification

### Rate Limiting
Consider implementing rate limiting for:
- Registration attempts
- Email resend requests
- Verification attempts

### Privacy
- Email addresses are encrypted in the database
- Verification emails don't reveal if an email exists in the system
- Failed verification attempts are logged for monitoring

## API Endpoints

### Registration
```bash
POST /api/auth/register
{
  "username": "newuser",
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### Email Verification
```bash
POST /api/auth/verify-email
{
  "token": "verification-token-from-email"
}
```

### Resend Verification
```bash
POST /api/auth/resend-verification
{
  "email": "user@example.com"
}
```

### Login (requires verified email)
```bash
POST /api/auth/login
{
  "username": "newuser",
  "password": "SecurePass123!"
}
```

This completes the email confirmation implementation for the Surge Web Installer!