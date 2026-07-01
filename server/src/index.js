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
const roomHands = new Map();

function createEmptySeats() {
  return {
    player1: null,
    player2: null
  };
}

function createRoom(roomId) {
  return {
    id: roomId,
    createdAt: new Date().toISOString(),
    gameState: 'waiting',
    street: 'preflop',
    communityCards: [],
    dealerSeat: 1,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    currentBets: { 1: 0, 2: 0 },
    pot: 0,
    countdown: null,
    countdownTimer: null
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

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  return suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
}

function shuffle(deck) {
  const nextDeck = [...deck];

  for (let index = nextDeck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nextDeck[index], nextDeck[swapIndex]] = [nextDeck[swapIndex], nextDeck[index]];
  }

  return nextDeck;
}

function dealHoleCards(deck) {
  return {
    player1: deck.splice(0, 2),
    player2: deck.splice(0, 2)
  };
}

function dealFlop(deck) {
  return deck.splice(0, 3);
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/rooms', (req, res) => {
  const roomId = createRoomId();
  rooms.set(roomId, createRoom(roomId));

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
  const seats = getPublicSeats(roomId);
  return [seats?.player1, seats?.player2].filter(Boolean);
}

function getBlindLabel(room, seatNumber) {
  if (room?.smallBlindSeat === seatNumber) {
    return 'SB';
  }

  if (room?.bigBlindSeat === seatNumber) {
    return 'BB';
  }

  return null;
}

function getPublicPlayer(roomId, player, seatNumber) {
  if (!player) {
    return null;
  }

  const room = rooms.get(roomId);

  return {
    socketId: player.socketId,
    nickname: player.nickname,
    ready: player.ready,
    chips: player.chips,
    currentBet: room?.currentBets?.[seatNumber] || 0,
    isDealer: room?.dealerSeat === seatNumber,
    blindLabel: getBlindLabel(room, seatNumber),
    hasHand: roomHands.get(roomId)?.has(player.socketId) || false
  };
}

function getPublicSeats(roomId) {
  const seats = roomPlayers.get(roomId) || createEmptySeats();

  return {
    player1: getPublicPlayer(roomId, seats.player1, 1),
    player2: getPublicPlayer(roomId, seats.player2, 2)
  };
}

function getRoomState(roomId) {
  const room = rooms.get(roomId);

  return {
    gameState: room?.gameState || 'waiting',
    street: room?.street || 'preflop',
    communityCards: room?.communityCards || [],
    dealerSeat: room?.dealerSeat || 1,
    smallBlindSeat: room?.smallBlindSeat || 1,
    bigBlindSeat: room?.bigBlindSeat || 2,
    currentBets: room?.currentBets || { 1: 0, 2: 0 },
    pot: room?.pot || 0,
    countdown: room?.countdown || null
  };
}

function broadcastRoomState(roomId) {
  io.to(roomId).emit('room-state', getRoomState(roomId));
}

function broadcastRoomPlayers(roomId) {
  const seats = getPublicSeats(roomId);
  const players = getRoomPlayers(roomId);
  const playerCount = players.length;
  io.to(roomId).emit('player-count', playerCount);
  io.to(roomId).emit('player-list', players);
  io.to(roomId).emit('players-updated', seats);
}

function bothPlayersReady(roomId) {
  const seats = roomPlayers.get(roomId);
  return Boolean(seats?.player1?.ready && seats?.player2?.ready);
}

function getPlayerBySeat(seats, seatNumber) {
  return seatNumber === 1 ? seats.player1 : seats.player2;
}

function postBlinds(room, seats) {
  room.dealerSeat = 1;
  room.smallBlindSeat = room.dealerSeat;
  room.bigBlindSeat = room.dealerSeat === 1 ? 2 : 1;
  room.currentBets = { 1: 0, 2: 0 };
  room.pot = 0;

  const smallBlindPlayer = getPlayerBySeat(seats, room.smallBlindSeat);
  const bigBlindPlayer = getPlayerBySeat(seats, room.bigBlindSeat);

  smallBlindPlayer.chips -= 1;
  bigBlindPlayer.chips -= 2;
  room.currentBets[room.smallBlindSeat] = 1;
  room.currentBets[room.bigBlindSeat] = 2;
}

function clearCountdown(room) {
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
  }

  room.countdownTimer = null;
  room.countdown = null;
}

function cancelCountdown(roomId) {
  const room = rooms.get(roomId);

  if (!room || room.gameState !== 'countdown') {
    return;
  }

  clearCountdown(room);
  room.gameState = 'waiting';
  broadcastRoomState(roomId);
}

function startGame(roomId) {
  const room = rooms.get(roomId);
  const seats = roomPlayers.get(roomId);

  if (!room || !seats?.player1 || !seats?.player2 || !bothPlayersReady(roomId)) {
    cancelCountdown(roomId);
    return;
  }

  clearCountdown(room);
  room.gameState = 'playing';
  postBlinds(room, seats);

  const deck = shuffle(createDeck());
  const holeCards = dealHoleCards(deck);
  const flop = dealFlop(deck);
  const hands = new Map([
    [seats.player1.socketId, holeCards.player1],
    [seats.player2.socketId, holeCards.player2]
  ]);

  room.street = 'flop';
  room.communityCards = flop;
  roomHands.set(roomId, hands);
  io.sockets.sockets.get(seats.player1.socketId)?.emit('hand', holeCards.player1);
  io.sockets.sockets.get(seats.player2.socketId)?.emit('hand', holeCards.player2);
  broadcastRoomPlayers(roomId);
  broadcastRoomState(roomId);
}

function startCountdown(roomId) {
  const room = rooms.get(roomId);

  if (!room || room.gameState !== 'waiting' || !bothPlayersReady(roomId)) {
    return;
  }

  room.gameState = 'countdown';
  room.countdown = 3;
  broadcastRoomState(roomId);

  room.countdownTimer = setInterval(() => {
    if (!bothPlayersReady(roomId)) {
      cancelCountdown(roomId);
      return;
    }

    if (room.countdown > 1) {
      room.countdown -= 1;
      broadcastRoomState(roomId);
      return;
    }

    startGame(roomId);
  }, 1000);
}

function updateCountdownState(roomId) {
  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  if (room.gameState === 'countdown' && !bothPlayersReady(roomId)) {
    cancelCountdown(roomId);
    return;
  }

  if (room.gameState === 'waiting' && bothPlayersReady(roomId)) {
    startCountdown(roomId);
  }
}

function removePlayerFromRoom(socket) {
  const { roomId } = socket.data;

  if (!roomId || !roomPlayers.has(roomId)) {
    return;
  }

  const seats = roomPlayers.get(roomId);
  roomHands.get(roomId)?.delete(socket.id);

  if (seats.player1?.socketId === socket.id) {
    seats.player1 = null;
  }

  if (seats.player2?.socketId === socket.id) {
    seats.player2 = null;
  }

  if (!seats.player1 && !seats.player2) {
    roomPlayers.delete(roomId);
    roomHands.delete(roomId);
  }

  socket.leave(roomId);
  socket.data.roomId = undefined;
  socket.data.nickname = undefined;
  updateCountdownState(roomId);
  broadcastRoomPlayers(roomId);
}

io.on('connection', (socket) => {
  socket.on('join-room', (payload) => {
    const roomId = typeof payload === 'string' ? payload : payload?.roomId;
    const nickname = typeof payload === 'string' ? '' : payload?.nickname?.trim();

    if (!rooms.has(roomId)) {
      socket.emit('player-count', 0);
      socket.emit('player-list', []);
      socket.emit('room-state', {
        gameState: 'waiting',
        street: 'preflop',
        communityCards: [],
        dealerSeat: 1,
        smallBlindSeat: 1,
        bigBlindSeat: 2,
        currentBets: { 1: 0, 2: 0 },
        pot: 0,
        countdown: null
      });
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
      socket.emit('players-updated', getPublicSeats(roomId));
      socket.emit('room-state', getRoomState(roomId));
      return;
    }

    const player = {
      socketId: socket.id,
      nickname: nickname || '未命名玩家',
      ready: false,
      chips: 100
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
    socket.emit('room-state', getRoomState(roomId));
  });

  socket.on('player-ready', (payload) => {
    const { roomId } = socket.data;
    const ready = typeof payload?.ready === 'boolean' ? payload.ready : true;
    const room = rooms.get(roomId);

    if (!roomId || !room || !roomPlayers.has(roomId) || room.gameState === 'playing') {
      return;
    }

    const seats = roomPlayers.get(roomId);

    if (seats.player1?.socketId === socket.id) {
      seats.player1.ready = ready;
    }

    if (seats.player2?.socketId === socket.id) {
      seats.player2.ready = ready;
    }

    broadcastRoomPlayers(roomId);
    updateCountdownState(roomId);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
  });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
