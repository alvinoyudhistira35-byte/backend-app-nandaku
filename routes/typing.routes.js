const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../utils/db');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const { PET_TYPES } = require('../utils/pet');
const missions = require('../utils/missions');

// GET /api/typing/text?duration=30 -> ambil teks acak untuk tes mengetik
router.get('/typing/text', apiKeyAuth, (req, res) => {
  const texts = readData('typing_texts.json');
  const duration = parseInt(req.query.duration, 10) || 30;
  // makin lama durasi, makin banyak paragraf digabung
  const count = duration >= 120 ? 4 : duration >= 60 ? 3 : duration >= 30 ? 2 : 1;
  if (!texts.length) return res.json({ duration, text: 'Belum ada teks latihan yang tersedia.' });
  // Pengacakan merata (Fisher-Yates), bukan sort(() => Math.random() - 0.5) yang berat sebelah.
  const pool = [...texts];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  res.json({ duration, text: pool.slice(0, count).join(' ') });
});

// Semua id jenis peliharaan mitologi yang bisa dibuka lewat misi Typing Test
function mythicalTypeIds() {
  return Object.entries(PET_TYPES).filter(([, t]) => t.mythical).map(([id]) => id);
}

// POST /api/typing/submit -> simpan hasil tes (WPM & akurasi).
// Kalau hasilnya cepat & akurat (misi mengetik), pengguna langsung membuka
// satu peliharaan mitologi baru sebagai hadiah.
router.post('/typing/submit', apiKeyAuth, (req, res) => {
  const wpm = Number(req.body.wpm);
  const accuracy = Number(req.body.accuracy);
  const duration = Number(req.body.duration);
  if (![wpm, accuracy, duration].every(Number.isFinite)) {
    return res.status(400).json({ error: 'wpm, accuracy, dan duration wajib diisi dengan angka.' });
  }
  // Nilai di luar akal sehat ditolak supaya statistik & hadiah mitologi tidak bisa dicurangi
  // dan data tidak tercemar nilai aneh (NaN/Infinity) yang bikin tampilan rusak.
  if (wpm < 0 || wpm > 400 || accuracy < 0 || accuracy > 100 || duration <= 0 || duration > 3600) {
    return res.status(400).json({ error: 'Hasil tes tidak masuk akal dan tidak disimpan.' });
  }

  const users = readData('users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ code: 'INVALID_API_KEY', error: 'Sesi tidak valid. Silakan login ulang.' });
  // Akun lama bisa belum punya struktur typing -> dulu langsung error 500 di sini.
  if (!user.typing || typeof user.typing !== 'object') user.typing = { best: null, attempts: [] };
  if (!Array.isArray(user.typing.attempts)) user.typing.attempts = [];

  const attempt = { wpm, accuracy, duration, date: new Date().toISOString() };
  user.typing.attempts.unshift(attempt);
  user.typing.attempts = user.typing.attempts.slice(0, 20);
  if (!user.typing.best || wpm > user.typing.best.wpm) {
    user.typing.best = attempt;
  }

  let unlockedType = null;
  if (missions.qualifiesForMythicalUnlock(wpm, accuracy)) {
    user.unlockedPetTypes = user.unlockedPetTypes || [];
    const locked = mythicalTypeIds().filter(id => !user.unlockedPetTypes.includes(id));
    if (locked.length > 0) {
      unlockedType = locked[Math.floor(Math.random() * locked.length)];
      user.unlockedPetTypes.push(unlockedType);
    }
  }

  writeData('users.json', users);
  res.json({
    message: 'Hasil tes disimpan.',
    typing: user.typing,
    unlockedPetType: unlockedType ? { id: unlockedType, label: PET_TYPES[unlockedType].label } : null
  });
});

module.exports = router;
