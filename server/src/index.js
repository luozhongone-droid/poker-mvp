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
const roomPlayers = new Map();

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

function getRoomPlayers(roomId) {
  return Array.from(roomPlayers.get(roomId)?.values() || []);
}

function broadcastRoomPlayers(roomId) {
  const players = getRoomPlayers(roomId);
  const playerCount = players.length;
  io.to(roomId).emit('player-count', playerCount);
  io.to(roomId).emit('player-list', players);
}

function removePlayerFromRoom(socket) {
  const { roomId } = socket.data;

  if (!roomId || !roomPlayers.has(roomId)) {
    return;
  }

  const players = roomPlayers.get(roomId);
  players.delete(socket.id);

  if (players.size === 0) {
    roomPlayers.delete(roomId);
  }

  socket.leave(roomId);
  socket.data.roomId = undefined;
  socket.data.nickname = undefined;
  broadcastRoomPlayers(roomId);
}

io.on('connection', (socket) => {
  socket.on('join-room', (payload) => {
    const roomId = typeof payload === 'string' ? payload : payload?.roomId;
    const nickname = typeof payload === 'string' ? '' : payload?.nickname?.trim();

    if (!rooms.has(roomId)) {
      socket.emit('player-count', 0);
      socket.emit('player-list', []);
      return;
    }

    if (socket.data.roomId) {
      removePlayerFromRoom(socket);
    }

    if (!roomPlayers.has(roomId)) {
      roomPlayers.set(roomId, new Map());
    }

    socket.data.roomId = roomId;
    socket.data.nickname = nickname || '未命名玩家';
    socket.join(roomId);
    roomPlayers.get(roomId).set(socket.id, {
      socketId: socket.id,
      nickname: socket.data.nickname
    });
    broadcastRoomPlayers(roomId);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
  });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
