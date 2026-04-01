const app = require('./app');

const PORT = process.env.PORT || 4001;

app.listen(PORT, () => {
  console.log(`users-service running on port ${PORT}`);
});
