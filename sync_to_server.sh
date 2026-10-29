#!/usr/bin/env bash
# ==============================================================================
# TerminalSQL — Production Server Synchronization & Daemon Manager
# Target: root@10.54.68.230 -> /root/dashboard/terminalsql
# Default: Web-Only Sync (Fast & Safe, does not touch backend or DB)
# Usage:
#   ./sync_to_server.sh        -> Sync Web/Frontend only (Default)
#   ./sync_to_server.sh web    -> Sync Web/Frontend only
#   ./sync_to_server.sh all    -> Full Sync (Frontend + Backend + Systemd)
# ==============================================================================

set -euo pipefail

# Text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_HOST="${REMOTE_HOST:-root@10.54.68.230}"
REMOTE_DIR="${REMOTE_DIR:-/root/dashboard/terminalsql}"
SERVICE_NAME="terminalsql"

MODE="${1:-all}"
if [[ "$MODE" == "--all" || "$MODE" == "-a" || "$MODE" == "full" ]]; then
  MODE="all"
elif [[ "$MODE" == "--web" || "$MODE" == "-w" || "$MODE" == "frontend" ]]; then
  MODE="web"
fi

echo -e "${PURPLE}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════════════════════╗"
if [[ "$MODE" == "all" ]]; then
echo "  ║        🚀 TerminalSQL Enterprise — FULL Server & Daemon Deploy       ║"
else
echo "  ║        ⚡ TerminalSQL Enterprise — WEB ONLY Sync (Frontend)          ║"
fi
echo "  ╚══════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ➜ Mode:           ${YELLOW}${BOLD}${MODE^^}${NC}"
echo -e "  ➜ Local Project:  ${CYAN}${LOCAL_DIR}${NC}"
echo -e "  ➜ Target Server:  ${CYAN}${REMOTE_HOST}${NC}"
echo -e "  ➜ Remote Path:    ${CYAN}${REMOTE_DIR}${NC}"
echo ""

# 1. Check SSH Connectivity
echo -e "${YELLOW}🔍 [1/3] Testing SSH connectivity to ${REMOTE_HOST}...${NC}"
if ! ssh -o BatchMode=yes -o ConnectTimeout=6 "$REMOTE_HOST" "echo SSH_CONNECTED" >/dev/null 2>&1; then
  echo -e "${RED}✗ Error: Cannot connect to ${REMOTE_HOST}. Please verify SSH access and credentials.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ SSH connection successful!${NC}"

if [[ "$MODE" == "web" ]]; then
  # 2. Build Frontend Only
  echo -e "${YELLOW}🔨 [2/3] Building production Frontend (Vite)...${NC}"
  cd "$LOCAL_DIR"
  (cd frontend && npm run build)
  echo -e "${GREEN}✓ Frontend bundle compiled successfully in frontend/dist.${NC}"

  # 3. Rsync Frontend dist to Remote Server
  echo -e "${YELLOW}📦 [3/3] Synchronizing frontend/dist to ${REMOTE_HOST}:${REMOTE_DIR}/frontend/dist...${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" "mkdir -p ${REMOTE_DIR}/frontend/dist"
  rsync -avz --delete \
    "${LOCAL_DIR}/frontend/dist/" \
    "${REMOTE_HOST}:${REMOTE_DIR}/frontend/dist/"

  echo -e "${GREEN}✓ Web frontend synchronization complete.${NC}"
  echo -e "${CYAN}ℹ️  Backend database, credentials, and service daemon left completely untouched.${NC}"

else
  # Full Deployment Mode
  echo -e "${YELLOW}🔨 [2/6] Building production bundles (Frontend & Backend)...${NC}"
  cd "$LOCAL_DIR"
  (cd frontend && npm run build) >/dev/null
  (cd backend && npm run build) >/dev/null
  echo -e "${GREEN}✓ Production builds ready.${NC}"

  echo -e "${YELLOW}📦 [3/6] Synchronizing clean codebase to ${REMOTE_DIR}...${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" "mkdir -p ${REMOTE_DIR} ${REMOTE_DIR}/backend/data"

  rsync -avz --delete \
    --exclude="node_modules" \
    --exclude=".git" \
    --exclude=".cache" \
    --exclude=".vite" \
    --exclude="*.log" \
    --exclude="*.pid" \
    --exclude="scratch" \
    --exclude=".gemini" \
    --exclude="*.tsbuildinfo" \
    --exclude="backend/data/*.db" \
    --exclude="backend/data/*.db-journal" \
    --exclude="backend/data/*.db-shm" \
    --exclude="backend/data/*.db-wal" \
    --exclude=".env.local" \
    "${LOCAL_DIR}/" \
    "${REMOTE_HOST}:${REMOTE_DIR}/"

  echo -e "${GREEN}✓ File synchronization complete.${NC}"

  echo -e "${YELLOW}⚙️  [4/6] Verifying backend dependencies on remote server...${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" bash << 'EOF'
set -euo pipefail
cd /root/dashboard/terminalsql/backend
if [ ! -d "node_modules" ] || [ ! -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
  /usr/local/bin/npm install --omit=dev --legacy-peer-deps --no-audit --no-fund
  /usr/local/bin/npm rebuild better-sqlite3
fi
EOF

  echo -e "${YELLOW}🛡️  [5/6] Reloading and restarting service daemon...${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" bash << 'EOF'
set -euo pipefail
systemctl daemon-reload
systemctl restart terminalsql.service
sleep 2
if systemctl is-active --quiet terminalsql.service; then
  echo "✓ Service terminalsql is ACTIVE"
else
  echo "✗ Service terminalsql FAILED to start!"
  journalctl -u terminalsql.service -n 20 --no-pager
  exit 1
fi
EOF

  echo -e "${YELLOW}🩺 [6/6] Verifying API Health on remote server...${NC}"
fi

HEALTH_RESULT=$(ssh -o BatchMode=yes "$REMOTE_HOST" "curl -s http://127.0.0.1:5176/api/health 2>/dev/null || true")

if [[ -z "$HEALTH_RESULT" || "$HEALTH_RESULT" == *"error"* ]]; then
  echo -e "${RED}✗ Warning: Health check failed or returned empty response!${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" "journalctl -u terminalsql.service -n 15 --no-pager"
else
  echo -e "${GREEN}✓ Backend Health Verified: ${HEALTH_RESULT}${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════════${NC}"
echo -e "  ${BOLD}🎉 TerminalSQL sync finished successfully!${NC}"
echo -e "  ➜ Web App URL:      ${CYAN}${BOLD}http://10.54.68.230:5176${NC}"
echo -e "  ➜ API Health:       ${CYAN}${HEALTH_RESULT}${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════════${NC}"
echo ""
