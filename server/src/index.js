import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});
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

function broadcastPlayerCount(roomId) {
  const playerCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  io.to(roomId).emit('player-count', playerCount);
}

io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    if (!rooms.has(roomId)) {
      socket.emit('player-count', 0);
      return;
    }

    if (socket.data.roomId) {
      socket.leave(socket.data.roomId);
      broadcastPlayerCount(socket.data.roomId);
    }

    socket.data.roomId = roomId;
    socket.join(roomId);
    broadcastPlayerCount(roomId);
  });

  socket.on('disconnect', () => {
    if (socket.data.roomId) {
      broadcastPlayerCount(socket.data.roomId);
    }
  });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
