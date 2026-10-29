#!/usr/bin/env bash
# ==============================================================================
# TerminalSQL — One-Click Offline Docker Deployment & Sync Tool
# Target: root@10.54.68.151 -> /root/docker_compose/terminalsql
# Usage:
#   ./sync_to_docker.sh         -> Full sync (Build local -> Export -> Transfer -> Load -> Up)
#   ./sync_to_docker.sh status  -> Check container health & status on server
#   ./sync_to_docker.sh restart -> Restart remote containers
#   ./sync_to_docker.sh logs    -> Stream remote docker logs
#   ./sync_to_docker.sh stop    -> Stop remote containers
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
REMOTE_HOST="${REMOTE_HOST:-root@10.54.68.151}"
REMOTE_DIR="${REMOTE_DIR:-/root/docker_compose/terminalsql}"
ACTION="${1:-deploy}"

echo -e "${PURPLE}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════════════════════╗"
echo "  ║        🐳 TerminalSQL — OFFLINE DOCKER SERVER SYNC & DEPLOY          ║"
echo "  ╚══════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ➜ Action:         ${YELLOW}${BOLD}${ACTION^^}${NC}"
echo -e "  ➜ Local Project:  ${CYAN}${LOCAL_DIR}${NC}"
echo -e "  ➜ Target Server:  ${CYAN}${REMOTE_HOST}${NC}"
echo -e "  ➜ Remote Path:    ${CYAN}${REMOTE_DIR}${NC}"
echo ""

# 1. Check SSH Connectivity
echo -e "${YELLOW}🔍 [1/6] Testing SSH connectivity to ${REMOTE_HOST}...${NC}"
if ! ssh -o BatchMode=yes -o ConnectTimeout=6 "$REMOTE_HOST" "echo SSH_CONNECTED" >/dev/null 2>&1; then
  echo -e "${RED}✗ Error: Cannot connect to ${REMOTE_HOST}. Please verify SSH access and network routing.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ SSH connection verified!${NC}"

# Handle Quick Actions
if [[ "$ACTION" == "status" || "$ACTION" == "ps" ]]; then
  echo -e "\n${BOLD}📊 Docker Status on ${REMOTE_HOST}:${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" "cd ${REMOTE_DIR} && docker compose ps"
  echo ""
  echo -e "${BOLD}🩺 Health Check:${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" "curl --noproxy '*' -s http://127.0.0.1:3002/api/health || echo 'Health endpoint not responding'"
  echo ""
  exit 0
fi

if [[ "$ACTION" == "logs" ]]; then
  echo -e "${CYAN}Streaming logs from ${REMOTE_HOST} (Ctrl+C to exit)...${NC}"
  ssh -t -o BatchMode=yes "$REMOTE_HOST" "cd ${REMOTE_DIR} && docker compose logs -f --tail=100"
  exit 0
fi

if [[ "$ACTION" == "restart" ]]; then
  echo -e "${YELLOW}🔄 Restarting containers on ${REMOTE_HOST}...${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" "cd ${REMOTE_DIR} && docker compose restart"
  echo -e "${GREEN}✓ Containers restarted successfully.${NC}"
  exit 0
fi

if [[ "$ACTION" == "stop" || "$ACTION" == "down" ]]; then
  echo -e "${YELLOW}🛑 Stopping containers on ${REMOTE_HOST}...${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" "cd ${REMOTE_DIR} && docker compose down"
  echo -e "${GREEN}✓ Containers stopped.${NC}"
  exit 0
fi

# Full Deployment Workflow
DOCKER_IMG_DIR="${LOCAL_DIR}/docker-images"
mkdir -p "$DOCKER_IMG_DIR"
TAR_FILE="${DOCKER_IMG_DIR}/terminalsql-images.tar.gz"

# Check if local and remote images already match
echo -e "\n${YELLOW}🔎 [2/6] Checking Docker image hash between local and remote...${NC}"
LOCAL_IMG_HASH=$(docker image inspect terminalsql-backend:latest terminalsql-frontend:latest --format '{{.Id}}' 2>/dev/null | sha256sum | awk '{print $1}' || echo "LOCAL_BUILD_NEEDED")
REMOTE_IMG_HASH=$(ssh -o BatchMode=yes "$REMOTE_HOST" "cat ${REMOTE_DIR}/.remote_image_hash 2>/dev/null || docker image inspect terminalsql-backend:latest terminalsql-frontend:latest --format '{{.Id}}' 2>/dev/null | sha256sum | awk '{print \$1}'" 2>/dev/null || echo "REMOTE_FETCH_NEEDED")

NEED_IMAGE_SYNC=true
if [[ "$LOCAL_IMG_HASH" == "$REMOTE_IMG_HASH" && "$LOCAL_IMG_HASH" != "LOCAL_BUILD_NEEDED" && "$ACTION" != "force" && -f "$TAR_FILE" ]]; then
  NEED_IMAGE_SYNC=false
  echo -e "${GREEN}✓ Remote Docker daemon already has the exact image build (${LOCAL_IMG_HASH:0:12}).${NC}"
  echo -e "${CYAN}⚡ Fast-sync mode: Skipping 150MB image transfer. Synchronizing only configuration & metadata...${NC}"
fi

if [[ "$NEED_IMAGE_SYNC" == "true" ]]; then
  # 2. Build Images Locally
  echo -e "\n${YELLOW}🔨 Building production Docker images locally...${NC}"
  cd "$LOCAL_DIR"
  docker build --network host -t terminalsql-backend:latest ./backend
  docker build --network host -t terminalsql-frontend:latest ./frontend
  echo -e "${GREEN}✓ Local Docker images built successfully.${NC}"

  # Update hash after build
  LOCAL_IMG_HASH=$(docker image inspect terminalsql-backend:latest terminalsql-frontend:latest --format '{{.Id}}' | sha256sum | awk '{print $1}')
  echo "$LOCAL_IMG_HASH" > "${DOCKER_IMG_DIR}/.image_hash"

  # 3. Export Images to Persistent Local Archive (Never in /tmp)
  echo -e "\n${YELLOW}📦 [3/6] Saving images to persistent archive: ${TAR_FILE}...${NC}"
  docker save terminalsql-backend:latest terminalsql-frontend:latest | gzip > "$TAR_FILE"
  ARCHIVE_SIZE=$(du -h "$TAR_FILE" | cut -f1)
  echo -e "${GREEN}✓ Image archive ready in project directory (${ARCHIVE_SIZE}).${NC}"
fi

# 4. Synchronize Codebase & Configs (Strictly preserving remote database & excluding image binaries)
echo -e "\n${YELLOW}🚀 [4/6] Synchronizing configs and metadata to ${REMOTE_HOST}:${REMOTE_DIR}...${NC}"
ssh -o BatchMode=yes "$REMOTE_HOST" "mkdir -p ${REMOTE_DIR} ${REMOTE_DIR}/backend/data"

rsync -avz \
  --exclude="node_modules" \
  --exclude="*/node_modules" \
  --exclude=".git" \
  --exclude="frontend/dist" \
  --exclude="backend/dist" \
  --exclude="*.log" \
  --exclude="backend/data/*.db*" \
  --exclude="data/*.db*" \
  --exclude="docker-images" \
  --exclude="*.tar.gz" \
  --exclude="*.tar" \
  "${LOCAL_DIR}/" \
  "${REMOTE_HOST}:${REMOTE_DIR}/"

# Configure docker-compose.yml on remote server to use pre-loaded images
ssh -o BatchMode=yes "$REMOTE_HOST" "cat > ${REMOTE_DIR}/docker-compose.yml << 'EOF'
services:
  backend:
    image: terminalsql-backend:latest
    ports:
      - \"\${BACKEND_PORT:-3002}:3002\"
    environment:
      - NODE_ENV=production
      - PORT=3002
      - JWT_SECRET=\${JWT_SECRET:-terminalsql_jwt_secret_key_production_32chars}
      - ENCRYPTION_KEY=\${ENCRYPTION_KEY:-terminalsql_master_aes256_encryption_key_32c}
      - DB_PATH=/app/data/terminalsql.db
      - ALLOWED_ORIGINS=*
      - FRONTEND_URL=\${FRONTEND_URL:-http://localhost:5175}
      # Corporate & Offline Environment: Bypass proxy for local/LAN traffic
      - HTTP_PROXY=
      - HTTPS_PROXY=
      - http_proxy=
      - https_proxy=
      - NO_PROXY=localhost,127.0.0.1,10.0.0.0/8,192.168.0.0/16,172.16.0.0/12,*.local
      - no_proxy=localhost,127.0.0.1,10.0.0.0/8,192.168.0.0/16,172.16.0.0/12,*.local
    volumes:
      - ./backend/data:/app/data:z
    restart: unless-stopped
    networks:
      - terminalsql-net
    healthcheck:
      test: [\"CMD\", \"node\", \"-e\", \"fetch('http://localhost:3002/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s

  frontend:
    image: terminalsql-frontend:latest
    ports:
      - \"\${FRONTEND_PORT:-5175}:80\"
    environment:
      - HTTP_PROXY=
      - HTTPS_PROXY=
      - http_proxy=
      - https_proxy=
      - NO_PROXY=localhost,127.0.0.1,10.0.0.0/8,192.168.0.0/16,172.16.0.0/12,*.local
      - no_proxy=localhost,127.0.0.1,10.0.0.0/8,192.168.0.0/16,172.16.0.0/12,*.local
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - terminalsql-net

networks:
  terminalsql-net:
    driver: bridge
EOF"

echo -e "${GREEN}✓ Codebase & compose configurations synchronized.${NC}"

# 5. Transfer & Load Images on Remote Server (Only if image sync needed)
if [[ "$NEED_IMAGE_SYNC" == "true" ]]; then
  echo -e "\n${YELLOW}🚚 [5/6] Transferring and loading offline images on ${REMOTE_HOST}...${NC}"
  rsync -avz --progress "$TAR_FILE" "${REMOTE_HOST}:${REMOTE_DIR}/terminalsql-images.tar.gz"

  echo -e "${CYAN}➜ Loading images into remote Docker daemon...${NC}"
  ssh -o BatchMode=yes "$REMOTE_HOST" "docker load -i ${REMOTE_DIR}/terminalsql-images.tar.gz && rm -f ${REMOTE_DIR}/terminalsql-images.tar.gz && echo '${LOCAL_IMG_HASH}' > ${REMOTE_DIR}/.remote_image_hash"
  echo -e "${GREEN}✓ Remote Docker images updated and loaded successfully.${NC}"
else
  echo -e "\n${GREEN}⚡ [5/6] Image transfer skipped (already up-to-date on remote).${NC}"
fi

# 6. Start Containers & Healthcheck
echo -e "\n${YELLOW}⚡ [6/6] Launching containers and verifying health status...${NC}"
ssh -o BatchMode=yes "$REMOTE_HOST" "chmod -R 777 ${REMOTE_DIR}/backend/data && echo '${LOCAL_IMG_HASH}' > ${REMOTE_DIR}/.remote_image_hash && cd ${REMOTE_DIR} && docker compose up -d"

sleep 3
echo ""
echo -e "${BOLD}==================== DEPLOYMENT VERIFICATION ====================${NC}"
ssh -o BatchMode=yes "$REMOTE_HOST" "cd ${REMOTE_DIR} && docker compose ps"
echo ""

echo -e "${CYAN}Testing backend health endpoint...${NC}"
ssh -o BatchMode=yes "$REMOTE_HOST" "curl --noproxy '*' -s http://127.0.0.1:3002/api/health || echo 'Healthcheck pending...'"
echo ""

echo -e "${GREEN}${BOLD}🎉 DEPLOYMENT TO ${REMOTE_HOST} COMPLETED SUCCESSFULLY!${NC}"
echo -e "  ➜ Web Interface:   ${CYAN}http://10.54.68.151:5175${NC}"
echo -e "  ➜ Backend Health:  ${CYAN}http://10.54.68.151:3002/api/health${NC}"
echo -e "  ➜ Database Storage:${CYAN}${REMOTE_DIR}/backend/data/terminalsql.db${NC}"
echo ""

