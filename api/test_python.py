#!/home/amcgnwgb/virtualenv/surge.video/api/3.9/bin/python3

print("Content-Type: text/plain")
print()
print("Python environment test")

try:
    import sys
    print(f"Python version: {sys.version}")
    print(f"Python executable: {sys.executable}")
    
    import os
    print(f"Current directory: {os.getcwd()}")
    
    # Test if we can import Flask
    try:
        import flask
        print(f"Flask version: {flask.__version__}")
    except ImportError as e:
        print(f"Flask import error: {e}")
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()