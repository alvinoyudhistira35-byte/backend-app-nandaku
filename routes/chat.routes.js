const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { readData, writeData } = require('../utils/db');
const apiKeyAuth = require('../middleware/apiKeyAuth');

function roomId(a, b) {
  return [a, b].sort().join('__');
}

// Hanya boleh membuka/mengirim chat dengan orang yang memang sudah berteman.
// Sebelumnya siapa pun yang tahu id orang lain bisa membaca & mengirim chat ke sana.
function requireFriend(req, res, next) {
  const friends = req.user.friends || [];
  if (!friends.includes(req.params.friendId)) {
    return res.status(403).json({ error: 'Kalian belum berteman.' });
  }
  next();
}

// GET /api/chat/:friendId -> riwayat pesan dengan seorang teman
router.get('/chat/:friendId', apiKeyAuth, requireFriend, (req, res) => {
  const room = roomId(req.user.id, req.params.friendId);
  const chats = readData('chats.json');
  const conversation = chats.find(c => c.room === room);
  res.json({ messages: conversation ? conversation.messages : [] });
});

// POST /api/chat/:friendId { message }
// Catatan: ini REST polling sederhana. Untuk chat real-time, tambahkan Socket.IO di server.js
// lalu emit event 'new_message' ke room yang sama.
router.post('/chat/:friendId', apiKeyAuth, requireFriend, (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message wajib diisi.' });
  if (message.length > 2000) return res.status(400).json({ error: 'Pesan terlalu panjang (maks 2000 karakter).' });

  const room = roomId(req.user.id, req.params.friendId);
  const chats = readData('chats.json');
  let conversation = chats.find(c => c.room === room);
  if (!conversation) {
    conversation = { room, messages: [] };
    chats.push(conversation);
  }
  if (!Array.isArray(conversation.messages)) conversation.messages = [];
  const newMessage = { id: uuidv4(), from: req.user.id, text: message, sentAt: new Date().toISOString() };
  conversation.messages.push(newMessage);
  writeData('chats.json', chats);
  res.status(201).json({ message: newMessage });
});

module.exports = router;
