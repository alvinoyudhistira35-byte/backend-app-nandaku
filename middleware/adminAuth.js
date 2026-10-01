module.exports = function adminAuth(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: "Akses ditolak. Endpoint ini khusus admin." });
  }
  next();
};
