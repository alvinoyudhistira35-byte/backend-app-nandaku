// Modul Peliharaan Virtual.
// Setiap jenis hewan punya tahapan sendiri (stage), dari telur/bayi sampai "Dewasa".
// "Dewasa" adalah tahap sekaligus BATAS LEVEL tertinggi untuk semua jenis hewan —
// begitu level peliharaan mencapai level tahap Dewasa, ia berhenti naik level.
const PET_TYPES = {
  naga: {
    label: 'Naga',
    stages: [
      { minLevel: 1, stage: 'Telur', icon: '🥚' },
      { minLevel: 3, stage: 'Bayi', icon: '🐣' },
      { minLevel: 6, stage: 'Remaja', icon: '🐲' },
      { minLevel: 10, stage: 'Dewasa', icon: '🐉' }
    ]
  },
  kucing: {
    label: 'Kucing',
    stages: [
      { minLevel: 1, stage: 'Bayi', icon: '🐱' },
      { minLevel: 3, stage: 'Anak Kucing', icon: '🐈' },
      { minLevel: 6, stage: 'Remaja', icon: '😺' },
      { minLevel: 10, stage: 'Dewasa', icon: '🐈\u200d⬛' }
    ]
  },
  anjing: {
    label: 'Anjing',
    stages: [
      { minLevel: 1, stage: 'Bayi', icon: '🐶' },
      { minLevel: 3, stage: 'Anak Anjing', icon: '🐕' },
      { minLevel: 6, stage: 'Remaja', icon: '🦮' },
      { minLevel: 10, stage: 'Dewasa', icon: '🐕\u200d🦺' }
    ]
  },
  burung: {
    label: 'Burung',
    stages: [
      { minLevel: 1, stage: 'Telur', icon: '🥚' },
      { minLevel: 3, stage: 'Anak Burung', icon: '🐤' },
      { minLevel: 6, stage: 'Remaja', icon: '🐥' },
      { minLevel: 10, stage: 'Dewasa', icon: '🦜' }
    ]
  },

  // ==== PELIHARAAN MITOLOGI (khusus, tidak muncul untuk pengguna biasa begitu saja) ====
  // Hanya bisa dipakai oleh: pengguna VIP, pengguna lama (akun sudah lama terdaftar),
  // atau siapa pun yang membuka kuncinya lewat misi (mis. lulus Typing Test dengan
  // kecepatan & akurasi tinggi). Lihat utils/missions.js untuk aturan pembukaannya.
  phoenix: {
    label: 'Phoenix',
    mythical: true,
    unlockInfo: 'Peliharaan mitologi. Terbuka untuk VIP/pengguna lama, atau lulus misi Typing Test dengan akurasi & kecepatan tinggi.',
    stages: [
      { minLevel: 1, stage: 'Telur Api', icon: '🥚' },
      { minLevel: 3, stage: 'Anak Phoenix', icon: '🐣' },
      { minLevel: 6, stage: 'Phoenix Muda', icon: '🔥' },
      { minLevel: 10, stage: 'Phoenix Abadi', icon: '🐦‍🔥' }
    ]
  },
  unicorn: {
    label: 'Unicorn',
    mythical: true,
    unlockInfo: 'Peliharaan mitologi. Terbuka untuk VIP/pengguna lama, atau lulus misi Typing Test dengan akurasi & kecepatan tinggi.',
    stages: [
      { minLevel: 1, stage: 'Telur Ajaib', icon: '🥚' },
      { minLevel: 3, stage: 'Anak Kuda', icon: '🐴' },
      { minLevel: 6, stage: 'Unicorn Remaja', icon: '🦄' },
      { minLevel: 10, stage: 'Unicorn Legendaris', icon: '🦄✨' }
    ]
  }
};

const DEFAULT_TYPE = 'naga';

function getStages(type) {
  return (PET_TYPES[type] || PET_TYPES[DEFAULT_TYPE]).stages;
}

// Level maksimum = level saat mencapai tahap "Dewasa" (batas level peliharaan)
function getMaxLevel(type) {
  const stages = getStages(type);
  const dewasa = stages.find(s => s.stage === 'Dewasa') || stages[stages.length - 1];
  return dewasa.minLevel;
}

function applyStage(pet) {
  const stages = getStages(pet.type);
  const evo = [...stages].reverse().find(e => pet.level >= e.minLevel);
  pet.stage = evo.stage;
  pet.icon = evo.icon;
  return pet;
}

// Menambah exp peliharaan (dipanggil saat lagu diputar / interaksi).
// Berhenti naik level begitu mencapai batas level (tahap Dewasa).
function addExp(pet, amount) {
  if (!pet.type) pet.type = DEFAULT_TYPE;
  const maxLevel = getMaxLevel(pet.type);

  if (pet.level >= maxLevel) {
    pet.level = maxLevel;
    pet.exp = 0;
    applyStage(pet);
    return { pet, leveledUp: false, maxed: true };
  }

  pet.exp += amount;
  let expNeeded = pet.level * 50;
  let leveledUp = false;
  while (pet.exp >= expNeeded && pet.level < maxLevel) {
    pet.exp -= expNeeded;
    pet.level += 1;
    leveledUp = true;
    if (pet.level >= maxLevel) { pet.exp = 0; break; }
    expNeeded = pet.level * 50;
  }
  applyStage(pet);
  return { pet, leveledUp, maxed: pet.level >= maxLevel };
}

// Mengganti jenis hewan peliharaan (level & exp tetap, hanya jenis & tampilannya berubah)
function setPetType(pet, type) {
  if (!PET_TYPES[type]) {
    const err = new Error('Jenis hewan tidak dikenali.');
    err.status = 400;
    throw err;
  }
  pet.type = type;
  const maxLevel = getMaxLevel(type);
  if (pet.level > maxLevel) { pet.level = maxLevel; pet.exp = 0; }
  applyStage(pet);
  return pet;
}

// Ringkasan progres untuk ditampilkan di menu level (termasuk daftar tahap & batas level)
function petProgress(pet) {
  if (!pet.type) pet.type = DEFAULT_TYPE;
  const stages = getStages(pet.type);
  const maxLevel = getMaxLevel(pet.type);
  const isMaxed = pet.level >= maxLevel;
  const expNeeded = isMaxed ? 0 : pet.level * 50;
  return {
    type: pet.type,
    typeLabel: (PET_TYPES[pet.type] || {}).label || pet.type,
    mythical: !!(PET_TYPES[pet.type] || {}).mythical,
    level: pet.level,
    exp: pet.exp,
    expNeeded,
    maxLevel,
    isMaxed,
    stage: pet.stage,
    icon: pet.icon,
    stages: stages.map(s => ({ ...s, unlocked: pet.level >= s.minLevel }))
  };
}

// unlockedTypes: daftar id jenis mitologi yang sudah dibuka user lewat misi.
// hasMythicalAccess: true jika user VIP / pengguna lama (otomatis boleh pakai semua jenis mitologi).
function listPetTypes(unlockedTypes = [], hasMythicalAccess = false) {
  return Object.entries(PET_TYPES).map(([id, t]) => {
    const mythical = !!t.mythical;
    const locked = mythical && !hasMythicalAccess && !unlockedTypes.includes(id);
    return {
      id,
      label: t.label,
      mythical,
      locked,
      unlockInfo: t.unlockInfo || null,
      previewIcon: t.stages[0].icon,
      adultIcon: t.stages[t.stages.length - 1].icon,
      maxLevel: getMaxLevel(id)
    };
  });
}

function isMythical(type) {
  return !!(PET_TYPES[type] && PET_TYPES[type].mythical);
}

module.exports = { PET_TYPES, DEFAULT_TYPE, addExp, setPetType, petProgress, listPetTypes, getMaxLevel, isMythical };
