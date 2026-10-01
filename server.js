const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { initStorage, isMongoActive } = require('./utils/db');
const mediaStorage = require('./utils/mediaStorage');
const { ensureAdminSeeded } = require('./seed-admin');

const authRoutes = require('./routes/auth.routes');
const musicRoutes = require('./routes/music.routes');
const petRoutes = require('./routes/pet.routes');
const typingRoutes = require('./routes/typing.routes');
const friendsRoutes = require('./routes/friends.routes');
const storyRoutes = require('./routes/story.routes');
const chatRoutes = require('./routes/chat.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// File hasil upload admin (audio, cover, foto artis) diakses lewat /uploads/...
app.use('/uploads', express.static(config.UPLOADS_DIR, {
  fallthrough: true,
  maxAge: '1h',
  setHeaders: (res) => res.setHeader('Accept-Ranges', 'bytes') // agar pemutar bisa seek/geser lagu
}));

// Endpoint pemeriksaan cepat: berguna untuk memastikan server & penyimpanan sehat.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    storage: {
      dataDir: config.DATA_DIR,
      uploadsDir: config.UPLOADS_DIR,
      dataPersistent: config.DATA_IS_PERSISTENT,
      mongoActive: isMongoActive(),
      uploadsPersistent: config.UPLOADS_ARE_PERSISTENT,
      cloudinaryActive: mediaStorage.isCloudinaryActive()
    }
  });
});

app.use('/api', authRoutes);
app.use('/api', musicRoutes);
app.use('/api', petRoutes);
app.use('/api', typingRoutes);
app.use('/api', friendsRoutes);
app.use('/api', storyRoutes);
app.use('/api', chatRoutes);
app.use('/api', adminRoutes);

// Sajikan frontend dari backend juga -> satu alamat untuk semuanya, tidak perlu lagi
// mengubah URL backend di file frontend saat dipindah ke hosting.
if (config.SERVE_FRONTEND && fs.existsSync(config.FRONTEND_DIR)) {
  app.use(express.static(config.FRONTEND_DIR));
  app.get('/', (req, res) => res.sendFile(path.join(config.FRONTEND_DIR, 'index.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(config.FRONTEND_DIR, 'admin.html')));
} else {
  app.get('/', (req, res) => {
    res.json({ message: 'Nandaku Backend aktif. Lihat README.md untuk daftar endpoint.' });
  });
}

// 404: khusus /api dibalas JSON, selebihnya teks biasa.
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
  res.status(404).send('Halaman tidak ditemukan.');
});

// Penangan error terakhir -> selalu balas JSON rapi, jangan sampai proses mati.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Terjadi kesalahan pada server.' });
});

// Jangan biarkan satu error tak terduga mematikan server (dulu: server mati diam-diam
// beberapa saat setelah dipakai, lalu semua request gagal dan terlihat seperti "data hilang").
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// ==========================================================================================
// LOG KHUSUS UNTUK MEMASTIKAN APAKAH PROSES BENAR-BENAR MATI/RESTART, DAN KENAPA.
// ------------------------------------------------------------------------------------------
// Kalau proses Node berhenti karena SIGTERM/SIGINT, itu PASTI dikirim dari LUAR (platform
// hosting yang mematikan container untuk redeploy/restart/scale) -- BUKAN error di kode kita
// (kode kita tidak pernah memanggil process.exit() atau mengirim sinyal ke dirinya sendiri).
// Baris log ini akan selalu muncul di log hosting tepat sebelum proses berhenti, jadi bisa
// dipastikan: kalau baris ini ADA di log saat kejadian -> restart dari platform (bukan bug
// kode, solusinya self-ping/keep-alive yang sudah aktif). Kalau baris ini TIDAK ADA tapi
// proses tetap berhenti/log terputus begitu saja -> baru itu tanda crash asli & perlu dilihat
// baris sebelumnya (biasanya ada "Error:"/"TypeError:" tepat di atasnya).
// ==========================================================================================
process.on('SIGTERM', () => {
  console.log('[process] Menerima SIGTERM dari platform hosting (redeploy/restart/scale-down) -> proses akan berhenti SEKARANG. Ini bukan crash dari kode aplikasi.');
});
process.on('SIGINT', () => {
  console.log('[process] Menerima SIGINT (biasanya Ctrl+C atau platform menghentikan proses) -> proses akan berhenti SEKARANG.');
});
process.on('exit', (code) => {
  console.log(`[process] Proses BERHENTI dengan kode ${code}.`);
});

let server;

// Kirim satu request kecil ke diri sendiri secara berkala, supaya hosting gratis
// (Render/Railway/dll yang mematikan server otomatis setelah idle ±15 menit) selalu
// menganggap server ini "sedang dipakai" dan tidak pernah sempat tidur -> tidak ada lagi
// jeda "bangun dari tidur" yang terasa seperti server restart saat lagu diputar.
// Otomatis aktif kalau platform hosting menyediakan URL publik (Render menyediakan
// RENDER_EXTERNAL_URL secara otomatis); bisa juga diisi manual lewat env SELF_PING_URL
// untuk platform lain.
function startSelfPing() {
  const url = config.SELF_PING_URL;
  if (!url) return;
  const https = require('https');
  const http = require('http');
  const client = url.startsWith('https') ? https : http;
  setInterval(() => {
    client.get(url + '/api/health', (res) => res.resume()).on('error', () => {
      // Sengaja diabaikan: ini cuma untuk menjaga server tetap aktif, kalau sesekali
      // gagal (mis. lagi redeploy) bukan masalah, akan dicoba lagi di interval berikutnya.
    });
  }, 10 * 60 * 1000); // tiap 10 menit -> selalu di bawah ambang idle 15 menit
}

async function start() {
  try {
    // 1) Siapkan folder penyimpanan lokal, salin data bawaan kalau masih kosong, DAN
    //    (kalau MONGODB_URI diisi) sinkronkan dengan MongoDB Atlas dulu sebelum server
    //    mulai melayani request -> supaya data yang dipulihkan dari Atlas sudah siap pakai.
    await initStorage();

    // 2) Pastikan akun admin selalu ada dengan API key tetap, jadi tidak ada lagi
    //    "API key tidak valid" hanya karena akun admin sempat hilang.
    ensureAdminSeeded({ silent: true });
  } catch (err) {
    // PENTING: apa pun yang gagal di langkah persiapan di atas, JANGAN sampai membuat
    // server gagal menyala sama sekali. Server yang menyala (walau datanya belum ideal)
    // jauh lebih baik daripada server yang tidak pernah listen -> yang di banyak hosting
    // gratis membuat platform mengira aplikasi crash dan terus-menerus me-restart-nya.
    console.error('[start] Persiapan awal gagal sebagian, server tetap dilanjutkan menyala:', err.message);
  }

  // 3) Peringatan kalau data masih rawan hilang (tidak ada Atlas maupun disk permanen).
  if (!config.DATA_IS_PERSISTENT) {
    console.warn('\n==================== PERINGATAN PENYIMPANAN ====================');
    console.warn('Data (users.json, songs.json, dst) masih disimpan di dalam folder aplikasi:');
    console.warn('  DATA_DIR = ', config.DATA_DIR);
    console.warn('Aman untuk dijalankan di komputer sendiri.');
    console.warn('TAPI kalau di-hosting gratis (Render/Railway/dll), isi folder ini kembali ke');
    console.warn('kondisi awal setiap server restart/redeploy -> data hilang, API key user');
    console.warn('jadi tidak valid.');
    console.warn('Perbaikan TERMUDAH & GRATIS: buat MongoDB Atlas (tier M0) lalu set env');
    console.warn('  MONGODB_URI=mongodb+srv://...        (lihat backend/README.md)');
    console.warn('================================================================\n');
  } else if (config.MONGODB_URI) {
    console.log('Penyimpanan data permanen aktif via MongoDB Atlas.');
  } else {
    console.log('Penyimpanan permanen aktif -> DATA_DIR:', config.DATA_DIR, '| UPLOADS_DIR:', config.UPLOADS_DIR);
  }

  // Catatan: file upload (audio/gambar) di UPLOADS_DIR TIDAK ikut disimpan di MongoDB.
  // Kalau CLOUDINARY_URL diisi, file baru sudah permanen (lihat utils/mediaStorage.js).
  if (!config.UPLOADS_ARE_PERSISTENT) {
    console.warn('\n==================== PERINGATAN FILE UPLOAD ====================');
    console.warn('File audio & gambar yang diunggah admin masih disimpan di folder aplikasi:');
    console.warn('  UPLOADS_DIR = ', config.UPLOADS_DIR);
    console.warn('Kalau di-hosting gratis, folder ini ikut ter-reset saat restart/redeploy ->');
    console.warn('lagu tetap tercatat (aman di MongoDB), TAPI filenya hilang -> gagal diputar (404).');
    console.warn('Perbaikan GRATIS: buat akun Cloudinary lalu set env');
    console.warn('  CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME   (lihat backend/README.md)');
    console.warn('================================================================\n');
  } else if (config.CLOUDINARY_URL) {
    console.log('Penyimpanan file upload (audio/gambar) permanen aktif via Cloudinary.');
  }

  server = app.listen(config.PORT, () => {
    console.log(`🎵 Nandaku Backend berjalan di http://localhost:${config.PORT}`);
    if (config.SELF_PING_URL) {
      console.log('Self-ping aktif ->', config.SELF_PING_URL, '(mencegah server tidur di hosting gratis).');
    }
  });
  startSelfPing();
}

start().catch(err => {
  // Jaring pengaman terakhir: kalau start() sampai gagal total, JANGAN biarkan proses mati
  // tanpa keterangan (yang di hosting terlihat sebagai "restart" berulang tanpa sebab jelas).
  // Tetap coba nyalakan server polos supaya endpoint /api/health minimal bisa dijangkau.
  console.error('[start] Gagal total, mencoba menyalakan server minimal:', err);
  if (!server) {
    server = app.listen(config.PORT, () => {
      console.log(`🎵 Nandaku Backend (mode darurat) berjalan di http://localhost:${config.PORT}`);
    });
  }
});

module.exports = { app, get server() { return server; } };
