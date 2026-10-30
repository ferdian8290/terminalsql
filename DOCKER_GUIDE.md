# TerminalSQL — Docker & Docker Compose Deployment Guide

Panduan lengkap deployment TerminalSQL menggunakan Docker & Docker Compose dengan penyimpanan data persisten (*zero data loss*).

---

## 1. Arsitektur Penyimpanan Data (*Persistent Storage*)

Semua akun pengguna, koneksi database (ClickHouse, PostgreSQL, MySQL, SQLite), session SSH, query templates, dan history tersimpan di database SQLite:

- **Host Path**: `./backend/data/terminalsql.db` (dan symlink `./data`)
- **Container Path**: `/app/data/terminalsql.db`

> [!TIP]
> **Keuntungan Arsitektur Ini:**
> Folder `./backend/data` adalah lokasi yang **sama persis** dengan yang digunakan oleh instalasi native (`start.sh` / `systemd`). Artinya, Anda bisa beralih antara Docker dan native tanpa takut data koneksi atau template SQL Anda hilang/terpisah!

---

## 2. Prasyarat

Pastikan server Anda sudah terpasang:
- **Docker Engine** (versi 24.0+)
- **Docker Compose** plugin (versi 2.0+)

Cek versi:
```bash
docker --version
docker compose version
```

---

## 3. Cara Menjalankan (How-To)

### A. One-Click Offline Deploy Script (`./sync_to_docker.sh`) — Sangat Direkomendasikan!
Untuk server on-premise tanpa akses internet (seperti `root@10.54.68.151`), Anda cukup menjalankan satu perintah otomatis dari komputer lokal:

```bash
# 1. Smart Sync (Otomatis mendeteksi perubahan: build & transfer jika ada kode baru, fast-sync jika hanya metadata)
./sync_to_docker.sh

# 2. Force Rebuild & Full Transfer (Memaksa rebuild dan re-upload arsip 146MB)
./sync_to_docker.sh force

# 3. Cek status container & healthcheck di server remote
./sync_to_docker.sh status

# 4. Stream log container di server remote secara real-time
./sync_to_docker.sh logs

# 5. Restart container di server remote
./sync_to_docker.sh restart

# 6. Stop container di server remote
./sync_to_docker.sh stop
```

> [!NOTE]
> **Fitur Smart Image Hash Diffing & Fast-Sync:**
> - Script melacak checksum kode sumber (`.last_built_source_hash`). Jika source code lokal tidak berubah dan remote server sudah memiliki image ID yang sama, script masuk ke mode **⚡ Fast-sync**.
> - Pada mode Fast-sync, script **melewati build lokal, kompresi, transfer arsip 150MB, dan docker load**. Hanya konfigurasi & metadata (~6 KB) yang disinkronkan via rsync dalam **~2 detik** tanpa downtime!
> - Arsip image Docker disimpan secara permanen di `./docker-images/terminalsql-images.tar.gz` (bukan di `/tmp/` yang terhapus saat reboot), siap digunakan kapan pun untuk keperluan instalasi offline.

---

### B. Konfigurasi Kunci Enkripsi (`.env.local`)
Jika belum ada file `.env.local`, buat atau generate kunci otomatis:
```bash
# Otomatis generate kunci rahasia AES-256 dan JWT:
JWT_SECRET=$(openssl rand -base64 48)
ENC_KEY=$(openssl rand -base64 32 | head -c 32)

cat > .env.local << EOF
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENC_KEY}
PORT=3002
FRONTEND_PORT=5175
FRONTEND_URL=http://localhost:5175
ALLOWED_ORIGINS=http://localhost:5175,http://localhost:3002
EOF
```

> [!IMPORTANT]
> Jangan ubah `ENCRYPTION_KEY` setelah membuat koneksi database, karena password koneksi terenkripsi menggunakan kunci tersebut.

---

### B. Build & Jalankan Container
Jalankan perintah berikut di root folder project:

```bash
# 1. Build image dan jalankan di background (-d)
docker compose up -d --build

# 2. Cek status container dan health check
docker compose ps
```

Hasil status yang benar:
```
NAME                    IMAGE                  COMMAND                  SERVICE    STATUS
terminalsql-backend-1   terminalsql-backend    "node dist/index.js"     backend    running (healthy)
terminalsql-frontend-1  terminalsql-frontend   "nginx -g 'daemon of…"   frontend   running
```

Aplikasi siap diakses di browser:
- **Web UI**: `http://<IP-SERVER>:5175`
- **Backend Health**: `http://<IP-SERVER>:3002/api/health`

---

### C. Monitoring & Logs
```bash
# Melihat log real-time kedua service:
docker compose logs -f

# Melihat log backend saja:
docker compose logs -f backend

# Melihat log frontend Nginx saja:
docker compose logs -f frontend
```

---

### D. Menghentikan / Restart Service
```bash
# Menghentikan service sementara (data tetap aman):
docker compose stop

# Menjalankan kembali:
docker compose start

# Merestart service:
docker compose restart

# Menghentikan dan menghapus container (data di backend/data TETAP AMAN):
docker compose down
```

---

## 4. Cara Update ke Versi Baru
Ketika ada pembaruan kode di branch/repository:

```bash
# 1. Tarik kode terbaru
git pull

# 2. Re-build dan recreate container (tanpa downtime data)
docker compose up -d --build
```
Karena database di-mount ke `./backend/data` di host, seluruh koneksi dan template query Anda **100% utuh dan tidak terhapus**.

---

## 5. Cara Backup & Restore Data

### Backup
Cukup backup folder `./backend/data` dan file `.env.local`:
```bash
# Backup ke arsip tar.gz
tar -czvf terminalsql_backup_$(date +%Y%m%d).tar.gz backend/data .env.local
```

### Restore
Jika pindah ke server baru:
```bash
# Ekstrak file backup
tar -xzvf terminalsql_backup_*.tar.gz

# Jalankan docker compose
docker compose up -d
```

---

## 6. Mengubah Port (Jika Port Default Bentrok)
Jika port `5175` atau `3002` sudah digunakan service lain di server Anda, cukup ubah nilai port di file `.env.local`:
```env
FRONTEND_PORT=8080
BACKEND_PORT=4000
```
Lalu restart:
```bash
docker compose up -d
```
Maka TerminalSQL otomatis berjalan di port `8080`!

---

## 7. Keamanan & Multi-Key Credential Resilience
TerminalSQL mengenkripsi seluruh password dan credential koneksi (SSH, Database, SFTP) menggunakan algoritma **AES-256-GCM** dengan derivasi kunci PBKDF2 (100.000 iterasi).

### Resilient Multi-Key Fallback:
Ketika database dipindahkan antar server (misal dari instalasi native ke Docker, atau antar mesin on-premise), jika file `.env` di server baru memiliki `ENCRYPTION_KEY` yang berbeda dengan kunci saat koneksi pertama kali dibuat:
- Sistem backend **secara otomatis mencoba fallback key** yang valid (`terminalsql_master_aes256_encryption_key_32c` dan kunci default instalasi).
- Mencegah error `Failed to decrypt credentials: Unsupported state or unable to authenticate data`.
- Koneksi tetap langsung dapat digunakan tanpa perlu memasukkan ulang password.

---

## 8. Troubleshooting

### Q: Container backend gagal start atau koneksi SSH ditolak?
Periksa log backend:
```bash
./sync_to_docker.sh logs
```
Pastikan folder database di host memiliki permission yang benar:
```bash
chmod -R 777 backend/data
```

### Q: Browser menampilkan pesan proxy error saat curl internal?
Pada server korporat dengan environment `http_proxy` / `https_proxy`, selalu sertakan flag `--noproxy '*'` saat melakukan pengujian curl lokal:
```bash
curl --noproxy '*' -s http://127.0.0.1:3002/api/health
```
File `docker-compose.yml` telah secara otomatis mengonfigurasi variabel `HTTP_PROXY=` kosong dan `NO_PROXY=*` untuk mencegah container memutar traffic internal melalui proxy gateway eksternal.

