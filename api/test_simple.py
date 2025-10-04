#!/home/amcgnwgb/virtualenv/surge.video/api/3.9/bin/python3

from flask import Flask, jsonify
import sys
import os

app = Flask(__name__)

@app.route('/health')
def health():
    return jsonify({
        'status': 'simple_test_working',
        'message': 'WSGI configuration successful'
    })

@app.route('/debug')
def debug():
    return jsonify({
        'python_executable': sys.executable,
        'python_version': sys.version,
        'cwd': os.getcwd(),
        'environment': dict(os.environ)
    })

# For WSGI compatibility
application = app

if __name__ == '__main__':
    app.run(debug=True)