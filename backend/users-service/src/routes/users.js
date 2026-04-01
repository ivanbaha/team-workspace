const express = require('express');
const verifyToken = require('../middleware/auth');
const users = require('../data/users');

const router = express.Router();

// GET /v1/users/:id
router.get('/:id', verifyToken, (req, res) => {
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } });
  }
  return res.json({ data: { id: user.id, name: user.name, email: user.email }, error: null });
});

// PUT /v1/users/:id
router.put('/:id', verifyToken, (req, res) => {
  const index = users.findIndex((u) => u.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } });
  }
  users[index] = { ...users[index], ...req.body };
  return res.json({ data: { id: users[index].id, name: users[index].name, email: users[index].email }, error: null });
});

// DELETE /v1/users/:id
router.delete('/:id', verifyToken, (req, res) => {
  const index = users.findIndex((u) => u.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'User not found' } });
  }
  users.splice(index, 1);
  return res.status(200).json({ data: { deleted: true }, error: null });
});

module.exports = router;
