const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ data: null, error: { code: 'UNAUTHENTICATED', message: 'No token provided' } });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ data: null, error: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired' } });
  }
}

module.exports = verifyToken;
