const express = require('express');
const verifyToken = require('../middleware/auth');
const products = require('../data/products');

const router = express.Router();

// GET /v1/products
router.get('/', verifyToken, (req, res) => {
  let result = products;
  if (req.query.search) {
    result = result.filter((p) => p.name.toLowerCase().includes(req.query.search.toLowerCase()));
  }
  if (req.query.category) {
    result = result.filter((p) => p.category === req.query.category);
  }
  return res.json({ data: result, error: null });
});

// GET /v1/products/:id
router.get('/:id', verifyToken, (req, res) => {
  const product = products.find((p) => p.id === req.params.id);
  if (!product) {
    return res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Product not found' } });
  }
  return res.json({ data: product, error: null });
});

// POST /v1/products
router.post('/', verifyToken, (req, res) => {
  const product = { id: String(products.length + 1), ...req.body };
  products.push(product);
  return res.status(201).json({ data: product, error: null });
});

// PUT /v1/products/:id
router.put('/:id', verifyToken, (req, res) => {
  const index = products.findIndex((p) => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Product not found' } });
  }
  products[index] = { ...products[index], ...req.body };
  return res.json({ data: products[index], error: null });
});

// DELETE /v1/products/:id
router.delete('/:id', verifyToken, (req, res) => {
  const index = products.findIndex((p) => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Product not found' } });
  }
  products.splice(index, 1);
  return res.status(200).json({ data: { deleted: true }, error: null });
});

module.exports = router;
