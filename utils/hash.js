// Hashing password sederhana pakai modul bawaan Node ('crypto'), jadi tidak perlu
// dependency tambahan. Untuk aplikasi produksi sungguhan, ganti dengan bcrypt/argon2.
const crypto = require('crypto');

function hashPassword(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(password + salt).digest('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.createHash('sha256').update(password + salt).digest('hex');
  return check === hash;
}

module.exports = { hashPassword, verifyPassword };
