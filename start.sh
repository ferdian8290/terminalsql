#!/usr/bin/env bash
# TerminalSQL — Universal One-Click Runner
# Starts both Backend (Port 3001) and Frontend (Port 5173) with graceful shutdown

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Text styles
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗     ███████╗ ██████╗ ██╗     "
echo "     ██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║     ██╔════╝██╔═══██╗██║     "
echo "     ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║     ███████╗██║   ██║██║     "
echo "     ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║     ╚════██║██║▄▄ ██║██║     "
echo "     ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗███████║╚██████╔╝███████╗"
echo "     ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝╚══════╝ ╚══▀▀═╝ ╚══════╝"
echo -e "${NC}"
echo -e "  ${BOLD}SSH · Database (SQL) · SFTP · Bastion Tunneling — All in One${NC}"
echo ""

# 1. Environment Secrets Setup
if [ ! -f .env.local ]; then
  echo -e "${YELLOW}⚡ Generating security keys in .env.local...${NC}"
  JWT_SECRET=$(openssl rand -base64 48)
  ENC_KEY=$(openssl rand -base64 32 | head -c 32)
  FRONTEND_PORT=${FRONTEND_PORT:-5175}
  BACKEND_PORT=${PORT:-5176}
  cat > .env.local << EOF
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENC_KEY}
PORT=${BACKEND_PORT}
FRONTEND_URL=http://localhost:${FRONTEND_PORT}
ALLOWED_ORIGINS=http://localhost:${FRONTEND_PORT},http://localhost:${BACKEND_PORT}
EOF
  echo -e "${GREEN}✓ Created .env.local with AES-256 master key${NC}"
fi

export $(grep -v '^#' .env.local | xargs -d '\n') 2>/dev/null || true
BACKEND_PORT=${PORT:-5176}
FRONTEND_PORT=${FRONTEND_PORT:-5175}

# 2. Free stale ports if needed
free_port() {
  local port=$1
  local pids=$(lsof -t -i :$port 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo -e "${YELLOW}Freeing occupied port ${port}...${NC}"
    kill -9 $pids 2>/dev/null || true
    sleep 0.5
  fi
}

free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

# 3. Clean up child processes on exit (Ctrl+C)
cleanup() {
  echo ""
  echo -e "${YELLOW}🛑 Shutting down TerminalSQL dev servers...${NC}"
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  # Wait for processes to exit
  wait 2>/dev/null || true
  echo -e "${GREEN}✓ All services stopped cleanly.${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM

# 4. Start Backend
echo -e "${CYAN}🚀 Starting Backend on http://localhost:${BACKEND_PORT}...${NC}"
(cd backend && npm run dev) &
BACKEND_PID=$!

# Wait for backend to be ready
echo -n "   Waiting for API readiness..."
for i in {1..30}; do
  if curl -s http://localhost:${BACKEND_PORT}/api/health >/dev/null 2>&1; then
    echo -e " ${GREEN}✓ Ready!${NC}"
    break
  fi
  sleep 0.5
  echo -n "."
done

# 5. Start Frontend
echo -e "${CYAN}🎨 Starting Frontend on http://localhost:${FRONTEND_PORT}...${NC}"
(cd frontend && npm run dev -- --host 0.0.0.0 --port "${FRONTEND_PORT}") &
FRONTEND_PID=$!

sleep 1.5

echo ""
echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════${NC}"
echo -e "  ${BOLD}TerminalSQL is running!${NC}"
echo -e "  ➜ Local Web App:   ${CYAN}${BOLD}http://localhost:${FRONTEND_PORT}${NC}"
echo -e "  ➜ Network Access:  ${CYAN}${BOLD}http://$(hostname -I 2>/dev/null | awk '{print $1}'):${FRONTEND_PORT}${NC}"
echo -e "  ➜ Backend API:     ${CYAN}http://localhost:${BACKEND_PORT}/api${NC}"
echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════${NC}"
echo -e "  Press ${BOLD}Ctrl + C${NC} anytime to stop both servers."
echo ""

# Keep running and wait for background jobs
wait $BACKEND_PID $FRONTEND_PID
