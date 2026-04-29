#!/bin/bash

echo "=== Auto-QA Pre-flight Validation ==="

# 1. Check if we are in a Node.js project
if[ ! -f "package.json" ]; then
  echo "❌ ERROR: package.json not found in the current directory."
  echo "Action Required: Please navigate to the root of a Node.js project."
  exit 1
fi
echo "✅ package.json found."

# 2. Check Node & NPM versions
if ! command -v node &> /dev/null; then
  echo "❌ ERROR: Node.js is not installed."
  exit 1
fi
echo "✅ Node.js is installed ($(node -v))."

if ! command -v npm &> /dev/null; then
  echo "❌ ERROR: npm is not installed."
  exit 1
fi
echo "✅ NPM is installed ($(npm -v))."

# 3. Check for zombie processes on common ports (3000, 5173, 8080)
for port in 3000 5173 8080; do
  pid=$(lsof -ti :$port)
  if[ ! -z "$pid" ]; then
    echo "⚠️ WARNING: Port $port is already in use by PID $pid."
    echo "Action Recommended: Run 'kill -9 $pid' if this is a zombie process before starting QA."
  fi
done

echo "=== Validation Complete ==="
exit 0