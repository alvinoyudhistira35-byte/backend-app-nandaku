const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

// ==========================================================================================
// PENYIMPANAN FILE UPLOAD (AUDIO & GAMBAR)
// ------------------------------------------------------------------------------------------
// Dulu: file selalu ditulis langsung ke disk lokal (UPLOADS_DIR) lewat multer.diskStorage.
// Masalahnya, di hosting gratis, UPLOADS_DIR ini ikut ter-reset setiap redeploy/restart ->
// lagu yang barusan diupload jadi tidak bisa diputar lagi (404), walau datanya (judul, dst)
// sudah aman di MongoDB.
//
// Sekarang: kalau CLOUDINARY_URL diisi, file disimpan permanen di Cloudinary dan yang
// disimpan sebagai audioUrl/cover/photo adalah URL penuh Cloudinary (https://res.cloudinary
// .com/...). Kalau CLOUDINARY_URL kosong, perilaku PERSIS seperti sebelumnya: file ditulis
// ke disk lokal dan yang disimpan adalah path relatif ('/uploads/...').
//
// Route (admin.routes.js) memakai multer.memoryStorage() (bukan diskStorage lagi), lalu
// panggil saveFile(buffer, kind, originalname) di sini -> dapat { url, publicId }.
// ==========================================================================================

const CLOUDINARY_ENABLED = Boolean(config.CLOUDINARY_URL);

let cloudinary = null;
if (CLOUDINARY_ENABLED) {
  try {
    cloudinary = require('cloudinary').v2;
    // SDK Cloudinary otomatis membaca env CLOUDINARY_URL, tidak perlu config manual.
  } catch (err) {
    console.error('[media] Paket "cloudinary" belum ter-install. Jalankan "npm install" di folder backend.');
    throw err;
  }
}

function localUploadDir(sub) {
  const dir = path.join(config.UPLOADS_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// kind: 'audio' | 'cover' | 'artist'
const LOCAL_SUBDIR = { audio: 'songs', cover: 'covers', artist: 'artists' };
const CLOUDINARY_FOLDER = { audio: 'nandaku/songs', cover: 'nandaku/covers', artist: 'nandaku/artists' };
// Cloudinary memperlakukan file audio lewat resource_type 'video' (ini yang dipakai
// Cloudinary untuk semua media berbasis waktu, termasuk mp3/wav/dll), sedangkan
// gambar cukup 'image'.
const CLOUDINARY_RESOURCE_TYPE = { audio: 'video', cover: 'image', artist: 'image' };

function cleanExt(originalname) {
  return path.extname(originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
}

/** Simpan satu file (Buffer) dan kembalikan { url, publicId, resourceType }.
 *  url: dipakai langsung sebagai audioUrl/cover/photo (bisa path relatif ATAU URL penuh).
 *  publicId + resourceType: dipakai nanti kalau file ini perlu dihapus (lihat deleteFile). */
async function saveFile(buffer, kind, originalname) {
  if (CLOUDINARY_ENABLED) {
    const resourceType = CLOUDINARY_RESOURCE_TYPE[kind] || 'auto';
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: CLOUDINARY_FOLDER[kind] || 'nandaku/misc', resource_type: resourceType },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(buffer);
    });
    return { url: result.secure_url, publicId: result.public_id, resourceType };
  }

  // Fallback lama: tulis ke disk lokal.
  const dir = localUploadDir(LOCAL_SUBDIR[kind] || 'misc');
  const filename = uuidv4() + (cleanExt(originalname) || '');
  fs.writeFileSync(path.join(dir, filename), buffer);
  return { url: `/uploads/${LOCAL_SUBDIR[kind] || 'misc'}/${filename}`, publicId: null, resourceType: null };
}

/** Hapus file berdasarkan info yang disimpan bersama data lagu/artis:
 *  - Kalau ada publicId (berarti file di Cloudinary) -> hapus lewat API Cloudinary.
 *  - Kalau tidak (file lama di disk lokal, dari sebelum Cloudinary aktif) -> hapus dari disk. */
function deleteFile(publicUrl, publicId, resourceType) {
  if (publicId && CLOUDINARY_ENABLED) {
    cloudinary.uploader.destroy(publicId, { resource_type: resourceType || 'image' })
      .catch(err => console.error('[media] Gagal menghapus file di Cloudinary:', publicId, err.message));
    return;
  }
  deleteLocalFile(publicUrl);
}

function deleteLocalFile(publicUrl) {
  if (!publicUrl || typeof publicUrl !== 'string') return;
  if (publicUrl.includes('default-artist.svg') || publicUrl.includes('default-avatar.svg')) return;
  if (!publicUrl.startsWith('/uploads/')) return; // URL Cloudinary (http...) tidak diproses di sini

  const relative = publicUrl.replace(/^\/uploads\//, '');
  const absolutePath = path.resolve(config.UPLOADS_DIR, relative);
  const root = path.resolve(config.UPLOADS_DIR);
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    console.error('Ditolak: percobaan menghapus file di luar folder uploads:', publicUrl);
    return;
  }
  fs.unlink(absolutePath, (err) => {
    if (err && err.code !== 'ENOENT') console.error('Gagal menghapus file:', absolutePath, err.message);
  });
}

module.exports = { saveFile, deleteFile, isCloudinaryActive: () => CLOUDINARY_ENABLED };
