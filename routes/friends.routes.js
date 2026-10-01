const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { readData, writeData } = require('../utils/db');
const apiKeyAuth = require('../middleware/apiKeyAuth');

function safeUser(u) {
  return { id: u.id, username: u.username, name: u.name, avatar: u.avatar };
}

// GET /api/users/search?q= -> cari pengguna lain untuk ditambah sebagai teman
router.get('/users/search', apiKeyAuth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const users = readData('users.json');
  const result = users
    // Dulu memakai u.username.toLowerCase() tanpa pengaman -> satu akun tanpa username
    // membuat SELURUH pencarian teman error 500.
    .filter(u => u.id !== req.user.id && ((u.username || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)))
    .map(safeUser);
  res.json({ users: result });
});

// GET /api/friends -> daftar teman
router.get('/friends', apiKeyAuth, (req, res) => {
  const users = readData('users.json');
  const me = users.find(u => u.id === req.user.id);
  const friendIds = (me && me.friends) || [];
  const friends = users.filter(u => friendIds.includes(u.id)).map(safeUser);
  res.json({ friends });
});

// POST /api/friends/request { targetUserId }
router.post('/friends/request', apiKeyAuth, (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId wajib diisi.' });
  if (targetUserId === req.user.id) return res.status(400).json({ error: 'Tidak bisa menambahkan diri sendiri.' });

  const users = readData('users.json');
  const target = users.find(u => u.id === targetUserId);
  if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  if ((req.user.friends || []).includes(targetUserId)) {
    return res.status(409).json({ error: 'Kalian sudah berteman.' });
  }

  const requests = readData('friend_requests.json');
  const exists = requests.find(r => r.from === req.user.id && r.to === targetUserId && r.status === 'pending');
  if (exists) return res.status(409).json({ error: 'Permintaan sudah dikirim sebelumnya.' });

  const newRequest = { id: uuidv4(), from: req.user.id, to: targetUserId, status: 'pending', createdAt: new Date().toISOString() };
  requests.push(newRequest);
  writeData('friend_requests.json', requests);
  res.status(201).json({ message: 'Permintaan pertemanan terkirim.', request: newRequest });
});

// GET /api/friends/requests -> permintaan masuk untuk user ini
router.get('/friends/requests', apiKeyAuth, (req, res) => {
  const requests = readData('friend_requests.json').filter(r => r.to === req.user.id && r.status === 'pending');
  res.json({ requests });
});

// POST /api/friends/respond { requestId, accept }
router.post('/friends/respond', apiKeyAuth, (req, res) => {
  const { requestId, accept } = req.body;
  const requests = readData('friend_requests.json');
  const request = requests.find(r => r.id === requestId && r.to === req.user.id);
  if (!request) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });

  request.status = accept ? 'accepted' : 'rejected';
  writeData('friend_requests.json', requests);

  if (accept) {
    const users = readData('users.json');
    const me = users.find(u => u.id === req.user.id);
    const sender = users.find(u => u.id === request.from);
    // Pengirim bisa saja sudah tidak ada (akun dihapus) -> dulu server langsung error.
    if (!me || !sender) return res.status(404).json({ error: 'Akun pengirim sudah tidak tersedia.' });
    me.friends = me.friends || [];
    sender.friends = sender.friends || [];
    if (!me.friends.includes(sender.id)) me.friends.push(sender.id);
    if (!sender.friends.includes(me.id)) sender.friends.push(me.id);
    writeData('users.json', users);
  }

  res.json({ message: accept ? 'Pertemanan diterima.' : 'Permintaan ditolak.', request });
});

module.exports = router;
