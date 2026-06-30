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

function createEmptySeats() {
  return {
    player1: null,
    player2: null
  };
}

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
  const seats = roomPlayers.get(roomId);
  return [seats?.player1, seats?.player2].filter(Boolean);
}

function broadcastRoomPlayers(roomId) {
  const seats = roomPlayers.get(roomId) || createEmptySeats();
  const players = getRoomPlayers(roomId);
  const playerCount = players.length;
  io.to(roomId).emit('player-count', playerCount);
  io.to(roomId).emit('player-list', players);
  io.to(roomId).emit('players-updated', seats);
}

function removePlayerFromRoom(socket) {
  const { roomId } = socket.data;

  if (!roomId || !roomPlayers.has(roomId)) {
    return;
  }

  const seats = roomPlayers.get(roomId);

  if (seats.player1?.socketId === socket.id) {
    seats.player1 = null;
  }

  if (seats.player2?.socketId === socket.id) {
    seats.player2 = null;
  }

  if (!seats.player1 && !seats.player2) {
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
      roomPlayers.set(roomId, createEmptySeats());
    }

    const seats = roomPlayers.get(roomId);

    if (seats.player1 && seats.player2) {
      socket.emit('room-full');
      socket.emit('player-count', 2);
      socket.emit('player-list', getRoomPlayers(roomId));
      socket.emit('players-updated', seats);
      return;
    }

    const player = {
      socketId: socket.id,
      nickname: nickname || '未命名玩家',
      ready: false
    };

    if (!seats.player1) {
      seats.player1 = player;
    } else {
      seats.player2 = player;
    }

    socket.data.roomId = roomId;
    socket.data.nickname = player.nickname;
    socket.join(roomId);
    broadcastRoomPlayers(roomId);
  });

  socket.on('player-ready', () => {
    const { roomId } = socket.data;

    if (!roomId || !roomPlayers.has(roomId)) {
      return;
    }

    const seats = roomPlayers.get(roomId);

    if (seats.player1?.socketId === socket.id) {
      seats.player1.ready = true;
    }

    if (seats.player2?.socketId === socket.id) {
      seats.player2.ready = true;
    }

    broadcastRoomPlayers(roomId);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
  });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
