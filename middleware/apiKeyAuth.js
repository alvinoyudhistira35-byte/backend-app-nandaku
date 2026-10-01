const { readData } = require('../utils/db');

// Middleware inti: memvalidasi API key yang dikirim frontend di header 'x-api-key'.
// Perbaikan: key di-trim (spasi/kutip ikut tersalin saat copy-paste adalah penyebab umum
// "API key tidak valid"), dan response menyertakan 'code' supaya frontend bisa membedakan
// "key salah" dari "belum mengirim key" dan menanganinya tanpa loop alert.
module.exports = function apiKeyAuth(req, res, next) {
  let apiKey = req.headers['x-api-key'] || req.query.api_key || '';
  if (Array.isArray(apiKey)) apiKey = apiKey[0];
  apiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');

  if (!apiKey) {
    return res.status(401).json({
      code: 'NO_API_KEY',
      error: "API key tidak ditemukan. Sertakan header 'x-api-key'."
    });
  }

  const users = readData('users.json');
  const user = users.find(u => u.apiKey && String(u.apiKey).trim() === apiKey);

  if (!user) {
    return res.status(401).json({
      code: 'INVALID_API_KEY',
      error: 'API key tidak valid. Silakan login ulang.'
    });
  }

  req.user = user;
  next();
};
