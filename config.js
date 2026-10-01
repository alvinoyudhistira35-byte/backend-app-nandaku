const fs = require('fs');
const path = require('path');

// ==========================================================================================
// LOKASI PENYIMPANAN DATA & FILE UPLOAD
// ------------------------------------------------------------------------------------------
// PENYEBAB UTAMA BUG "API key tidak valid + semua lagu hilang":
// Data (data/*.json) dan file upload (uploads/**) sebelumnya disimpan DI DALAM folder aplikasi.
// Di hosting seperti Render/Railway/Replit/Koyeb free tier, isi folder aplikasi DIKEMBALIKAN
// ke versi hasil deploy setiap kali server restart / redeploy / bangun dari idle-sleep.
// Akibatnya users.json kembali kosong (=> API key di browser jadi tidak dikenal => "API key
// tidak valid") dan songs.json kembali ke 8 lagu contoh (=> lagu yang baru diupload hilang).
//
// Solusi: simpan data & upload di DISK PERMANEN (persistent disk/volume) DI LUAR folder aplikasi.
// Set salah satu:
//   DATA_DIR=/data/app-data  UPLOADS_DIR=/data/app-uploads
// atau cukup:
//   STORAGE_DIR=/data        (otomatis jadi /data/data dan /data/uploads)
// Kalau hosting menyediakan env RENDER_DISK_PATH / RAILWAY_VOLUME_MOUNT_PATH, itu dipakai otomatis.
//
// PENYEBAB LAIN yang sering ketukar dengan "server restart": beberapa platform hosting
// (mis. Glitch, dan beberapa mode "watch" di platform sejenis) MEMANTAU SELURUH folder
// project dan otomatis me-restart aplikasi setiap kali ADA FILE YANG BERUBAH DI DALAMNYA --
// termasuk file yang ditulis SENDIRI oleh aplikasi saat runtime (data/*.json, uploads/*).
// Jadi setiap upload lagu (menulis file) atau memutar lagu (menulis riwayat ke users.json)
// bisa memicu platform tsb mengira ada "perubahan kode" dan me-restart container -- padahal
// bukan crash. Makanya secara default DATA_DIR/UPLOADS_DIR sekarang ditaruh di ".data/"
// (folder tersembunyi), karena platform seperti Glitch memang mengabaikan folder ".data/"
// dari pemantauannya (konvensi yang sudah lama dipakai untuk kebutuhan ini).
// ==========================================================================================

// Hanya menerima folder yang MEMANG SUDAH ADA (artinya benar-benar sebuah disk/volume yang
// di-mount oleh hosting) dan bisa ditulis. Sengaja TIDAK membuat folder baru di sini, supaya
// tidak asal menaruh data di lokasi acak pada komputer sendiri.
function existingWritableDir(candidates) {
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (_) { /* coba kandidat berikutnya */ }
  }
  return null;
}

const APP_DIR = __dirname;

// Kandidat lokasi penyimpanan permanen, urut dari yang paling bisa dipercaya.
const STORAGE_DIR =
  process.env.STORAGE_DIR ||
  process.env.RENDER_DISK_PATH ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  existingWritableDir(['/data', '/var/data', '/mnt/data']) ||
  null;

const DATA_DIR = process.env.DATA_DIR || (STORAGE_DIR ? path.join(STORAGE_DIR, 'data') : path.join(APP_DIR, '.data', 'data'));
const UPLOADS_DIR = process.env.UPLOADS_DIR || (STORAGE_DIR ? path.join(STORAGE_DIR, 'uploads') : path.join(APP_DIR, '.data', 'uploads'));

// Folder "bawaan" yang ikut dalam repo -> dipakai HANYA sebagai benih (seed) sekali saja
// saat DATA_DIR / UPLOADS_DIR masih kosong. Setelah itu tidak pernah menimpa data asli lagi.
const SEED_DATA_DIR = path.join(APP_DIR, 'data');
const SEED_UPLOADS_DIR = path.join(APP_DIR, 'uploads');

// Penyimpanan dianggap RAWAN HILANG kalau masih berada di dalam folder aplikasi.
const STORAGE_IS_EPHEMERAL =
  path.resolve(DATA_DIR).startsWith(path.resolve(APP_DIR) + path.sep) ||
  path.resolve(DATA_DIR) === path.resolve(APP_DIR);

// ==========================================================================================
// MONGODB ATLAS (opsional, tapi SANGAT DIREKOMENDASIKAN untuk hosting gratis)
// ------------------------------------------------------------------------------------------
// Kebanyakan hosting gratis (Render free, dll) TIDAK menyediakan persistent disk gratis,
// jadi solusi STORAGE_DIR di atas butuh paket berbayar supaya benar-benar berguna.
// Kalau MONGODB_URI diisi, data (users.json, songs.json, dst) disimpan permanen di MongoDB
// Atlas (gratis, tier M0) selain tetap disimpan sebagai cache lokal di DATA_DIR:
//  - Saat server start: data terbaru ditarik dari Atlas ke file lokal.
//  - Setiap ada perubahan (writeData): file lokal ditulis SEKALIGUS (seperti biasa, cepat &
//    aman) DAN dikirim ke Atlas di latar belakang.
// Jadi walau host mengembalikan folder aplikasi ke kondisi awal saat redeploy, begitu server
// menyala lagi data langsung dipulihkan dari Atlas. Cara buat & dapatkan MONGODB_URI ada di
// backend/README.md.
// Catatan: ini hanya mencakup DATA (JSON), bukan file upload (audio/gambar) di UPLOADS_DIR.
// ==========================================================================================
// Kalau isinya masih persis contoh placeholder di .env.example (belum diganti), perlakukan
// sebagai KOSONG -> daripada mencoba konek ke alamat palsu (lambat & bikin bingung karena
// terlihat aktif padahal tidak).
function realOrEmpty(value, placeholderMarkers) {
  if (!value) return '';
  const lower = value.toLowerCase();
  if (placeholderMarkers.some(marker => lower.includes(marker))) {
    console.warn(`[config] Nilai env "${value.slice(0, 20)}..." masih contoh placeholder, dianggap belum diisi. Ganti dengan nilai asli di .env.`);
    return '';
  }
  return value;
}

const MONGODB_URI = realOrEmpty(process.env.MONGODB_URI, ['user:password@cluster']);
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'nandaku';

// Data dianggap permanen kalau memakai MongoDB Atlas, ATAU disk-nya sendiri sudah permanen.
const DATA_IS_PERSISTENT = Boolean(MONGODB_URI) || !STORAGE_IS_EPHEMERAL;

// ==========================================================================================
// CLOUDINARY (opsional, tapi DIREKOMENDASIKAN untuk file upload di hosting gratis)
// ------------------------------------------------------------------------------------------
// MongoDB Atlas di atas hanya menyimpan DATA (JSON) -> tidak menyimpan file audio/gambar
// yang diunggah admin. File-file itu masih ada di UPLOADS_DIR, yang ikut hilang saat hosting
// gratis me-reset disk-nya (redeploy/restart/bangun dari idle-sleep). Efeknya: entri lagu
// tetap ada (sudah aman di Atlas), tapi saat diputar filenya 404 karena sudah tidak ada.
//
// Kalau CLOUDINARY_URL diisi, upload audio & gambar baru disimpan di Cloudinary (gratis
// selamanya, tanpa kartu kredit) alih-alih di disk lokal, jadi ikut permanen. Dapatkan
// CLOUDINARY_URL dari dashboard Cloudinary (Account Details -> "API Environment variable").
// Bentuknya: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
// Cara lengkap ada di backend/README.md.
// ==========================================================================================
const CLOUDINARY_URL = realOrEmpty(process.env.CLOUDINARY_URL, ['api_key:api_secret@cloud_name']);
const UPLOADS_ARE_PERSISTENT = Boolean(CLOUDINARY_URL) || !STORAGE_IS_EPHEMERAL;

// ==========================================================================================
// SELF-PING (opsional, otomatis) -- mencegah hosting gratis "menidurkan" server karena idle.
// Render otomatis menyediakan RENDER_EXTERNAL_URL untuk web service, jadi ini AKTIF SENDIRI
// tanpa perlu diatur apa pun kalau di-deploy di Render. Untuk platform lain, isi manual:
//   SELF_PING_URL=https://alamat-hosting-kamu
// ==========================================================================================
const SELF_PING_URL = (process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

module.exports = {
  SELF_PING_URL,
  PORT: process.env.PORT || 5000,
  APP_DIR,
  DATA_DIR,
  UPLOADS_DIR,
  SEED_DATA_DIR,
  SEED_UPLOADS_DIR,
  STORAGE_IS_EPHEMERAL,
  MONGODB_URI,
  MONGODB_DB_NAME,
  DATA_IS_PERSISTENT,
  CLOUDINARY_URL,
  UPLOADS_ARE_PERSISTENT,

  // Sajikan folder frontend langsung dari backend (satu origin -> tidak ada masalah CORS
  // dan tidak perlu lagi mengetik URL backend secara manual di frontend).
  SERVE_FRONTEND: process.env.SERVE_FRONTEND !== 'false',
  FRONTEND_DIR: process.env.FRONTEND_DIR || path.join(APP_DIR, '..', 'frontend'),

  // Batas ukuran & jenis file upload. Sebelumnya tanpa batas: file raksasa bisa memenuhi disk
  // atau membuat proses mati di tengah penulisan data (sumber data korup).
  UPLOAD_LIMITS: {
    audioBytes: Number(process.env.MAX_AUDIO_MB || 30) * 1024 * 1024,
    imageBytes: Number(process.env.MAX_IMAGE_MB || 5) * 1024 * 1024,
    audioMime: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/webm'],
    audioExt: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm'],
    imageMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
    imageExt: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']
  },

  // Akun admin. API key admin sengaja tetap (tidak acak) supaya tidak pernah "tidak valid"
  // walau data sempat ter-reset. WAJIB diganti lewat env di produksi.
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@nandaku.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  ADMIN_API_KEY: process.env.ADMIN_API_KEY || 'NANDAKU-ADMIN-DEFAULT-KEY',

  EXTERNAL_MUSIC_API: {
    enabled: false,
    baseUrl: '',
    apiKey: ''
  },

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || ''
};
