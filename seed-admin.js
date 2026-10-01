// Bisa dijalankan manual (node seed-admin.js) ATAU dipanggil otomatis dari server.js
// setiap kali server nyala. Akun admin memakai id & API key TETAP (bukan acak) supaya
// tidak pernah muncul "API key tidak valid" hanya karena akun admin sempat dibuat ulang.
const { readData, writeData } = require('./utils/db');
const { hashPassword } = require('./utils/hash');
const config = require('./config');

const ADMIN_ID = 'admin-default';

function ensureAdminSeeded({ silent = false } = {}) {
  const users = readData('users.json');
  const existing = users.find(u => u.id === ADMIN_ID || u.email === config.ADMIN_EMAIL);

  if (existing) {
    let changed = false;

    // Pastikan akun admin selalu punya API key yang sesuai konfigurasi & role admin.
    // Ini memperbaiki akun admin lama yang API key-nya acak / hilang.
    if (!existing.apiKey || (process.env.ADMIN_API_KEY && existing.apiKey !== config.ADMIN_API_KEY)) {
      existing.apiKey = config.ADMIN_API_KEY;
      changed = true;
    }
    if (existing.role !== 'admin') { existing.role = 'admin'; changed = true; }
    if (!existing.passwordHash || !existing.salt) {
      const { hash, salt } = hashPassword(config.ADMIN_PASSWORD);
      existing.passwordHash = hash;
      existing.salt = salt;
      changed = true;
    }
    // Lengkapi field yang mungkin belum ada di data lama supaya tidak error saat dipakai.
    changed = fillMissingFields(existing) || changed;

    if (changed) writeData('users.json', users);
    if (!silent) console.log('Akun admin sudah ada. API key:', existing.apiKey);
    return existing;
  }

  const { hash, salt } = hashPassword(config.ADMIN_PASSWORD);
  const admin = {
    id: ADMIN_ID,
    username: 'admin',
    email: config.ADMIN_EMAIL,
    name: 'Administrator',
    role: 'admin',
    apiKey: config.ADMIN_API_KEY,
    avatar: '/uploads/artists/default-avatar.svg',
    createdAt: new Date().toISOString(),
    pet: { type: 'naga', level: 1, exp: 0, stage: 'Telur', icon: '🥚' },
    history: [],
    typing: { best: null, attempts: [] },
    linkedAccounts: [],
    friends: [],
    vip: true,
    unlockedPetTypes: [],
    missions: null,
    passwordHash: hash,
    salt
  };
  users.push(admin);
  writeData('users.json', users);
  console.log('Akun admin dibuat.');
  console.log('Email    :', admin.email);
  console.log('Password :', config.ADMIN_PASSWORD);
  console.log('API Key  :', admin.apiKey);
  return admin;
}

// Data user lama kadang belum punya field baru (friends, missions, dst) sehingga route
// tertentu error "Cannot read properties of undefined". Dilengkapi di sini.
function fillMissingFields(u) {
  let changed = false;
  const defaults = {
    avatar: '/uploads/artists/default-avatar.svg',
    pet: { type: 'naga', level: 1, exp: 0, stage: 'Telur', icon: '🥚' },
    history: [],
    typing: { best: null, attempts: [] },
    linkedAccounts: [],
    friends: [],
    unlockedPetTypes: [],
    missions: null
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (u[key] === undefined) { u[key] = value; changed = true; }
  }
  return changed;
}

module.exports = { ensureAdminSeeded, fillMissingFields, ADMIN_ID };

if (require.main === module) {
  const { initStorage } = require('./utils/db');
  (async () => {
    await initStorage();
    ensureAdminSeeded();
  })();
}
