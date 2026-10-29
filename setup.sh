#!/bin/bash
# TerminalSQL — Quick Start Script

echo ""
echo "  ████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗     ███████╗ ██████╗ ██╗     "
echo "     ██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║     ██╔════╝██╔═══██╗██║     "
echo "     ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║     ███████╗██║   ██║██║     "
echo "     ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║     ╚════██║██║▄▄ ██║██║     "
echo "     ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗███████║╚██████╔╝███████╗"
echo "     ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝╚══════╝ ╚══▀▀═╝ ╚══════╝"
echo ""
echo "  SSH · Database · SFTP — all in one web app"
echo ""

set -e

# Check if .env.local exists
if [ ! -f .env.local ]; then
  echo "⚠  .env.local not found. Generating secure keys..."
  JWT_SECRET=$(openssl rand -base64 48)
  ENC_KEY=$(openssl rand -base64 32 | head -c 32)
  cat > .env.local << EOF
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENC_KEY}
PORT=5176
FRONTEND_URL=http://localhost:5175
ALLOWED_ORIGINS=http://localhost:5175,http://localhost:5176,http://localhost:3002
EOF
  echo "✓ .env.local created with generated secrets"
fi

source .env.local 2>/dev/null || true

# Backend
echo ""
echo "🔧 Setting up backend..."
cd backend
[ ! -d node_modules ] && npm install --production --legacy-peer-deps
cd ..

# Frontend
echo ""
echo "🎨 Setting up frontend..."
cd frontend
[ ! -d node_modules ] && npm install --legacy-peer-deps
cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start all servers instantly with one command, run:"
echo "  ./start.sh"
echo ""
echo "Then open: http://localhost:5175"
echo ""
