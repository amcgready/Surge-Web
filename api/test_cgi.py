#!/home/amcgnwgb/virtualenv/surge.video/api/3.9/bin/python3

import cgi
import cgitb
import json
import sys
import os

# Enable CGI error reporting
cgitb.enable()

# Print HTTP headers
print("Content-Type: application/json")
print("Access-Control-Allow-Origin: *")
print()  # Empty line required between headers and content

# Simple test response
response = {
    "status": "cgi_test_working",
    "message": "CGI script is functional",
    "python_version": sys.version,
    "python_executable": sys.executable,
    "current_directory": os.getcwd(),
    "script_name": os.environ.get('SCRIPT_NAME', 'unknown')
}

print(json.dumps(response, indent=2))