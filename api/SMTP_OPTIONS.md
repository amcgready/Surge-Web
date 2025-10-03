# Common SMTP Server Configurations for Domain Emails

# Try these SMTP servers for surge.video (replace in your .env file):

# Option 1: Standard domain mail server
MAIL_SERVER=mail.surge.video

# Option 2: SMTP prefix
MAIL_SERVER=smtp.surge.video  

# Option 3: If using cPanel hosting
MAIL_SERVER=surge.video

# Option 4: If using shared hosting (common patterns)
MAIL_SERVER=mail.surge.video
MAIL_SERVER=smtp.surge.video
MAIL_SERVER=email.surge.video

# Port Options:
MAIL_PORT=587    # Most common (TLS)
MAIL_PORT=465    # SSL
MAIL_PORT=25     # Plain (not recommended)

# Security Settings:
MAIL_USE_TLS=true   # For port 587
MAIL_USE_SSL=true   # For port 465 (set MAIL_USE_TLS=false)

# If your hosting provider uses specific servers:
# Examples:
# MAIL_SERVER=secure.emailsrvr.com      # Rackspace
# MAIL_SERVER=smtp.secureserver.net     # GoDaddy
# MAIL_SERVER=mail.privateemail.com     # Namecheap PrivateEmail
# MAIL_SERVER=smtp.gmail.com            # Gmail Workspace
# MAIL_SERVER=smtp-mail.outlook.com     # Microsoft 365