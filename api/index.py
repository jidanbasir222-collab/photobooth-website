"""
Vercel Serverless Function Entry Point for Our Little Booth
Routes all incoming HTTP requests to the Flask application instance.
"""

import sys
import os

# Ensure the root project directory is on sys.path so app.py and assets can be resolved
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

# Import the main Flask application instance
from app import app

# Vercel looks for the `app` WSGI callable
# If run directly for local testing
if __name__ == '__main__':
    app.run(debug=True)
