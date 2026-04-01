const express = require('express');
const jwt = require('jsonwebtoken');
const users = require('../data/users');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

// POST /v1/auth/register
router.post('/register', (req, res) => {
  const { name, email } = req.body;
  const existing = users.find((u) => u.email === email);
  if (existing) {
    return res.status(400).json({ data: null, error: { code: 'EMAIL_TAKEN', message: 'Email already registered' } });
  }
  const user = { id: String(users.length + 1), name, email, passwordHash: 'hashed_pw' };
  users.push(user);
  return res.status(201).json({ data: { id: user.id, name: user.name, email: user.email }, error: null });
});

// POST /v1/auth/login
router.post('/login', (req, res) => {
  const { email } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user) {
    return res.status(401).json({ data: null, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  }
  const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
  return res.json({ data: { token }, error: null });
});

module.exports = router;
