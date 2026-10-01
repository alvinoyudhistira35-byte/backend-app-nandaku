const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { readData, writeData, KNOWN_FILES, isMongoActive } = require('../utils/db');
const mediaStorage = require('../utils/mediaStorage');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const adminAuth = require('../middleware/adminAuth');
const config = require('../config');

const LIMITS = config.UPLOAD_LIMITS;

// File ditampung di MEMORI dulu (bukan langsung ditulis ke disk) -> baru benar-benar
// disimpan (ke Cloudinary atau disk lokal, lihat utils/mediaStorage.js) SETELAH semua
// validasi data (judul, nama artis, dst) lolos. Jadi kalau validasi gagal, tidak ada file
// yatim yang perlu dibersihkan sama sekali -- bandingkan dengan diskStorage sebelumnya yang
// menulis dulu baru menghapus lagi kalau ternyata gagal.
const storage = multer.memoryStorage();

// Saring jenis file: audio hanya untuk field 'audio', gambar untuk 'cover'/'photo'.
// Dulu tanpa saringan sama sekali -> file apa pun (bahkan .exe/.php) bisa masuk folder publik.
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const isAudioField = file.fieldname === 'audio';
  const allowedMime = isAudioField ? LIMITS.audioMime : LIMITS.imageMime;
  const allowedExt = isAudioField ? LIMITS.audioExt : LIMITS.imageExt;

  if (allowedMime.includes(file.mimetype) || allowedExt.includes(ext)) return cb(null, true);

  const err = new Error(
    isAudioField
      ? `Format audio tidak didukung. Gunakan: ${LIMITS.audioExt.join(', ')}.`
      : `Format gambar tidak didukung. Gunakan: ${LIMITS.imageExt.join(', ')}.`
  );
  err.code = 'INVALID_FILE_TYPE';
  cb(err);
}

// Satu instance multer per batas jumlah file (upload 1 lagu = 2 file, upload banyak foto
// artis sekaligus = sampai 30 file).
const uploaders = {};
function getUploader(maxFiles) {
  if (!uploaders[maxFiles]) {
    uploaders[maxFiles] = multer({
      storage,
      fileFilter,
      limits: { fileSize: Math.max(LIMITS.audioBytes, LIMITS.imageBytes), files: maxFiles }
    });
  }
  return uploaders[maxFiles];
}

// Bungkus multer supaya kegagalan upload dibalas JSON yang jelas, bukan error 500 generik.
// Ini memperbaiki kasus "upload gagal tanpa keterangan" pada file besar / format tak didukung.
function handleUpload(fields, maxFiles = 2) {
  const mw = getUploader(maxFiles).fields(fields);
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) {
        req.files = req.files || {};
        return next();
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `File terlalu besar. Maksimal audio ${Math.round(LIMITS.audioBytes / 1048576)} MB dan gambar ${Math.round(LIMITS.imageBytes / 1048576)} MB.`
        });
      }
      if (err.code === 'INVALID_FILE_TYPE') return res.status(415).json({ error: err.message });
      console.error('Upload error:', err);
      return res.status(400).json({ error: 'Gagal mengunggah file: ' + err.message });
    });
  };
}

// Hapus file lagu/cover/foto artis lama (di Cloudinary ATAU disk lokal, mediaStorage yang
// menentukan otomatis berdasarkan ada/tidaknya publicId).
function deleteMedia(entry, urlField, publicIdField, resourceTypeField) {
  if (!entry) return;
  mediaStorage.deleteFile(entry[urlField], entry[publicIdField], entry[resourceTypeField]);
}

// ---- Helper lirik, nama, dan deteksi duplikat ----
const MAX_LYRICS_CHARS = 60000;

// Lirik boleh teks biasa ATAU format LRC ([mm:ss.xx] baris lirik) -> disimpan apa adanya sebagai teks.
function cleanLyrics(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_LYRICS_CHARS);
}

// Kunci pembanding nama: huruf kecil, tanda baca (_ - .) dianggap spasi. Dipakai mencocokkan
// "rex-voltage.jpg" dengan artis "Rex Voltage".
function nameKey(value) {
  return String(value || '')
    .replace(/\.(jpe?g|png|webp|gif|svg)$/i, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function prettyName(value) {
  return String(value || '')
    .replace(/\.(jpe?g|png|webp|gif|svg)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isDuplicateSong(songs, artistId, title) {
  const key = titleKey(title);
  return songs.some(s => s.artistId === artistId && titleKey(s.title) === key);
}

function stripLyrics(song) {
  const { lyrics, ...rest } = song;
  return { ...rest, hasLyrics: Boolean(lyrics && String(lyrics).trim()) };
}

// Semua route admin wajib API key valid + role admin
router.use(apiKeyAuth, adminAuth);

// GET /api/admin/storage -> memberi tahu admin di mana data disimpan dan apakah aman.
// Berguna untuk memastikan penyebab "data hilang setelah restart" sudah teratasi.
router.get('/admin/storage', (req, res) => {
  res.json({
    dataDir: config.DATA_DIR,
    uploadsDir: config.UPLOADS_DIR,
    dataPersistent: config.DATA_IS_PERSISTENT,
    mongoActive: isMongoActive(),
    uploadsPersistent: config.UPLOADS_ARE_PERSISTENT,
    cloudinaryActive: mediaStorage.isCloudinaryActive(),
    warning: config.DATA_IS_PERSISTENT
      ? null
      : 'Data (akun, lagu, dll) masih disimpan di dalam folder aplikasi. Kalau di-hosting, isinya bisa kembali ke kondisi awal setiap server restart/redeploy. Set MONGODB_URI (MongoDB Atlas, gratis) di .env supaya data permanen -> lihat backend/README.md.',
    uploadsWarning: config.UPLOADS_ARE_PERSISTENT
      ? null
      : 'File upload (audio/gambar) belum permanen -> lagu bisa 404 setelah server restart/redeploy. Set CLOUDINARY_URL (Cloudinary, gratis) di .env -> lihat backend/README.md.'
  });
});

// GET /api/admin/backup -> unduh seluruh data JSON (akun, lagu, artis, dll) sebagai satu file.
router.get('/admin/backup', (req, res) => {
  const backup = { createdAt: new Date().toISOString(), version: 1, data: {} };
  KNOWN_FILES.forEach(name => { backup.data[name] = readData(name); });
  res.setHeader('Content-Disposition', `attachment; filename="nandaku-backup-${Date.now()}.json"`);
  res.json(backup);
});

// POST /api/admin/restore -> pulihkan data dari file backup di atas.
// Penyelamat kalau data pernah ter-reset: tinggal unggah backup terakhir.
router.post('/admin/restore', express.json({ limit: '25mb' }), (req, res) => {
  const payload = req.body && req.body.data;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'File backup tidak valid.' });
  }
  const restored = [];
  for (const name of KNOWN_FILES) {
    if (Array.isArray(payload[name])) {
      writeData(name, payload[name]);
      restored.push(name);
    }
  }
  if (!restored.length) return res.status(400).json({ error: 'Tidak ada data yang bisa dipulihkan dari file ini.' });
  res.json({ message: `Data berhasil dipulihkan (${restored.join(', ')}).`, restored });
});

// POST /api/admin/songs -> admin upload SATU lagu. Panel admin memanggil endpoint ini sekali
// per lagu (beberapa sekaligus secara paralel) sehingga bisa upload banyak lagu dalam sekali
// pilih, dengan progres & hasil per lagu.
// Admin cukup mengetik NAMA artis; kalau belum ada, artis dibuat otomatis.
// Field opsional: lyrics (teks biasa / format LRC), allowDuplicate=1.
router.post('/admin/songs', handleUpload([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req, res, next) => {
  let audioFile = null;
  let coverFile = null;
  try {
    const title = (req.body.title || '').trim().slice(0, 150);
    const artistName = (req.body.artistName || '').trim().slice(0, 80);
    const genre = (req.body.genre || '').trim().slice(0, 30);
    const lyrics = cleanLyrics(req.body.lyrics);
    const allowDuplicate = req.body.allowDuplicate === '1';

    if (!title || !artistName) {
      return res.status(400).json({ error: 'Judul dan nama artis wajib diisi.' });
    }
    // Dulu lagu tetap tersimpan walau file audio tidak ikut terkirim, jadi muncul lagu
    // "hantu" yang tidak bisa diputar. Sekarang ditolak sejak awal.
    if (!req.files.audio || !req.files.audio[0]) {
      return res.status(400).json({ error: 'File audio wajib diunggah.' });
    }

    // Cek duplikat SEBELUM menyimpan file apa pun (lagu yang sama = judul + artis yang sama),
    // supaya upload ulang daftar yang sama tidak menumpuk lagu ganda.
    const existingArtist = readData('artists.json').find(a => nameKey(a.name) === nameKey(artistName));
    if (existingArtist && !allowDuplicate && isDuplicateSong(readData('songs.json'), existingArtist.id, title)) {
      return res.status(409).json({ code: 'DUPLICATE_SONG', error: `Lagu "${title}" oleh ${existingArtist.name} sudah ada.` });
    }

    // Cari / buat artis tanpa jeda async di antaranya -> aman walau beberapa lagu dari artis
    // baru yang sama diunggah bersamaan (tidak akan terbentuk artis ganda).
    const artists = readData('artists.json');
    let artist = artists.find(a => nameKey(a.name) === nameKey(artistName));
    if (!artist) {
      artist = {
        id: 'art-' + uuidv4(),
        name: artistName,
        bio: '',
        photo: '/uploads/artists/default-artist.svg'
      };
      artists.push(artist);
      writeData('artists.json', artists);
    }

    // Baru sekarang file benar-benar disimpan (Cloudinary kalau aktif, kalau tidak ke disk
    // lokal) -- setelah semua validasi di atas lolos.
    audioFile = await mediaStorage.saveFile(req.files.audio[0].buffer, 'audio', req.files.audio[0].originalname);
    coverFile = req.files.cover
      ? await mediaStorage.saveFile(req.files.cover[0].buffer, 'cover', req.files.cover[0].originalname)
      : null;

    // Baca & tulis daftar lagu tanpa jeda async -> upload paralel tidak saling menimpa.
    const songs = readData('songs.json');
    if (!allowDuplicate && isDuplicateSong(songs, artist.id, title)) {
      // Kasus langka: lagu yang sama baru saja masuk lewat request paralel. Bersihkan file-nya.
      mediaStorage.deleteFile(audioFile.url, audioFile.publicId, audioFile.resourceType);
      if (coverFile) mediaStorage.deleteFile(coverFile.url, coverFile.publicId, coverFile.resourceType);
      return res.status(409).json({ code: 'DUPLICATE_SONG', error: `Lagu "${title}" oleh ${artist.name} sudah ada.` });
    }

    const newSong = {
      id: 'song-' + uuidv4(),
      title,
      artistId: artist.id,
      artistName: artist.name,
      genre: genre || 'pop',
      cover: coverFile ? coverFile.url : artist.photo,
      coverPublicId: coverFile ? coverFile.publicId : null,
      coverResourceType: coverFile ? coverFile.resourceType : null,
      audioUrl: audioFile.url,
      audioPublicId: audioFile.publicId,
      audioResourceType: audioFile.resourceType,
      lyrics,
      plays: 0,
      createdAt: new Date().toISOString()
    };
    songs.push(newSong);
    writeData('songs.json', songs);

    res.status(201).json({ message: 'Lagu baru berhasil diunggah dan langsung tersedia untuk pengguna.', song: stripLyrics(newSong), artist });
  } catch (err) {
    // Gagal di tengah jalan (mis. audio sudah tersimpan tapi cover gagal) -> jangan tinggalkan file yatim.
    if (audioFile) mediaStorage.deleteFile(audioFile.url, audioFile.publicId, audioFile.resourceType);
    if (coverFile) mediaStorage.deleteFile(coverFile.url, coverFile.publicId, coverFile.resourceType);
    next(err);
  }
});

// POST /api/admin/artists -> tambah / lengkapi artis (nama, bio, foto).
router.post('/admin/artists', handleUpload([{ name: 'photo', maxCount: 1 }]), async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const bio = (req.body.bio || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Nama artis wajib diisi.' });
    }

    const artists = readData('artists.json');
    const artist = artists.find(a => (a.name || '').toLowerCase() === name.toLowerCase());
    if (artist) {
      if (bio) artist.bio = bio;
      if (req.files.photo) {
        const oldPhoto = artist.photo;
        const oldPhotoPublicId = artist.photoPublicId;
        const oldPhotoResourceType = artist.photoResourceType;
        const photoFile = await mediaStorage.saveFile(req.files.photo[0].buffer, 'artist', req.files.photo[0].originalname);
        artist.photo = photoFile.url;
        artist.photoPublicId = photoFile.publicId;
        artist.photoResourceType = photoFile.resourceType;
        // Lagu yang memakai foto artis sebagai cover ikut diperbarui supaya tidak jadi gambar rusak.
        const songs = readData('songs.json');
        let touched = false;
        songs.forEach(s => { if (s.artistId === artist.id && s.cover === oldPhoto) { s.cover = artist.photo; touched = true; } });
        if (touched) writeData('songs.json', songs);
        if (oldPhoto !== artist.photo) mediaStorage.deleteFile(oldPhoto, oldPhotoPublicId, oldPhotoResourceType);
      }
      writeData('artists.json', artists);
      return res.status(200).json({ message: 'Data artis diperbarui.', artist });
    }

    const photoFile = req.files.photo
      ? await mediaStorage.saveFile(req.files.photo[0].buffer, 'artist', req.files.photo[0].originalname)
      : null;
    const newArtist = {
      id: 'art-' + uuidv4(),
      name,
      bio,
      photo: photoFile ? photoFile.url : '/uploads/artists/default-artist.svg',
      photoPublicId: photoFile ? photoFile.publicId : null,
      photoResourceType: photoFile ? photoFile.resourceType : null
    };
    artists.push(newArtist);
    writeData('artists.json', artists);
    res.status(201).json({ message: 'Artis baru berhasil ditambahkan.', artist: newArtist });
  } catch (err) { next(err); }
});

// POST /api/admin/artists/bulk -> tambah / perbarui BANYAK artis sekaligus.
// Field: list = teks, satu artis per baris, format "Nama | bio singkat" (bio opsional);
//        photo (banyak file) + photoNames = JSON array nama file asli (urutannya sama dengan photo).
// Foto dicocokkan ke artis lewat nama file ("rex-voltage.jpg" -> "Rex Voltage"). Foto yang tidak
// punya baris di daftar otomatis membuat artis baru bernama sesuai nama file.
const MAX_BULK_ARTISTS = 100;
router.post('/admin/artists/bulk', handleUpload([{ name: 'photo', maxCount: 30 }], 30), async (req, res, next) => {
  try {
    const entries = new Map(); // key -> { name, bio }
    String(req.body.list || '').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const bar = trimmed.indexOf('|');
      const name = (bar === -1 ? trimmed : trimmed.slice(0, bar)).trim().slice(0, 80);
      const bio = (bar === -1 ? '' : trimmed.slice(bar + 1)).trim().slice(0, 500);
      const key = nameKey(name);
      if (name && !entries.has(key)) entries.set(key, { name, bio });
    });

    let photoNames = [];
    try { photoNames = JSON.parse(req.body.photoNames || '[]'); } catch (_) { photoNames = []; }
    const photos = new Map(); // key -> multer file
    (req.files.photo || []).forEach((file, i) => {
      // Nama dari klien (UTF-8) lebih tepercaya daripada originalname multer untuk nama non-ASCII.
      const raw = (typeof photoNames[i] === 'string' && photoNames[i]) ? photoNames[i] : file.originalname;
      const key = nameKey(raw);
      if (!key) return;
      photos.set(key, file);
      if (!entries.has(key)) entries.set(key, { name: prettyName(raw).slice(0, 80), bio: '' });
    });

    if (!entries.size) return res.status(400).json({ error: 'Isi minimal satu nama artis atau pilih foto artis.' });
    if (entries.size > MAX_BULK_ARTISTS) return res.status(400).json({ error: `Maksimal ${MAX_BULK_ARTISTS} artis sekaligus.` });

    const results = [];
    for (const [key, entry] of entries) {
      try {
        const photo = photos.get(key);
        // Simpan foto dulu (async), BARU baca-ubah-tulis data artis tanpa jeda -> aman dari tabrakan.
        const photoFile = photo ? await mediaStorage.saveFile(photo.buffer, 'artist', photo.originalname) : null;

        const artists = readData('artists.json');
        let artist = artists.find(a => nameKey(a.name) === key);
        let status = 'unchanged';
        let oldPhoto = null;
        if (!artist) {
          artist = {
            id: 'art-' + uuidv4(),
            name: entry.name,
            bio: entry.bio,
            photo: photoFile ? photoFile.url : '/uploads/artists/default-artist.svg',
            photoPublicId: photoFile ? photoFile.publicId : null,
            photoResourceType: photoFile ? photoFile.resourceType : null
          };
          artists.push(artist);
          status = 'created';
        } else {
          if (entry.bio && entry.bio !== artist.bio) { artist.bio = entry.bio; status = 'updated'; }
          if (photoFile) {
            oldPhoto = { url: artist.photo, publicId: artist.photoPublicId, resourceType: artist.photoResourceType };
            artist.photo = photoFile.url;
            artist.photoPublicId = photoFile.publicId;
            artist.photoResourceType = photoFile.resourceType;
            status = 'updated';
          }
        }
        writeData('artists.json', artists);

        if (oldPhoto && oldPhoto.url !== artist.photo) {
          // Lagu yang memakai foto lama sebagai cover ikut diperbarui supaya tidak jadi gambar rusak.
          const songs = readData('songs.json');
          let touched = false;
          songs.forEach(sg => { if (sg.artistId === artist.id && sg.cover === oldPhoto.url) { sg.cover = artist.photo; touched = true; } });
          if (touched) writeData('songs.json', songs);
          mediaStorage.deleteFile(oldPhoto.url, oldPhoto.publicId, oldPhoto.resourceType);
        }
        results.push({ name: artist.name, status, photo: Boolean(photoFile) });
      } catch (err) {
        console.error('[artists/bulk] Gagal memproses artis:', entry.name, err);
        results.push({ name: entry.name, status: 'error', error: err.message });
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    const updated = results.filter(r => r.status === 'updated').length;
    const failed = results.filter(r => r.status === 'error').length;
    res.status(201).json({
      message: `${created} artis baru ditambahkan, ${updated} diperbarui${failed ? `, ${failed} gagal` : ''}.`,
      created, updated, failed, results
    });
  } catch (err) { next(err); }
});

// GET /api/admin/songs -> daftar lengkap semua lagu (urutan asli) untuk panel Kelola Lagu
router.get('/admin/songs', (req, res) => {
  res.json({ songs: readData('songs.json').map(stripLyrics) });
});

// GET /api/admin/songs/:id -> satu lagu lengkap (termasuk lirik) untuk form edit
router.get('/admin/songs/:id', (req, res) => {
  const song = readData('songs.json').find(s => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: 'Lagu tidak ditemukan.' });
  res.json({ song: { ...song, lyrics: song.lyrics || '' } });
});

// PUT /api/admin/songs/:id -> ubah judul, genre, dan/atau lirik lagu yang sudah ada
router.put('/admin/songs/:id', (req, res) => {
  const songs = readData('songs.json');
  const song = songs.find(s => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: 'Lagu tidak ditemukan.' });

  const body = req.body || {};
  if (typeof body.title === 'string') {
    const title = body.title.trim().slice(0, 150);
    if (!title) return res.status(400).json({ error: 'Judul tidak boleh kosong.' });
    song.title = title;
  }
  if (typeof body.genre === 'string' && body.genre.trim()) song.genre = body.genre.trim().slice(0, 30);
  if (typeof body.lyrics === 'string') song.lyrics = cleanLyrics(body.lyrics);

  writeData('songs.json', songs);
  res.json({ message: 'Lagu berhasil diperbarui.', song: stripLyrics(song) });
});

// DELETE /api/admin/songs/:id -> hapus satu lagu (data + file audio & cover-nya)
router.delete('/admin/songs/:id', (req, res) => {
  const songs = readData('songs.json');
  const index = songs.findIndex(s => s.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Lagu tidak ditemukan.' });

  const [removed] = songs.splice(index, 1);
  writeData('songs.json', songs);

  // File audio hanya dihapus kalau tidak dipakai lagu lain (bisa terjadi setelah restore backup).
  if (!songs.some(s => s.audioUrl === removed.audioUrl)) {
    deleteMedia(removed, 'audioUrl', 'audioPublicId', 'audioResourceType');
  }
  if (removed.cover && !songs.some(s => s.cover === removed.cover) && removed.cover !== '/uploads/artists/default-artist.svg') {
    deleteMedia(removed, 'cover', 'coverPublicId', 'coverResourceType');
  }

  res.json({ message: `Lagu "${removed.title}" berhasil dihapus.` });
});

// DELETE /api/admin/artists/:id -> hapus artis beserta SEMUA lagu miliknya
router.delete('/admin/artists/:id', (req, res) => {
  const artists = readData('artists.json');
  const artistIndex = artists.findIndex(a => a.id === req.params.id);
  if (artistIndex === -1) return res.status(404).json({ error: 'Artis tidak ditemukan.' });
  const [removedArtist] = artists.splice(artistIndex, 1);

  const songs = readData('songs.json');
  const keptSongs = songs.filter(s => s.artistId !== removedArtist.id);
  const removedSongs = songs.filter(s => s.artistId === removedArtist.id);

  writeData('artists.json', artists);
  writeData('songs.json', keptSongs);

  removedSongs.forEach(s => {
    if (!keptSongs.some(k => k.audioUrl === s.audioUrl)) deleteMedia(s, 'audioUrl', 'audioPublicId', 'audioResourceType');
    if (s.cover && !keptSongs.some(k => k.cover === s.cover) && s.cover !== '/uploads/artists/default-artist.svg') {
      deleteMedia(s, 'cover', 'coverPublicId', 'coverResourceType');
    }
  });
  if (!keptSongs.some(k => k.cover === removedArtist.photo)) {
    deleteMedia(removedArtist, 'photo', 'photoPublicId', 'photoResourceType');
  }

  res.json({
    message: `Artis "${removedArtist.name}" beserta ${removedSongs.length} lagu miliknya berhasil dihapus.`,
    deletedSongsCount: removedSongs.length
  });
});

// GET /api/admin/stats -> ringkasan statistik untuk dashboard admin
router.get('/admin/stats', (req, res) => {
  const users = readData('users.json');
  const songs = readData('songs.json');
  const artists = readData('artists.json');
  const totalPlays = songs.reduce((sum, s) => sum + (s.plays || 0), 0);
  res.json({ totalUsers: users.length, totalSongs: songs.length, totalArtists: artists.length, totalPlays });
});

// GET /api/admin/users -> daftar pengguna untuk pengelolaan status VIP
router.get('/admin/users', (req, res) => {
  const users = readData('users.json');
  res.json({
    users: users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      vip: !!u.vip,
      role: u.role || 'user',
      createdAt: u.createdAt,
      petType: u.pet ? u.pet.type : null
    }))
  });
});

// POST /api/admin/users/:id/vip -> jadikan/lepas status VIP seorang pengguna
router.post('/admin/users/:id/vip', (req, res) => {
  const { vip } = req.body;
  const users = readData('users.json');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  user.vip = !!vip;
  writeData('users.json', users);
  res.json({
    message: `Status VIP ${user.username} ${user.vip ? 'diaktifkan' : 'dinonaktifkan'}.`,
    user: { id: user.id, username: user.username, vip: user.vip }
  });
});

module.exports = router;
