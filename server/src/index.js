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
    deck: [],
    dealerSeat: 1,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    currentBets: { 1: 0, 2: 0 },
    pot: 0,
    currentTurn: null,
    hasVoluntaryRaise: false,
    actedThisRound: { 1: false, 2: false },
    handEnded: false,
    winnerSeat: null,
    actionLog: [],
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

function dealOneCommunityCard(deck) {
  return deck.splice(0, 1)[0];
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
    seat: seatNumber,
    socketId: player.socketId,
    nickname: player.nickname,
    ready: player.ready,
    online: true,
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
    currentTurn: room?.currentTurn || null,
    hasVoluntaryRaise: room?.hasVoluntaryRaise || false,
    actedThisRound: room?.actedThisRound || { 1: false, 2: false },
    handEnded: room?.handEnded || false,
    winnerSeat: room?.winnerSeat || null,
    actionLog: room?.actionLog || [],
    countdown: room?.countdown || null
  };
}

function broadcastRoomState(roomId) {
  io.to(roomId).emit('room-state', getRoomState(roomId));
}

function broadcastGameUpdated(roomId) {
  io.to(roomId).emit('game-updated', getRoomState(roomId));
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

function getSeatBySocket(seats, socketId) {
  if (seats.player1?.socketId === socketId) {
    return 1;
  }

  if (seats.player2?.socketId === socketId) {
    return 2;
  }

  return null;
}

function getOpponentSeat(seatNumber) {
  return seatNumber === 1 ? 2 : 1;
}

function isPublicBettingStreet(street) {
  return street === 'flop' || street === 'turn' || street === 'river';
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

function collectBetsToPot(room) {
  room.pot += room.currentBets[1] + room.currentBets[2];
  room.currentBets = { 1: 0, 2: 0 };
}

function startBettingRound(room, street) {
  room.street = street;
  room.currentBets = { 1: 0, 2: 0 };
  room.currentTurn = room.bigBlindSeat;
  room.hasVoluntaryRaise = false;
  room.actedThisRound = { 1: false, 2: false };
}

function dealFlopForRoom(room) {
  room.communityCards = dealFlop(room.deck);
  startBettingRound(room, 'flop');
}

function dealTurnForRoom(room) {
  const turnCard = dealOneCommunityCard(room.deck);

  if (turnCard) {
    room.communityCards.push(turnCard);
  }

  startBettingRound(room, 'turn');
}

function dealRiverForRoom(room) {
  const riverCard = dealOneCommunityCard(room.deck);

  if (riverCard) {
    room.communityCards.push(riverCard);
  }

  startBettingRound(room, 'river');
}

function finishShowdownReady(room) {
  room.street = 'showdown-ready';
  room.currentTurn = null;
  room.hasVoluntaryRaise = false;
  room.actedThisRound = { 1: false, 2: false };
}

function advanceFromStreet(room) {
  collectBetsToPot(room);

  if (room.street === 'preflop') {
    dealFlopForRoom(room);
    return;
  }

  if (room.street === 'flop') {
    dealTurnForRoom(room);
    return;
  }

  if (room.street === 'turn') {
    dealRiverForRoom(room);
    return;
  }

  if (room.street === 'river') {
    finishShowdownReady(room);
  }
}

function finishPreflop(roomId) {
  const room = rooms.get(roomId);

  if (!room || room.street !== 'preflop' || room.handEnded) {
    return;
  }

  advanceFromStreet(room);
  broadcastRoomPlayers(roomId);
  broadcastRoomState(roomId);
  broadcastGameUpdated(roomId);
}

function finishCurrentStreet(roomId) {
  const room = rooms.get(roomId);

  if (!room || room.handEnded) {
    return;
  }

  advanceFromStreet(room);
  broadcastRoomPlayers(roomId);
  broadcastRoomState(roomId);
  broadcastGameUpdated(roomId);
}

function handleFold(roomId, room, seatNumber) {
  const opponentSeat = getOpponentSeat(seatNumber);
  room.handEnded = true;
  room.gameState = 'ended';
  room.winnerSeat = opponentSeat;
  room.currentTurn = null;
  room.actionLog.push(`Player ${seatNumber} folds`);
}

function handleCall(roomId, room, seats, seatNumber) {
  const opponentSeat = getOpponentSeat(seatNumber);
  const player = getPlayerBySeat(seats, seatNumber);
  const toCall = room.currentBets[opponentSeat] - room.currentBets[seatNumber];

  player.chips -= toCall;
  room.currentBets[seatNumber] += toCall;
  room.actionLog.push(`Player ${seatNumber} calls ${toCall}`);

  if (room.hasVoluntaryRaise) {
    finishPreflop(roomId);
    return true;
  }

  room.currentTurn = opponentSeat;
  return false;
}

function handleCheck(roomId, room, seatNumber) {
  room.actionLog.push(`Player ${seatNumber} checks`);
  finishPreflop(roomId);
  return true;
}

function handleRaise(room, seats, seatNumber, raiseTo) {
  const opponentSeat = getOpponentSeat(seatNumber);
  const player = getPlayerBySeat(seats, seatNumber);
  const addAmount = raiseTo - room.currentBets[seatNumber];

  player.chips -= addAmount;
  room.currentBets[seatNumber] = raiseTo;
  room.hasVoluntaryRaise = true;
  room.currentTurn = opponentSeat;
  room.actionLog.push(`Player ${seatNumber} raises to ${raiseTo}`);
}

function publicStreetIsComplete(room) {
  return (
    room.currentBets[1] === room.currentBets[2] &&
    room.actedThisRound[1] &&
    room.actedThisRound[2]
  );
}

function handlePublicCheck(roomId, room, seatNumber) {
  const opponentSeat = getOpponentSeat(seatNumber);
  room.actedThisRound[seatNumber] = true;
  room.actionLog.push(`Player ${seatNumber} checks`);

  if (publicStreetIsComplete(room)) {
    finishCurrentStreet(roomId);
    return true;
  }

  room.currentTurn = opponentSeat;
  return false;
}

function handlePublicCall(roomId, room, seats, seatNumber) {
  const opponentSeat = getOpponentSeat(seatNumber);
  const player = getPlayerBySeat(seats, seatNumber);
  const toCall = room.currentBets[opponentSeat] - room.currentBets[seatNumber];

  player.chips -= toCall;
  room.currentBets[seatNumber] += toCall;
  room.actedThisRound[seatNumber] = true;
  room.actionLog.push(`Player ${seatNumber} calls ${toCall}`);

  if (publicStreetIsComplete(room)) {
    finishCurrentStreet(roomId);
    return true;
  }

  room.currentTurn = opponentSeat;
  return false;
}

function handlePublicBet(room, seats, seatNumber, betTo) {
  const opponentSeat = getOpponentSeat(seatNumber);
  const player = getPlayerBySeat(seats, seatNumber);
  const addAmount = betTo - room.currentBets[seatNumber];

  player.chips -= addAmount;
  room.currentBets[seatNumber] = betTo;
  room.hasVoluntaryRaise = true;
  room.actedThisRound[seatNumber] = true;
  room.actedThisRound[opponentSeat] = false;
  room.currentTurn = opponentSeat;
  room.actionLog.push(`Player ${seatNumber} bets ${betTo}`);
}

function handlePublicRaise(room, seats, seatNumber, raiseTo) {
  const opponentSeat = getOpponentSeat(seatNumber);
  const player = getPlayerBySeat(seats, seatNumber);
  const addAmount = raiseTo - room.currentBets[seatNumber];

  player.chips -= addAmount;
  room.currentBets[seatNumber] = raiseTo;
  room.hasVoluntaryRaise = true;
  room.actedThisRound[seatNumber] = true;
  room.actedThisRound[opponentSeat] = false;
  room.currentTurn = opponentSeat;
  room.actionLog.push(`Player ${seatNumber} raises to ${raiseTo}`);
}

function rejectAction(socket, message) {
  socket.emit('action-error', { message });
}

function broadcastGame(roomId) {
  broadcastRoomPlayers(roomId);
  broadcastRoomState(roomId);
  broadcastGameUpdated(roomId);
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
  const hands = new Map([
    [seats.player1.socketId, holeCards.player1],
    [seats.player2.socketId, holeCards.player2]
  ]);

  room.deck = deck;
  room.street = 'preflop';
  room.communityCards = [];
  room.currentTurn = room.smallBlindSeat;
  room.hasVoluntaryRaise = false;
  room.actedThisRound = { 1: false, 2: false };
  room.handEnded = false;
  room.winnerSeat = null;
  room.actionLog = [];
  roomHands.set(roomId, hands);
  io.sockets.sockets.get(seats.player1.socketId)?.emit('hand', holeCards.player1);
  io.sockets.sockets.get(seats.player2.socketId)?.emit('hand', holeCards.player2);
  broadcastGame(roomId);
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
        currentTurn: null,
        hasVoluntaryRaise: false,
        actedThisRound: { 1: false, 2: false },
        handEnded: false,
        winnerSeat: null,
        actionLog: [],
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

  socket.on('player-action', (payload) => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    const seats = roomPlayers.get(roomId);

    if (!roomId || !room || !seats) {
      rejectAction(socket, '房间不存在');
      return;
    }

    const seatNumber = getSeatBySocket(seats, socket.id);

    if (!seatNumber) {
      rejectAction(socket, '你不在当前牌局中');
      return;
    }

    if (room.handEnded || room.gameState === 'ended') {
      rejectAction(socket, '本局已经结束');
      return;
    }

    if (room.gameState !== 'playing' || (!isPublicBettingStreet(room.street) && room.street !== 'preflop')) {
      rejectAction(socket, '当前阶段不能操作');
      return;
    }

    if (room.currentTurn !== seatNumber) {
      rejectAction(socket, '还没轮到你操作');
      return;
    }

    const action = payload?.action;
    const opponentSeat = getOpponentSeat(seatNumber);
    const player = getPlayerBySeat(seats, seatNumber);
    const toCall = room.currentBets[opponentSeat] - room.currentBets[seatNumber];

    if (action === 'fold') {
      handleFold(roomId, room, seatNumber);
      broadcastGame(roomId);
      return;
    }

    if (action === 'call') {
      if (toCall <= 0) {
        rejectAction(socket, '当前不能 call');
        return;
      }

      if (player.chips < toCall) {
        rejectAction(socket, '筹码不足');
        return;
      }

      const streetFinished =
        room.street === 'preflop'
          ? handleCall(roomId, room, seats, seatNumber)
          : handlePublicCall(roomId, room, seats, seatNumber);

      if (!streetFinished) {
        broadcastGame(roomId);
      }

      return;
    }

    if (action === 'check') {
      if (toCall !== 0) {
        rejectAction(socket, '当前不能 check');
        return;
      }

      const streetFinished =
        room.street === 'preflop'
          ? handleCheck(roomId, room, seatNumber)
          : handlePublicCheck(roomId, room, seatNumber);

      if (!streetFinished) {
        broadcastGame(roomId);
      }

      return;
    }

    if (action === 'bet') {
      const betTo = Number(payload?.betTo);

      if (!isPublicBettingStreet(room.street)) {
        rejectAction(socket, '当前不能 bet');
        return;
      }

      if (toCall !== 0) {
        rejectAction(socket, '当前不能 bet');
        return;
      }

      if (betTo !== 2 && betTo !== 4) {
        rejectAction(socket, '当前只支持 Bet 2 或 Bet 4');
        return;
      }

      if (betTo <= room.currentBets[seatNumber] || betTo <= room.currentBets[opponentSeat]) {
        rejectAction(socket, '下注额必须大于双方当前下注');
        return;
      }

      const addAmount = betTo - room.currentBets[seatNumber];

      if (player.chips < addAmount) {
        rejectAction(socket, '筹码不足');
        return;
      }

      handlePublicBet(room, seats, seatNumber, betTo);
      broadcastGame(roomId);
      return;
    }

    if (action === 'raise') {
      const raiseTo = Number(payload?.raiseTo || 4);

      if (isPublicBettingStreet(room.street) && toCall <= 0) {
        rejectAction(socket, '当前请使用 bet');
        return;
      }

      if (raiseTo !== 4) {
        rejectAction(socket, '当前只支持 Raise to 4');
        return;
      }

      if (raiseTo <= room.currentBets[seatNumber] || raiseTo <= room.currentBets[opponentSeat]) {
        rejectAction(socket, '加注额必须大于双方当前下注');
        return;
      }

      const addAmount = raiseTo - room.currentBets[seatNumber];

      if (player.chips < addAmount) {
        rejectAction(socket, '筹码不足');
        return;
      }

      if (room.street === 'preflop') {
        handleRaise(room, seats, seatNumber, raiseTo);
      } else {
        handlePublicRaise(room, seats, seatNumber, raiseTo);
      }

      broadcastGame(roomId);
      return;
    }

    rejectAction(socket, '未知操作');
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
  });
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
