import express from 'express';

const app = express();
const port = process.env.PORT || 3001;

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
