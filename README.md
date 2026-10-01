# Nandaku - Backend

Backend REST API untuk aplikasi musik berbasis API key: autentikasi, katalog lagu & artis,
peliharaan virtual, typing speed test, pertemanan, story, chat, dan panel admin.

## Cara Menjalankan

```bash
cd backend
npm install
node seed-admin.js   # buat akun admin default (sekali saja)
npm start            # jalankan server di http://localhost:5000
```

Akun admin default (dibuat otomatis setiap server nyala, jadi tidak akan pernah "hilang" walau
server sempat restart):
- Email: `admin@nandaku.com`
- Password: `admin123`
- Login langsung lewat form di `admin.html` dengan email/password di atas (tidak perlu salin API key manual).

## ⚠️ Kalau di-deploy ke hosting (bukan cuma dijalankan di laptop)

Kebanyakan hosting gratis (Render/Railway/Replit/dll) punya disk **sementara** yang
di-reset setiap server restart/redeploy/idle-sleep, dan fitur *persistent disk* biasanya
hanya untuk paket berbayar. Karena itu aplikasi ini sudah dilengkapi opsi menyimpan data
di **MongoDB Atlas** — database cloud gratis selamanya (tier M0, 512MB, tanpa kartu kredit).

### Cara mengaktifkan (± 5 menit, gratis)

1. Buka https://www.mongodb.com/cloud/atlas/register dan daftar (boleh pakai akun Google,
   tidak perlu kartu kredit).
2. Saat diminta membuat cluster, pilih **M0 Free**, region terdekat (mis. Singapore), lalu
   klik **Create**.
3. Di menu **Database Access**, buat 1 user database (username & password bebas, simpan
   baik-baik).
4. Di menu **Network Access**, klik **Add IP Address** → pilih **Allow Access from Anywhere**
   (`0.0.0.0/0`). Ini wajib karena IP server hosting berubah-ubah.
5. Di halaman cluster, klik **Connect** → **Drivers** → salin **connection string**-nya.
   Bentuknya seperti:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   Ganti `USER` dan `PASSWORD` dengan user yang dibuat di langkah 3.
6. Isi environment variable di hosting kamu (atau file `.env` lokal, contoh di
   `.env.example`):
   ```
   MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. Deploy ulang / restart server. Cek log: kalau muncul
   `[db] Terhubung ke MongoDB Atlas -> data akan tersimpan permanen di sana.` berarti sudah
   aktif. Bisa juga dicek lewat `GET /api/health` atau `GET /api/admin/storage` (perlu login
   admin) — lihat field `dataPersistent` / `mongoActive`.

Setelah ini aktif, akun, lagu, chat, story, dll TIDAK akan hilang lagi walau hosting
me-restart atau redeploy server — bahkan kalau kamu pindah ke hosting gratis lain sekalipun,
karena datanya tidak lagi bergantung pada disk hosting.

**Catatan penting:** langkah di atas hanya mencakup **data** (`data/*.json` — akun, lagu,
chat, dsb). File **upload asli** (audio & gambar) butuh langkah tambahan di bawah ini.

### Bikin file upload (audio & gambar) ikut permanen — Cloudinary (± 5 menit, gratis)

Tanpa ini, entri lagu tetap aman (sudah di Atlas), tapi FILE audio/gambarnya sendiri masih
di disk sementara hosting — begitu server restart/redeploy, lagu terlihat ada tapi gagal
diputar (404) karena filenya sudah hilang. Cloudinary (gratis 25GB, tanpa kartu kredit)
menyelesaikan ini.

1. Daftar di https://cloudinary.com/users/register/free (boleh pakai akun Google).
2. Di Dashboard, buka **Settings (⚙️) → API Keys**, lalu salin nilai **API Environment
   variable** — bentuknya seperti:
   `cloudinary://123456789012345:AbCdEfGhIjKlMnOpQrStUvWxYz@dxxxxxxxx`
3. Isi environment variable di hosting kamu (atau `.env` lokal):
   ```
   CLOUDINARY_URL=cloudinary://123456789012345:AbCdEfGhIjKlMnOpQrStUvWxYz@dxxxxxxxx
   ```
4. Deploy ulang / restart server. Cek log: kalau muncul
   `Penyimpanan file upload (audio/gambar) permanen aktif via Cloudinary.` berarti sudah
   aktif. Lagu yang diunggah SETELAH ini aktif akan tersimpan permanen (URL-nya berupa
   link `https://res.cloudinary.com/...`, bukan lagi `/uploads/...`).

**Catatan:** lagu-lagu yang sudah lebih dulu diupload sebelum `CLOUDINARY_URL` diisi
(masih berbentuk `/uploads/songs/...`) TIDAK otomatis ikut pindah ke Cloudinary — file
lamanya kemungkinan sudah hilang duluan karena reset hosting. Solusi paling praktis:
upload ulang lagu-lagu tersebut lewat panel admin setelah Cloudinary aktif, supaya
tersimpan permanen mulai sekarang.

### "Server restart" / error saat upload atau memutar lagu, padahal data & Cloudinary sudah beres

Ini HAMPIR SELALU BUKAN bug kode, melainkan perilaku bawaan hosting **gratis**
(Render/Railway/Cyclic/dll free tier): server dimatikan otomatis ("tidur") setelah kira-kira
15 menit tidak ada yang mengakses, lalu perlu waktu 15–60 detik untuk "bangun" lagi saat ada
request pertama masuk. Selama masa bangun itu, request (upload/play/apa pun) akan gagal atau
sangat lambat — dari sisi pengguna ini terlihat persis seperti "server restart" atau error,
padahal servernya memang sedang menyala ulang.

Frontend sekarang sudah otomatis mendeteksi ini: kalau request gagal karena server belum
merespons sama sekali, muncul pita kuning "⏳ Menghubungkan ke server..." di atas layar dan
dicoba lagi otomatis beberapa kali (total sampai ±30 detik). Jadi kalau kamu melihat pita itu
lalu request berhasil sendiri, itu tandanya memang cuma server yang lagi bangun — bukan bug.

**Kabar baik:** kalau kamu deploy di **Render**, backend ini sekarang otomatis "menjaga
dirinya sendiri tetap bangun" — TIDAK PERLU setup apa pun. Render otomatis menyediakan env
`RENDER_EXTERNAL_URL`, dan server memakainya untuk mengetuk `/api/health` miliknya sendiri
setiap 10 menit (di bawah ambang idle 15 menit), jadi tidak akan pernah sempat tidur. Cek log
saat startup: kalau muncul `Self-ping aktif -> https://...`, ini sudah berjalan.

Kalau hosting kamu BUKAN Render (jadi tidak ada `RENDER_EXTERNAL_URL` otomatis), aktifkan
manual dengan salah satu cara ini:
- Set env `SELF_PING_URL=https://alamat-hosting-kamu` (tanpa garis miring di akhir), ATAU
- Daftar di https://uptimerobot.com (atau https://cron-job.org) — gratis, tanpa kartu kredit
  — buat monitor **HTTP(s)** ke `https://alamat-hosting-kamu/api/health`, interval 5 menit.

Kalau setelah ini request TETAP gagal terus-menerus (bukan cuma lambat sekali di awal), itu
baru kemungkinan bug sungguhan — cek log server di dashboard hosting tepat pada waktu
kejadian dan salin pesan errornya, supaya bisa ditelusuri lebih lanjut.

## Cara Kerja API Key

Setiap request ke endpoint (kecuali `/register`, `/login`, `/google-login`) WAJIB menyertakan header:

```
x-api-key: MUSIKAPP-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

API key ini didapat otomatis saat user mendaftar, dan direpresentasikan sebagai "peliharaan virtual"
di frontend (level & evolusinya naik setiap API key dipakai, misalnya setiap kali memutar lagu).

## Menyambungkan ke Music API Eksternal Asli (opsional)

Secara default aplikasi memakai data lagu lokal (`data/songs.json`) supaya bisa langsung dijalankan
tanpa API key eksternal. Jika ingin memakai layanan musik asli (Spotify Web API, Deezer, Jamendo, dll):

1. Daftar sebagai developer di layanan tersebut dan dapatkan API key/Client ID & Secret.
2. Isi `config.js` -> `EXTERNAL_MUSIC_API.enabled = true`, `baseUrl`, dan `apiKey`.
3. Lengkapi fungsi `fetchFromExternalApi()` di `routes/music.routes.js` untuk memanggil API tersebut.

## Daftar Endpoint Utama

### Auth
- `POST /api/register` — daftar akun manual
- `POST /api/login` — login manual
- `POST /api/google-login` — login/daftar via akun Google
- `POST /api/accounts/add` — tambah akun lain (multi-account), butuh `x-api-key`
- `GET  /api/me` — profil user aktif
- `PUT  /api/me/avatar` — ganti foto profil
- `PUT  /api/me/settings` — pengaturan privasi & keamanan

### Musik
- `GET  /api/songs` — daftar lagu acak/rekomendasi (beranda)
- `GET  /api/songs/search?q=` — cari lagu
- `GET  /api/artists` — daftar artis (panel geser)
- `GET  /api/artists/:id/songs` — lagu milik satu artis
- `POST /api/songs/:id/play` — tandai lagu diputar (mood terdeteksi, pet dapat exp)

### Peliharaan Virtual
- `GET  /api/pet` — status peliharaan
- `GET  /api/pet/progress` — detail level/exp, batas level (s.d. tahap Dewasa), dan daftar tahap
- `GET  /api/pet/types` — daftar jenis hewan yang bisa dipilih
- `POST /api/pet/interact` — sentuh/tekan peliharaan (kasih makan/exp)
- `POST /api/pet/change-type` — ganti jenis hewan peliharaan (body: `{ "type": "naga|kucing|anjing|burung" }`)

### Typing Speed Test
- `GET  /api/typing/text?duration=30|60|120` — ambil teks acak
- `POST /api/typing/submit` — kirim hasil (wpm, accuracy, duration)

### Pertemanan
- `GET  /api/users/search?q=` — cari pengguna lain
- `GET  /api/friends` — daftar teman
- `POST /api/friends/request` — kirim permintaan
- `GET  /api/friends/requests` — permintaan masuk
- `POST /api/friends/respond` — terima/tolak permintaan

### Story
- `POST /api/story` — unggah story (privacy: `friends` / `public`)
- `GET  /api/story/feed` — feed story (milik sendiri + teman + publik)

### Chat
- `GET  /api/chat/:friendId` — riwayat chat
- `POST /api/chat/:friendId` — kirim pesan

### Admin (butuh akun role admin)
- `POST /api/admin/songs` — upload SATU lagu (multipart: `audio`, `cover` opsional, field `title`, `artistName`, `genre`, `lyrics` opsional berupa teks biasa / format LRC, `allowDuplicate=1` opsional). Panel admin memanggilnya sekali per lagu, 3 paralel, jadi bisa upload banyak lagu sekaligus. Judul + artis yang sama dibalas `409 DUPLICATE_SONG`.
- `GET /api/admin/songs/:id` — satu lagu lengkap (termasuk lirik)
- `PUT /api/admin/songs/:id` — ubah `title`, `genre`, `lyrics` lagu yang sudah ada
- `POST /api/admin/artists` — tambah / perbarui satu artis (multipart: `photo`, field `name`, `bio`)
- `POST /api/admin/artists/bulk` — tambah / perbarui BANYAK artis (multipart: field `list` = satu artis per baris `Nama | bio`, `photo` banyak file + `photoNames` = JSON array nama file; foto dicocokkan ke artis lewat nama file)
- `GET  /api/admin/stats` — statistik dashboard admin

## Struktur Data

Semua data disimpan sebagai file JSON di folder `data/`, dengan opsi disinkronkan ke
MongoDB Atlas (`MONGODB_URI`) supaya permanen di hosting gratis. Lihat bagian di atas.

---

## Penyimpanan Data & File Upload (PENTING saat di-hosting)

Secara bawaan, data (`data/*.json`) dan file upload (`uploads/`) disimpan di dalam folder
aplikasi. Itu aman di komputer sendiri, TAPI di hosting berdisk sementara
(Render/Railway/Replit free tier) isinya dikembalikan ke kondisi awal setiap kali server
restart / redeploy / bangun dari idle — sehingga lagu hasil upload hilang dan API key
pengguna menjadi tidak valid.

Solusi gratis (lihat panduan lengkap di bagian atas README ini):
- **Data** (akun, lagu, chat, dst) → set `MONGODB_URI` (MongoDB Atlas, gratis).
- **File upload** (audio & gambar) → set `CLOUDINARY_URL` (Cloudinary, gratis).

Kalau hostingnya berbayar dan sudah menyediakan persistent disk, alternatifnya set:

```
STORAGE_DIR=/data
```

atau lebih rinci: `DATA_DIR=/data/data` dan `UPLOADS_DIR=/data/uploads`.
Lihat `.env.example` untuk daftar lengkap pengaturan.

Cek statusnya kapan saja lewat `GET /api/health` atau lewat peringatan di panel admin
(field `dataPersistent`, `mongoActive`, `uploadsPersistent`, `cloudinaryActive`).

### Endpoint tambahan
- `GET  /api/health` — status server & lokasi penyimpanan
- `GET  /api/admin/storage` — info penyimpanan (admin)
- `GET  /api/admin/backup` — unduh cadangan seluruh data JSON (admin)
- `POST /api/admin/restore` — pulihkan data dari file cadangan (admin)

Catatan: file cadangan berisi data JSON saja (termasuk URL Cloudinary lagu/gambar kalau
sudah aktif). Kalau belum pakai Cloudinary, salin juga folder `uploads/` secara manual
untuk cadangan yang benar-benar lengkap.
