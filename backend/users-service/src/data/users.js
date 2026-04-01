// In-memory users store — replace with a real database in production.
const users = [
  { id: '1', name: 'Alice', email: 'alice@example.com', passwordHash: 'hashed_pw' },
  { id: '2', name: 'Bob', email: 'bob@example.com', passwordHash: 'hashed_pw' },
];

module.exports = users;
