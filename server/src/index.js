import express from 'express';

const app = express();
const port = process.env.PORT || 3001;
const rooms = new Map();

function createRoomId() {
  let roomId = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, '0');

  while (rooms.has(roomId)) {
    roomId = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, '0');
  }

  return roomId;
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/rooms', (req, res) => {
  const roomId = createRoomId();
  rooms.set(roomId, { id: roomId, createdAt: new Date().toISOString() });

  res.json({ ok: true, roomId });
});

app.post('/rooms/:roomId/join', (req, res) => {
  const { roomId } = req.params;

  if (!rooms.has(roomId)) {
    res.status(404).json({ ok: false, message: '房间不存在' });
    return;
  }

  res.json({ ok: true, roomId });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
