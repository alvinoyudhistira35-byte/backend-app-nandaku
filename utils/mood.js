// Pemetaan genre -> mood. Mood inilah yang menentukan tema latar belakang animasi di aplikasi
// (lihat frontend/js/mood-bg.js): senang, sedih, santai, energik, atau netral.
const MOOD_MAP = {
  pop: { mood: "senang", emoji: "😊" },
  happy: { mood: "senang", emoji: "😊" },
  kpop: { mood: "senang", emoji: "😊" },
  dangdut: { mood: "senang", emoji: "😊" },
  reggae: { mood: "senang", emoji: "😊" },
  sad: { mood: "sedih", emoji: "😢" },
  ballad: { mood: "sedih", emoji: "😢" },
  melankolis: { mood: "sedih", emoji: "😢" },
  galau: { mood: "sedih", emoji: "😢" },
  chill: { mood: "santai", emoji: "😌" },
  acoustic: { mood: "santai", emoji: "😌" },
  lofi: { mood: "santai", emoji: "😌" },
  jazz: { mood: "santai", emoji: "😌" },
  klasik: { mood: "santai", emoji: "😌" },
  classical: { mood: "santai", emoji: "😌" },
  indie: { mood: "santai", emoji: "😌" },
  rnb: { mood: "santai", emoji: "😌" },
  religi: { mood: "santai", emoji: "😌" },
  energetic: { mood: "energik", emoji: "⚡" },
  edm: { mood: "energik", emoji: "⚡" },
  dance: { mood: "energik", emoji: "⚡" },
  hiphop: { mood: "energik", emoji: "⚡" },
  rap: { mood: "energik", emoji: "⚡" },
  rock: { mood: "energik", emoji: "🔥" },
  metal: { mood: "energik", emoji: "🔥" },
  punk: { mood: "energik", emoji: "🔥" }
};

function detectMood(song) {
  // "R&B", "Hip-Hop", "Lo-Fi" dst. disamakan dulu jadi "rnb", "hiphop", "lofi".
  const key = (song.genre || "").toLowerCase().replace(/&/g, "n").replace(/[^a-z0-9]/g, "");
  return MOOD_MAP[key] || { mood: "netral", emoji: "🎵" };
}

// Cadangan sederhana kalau animasi latar belakang di frontend tidak termuat.
function backgroundForMood(mood) {
  const map = {
    senang: "linear-gradient(160deg,#ff7e5f,#feb47b 45%,#c94b7b)",
    sedih: "linear-gradient(160deg,#0b1026,#1b2a5c 55%,#3a4a8a)",
    santai: "linear-gradient(160deg,#0f4c5c,#2a9d8f 55%,#7fd1ba)",
    energik: "linear-gradient(160deg,#12002b,#6a00f4 55%,#ff006e)",
    netral: "linear-gradient(160deg,#1f1c2c,#43386b 55%,#928dab)"
  };
  return map[mood] || map.netral;
}

module.exports = { detectMood, backgroundForMood };
