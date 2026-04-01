const express = require('express');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'users-service' }));
app.use('/v1/auth', authRoutes);
app.use('/v1/users', usersRoutes);

module.exports = app;
