const express = require('express');
const productsRoutes = require('./routes/products');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'products-service' }));
app.use('/v1/products', productsRoutes);

module.exports = app;
