const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { readData, writeData } = require('../utils/db');
const { hashPassword, verifyPassword } = require('../utils/hash');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const { fillMissingFields } = require('../seed-admin');

// Email disamakan (huruf kecil + tanpa spasi) supaya "Budi@Mail.com" dan "budi@mail.com"
// tidak menjadi dua akun berbeda -- dulu ini bikin user merasa akunnya "hilang" saat login.
function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(u) {
  const { passwordHash, salt, ...safe } = u;
  return safe;
}

function createUserRecord({ username, email, name, role = 'user' }) {
  return {
    id: uuidv4(),
    username: String(username).trim(),
    email: normEmail(email),
    name: name || username,
    role,
    apiKey: 'MUSIKAPP-' + uuidv4(),
    avatar: '/uploads/artists/default-avatar.svg',
    createdAt: new Date().toISOString(),
    pet: { type: 'naga', level: 1, exp: 0, stage: 'Telur', icon: '🥚' },
    history: [],
    typing: { best: null, attempts: [] },
    linkedAccounts: [],
    friends: [],
    vip: false,
    unlockedPetTypes: [],
    missions: null
  };
}

// REGISTER manual
router.post('/register', (req, res) => {
  const { username, password, name } = req.body;
  const email = normEmail(req.body.email);
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, dan password wajib diisi.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  }
  const users = readData('users.json');
  if (users.find(u => normEmail(u.email) === email)) {
    return res.status(409).json({ error: 'Email sudah terdaftar.' });
  }
  const { hash, salt } = hashPassword(password);
  const newUser = { ...createUserRecord({ username, email, name }), passwordHash: hash, salt };
  users.push(newUser);
  writeData('users.json', users);
  res.status(201).json({ message: 'Registrasi berhasil. Peliharaan virtual baru telah dibuat!', user: publicUser(newUser) });
});

// LOGIN manual
router.post('/login', (req, res) => {
  const { password } = req.body;
  const email = normEmail(req.body.email);
  if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password wajib diisi.' });
  }
  const users = readData('users.json');
  const user = users.find(u => normEmail(u.email) === email);
  if (!user || !user.salt || !user.passwordHash || !verifyPassword(password, user.salt, user.passwordHash)) {
    return res.status(401).json({ error: 'Email atau password salah.' });
  }
  // Akun lama yang API key-nya hilang / belum punya field baru diperbaiki saat login,
  // jadi user tidak pernah terjebak di status "API key tidak valid".
  let changed = fillMissingFields(user);
  if (!user.apiKey) { user.apiKey = 'MUSIKAPP-' + uuidv4(); changed = true; }
  if (changed) writeData('users.json', users);

  res.json({ message: 'Login berhasil.', user: publicUser(user) });
});

// LOGIN / DAFTAR dengan Google
// Catatan: di produksi, verifikasi 'idToken' dari Google Identity Services di sisi server
// memakai 'google-auth-library' dan GOOGLE_CLIENT_ID pada config.js.
// Di sini kita terima profil Google yang sudah diverifikasi oleh frontend untuk mempermudah demo.
router.post('/google-login', (req, res) => {
  const { googleId, name, photo } = req.body;
  const email = normEmail(req.body.email);
  if (!googleId || !email) {
    return res.status(400).json({ error: 'Data akun Google tidak lengkap.' });
  }
  const users = readData('users.json');
  let user = users.find(u => u.googleId === googleId || normEmail(u.email) === email);
  if (!user) {
    user = createUserRecord({ username: email.split('@')[0], email, name });
    user.googleId = googleId;
    if (photo) user.avatar = photo;
    users.push(user);
    writeData('users.json', users);
    return res.status(201).json({ message: 'Akun Google baru terdaftar.', user: publicUser(user) });
  }
  let changed = fillMissingFields(user);
  if (!user.apiKey) { user.apiKey = 'MUSIKAPP-' + uuidv4(); changed = true; }
  if (changed) writeData('users.json', users);
  res.json({ message: 'Login dengan Google berhasil.', user: publicUser(user) });
});

// Tambah akun lain (multi-account switch) dari dalam menu profil
router.post('/accounts/add', apiKeyAuth, (req, res) => {
  const { username, password, name } = req.body;
  const email = normEmail(req.body.email);
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, dan password wajib diisi.' });
  }
  const users = readData('users.json');
  if (users.find(u => normEmail(u.email) === email)) {
    return res.status(409).json({ error: 'Email sudah terdaftar.' });
  }
  const { hash, salt } = hashPassword(password);
  const newUser = { ...createUserRecord({ username, email, name }), passwordHash: hash, salt };
  users.push(newUser);

  const mainUser = users.find(u => u.id === req.user.id);
  if (!mainUser) return res.status(401).json({ code: 'INVALID_API_KEY', error: 'Sesi tidak valid. Silakan login ulang.' });
  if (!Array.isArray(mainUser.linkedAccounts)) mainUser.linkedAccounts = [];
  mainUser.linkedAccounts.push({ id: newUser.id, email: newUser.email, apiKey: newUser.apiKey });
  writeData('users.json', users);

  res.status(201).json({ message: 'Akun baru ditambahkan dan tertaut ke akun ini.', user: publicUser(newUser) });
});

// Data profil user yang sedang login (berdasar API key)
router.get('/me', apiKeyAuth, (req, res) => {
  const users = readData('users.json');
  const user = users.find(u => u.id === req.user.id) || req.user;
  if (fillMissingFields(user)) writeData('users.json', users);
  res.json({ user: publicUser(user) });
});

// Update foto profil
router.put('/me/avatar', apiKeyAuth, (req, res) => {
  const { avatarUrl } = req.body;
  if (!avatarUrl) return res.status(400).json({ error: 'avatarUrl wajib diisi.' });
  const users = readData('users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ code: 'INVALID_API_KEY', error: 'Sesi tidak valid. Silakan login ulang.' });
  user.avatar = avatarUrl;
  writeData('users.json', users);
  res.json({ message: 'Foto profil diperbarui.', user: publicUser(user) });
});

// Pengaturan privasi & keamanan
router.put('/me/settings', apiKeyAuth, (req, res) => {
  const { storyVisibility, profileVisibility, newPassword } = req.body;
  const users = readData('users.json');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ code: 'INVALID_API_KEY', error: 'Sesi tidak valid. Silakan login ulang.' });
  user.settings = user.settings || {};
  if (storyVisibility) user.settings.storyVisibility = storyVisibility; // 'friends' | 'public'
  if (profileVisibility) user.settings.profileVisibility = profileVisibility; // 'friends' | 'public' | 'private'
  if (newPassword) {
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
    const { hash, salt } = hashPassword(newPassword);
    user.passwordHash = hash;
    user.salt = salt;
  }
  writeData('users.json', users);
  res.json({ message: 'Pengaturan diperbarui.', user: publicUser(user) });
});

module.exports = router;
