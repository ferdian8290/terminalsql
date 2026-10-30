# TerminalSQL

> Web-based SSH Terminal · SQL Query Editor · SFTP Manager · Native Desktop App Paradigm.

![Version](https://img.shields.io/badge/Version-1.5.11-purple)
![Stack](https://img.shields.io/badge/Backend-Node.js%20%2B%20Fastify-green)
![Stack](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-blue)
![Database](https://img.shields.io/badge/Engines-MySQL%20%7C%20PostgreSQL%20%7C%20ClickHouse%20%7C%20SQLite-orange)
![Security](https://img.shields.io/badge/Security-AES--256--GCM%20%2B%20Argon2-red)
![Deployment](https://img.shields.io/badge/Deployment-Systemd%20%7C%20Docker%20%7C%20Offline%20Air--Gapped-success)

---

## Overview

TerminalSQL brings the productivity and density of enterprise desktop clients directly into a lightweight, high-performance web application. It runs either as a single unified service or containerized via Docker.

---

## Key Features

| Module | Capabilities |
|--------|-------------|
| 🖥️ **SSH Terminal** | xterm.js v5 with WebGL acceleration, multi-tab session management, terminal resize, auto-reconnect, SSH Bastion / Jump Host tunneling, **HTTP Streaming Tunnel Fallback** (bypasses corporate proxies / firewalls blocking WebSocket code 1006), **Live Active Status Dot** (sidebar & header indicator reflects real live socket state, automatically clearing on disconnect), **2-minute detached session grace period**, **Terminal Session Log Downloader**, and **Mobile Virtual Touch Keypad**. |
| 🪟 **Zero-Reconnect Split Screen** | Drag-and-drop tab splitting (`Split Down` & `Split Right`) with visual drop zone suggestions. Sessions and WebSockets persist seamlessly across layout splits without disconnecting. |
| 🗄️ **Database Engine** | Native drivers for **ClickHouse**, **PostgreSQL**, **MySQL**, and **SQLite**. Monaco Editor SQL execution, clean query text, backend limit injection (respects user-defined LIMIT, with defaults 100, 200, 500, 1000, Unlimited), automatic connection pool lifecycle management, **SQL Editor Draft Auto-Save** (persists query across page reloads), and **SQL Script Templates & Snippets Library** (SQLite server-backed CRUD). |
| ⌨️ **Monaco `Ctrl+Enter` Execution** | Press `Ctrl+Enter` (or `Cmd+Enter`) inside Monaco Editor or anywhere in the tab to instantly execute the highlighted SQL selection, or the entire statement if unselected. |
| 🌐 **Resilient ClickHouse Support** | Direct `SELECT 1` ping verification that bypasses proxy `/ping` path restrictions. Scoped schema introspection preventing client timeouts on large enterprise clusters. |
| 🔒 **Safe Mode** | Read-Only safety lock enabled by default with a dedicated amber toolbar badge preventing unintended DDL/DML mutations. |
| 📊 **High-Density Results Table** | Smooth horizontal and vertical scrolling with CSS `sticky` headers and sticky `#` row index. Cell value click-to-copy, column sorting, and instant row search filtering with live match counters. |
| 📤 **Advanced Export Suite** | **Semicolon (`;`) default** CSV delimiter (standard enterprise / Excel format). Quick export dropdown for Comma (`,`), Tab (`\t`), Pipe (`\|`), JSON, and an Advanced Export Modal with live formatted previews, custom quotes, and header toggles. |
| 🌳 **Hierarchical Schema Navigator** | Centralized left sidebar with database trees categorized into **Tables**, **Foreign Tables**, **Views**, and **Materialized Views** with structured icons and column introspection. |
| 📁 **SFTP File Manager** | Remote file browsing, drag-and-drop upload, chunked downloads, directory navigation, rename, permissions, and clean empty-state staging. |
| 📱 **Mobile & Zoom Responsive** | Adaptive off-canvas drawer navigation for mobile viewports (`< 768px`), responsive toolbar wrapping, and zoom scalability up to 200%. |
| 🛡️ **Native Desktop App Guard** | Complete elimination of default browser context menus in favor of dark custom context menus. Blocks accidental browser back/forward gestures from mouse side buttons (Mouse 4/5), trackpad swipes (`overscroll-behavior: none`), and `Alt+ArrowLeft`. |
| 🔐 **Enterprise Security** | AES-256-GCM encryption for stored connection credentials, Argon2id password hashing, JWT in `httpOnly; SameSite=Strict` cookies, CORS origin filtering via `ALLOWED_ORIGINS`, and TOTP MFA. |

---

## Deployment Methods Comparison

TerminalSQL supports multiple deployment paradigms depending on your target infrastructure:

| Method | Target Infrastructure | Internet Required? | Process Manager | Default Ports | Best Suited For |
|--------|----------------------|--------------------|-----------------|---------------|-----------------|
| **Method 1: Local / Development** | Workstation (Linux / macOS / WSL) | Yes (first install) | Node.js / tsx | UI: `5175`, API: `3002` / `5176` | Development, testing, local workstation |
| **Method 2: Native Linux Daemon** | Production Linux Server | Yes (first install) | systemd daemon (`terminalsql.service`) | Unified: `5176` | High performance, single bare-metal server |
| **Method 3: Docker Compose (Online)** | Server with Docker & Internet | Yes | Docker Engine / Compose | UI: `5175`, API: `3002` | Standard containerized environments |
| **Method 4: Docker Compose (Offline / Air-Gapped)** | On-Premise Server with NO Internet | **NO (100% Offline)** | Docker Engine / Compose | UI: `5175`, API: `3002` | Isolated banking / telco / intranet servers |

---

## Installation & Deployment Guides

### Method 1: Local Development / Manual Run

Prerequisites: Node.js 20+, npm, and basic build tools (`gcc`, `g++`, `make`, `python3`).

```bash
# 1. Clone repository and enter directory
cd terminalsql

# 2. Run automated setup (generates master keys and installs dependencies)
bash setup.sh

# 3. Start development servers with hot-reload
./start.sh
```

Aplikasi langsung aktif di:
- **Web UI**: `http://localhost:5175`
- **Backend API**: `http://localhost:3002/api/health`

---

### Method 2: Native Linux Server Deployment (Systemd Daemon)

Digunakan pada server Linux (Rocky Linux, RHEL, CentOS, Ubuntu, Debian) sebagai service background mandiri.

#### 2A. One-Click Sync & Deploy (Dari Laptop / Workstation)
Jika Anda memiliki akses SSH ke server target:

```bash
# Otomatis build lokal, sinkronisasi file, dan restart daemon systemd di server
./sync_to_server.sh
```

#### 2B. Manual Installation di Server (From Scratch)
Jika Anda login langsung di server via SSH:

```bash
# 1. Pastikan Node.js 20 terpasang di server
node -v # >= 20.x

# 2. Masuk ke direktori aplikasi
cd /root/dashboard/terminalsql

# 3. Jalankan setup awal untuk generate .env.local dan install dependencies
bash setup.sh

# 4. Build frontend dan backend
npm run build

# 5. Pasang service systemd
cat > /etc/systemd/system/terminalsql.service << 'EOF'
[Unit]
Description=TerminalSQL Production Server Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/dashboard/terminalsql
ExecStart=/usr/local/bin/node /root/dashboard/terminalsql/backend/dist/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=5176
EnvironmentFile=-/root/dashboard/terminalsql/.env.local

[Install]
WantedBy=multi-user.target
EOF

# 6. Aktifkan dan jalankan service
systemctl daemon-reload
systemctl enable --now terminalsql
```

#### 2C. Mengelola Service di Server (`manage.sh`)
```bash
./manage.sh status     # Cek status dan healthcheck
./manage.sh restart    # Restart service
./manage.sh logs       # Stream real-time log (Ctrl+C untuk keluar)
./manage.sh rebuild    # Rebuild native modul C++ better-sqlite3
```

---

### Method 3: Docker & Docker Compose (Standard / Online)

Digunakan pada server yang memiliki Docker Engine dan koneksi internet publik:

```bash
# 1. Pastikan file .env.local sudah tersedia
bash setup.sh

# 2. Build dan jalankan container di background
docker compose up -d --build

# 3. Cek status container
docker compose ps
```

- **Web UI**: `http://<IP-SERVER>:5175`
- **Backend Health**: `http://<IP-SERVER>:3002/api/health`

---

### Method 4: Docker & Docker Compose (Offline / On-Premise Air-Gapped)

Digunakan khusus untuk server on-premise perusahaan (seperti perbankan / telekomunikasi / server tanpa akses internet publik).

> [!IMPORTANT]
> Di server tanpa internet, **JANGAN** menggunakan flag `--build` karena server tidak bisa mendownload image dari Docker Hub atau npm registry. Gunakan metode image transfer berikut:

#### 4A. One-Click Offline Deploy Script (Paling Mudah)
Dari komputer workstation lokal Anda yang memiliki akses SSH ke server on-premise:

```bash
# 1. Smart Sync (Otomatis mendeteksi perubahan: build & transfer jika ada kode baru, fast-sync jika hanya metadata)
./sync_to_docker.sh

# 2. Force Rebuild & Full Transfer (Memaksa build ulang dan upload penuh 146MB)
./sync_to_docker.sh force
```

> [!TIP]
> **Smart Hash Diffing & Fast-Sync Mode:**
> Script secara otomatis melacak checksum perubahan kode sumber (`.last_built_source_hash`). Jika source code tidak berubah, sinkronisasi hanya memakan waktu **~2 detik** untuk mentransfer file konfigurasi & metadata (~6 KB) tanpa mengupload ulang image 150MB. Arsip image Docker disimpan permanen di `./docker-images/terminalsql-images.tar.gz`.

**Perintah Manajemen Server Offline:**
```bash
./sync_to_docker.sh status    # Cek status container & healthcheck di server remote
./sync_to_docker.sh logs      # Stream log real-time dari server remote
./sync_to_docker.sh restart   # Restart container di server remote
./sync_to_docker.sh stop      # Stop container di server remote
```

#### 4B. Manual Air-Gapped Transfer (Tanpa Script / Menggunakan USB atau SCP)
Jika Anda ingin mengeksekusi langkah demi langkah secara manual:

1. **Di Komputer Workstation (Lokal):**
   ```bash
   # Build image lokal
   docker compose build
   
   # Simpan image ke file tar terkompresi
   docker save terminalsql-backend:latest terminalsql-frontend:latest | gzip > terminalsql-images.tar.gz
   
   # Transfer file ke server on-premise
   scp terminalsql-images.tar.gz root@<IP-SERVER>:/root/docker_compose/terminalsql/
   ```

2. **Di Server On-Premise (Offline):**
   ```bash
   cd /root/docker_compose/terminalsql
   
   # Load image ke Docker daemon lokal server (100% offline)
   docker load -i terminalsql-images.tar.gz
   rm -f terminalsql-images.tar.gz
   
   # Pastikan permission folder data SQLite writable
   chmod -R 777 backend/data
   
   # Jalankan container
   docker compose up -d
   ```

Lihat [DOCKER_GUIDE.md](file:///home/pi/zabbixboy/terminalsql/DOCKER_GUIDE.md) untuk detail arsitektur container dan backup/restore.

---

## Firewall & Port Configuration

Pastikan port berikut telah diizinkan pada firewall server Anda:

| Port | Protocol | Usage | Mode |
|------|----------|-------|------|
| `5176` | TCP | Unified Web UI & Backend API | Systemd Native |
| `5175` | TCP | Nginx Web Frontend | Docker Compose |
| `3002` | TCP | Fastify Backend API & WebSocket | Docker Compose |

### Membuka Port di Linux Server:
```bash
# RHEL / Rocky Linux / CentOS (firewalld):
firewall-cmd --add-port=5175/tcp --permanent
firewall-cmd --add-port=3002/tcp --permanent
firewall-cmd --add-port=5176/tcp --permanent
firewall-cmd --reload

# Ubuntu / Debian (ufw):
ufw allow 5175/tcp
ufw allow 3002/tcp
ufw allow 5176/tcp
ufw reload
```

---

## Data Storage & User Persistence

Semua data akun, preferensi, riwayat query, dan koneksi database tersimpan secara persisten di database SQLite tertanam:

| Komponen | Lokasi & Penjelasan |
|----------|---------------------|
| 📂 **Database File** | `./backend/data/terminalsql.db` (Host path yang sama persis digunakan oleh Systemd maupun Docker volume mount). |
| 👤 **Tabel Akun (`users`)** | Menyimpan `email`, `password_hash` (**Argon2id** algorithm), `totp_secret`, `totp_enabled`, `created_at`, `last_login`. |
| 🔑 **Tabel Koneksi (`connections`)** | Menyimpan profil SSH, ClickHouse, Postgres, MySQL, dan SFTP. Password dan private key terenkripsi **AES-256-GCM** dengan `ENCRYPTION_KEY`. |
| 📜 **Tabel Template (`sql_templates`)** | Menyimpan template query SQL per database engine beserta parameter substitution. |
| 💾 **Backup & Restore** | Untuk backup seluruh data, Anda hanya perlu menyalin folder `backend/data/` dan file `.env.local`. |

---

## Environment Configuration (`.env.local`)

File konfigurasi kredensial utama (dibuat otomatis oleh `setup.sh` / `sync_to_server.sh` / `sync_to_docker.sh`):

```env
NODE_ENV=production
PORT=3002
FRONTEND_PORT=5175
FRONTEND_URL=http://localhost:5175
ALLOWED_ORIGINS=http://localhost:5175,http://localhost:3002,http://127.0.0.1:5175
JWT_SECRET=<48+ bytes random string dari openssl>
ENCRYPTION_KEY=<tepat 32 bytes AES-256 master key>
DB_PATH=/app/data/terminalsql.db
```

> [!WARNING]
> Jangan pernah mengubah `ENCRYPTION_KEY` setelah membuat koneksi database, karena seluruh password database dienkripsi menggunakan kunci tersebut.

---

## Architecture & Design Guidelines

TerminalSQL tunduk pada standar antarmuka **Native Desktop App Paradigm**:
- **High-Density Typography**: Item sidebar dan tree berukuran compact `11px` (tinggi baris `20px`); toolbar & input `11.5px` ~ `12px`; badge & mono `9.5px` ~ `10px`.
- **Zero Browser Context Menus**: Klik kanan browser default diblokir sepenuhnya dan digantikan oleh custom dark context menu.
- **Categorized Schema Tree**: Schema dikelompokkan ke dalam 4 folder standar (Tables, Foreign Tables, Views, Materialized Views).
- **Monaco SQL Priority**: Shortcut `Ctrl+Enter` memprioritaskan teks SQL yang di-blok/highlight sebelum mengeksekusi seluruh isi query editor.

---

## Changelog & Version History

### [v1.5.11] - 2026-10-30
- **Fix SFTP Permissions Object React Error #31**: Corrected `permissions` rendering in `SFTPManager.tsx` and serialized `f.rights` in `backend/src/modules/sftp/routes.ts` so `{ user, group, other }` object is safely formatted into standard POSIX notation string (`rwxr-xr-x`), eliminating Minified React Error #31 crash.

### [v1.5.10] - 2026-10-30
- **Permanent 2-Screen Dual-Pane Layout**: Enforced standard Dual-Pane (FileZilla / WinSCP style) layout for SFTP Manager: Left Screen = Local site / staged PC files, Right Screen = Remote server filesystem with resizable split divider.
- **Header Transfer Controls**: Integrated high-density transfer control pills (`Upload ->` and `<- Download`) directly in the header bar for quick two-way synchronization.
- **Live Remote File Preview**: Added in-browser live preview modal for remote files without downloading to PC. Supports `.csv`, `.tsv`, `.txt`, `.log`, `.json`, `.sql`, `.conf`, `.env`, `.sh`, `.yml`, `.yaml`, and `.xml`.
- **Interactive CSV Grid Viewer**: Parsed CSV and TSV files into an interactive spreadsheet table grid with live row filtering search, column headers, and row numbering, alongside raw text view toggle.
- **On-the-Fly Archive Inspector**: Inspected `.tar`, `.tar.gz`, and `.tgz` archives directly on the server without extraction, allowing file-by-file exploration and live viewing of text/csv contents inside archives.
- **In-Memory Gzip Stream Decompression**: Decompressed `.gz` single files on-the-fly via streaming without disk I/O.
- **Chunked Stream Safety Limit**: Enforced a streaming preview limit (default 2MB) to protect server memory and prevent browser freezing on large files.

### [v1.5.9] - 2026-10-30
- **Live Remote File Preview**: Added in-browser live preview for files in the SFTP manager without downloading to PC. Supports `.csv`, `.tsv`, `.txt`, `.log`, `.json`, `.sql`, `.conf`, `.env`, `.sh`, `.yml`, `.yaml`, and `.xml`.
- **Interactive CSV Grid Viewer**: Parsed CSV and TSV files into an interactive spreadsheet table grid with live row filtering search, column headers, and row numbering, alongside raw text view toggle.
- **On-the-Fly Archive Inspector**: Inspected `.tar`, `.tar.gz`, and `.tgz` archives directly on the server without extraction, allowing file-by-file exploration and live viewing of text/csv contents inside archives.
- **In-Memory Gzip Stream Decompression**: Decompressed `.gz` single files on-the-fly via streaming without disk I/O.
- **Chunked Stream Safety Limit**: Enforced a streaming preview limit (default 2MB) to protect server memory and prevent browser freezing on large files.

### [v1.5.8] - 2026-10-30
- **Seamless SFTP Integration & Persistent Tab**: Always displayed the dedicated SFTP category tab in the left sidebar switcher (`Database`, `Terminal`, `SFTP`) regardless of manual connection type, automatically including all SSH hosts as immediate SFTP storage targets.
- **Full Remote Explorer Mode**: Introduced a dedicated Full Remote File Explorer view (100% width) in `SFTPManager` as the default display, avoiding confusing blank staged file panes. Added a toggle button for dual-pane FileZilla style.
- **Direct Upload & Drag-and-Drop**: Added a direct "Upload" button on the remote toolbar and direct drag-and-drop support over the remote file explorer to immediately transfer files into the active remote directory.
- **Cross-Launch Context Menus**: Enabled 1-click cross-launching between SSH Terminal and SFTP File Manager from custom native right-click context menus.

### [v1.5.7] - 2026-10-30
- **Resilient Multi-Key Credential Decryption**: Implemented multi-key fallback decryption in `backend/src/utils/crypto.ts`. If environment encryption keys differ across container or host migrations, credentials automatically fall back to known keys without throwing `Unsupported state or unable to authenticate data`.

### [v1.5.6] - 2026-10-30
- **Action Button Precision Positioning**: Refined sidebar connect button spacing (`pr-1`), optically centered play icon (`ml-0.5`), and removed native HTML `title` attributes to eliminate conflicting horizontal browser tooltips.
- **Smart Image Build & Sync Tracking**: Enhanced `sync_to_docker.sh` with codebase source change tracking (`.last_built_source_hash`) so Docker rebuilds are triggered whenever source code changes while keeping metadata sync instant (~2s) for config edits.

### [v1.5.5] - 2026-10-29
- **Smart Docker Image Hash Diffing**: Upgraded `sync_to_docker.sh` to compare local vs remote image hashes before deployment. Skips redundant 150MB transfers and `docker load` if remote images already match, completing metadata & config syncs in ~2 seconds.
- **Persistent Local Image Storage**: Stored compressed Docker bundle in `./docker-images/terminalsql-images.tar.gz` instead of volatile `/tmp`, preserving offline archive readiness across host reboots.

### [v1.5.4] - 2026-10-29
- **Sidebar Action Tooltip**: Repositioned quick-action hover tooltip (`Connect` / `Reconnect`) to `side="top" align="end"` with a smooth 400ms delay, eliminating cross-border protrusion into the terminal editor.
- **Clean Alignment**: Added padding right spacing (`pr-0.5`) on the action button container for uniform alignment.

### [v1.5.3] - 2026-10-29
- **Live Status Dot Relocation**: Moved the active connection green dot (`titik ijo`) from overlapping the terminal icon to neatly alongside the connection name (`name ●`).
- **Icon Integrity**: Kept terminal (`>_`), database, and SFTP brand icons 100% clean and unobstructed.

### [v1.5.2] - 2026-10-29
- **Zero Noise Terminal Output**: Removed internal switching messages (`Corporate proxy detected...`) and handshake notices from the terminal canvas, launching straight into clean shell prompts.
- **Normal Status Badges**: Standardized the terminal toolbar status pill to show clean `● Connected`, omitting `(HTTP Tunnel)` text.
- **SSE Stream Hijack & Buffer Defeat**: Implemented Fastify `reply.hijack()` and 2KB comment padding to immediately defeat corporate proxy buffering (Squid, BlueCoat, Fortinet).

### [v1.5.1] - 2026-10-29
- **Live Socket State Sync**: Integrated global `tabStatuses` store in Zustand. Sidebar green dots and top header badge (`N SSH`) now strictly reflect live connected sessions, clearing automatically on disconnect or session closure.

### [v1.5.0] - 2026-10-29
- **HTTP Streaming Tunnel Fallback**: Added automated dual-transport resilience. When strict enterprise corporate proxies intercept raw WebSocket traffic (`Session closed code 1006`), the client transparently switches to HTTP Streaming (`text/event-stream` + HTTP POST).
