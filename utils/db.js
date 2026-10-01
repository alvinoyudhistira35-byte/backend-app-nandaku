const fs = require('fs');
const path = require('path');
const config = require('../config');

// ==========================================================================================
// PENYIMPANAN DATA: FILE LOKAL (CEPAT) + MONGODB ATLAS (PERMANEN)
// ------------------------------------------------------------------------------------------
// Kenapa dua-duanya?
//  - File lokal (DATA_DIR/*.json) tetap dipakai sebagai "cache" baca/tulis yang CEPAT dan
//    SINKRON, supaya semua route yang sudah ada (readData/writeData) tidak perlu diubah
//    sama sekali jadi async/await.
//  - MongoDB Atlas (kalau MONGODB_URI diisi di .env) jadi tempat penyimpanan yang BENAR-BENAR
//    PERMANEN, di luar disk hosting. Karena kebanyakan hosting gratis (mis. Render free)
//    mengembalikan isi folder aplikasi ke kondisi awal deploy setiap kali server redeploy/
//    bangun dari idle-sleep, file lokal saja TIDAK CUKUP di hosting gratis.
//
// Alurnya:
//  1. initStorage() (dipanggil sekali saat server start, dan HARUS di-await):
//     - Menyiapkan file lokal seperti biasa (seed dari data bawaan kalau masih kosong).
//     - Kalau MONGODB_URI diisi: konek ke Atlas, lalu untuk tiap koleksi:
//         * kalau Atlas SUDAH punya data -> tarik ke file lokal (Atlas menang, ini yang
//           membuat data "pulih" walau file lokal baru saja direset oleh hosting).
//         * kalau Atlas MASIH KOSONG -> upload data lokal (seed) ke Atlas, jadi Atlas mulai
//           terisi dari titik awal yang sama.
//  2. writeData(name, data) tetap SINKRON seperti dulu (tulis atomik ke file lokal + backup
//     .bak), lalu KALAU Atlas aktif, kirim salinan terbaru ke Atlas di latar belakang
//     (tidak menunggu/blocking, supaya request tetap cepat). Kalau pengiriman ke Atlas
//     gagal (mis. internet sempat putus), data tetap aman di file lokal & akan terkirim
//     lagi di penulisan berikutnya.
//  3. readData(name) tetap membaca dari file lokal (sinkron, cepat) seperti dulu.
//
// Kalau MONGODB_URI TIDAK diisi, semuanya berjalan PERSIS seperti sebelumnya (file lokal saja)
// -> aman dipakai untuk pengembangan di komputer sendiri tanpa perlu setup Atlas.
// ==========================================================================================

const KNOWN_FILES = [
  'users.json', 'songs.json', 'artists.json', 'stories.json',
  'chats.json', 'friend_requests.json', 'typing_texts.json'
];

let mongoClient = null;
let mongoDb = null;
let mongoReady = false; // true kalau sudah konek DAN sinkronisasi awal selesai

function filePath(name) {
  return path.join(config.DATA_DIR, name);
}

function collectionName(name) {
  return name.replace(/\.json$/, '');
}

function safeParse(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function copyDirIfMissing(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirIfMissing(src, dst);
    else if (!fs.existsSync(dst)) {
      try { fs.copyFileSync(src, dst); } catch (err) { console.error('Gagal menyalin', src, err.message); }
    }
  }
}

// ---------- Baca/tulis file lokal (logika lama, tidak berubah) ----------

function readLocal(name) {
  const p = filePath(name);

  if (fs.existsSync(p)) {
    const parsed = safeParse(fs.readFileSync(p, 'utf-8'));
    if (parsed) return parsed;
    console.error(`[db] ${name} rusak/terpotong. Mencoba memulihkan dari cadangan (.bak).`);
  }

  const bak = p + '.bak';
  if (fs.existsSync(bak)) {
    const parsed = safeParse(fs.readFileSync(bak, 'utf-8'));
    if (parsed) {
      try {
        if (fs.existsSync(p)) fs.renameSync(p, p + '.corrupt-' + Date.now());
        fs.copyFileSync(bak, p);
        console.error(`[db] ${name} berhasil dipulihkan dari cadangan.`);
      } catch (err) {
        console.error('[db] Gagal memulihkan', name, err.message);
      }
      return parsed;
    }
  }

  return [];
}

function writeLocal(name, data) {
  if (!Array.isArray(data)) {
    throw new Error(`writeData(${name}) hanya menerima array.`);
  }
  const p = filePath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  // Simpan versi sebelumnya sebagai cadangan sebelum ditimpa.
  try {
    if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
  } catch (err) {
    console.error('[db] Gagal membuat cadangan', name, err.message);
  }

  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd); // pastikan benar-benar sampai ke disk sebelum rename
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p); // rename bersifat atomik: file tidak pernah setengah jadi
}

// ---------- MongoDB Atlas (opsional) ----------

async function connectMongo() {
  if (!config.MONGODB_URI) return null;
  if (mongoDb) return mongoDb;

  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch (err) {
    console.error('[db] Paket "mongodb" belum ter-install. Jalankan "npm install" di folder backend dulu.');
    throw err;
  }

  mongoClient = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await mongoClient.connect();
  mongoDb = mongoClient.db(config.MONGODB_DB_NAME);
  return mongoDb;
}

/** Menyalin data bawaan (repo) ke DATA_DIR hanya jika di sana belum ada, lalu (kalau dipasang)
 *  menyinkronkan dengan MongoDB Atlas supaya data permanen walau disk lokal ter-reset. */
async function initStorage() {
  // Dibungkus try/catch supaya kalau ada masalah membuat folder (mis. izin/permission di
  // host tertentu), initStorage() TIDAK gagal total -> server tetap lanjut menyala dan
  // melayani request, bukannya diam-diam tidak pernah start (yang di banyak hosting gratis
  // membuat platform-nya berpikir server "crash" lalu terus mencoba me-restart berulang-ulang).
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.error('[db] Gagal menyiapkan folder penyimpanan:', err.message);
  }

  for (const name of KNOWN_FILES) {
    const target = filePath(name);
    if (fs.existsSync(target)) continue;
    const seed = path.join(config.SEED_DATA_DIR, name);
    try {
      if (fs.existsSync(seed) && path.resolve(seed) !== path.resolve(target)) {
        fs.copyFileSync(seed, target);
      } else {
        fs.writeFileSync(target, '[]');
      }
    } catch (err) {
      console.error('Gagal menyiapkan file data', name, err.message);
    }
  }

  // Salin aset bawaan (cover/foto artis/lagu contoh) ke UPLOADS_DIR kalau belum ada,
  // supaya gambar default tidak jadi gambar rusak saat memakai disk permanen.
  if (path.resolve(config.SEED_UPLOADS_DIR) !== path.resolve(config.UPLOADS_DIR)) {
    copyDirIfMissing(config.SEED_UPLOADS_DIR, config.UPLOADS_DIR);
  }

  if (!config.MONGODB_URI) return; // tanpa Atlas -> berhenti di sini, seperti sebelumnya

  try {
    const db = await connectMongo();
    for (const name of KNOWN_FILES) {
      const col = db.collection(collectionName(name));
      const count = await col.countDocuments();

      if (count > 0) {
        // Atlas sudah punya data -> ini sumber kebenaran, tarik ke file lokal.
        const docs = await col.find({}, { projection: { _id: 0 } }).toArray();
        writeLocal(name, docs);
      } else {
        // Atlas masih kosong -> upload data lokal (bawaan/seed) supaya Atlas mulai terisi.
        const local = readLocal(name);
        if (local.length) await col.insertMany(local);
      }
    }
    mongoReady = true;
    console.log('[db] Terhubung ke MongoDB Atlas -> data akan tersimpan permanen di sana.');
  } catch (err) {
    mongoReady = false;
    console.error('[db] Gagal konek/sinkron ke MongoDB Atlas, sementara memakai file lokal saja:', err.message);
    console.error('[db] Periksa MONGODB_URI di .env (termasuk apakah IP hosting sudah di-whitelist di Atlas).');
  }
}

function readData(name) {
  return readLocal(name);
}

function writeData(name, data) {
  // Tulis ke file lokal secara SINKRON dulu (seperti sebelumnya) -> tidak ada perubahan
  // perilaku untuk route yang memanggil fungsi ini.
  writeLocal(name, data);

  // Kalau Atlas aktif, kirim salinan terbaru ke sana di LATAR BELAKANG (tidak menunggu).
  // Strategi paling sederhana & konsisten dengan bentuk data (array penuh, bukan diff):
  // kosongkan koleksi lalu isi ulang dari array yang sama dengan file lokal.
  if (mongoReady && mongoDb) {
    try {
      const col = mongoDb.collection(collectionName(name));
      col.deleteMany({})
        .then(() => (data.length ? col.insertMany(data) : null))
        .catch(err => console.error(`[db] Gagal menyimpan ${name} ke MongoDB Atlas (data lokal tetap aman):`, err.message));
    } catch (err) {
      // Jaga-jaga kalau mongoDb.collection() sendiri sampai melempar error sinkron
      // (mis. koneksi baru saja putus) -- data lokal tetap sudah aman ditulis di atas.
      console.error(`[db] Gagal memulai penyimpanan ${name} ke MongoDB Atlas:`, err.message);
    }
  }
}

function isMongoActive() {
  return mongoReady;
}

module.exports = { readData, writeData, initStorage, KNOWN_FILES, filePath, isMongoActive };
