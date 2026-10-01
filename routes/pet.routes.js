const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../utils/db');
const { addExp, setPetType, petProgress, listPetTypes, isMythical } = require('../utils/pet');
const missions = require('../utils/missions');
const apiKeyAuth = require('../middleware/apiKeyAuth');

// Ambil data user terbaru dari penyimpanan + lengkapi field yang belum ada.
// Mencegah error 500 "Cannot read properties of undefined" pada akun lama.
function loadUser(req, res) {
  const users = readData('users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) {
    res.status(401).json({ code: 'INVALID_API_KEY', error: 'Sesi tidak valid. Silakan login ulang.' });
    return null;
  }
  if (!user.pet) user.pet = { ...DEFAULT_PET };
  if (!Array.isArray(user.unlockedPetTypes)) user.unlockedPetTypes = [];
  // Disimpan sebagai properti TERSEMBUNYI (non-enumerable) supaya tidak ikut
  // ter-JSON.stringify saat menyimpan (kalau ikut, terjadi circular reference
  // dan penyimpanan data gagal total).
  Object.defineProperty(user, '_all', { value: users, enumerable: false, configurable: true, writable: true });
  return user;
}

// GET /api/pet -> status peliharaan virtual milik user (berdasar API key)
const DEFAULT_PET = { type: 'naga', level: 1, exp: 0, stage: 'Telur', icon: '🥚' };

router.get('/pet', apiKeyAuth, (req, res) => {
  res.json({ pet: req.user.pet || DEFAULT_PET });
});

// GET /api/pet/progress -> detail untuk menu level: level, exp, batas level (s.d. Dewasa), daftar tahap
router.get('/pet/progress', apiKeyAuth, (req, res) => {
  res.json({ progress: petProgress(req.user.pet || DEFAULT_PET) });
});

// GET /api/pet/types -> daftar jenis hewan peliharaan yang bisa dipilih (termasuk status kunci mitologi)
router.get('/pet/types', apiKeyAuth, (req, res) => {
  const unlocked = req.user.unlockedPetTypes || [];
  const access = missions.hasMythicalAccess(req.user);
  res.json({
    types: listPetTypes(unlocked, access),
    isVip: !!req.user.vip,
    isLongTimeUser: missions.isLongTimeUser(req.user)
  });
});

// GET /api/pet/missions -> progres misi harian (syarat sebelum bisa "Beri Makan")
// Ini endpoint READ (dipanggil tiap kali menu peliharaan dibuka), jadi HANYA menulis
// ke data/users.json kalau struktur misinya memang baru dibuat/direset (ganti hari).
// Sebelumnya endpoint ini selalu menulis walau cuma sekadar dilihat, yang bikin
// nodemon (mode dev) mendeteksi perubahan file dan me-restart server tiap menu
// peliharaan dibuka.
router.get('/pet/missions', apiKeyAuth, (req, res) => {
  const user = loadUser(req, res);
  if (!user) return;
  const users = user._all;
  const missionsBefore = user.missions ? JSON.stringify(user.missions) : null;
  const status = missions.missionsStatus(user);
  const missionsAfter = JSON.stringify(user.missions);
  if (missionsAfter !== missionsBefore) writeData('users.json', users);
  res.json({ missions: status });
});

// POST /api/pet/listen-progress -> dikirim berkala oleh player selagi lagu diputar & tab aktif
// (tiap 5 detik, lihat frontend/js/player.js).
//
// PENTING: sebelumnya endpoint ini SELALU menulis ke data/users.json tiap dipanggil, artinya
// file data berubah tiap 5 detik selama musik diputar. Di mode dev (`npm run dev` / nodemon),
// atau kalau ada tool lain yang mem-watch folder proyek (live-reload dll), perubahan file
// sesering itu memicu restart/reload berulang-ulang -- bug restart yang sebelumnya cuma muncul
// saat upload lagu, jadi ikut muncul tiap kali musik diputar.
//
// Perbaikannya: progres detik ditampung dulu di memori (per user), dan baru benar-benar
// ditulis ke data/users.json paling cepat tiap 30 detik (atau begitu misi "5 menit mendengarkan"
// baru saja selesai, supaya statusnya langsung tersimpan). Ini mengurangi frekuensi tulis ke
// disk sampai 6x lipat lebih jarang tanpa mengubah cara kerja misinya untuk pengguna.
const FLUSH_INTERVAL_MS = 30 * 1000;
const lastFlushAtByUserId = new Map();

router.post('/pet/listen-progress', apiKeyAuth, (req, res) => {
  const { seconds } = req.body;
  const user = loadUser(req, res);
  if (!user) return;
  const users = user._all;
  const wasListenDone = missions.missionsStatus(user).listenDone;
  const status = missions.addListenSeconds(user, Number(seconds) || 0);

  const now = Date.now();
  const lastFlush = lastFlushAtByUserId.get(user.id) || 0;
  const justFinishedListening = !wasListenDone && status.listenDone;
  if (justFinishedListening || now - lastFlush >= FLUSH_INTERVAL_MS) {
    writeData('users.json', users);
    lastFlushAtByUserId.set(user.id, now);
  }

  res.json({ missions: status });
});

// POST /api/pet/interact -> "Beri Makan" peliharaan. Hanya bisa dilakukan setelah
// misi harian selesai (mis. dengarkan musik 5 menit + putar minimal 3 lagu).
router.post('/pet/interact', apiKeyAuth, (req, res) => {
  const user = loadUser(req, res);
  if (!user) return;
  const users = user._all;
  const status = missions.missionsStatus(user);

  if (!status.allDone) {
    return res.status(400).json({
      error: 'Selesaikan misi harian dulu sebelum bisa memberi makan peliharaan.',
      missions: status
    });
  }

  const { pet, leveledUp, maxed } = addExp(user.pet, 20);
  user.pet = pet;
  missions.markFed(user);
  writeData('users.json', users);
  res.json({
    pet: user.pet,
    leveledUp,
    maxed,
    reaction: 'senang',
    progress: petProgress(user.pet),
    missions: missions.missionsStatus(user)
  });
});

// POST /api/pet/change-type -> ganti jenis hewan peliharaan (level & exp tetap)
// Peliharaan mitologi hanya bisa dipilih oleh VIP/pengguna lama, atau yang sudah
// membukanya lewat misi (mis. Typing Test dengan akurasi & kecepatan tinggi).
router.post('/pet/change-type', apiKeyAuth, (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ error: 'type wajib diisi.' });

  const user = loadUser(req, res);
  if (!user) return;
  const users = user._all;

  if (isMythical(type)) {
    const unlocked = user.unlockedPetTypes || [];
    const access = missions.hasMythicalAccess(user);
    if (!access && !unlocked.includes(type)) {
      return res.status(403).json({
        error: 'Peliharaan mitologi ini masih terkunci. Jadilah VIP/pengguna lama, atau selesaikan misi Typing Test dengan kecepatan & akurasi tinggi untuk membukanya.'
      });
    }
  }

  try {
    setPetType(user.pet, type);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  writeData('users.json', users);
  res.json({ pet: user.pet, progress: petProgress(user.pet) });
});

module.exports = router;
