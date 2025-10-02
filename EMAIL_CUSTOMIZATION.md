# 🎨 Email Template Customization Guide

## Overview

The Surge Web Installer now includes a fully customizable email template system with multiple themes, responsive design, and extensive personalization options.

## ✨ Features

### 🎯 **Professional Design**
- Modern, responsive HTML templates
- Dark mode support for email clients that support it
- Mobile-optimized layout
- Professional branding elements

### 🌈 **Multiple Themes**
- **Default**: Clean, modern blue theme with feature showcase
- **Dark**: Dark mode with subtle gradients
- **Minimal**: Clean, simple design without extra elements
- **Colorful**: Bright, vibrant colors with rainbow accents  
- **Professional**: Corporate-friendly muted color scheme

### 📱 **Responsive & Accessible**
- Works perfectly on mobile devices
- Fallback text version for all email clients
- High contrast and readable fonts
- Screen reader friendly

### ⚡ **Easy Customization**
- Simple configuration file approach
- No HTML/CSS knowledge required
- Environment-based theme switching
- Live preview system for development

## 🎨 Customizing Your Emails

### Quick Theme Change

Set your desired theme in the `.env` file:
```bash
EMAIL_THEME=colorful  # Options: default, dark, minimal, colorful, professional
```

### Custom Branding

Edit `backend/email_config.py` to customize:

```python
# Your Branding
PRIMARY_COLOR = "#ff6b6b"          # Main brand color
SECONDARY_COLOR = "#4ecdc4"        # Secondary brand color  
LOGO_TEXT = "🚀"                   # Logo emoji/text in circle
COMPANY_NAME = "Your Company"      # Company name

# Email Header
HEADER_TITLE = "Welcome to YourApp!"
HEADER_SUBTITLE = "Your tagline here"

# Welcome Message
WELCOME_MESSAGE = """Your custom welcome message here. 
Make it personal and explain what happens next."""

# Call-to-Action
CTA_TEXT = "Activate Account"
CTA_SUBTITLE = "Click to get started"

# Footer Links
WEBSITE_URL = "https://yoursite.com"
DOCS_URL = "https://yoursite.com/docs"
SUPPORT_URL = "https://yoursite.com/support"
```

## 🖼️ Email Preview System

### Preview in Browser
Visit these URLs during development to see your emails:

```bash
# List all available themes
GET http://localhost:5001/api/preview/email-themes

# Preview specific theme
GET http://localhost:5001/api/preview/email?theme=default
GET http://localhost:5001/api/preview/email?theme=dark
GET http://localhost:5001/api/preview/email?theme=colorful
```

### Live Preview
1. Start your development server
2. Visit `http://localhost:5001/api/preview/email?theme=THEME_NAME`
3. Make changes to `email_config.py`
4. Refresh to see updates instantly

## 🎭 Creating Custom Themes

### Method 1: Configuration Override
Add a new theme to `email_config.py`:

```python
# Cyberpunk Theme
CYBERPUNK_THEME = {
    'PRIMARY_COLOR': "#ff00ff",
    'SECONDARY_COLOR': "#00ffff", 
    'LOGO_TEXT': "⚡",
    'HEADER_TITLE': "Welcome to the Grid 🌐",
    'HEADER_SUBTITLE': "Jacking into the matrix...",
    'COMPANY_ADDRESS': "Broadcasting from Neo-Tokyo"
}
```

Then update the `get_email_theme()` function in `app.py`:

```python
def get_email_theme():
    theme_name = os.environ.get('EMAIL_THEME', 'default')
    
    if theme_name == 'cyberpunk':
        return email_config.CYBERPUNK_THEME
    # ... existing themes
```

### Method 2: Environment Variables
Override individual elements via environment:

```bash
# In .env or docker-compose.yml
EMAIL_THEME=custom
EMAIL_PRIMARY_COLOR=#ff6b6b
EMAIL_SECONDARY_COLOR=#4ecdc4
EMAIL_HEADER_TITLE=My Custom Title
EMAIL_LOGO_TEXT=💫
```

## 📧 Email Template Structure

### HTML Template Components
The email template includes these customizable sections:

1. **Header**: Logo, title, subtitle with gradient background
2. **Greeting**: Personalized welcome message
3. **Features Grid**: 4 feature cards (optional)
4. **Call-to-Action**: Large verification button
5. **Security Notice**: Important security information
6. **Footer**: Links, contact info, legal text

### Template Variables
Available in both HTML and text templates:

```python
{
    'username': 'User Name',
    'verification_url': 'https://...',
    'primary_color': '#2196F3',
    'secondary_color': '#1976D2',
    'logo_text': 'S',
    'header_title': 'Welcome!',
    'header_subtitle': 'Tagline',
    'welcome_message': 'Custom message...',
    'cta_text': 'Button text',
    'cta_subtitle': 'Button description', 
    'security_message': 'Security note...',
    'footer_message': 'Footer text',
    'company_name': 'Company',
    'company_address': 'Address',
    'show_features': True,
    'show_social_links': True,
    'website_url': 'https://...',
    'docs_url': 'https://...',
    'support_url': 'https://...',
    'current_year': 2025
}
```

## 🔧 Advanced Customization

### Custom HTML Template
1. Copy `backend/templates/email/verification.html`
2. Modify the HTML structure
3. Update CSS styles in the `<style>` section
4. Test with preview endpoint

### Custom CSS Framework
Replace the embedded CSS with your preferred framework:

```html
<!-- In verification.html -->
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
```

### Dynamic Content
Add dynamic content based on user data:

```python
# In send_email_verification function
template_vars.update({
    'user_timezone': user.timezone,
    'user_country': user.country,
    'registration_date': user.created_at.strftime('%B %d, %Y')
})
```

### Multilingual Support
Create language-specific templates:

```
templates/email/
├── verification.html
├── verification.txt  
├── verification_es.html  # Spanish
├── verification_fr.html  # French
└── verification_de.html  # German
```

## 🧪 Testing Your Customizations

### 1. Visual Testing
```bash
# Preview all themes
curl http://localhost:5001/api/preview/email-themes

# Preview specific theme  
curl http://localhost:5001/api/preview/email?theme=colorful
```

### 2. Email Client Testing
Test in multiple email clients:
- Gmail (web and mobile)
- Outlook (desktop and web)  
- Apple Mail
- Thunderbird
- Yahoo Mail

### 3. Automated Testing
Add to your test suite:

```python
def test_email_themes():
    themes = ['default', 'dark', 'minimal', 'colorful', 'professional']
    for theme in themes:
        response = client.get(f'/api/preview/email?theme={theme}')
        assert response.status_code == 200
        assert 'Welcome' in response.data.decode()
```

## 🚀 Production Deployment

### Environment Variables
Set in production environment:

```bash
# Production email settings
EMAIL_THEME=professional
MAIL_SERVER=smtp.yourprovider.com
MAIL_USERNAME=noreply@yourdomain.com
MAIL_PASSWORD=your-smtp-password
MAIL_DEFAULT_SENDER=noreply@yourdomain.com

# Custom branding (optional)
EMAIL_PRIMARY_COLOR=#your-brand-color
EMAIL_HEADER_TITLE=Your Product Name
EMAIL_COMPANY_NAME=Your Company Inc.
```

### Performance Considerations
- Email templates are rendered on each send
- For high-volume sending, consider template caching
- Use CDN for any external assets (fonts, images)
- Test email deliverability with your chosen SMTP provider

## 💡 Best Practices

### Design Guidelines
✅ **Do:**
- Keep primary content within 600px width
- Use web-safe fonts (Arial, Helvetica, etc.)
- Include alt text for images
- Test in both light and dark modes
- Provide clear call-to-action buttons
- Include plain text version

❌ **Don't:**
- Use complex CSS layouts
- Rely on external images for critical content
- Use JavaScript or interactive elements
- Make text too small (minimum 14px)
- Use low-contrast color combinations

### Email Deliverability
- Set up SPF, DKIM, and DMARC records
- Use a consistent sender name and email
- Include clear unsubscribe links (for marketing emails)
- Monitor bounce rates and spam complaints
- Test subject lines for spam triggers

## 📞 Support

Need help with email customization?
- Check the preview endpoints for visual testing
- Review the email_config.py file for all options
- Test with different EMAIL_THEME values
- Use the development email preview system

Your verification emails are now fully customizable and professional! 🎉