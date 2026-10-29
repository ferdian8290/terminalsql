#!/usr/bin/env bash
# ==============================================================================
# TerminalSQL — Server Service Manager (manage.sh)
# Usage: ./manage.sh [status|restart|start|stop|logs|rebuild]
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="terminalsql"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

ACTION="${1:-status}"

case "$ACTION" in
  status)
    echo -e "${BOLD}Checking status of ${SERVICE_NAME}...${NC}"
    systemctl status "$SERVICE_NAME" --no-pager
    echo ""
    echo -e "${BOLD}Health check:${NC}"
    curl -s http://127.0.0.1:5176/api/health || echo -e "${RED}Service not responding on port 5176${NC}"
    echo ""
    ;;
  restart)
    echo -e "${YELLOW}Restarting ${SERVICE_NAME}...${NC}"
    systemctl restart "$SERVICE_NAME"
    sleep 1
    systemctl status "$SERVICE_NAME" --no-pager -n 5
    ;;
  start)
    echo -e "${GREEN}Starting ${SERVICE_NAME}...${NC}"
    systemctl start "$SERVICE_NAME"
    ;;
  stop)
    echo -e "${RED}Stopping ${SERVICE_NAME}...${NC}"
    systemctl stop "$SERVICE_NAME"
    ;;
  logs)
    echo -e "${CYAN}Streaming logs for ${SERVICE_NAME} (Ctrl+C to exit)...${NC}"
    journalctl -u "$SERVICE_NAME" -f -n 50
    ;;
  rebuild)
    echo -e "${YELLOW}Rebuilding better-sqlite3 native binary...${NC}"
    cd "${PROJECT_DIR}/backend"
    /usr/local/bin/npm rebuild better-sqlite3
    systemctl restart "$SERVICE_NAME"
    echo -e "${GREEN}✓ Done.${NC}"
    ;;
  *)
    echo "Usage: $0 {status|restart|start|stop|logs|rebuild}"
    exit 1
    ;;
esac
