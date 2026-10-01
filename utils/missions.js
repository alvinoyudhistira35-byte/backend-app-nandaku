// Modul Misi Harian.
// Untuk bisa "Beri Makan" peliharaan, pengguna wajib menyelesaikan misi harian dulu
// (mis. memutar musik sambil tetap di website selama 5 menit, dan memutar beberapa lagu).
// Juga berisi aturan siapa yang boleh memakai peliharaan mitologi (VIP / pengguna lama).

const LISTEN_TARGET_SECONDS = 5 * 60; // 5 menit mendengarkan musik di website
const SONGS_TARGET = 3;               // memutar minimal 3 lagu berbeda hari ini
const LONG_TIME_USER_DAYS = 30;       // dianggap "pengguna lama" setelah 30 hari

// Ambang batas Typing Test untuk membuka peliharaan mitologi secara instan
const TYPING_UNLOCK_WPM = 45;
const TYPING_UNLOCK_ACCURACY = 97;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// Pastikan struktur misi harian user selalu ada & sudah direset kalau sudah ganti hari.
function ensureMissions(user) {
  const today = todayKey();
  if (!user.missions || user.missions.date !== today) {
    user.missions = {
      date: today,
      listenSeconds: 0,
      songsPlayedIds: [],
      fedToday: false
    };
  }
  return user.missions;
}

function missionsStatus(user) {
  const m = ensureMissions(user);
  const listenDone = m.listenSeconds >= LISTEN_TARGET_SECONDS;
  const songsDone = m.songsPlayedIds.length >= SONGS_TARGET;
  return {
    date: m.date,
    listenSeconds: Math.min(m.listenSeconds, LISTEN_TARGET_SECONDS),
    listenTarget: LISTEN_TARGET_SECONDS,
    listenDone,
    songsPlayed: m.songsPlayedIds.length,
    songsTarget: SONGS_TARGET,
    songsDone,
    allDone: listenDone && songsDone,
    fedToday: m.fedToday
  };
}

// Dipanggil berkala dari player (mis. tiap 10 detik selagi lagu diputar & tab aktif)
function addListenSeconds(user, seconds) {
  const m = ensureMissions(user);
  if (!m.fedToday || m.listenSeconds < LISTEN_TARGET_SECONDS) {
    m.listenSeconds = Math.min(LISTEN_TARGET_SECONDS, m.listenSeconds + Math.max(0, seconds));
  }
  return missionsStatus(user);
}

// Dipanggil tiap kali sebuah lagu benar-benar diputar
function registerSongPlayed(user, songId) {
  const m = ensureMissions(user);
  if (!m.songsPlayedIds.includes(songId)) {
    m.songsPlayedIds.push(songId);
  }
  return missionsStatus(user);
}

// Tandai sudah "makan" hari ini setelah misi selesai (agar progres misi tetap tercatat)
function markFed(user) {
  const m = ensureMissions(user);
  m.fedToday = true;
  return m;
}

function isLongTimeUser(user) {
  if (!user.createdAt) return false;
  const createdAt = new Date(user.createdAt).getTime();
  if (Number.isNaN(createdAt)) return false;
  const days = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  return days >= LONG_TIME_USER_DAYS;
}

// VIP eksplisit (diset admin) ATAU sudah jadi pengguna lama -> boleh pakai semua peliharaan mitologi
function hasMythicalAccess(user) {
  return !!user.vip || isLongTimeUser(user);
}

// Cek apakah hasil typing test memenuhi syarat membuka peliharaan mitologi secara instan
function qualifiesForMythicalUnlock(wpm, accuracy) {
  return wpm >= TYPING_UNLOCK_WPM && accuracy >= TYPING_UNLOCK_ACCURACY;
}

module.exports = {
  LISTEN_TARGET_SECONDS,
  SONGS_TARGET,
  LONG_TIME_USER_DAYS,
  TYPING_UNLOCK_WPM,
  TYPING_UNLOCK_ACCURACY,
  ensureMissions,
  missionsStatus,
  addListenSeconds,
  registerSongPlayed,
  markFed,
  isLongTimeUser,
  hasMythicalAccess,
  qualifiesForMythicalUnlock
};
