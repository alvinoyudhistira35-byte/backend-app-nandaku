const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { readData, writeData } = require('../utils/db');
const apiKeyAuth = require('../middleware/apiKeyAuth');

// POST /api/story { content, imageUrl, privacy: 'friends' | 'public' }
router.post('/story', apiKeyAuth, (req, res) => {
  const { content, imageUrl, privacy } = req.body;
  if (!content && !imageUrl) return res.status(400).json({ error: 'Isi story atau gambar wajib diisi.' });

  if (content && String(content).length > 1000) {
    return res.status(400).json({ error: 'Story terlalu panjang (maks 1000 karakter).' });
  }

  const stories = readData('stories.json');
  const story = {
    id: uuidv4(),
    userId: req.user.id,
    username: req.user.username,
    avatar: req.user.avatar,
    content: content || '',
    imageUrl: imageUrl || null,
    privacy: privacy === 'public' ? 'public' : 'friends',
    createdAt: new Date().toISOString()
  };
  stories.unshift(story);
  writeData('stories.json', stories);
  res.status(201).json({ message: 'Story berhasil diunggah.', story });
});

// GET /api/story/feed -> story milik sendiri + teman (privacy friends) + semua story publik
router.get('/story/feed', apiKeyAuth, (req, res) => {
  const users = readData('users.json');
  const me = users.find(u => u.id === req.user.id);
  const friendIds = new Set((me && me.friends) || []);
  const stories = readData('stories.json').filter(s =>
    s.userId === req.user.id ||
    s.privacy === 'public' ||
    (s.privacy === 'friends' && friendIds.has(s.userId))
  );
  res.json({ stories });
});

module.exports = router;
