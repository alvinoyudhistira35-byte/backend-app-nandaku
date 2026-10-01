const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../utils/db');
const { detectMood, backgroundForMood } = require('../utils/mood');
const { addExp } = require('../utils/pet');
const missions = require('../utils/missions');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const config = require('../config');

// Placeholder pengambilan lagu dari Music API eksternal asli.
// Aktifkan config.EXTERNAL_MUSIC_API.enabled dan lengkapi fetch ke baseUrl+apiKey di sini
// (misalnya pakai axios/fetch) jika ingin menyambungkan Spotify/Deezer/dll.
async function fetchFromExternalApi() {
  if (!config.EXTERNAL_MUSIC_API.enabled) return null;
  // contoh: const resp = await fetch(`${config.EXTERNAL_MUSIC_API.baseUrl}/tracks`, { headers: { Authorization: `Bearer ${config.EXTERNAL_MUSIC_API.apiKey}` }});
  // return await resp.json();
  return null;
}

function withMood(song) {
  const { mood, emoji } = detectMood(song);
  return { ...song, mood, moodEmoji: emoji, background: backgroundForMood(mood) };
}

// Untuk daftar lagu (beranda, pencarian, album artis) isi lirik TIDAK ikut dikirim supaya
// respons tetap ringan; cukup penanda hasLyrics. Lirik lengkap dikirim saat lagu diputar.
function listView(song) {
  const { lyrics, ...rest } = song;
  return { ...withMood(rest), hasLyrics: Boolean(lyrics && String(lyrics).trim()) };
}

// Fisher-Yates: pengacakan yang benar-benar merata.
// Cara lama (sort dengan Math.random()-0.5) menghasilkan urutan yang berat sebelah,
// sehingga sebagian lagu -- termasuk lagu yang baru diupload -- jarang sekali muncul
// di beranda dan terlihat seperti "hilang".
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// GET /api/songs -> daftar lagu acak/rekomendasi untuk beranda
router.get('/songs', apiKeyAuth, async (req, res, next) => {
  try {
    const external = await fetchFromExternalApi();
    const songs = external || readData('songs.json');
    // Lagu tanpa file audio (data lama yang terlanjur tersimpan tanpa file) disembunyikan
    // supaya tidak muncul lagu yang diklik tapi tidak berbunyi.
    const playable = songs.filter(s => s && s.audioUrl);
    res.json({ songs: shuffle(playable).map(listView) });
  } catch (err) { next(err); }
});

// GET /api/songs/search?q=
router.get('/songs/search', apiKeyAuth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const songs = readData('songs.json');
  // Beberapa data lama bisa tidak punya title/artistName -> dulu bikin server error 500
  // setiap kali pencarian dipakai. Sekarang ditangani dengan aman.
  const result = songs.filter(s =>
    (s.title || '').toLowerCase().includes(q) || (s.artistName || '').toLowerCase().includes(q)
  );
  res.json({ songs: result.map(listView) });
});

// GET /api/artists -> daftar artis untuk panel geser
router.get('/artists', apiKeyAuth, (req, res) => {
  res.json({ artists: readData('artists.json') });
});

// GET /api/artists/:id/songs -> lagu-lagu ciptaan artis tsb (saat kartu artis diklik)
router.get('/artists/:id/songs', apiKeyAuth, (req, res) => {
  const songs = readData('songs.json').filter(s => s.artistId === req.params.id);
  const artist = readData('artists.json').find(a => a.id === req.params.id);
  if (!artist) return res.status(404).json({ error: 'Artis tidak ditemukan.' });
  res.json({ artist, songs: songs.map(listView) });
});

// POST /api/songs/:id/play -> dipanggil saat lagu benar-benar diputar
// Alur backend inti sesuai flowchart: validasi API key (middleware) -> ambil data lagu
// -> deteksi mood -> update statistik & level peliharaan -> kirim response ke frontend
router.post('/songs/:id/play', apiKeyAuth, (req, res, next) => {
  try {
    const songs = readData('songs.json');
    const song = songs.find(s => s.id === req.params.id);
    if (!song) return res.status(404).json({ error: 'Lagu tidak ditemukan.' });

    song.plays = (song.plays || 0) + 1;
    writeData('songs.json', songs);

    const users = readData('users.json');
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(401).json({ code: 'INVALID_API_KEY', error: 'Sesi tidak valid. Silakan login ulang.' });
    if (!Array.isArray(user.history)) user.history = [];
    if (!user.pet) user.pet = { type: 'naga', level: 1, exp: 0, stage: 'Telur', icon: '🥚' };
    user.history.unshift({ songId: song.id, title: song.title, playedAt: new Date().toISOString() });
    user.history = user.history.slice(0, 50);

    const { pet, leveledUp } = addExp(user.pet, 10);
    user.pet = pet;
    const missionsStatus = missions.registerSongPlayed(user, song.id);
    writeData('users.json', users);

    res.json({
      song: withMood(song),
      pet: user.pet,
      petLeveledUp: leveledUp,
      missions: missionsStatus
    });
  } catch (err) {
    // Kalau ada apa pun yang tidak terduga di sini, balas error JSON biasa -- JANGAN sampai
    // membuat proses Node berhenti (itu yang bikin terasa seperti "server restart").
    console.error('[play] Error saat memproses pemutaran lagu:', err);
    next(err);
  }
});

module.exports = router;
