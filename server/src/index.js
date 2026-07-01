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
    handNumber: 1,
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
    isTie: false,
    showdownHands: null,
    handRanks: null,
    showdownResult: null,
    actionLog: [],
    countdown: null,
    countdownTimer: null,
    nextHandTimer: null,
    nextHandStartsAt: null
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

const rankValues = {
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

const categoryLabels = {
  0: 'High Card',
  1: 'One Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
  9: 'Royal Flush'
};

function getCardValue(card) {
  return rankValues[card.rank];
}

function getFiveCardCombinations(cards) {
  const combinations = [];

  for (let first = 0; first < cards.length - 4; first += 1) {
    for (let second = first + 1; second < cards.length - 3; second += 1) {
      for (let third = second + 1; third < cards.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < cards.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < cards.length; fifth += 1) {
            combinations.push([cards[first], cards[second], cards[third], cards[fourth], cards[fifth]]);
          }
        }
      }
    }
  }

  return combinations;
}

function getStraightHigh(values) {
  const uniqueValues = [...new Set(values)].sort((a, b) => b - a);

  if (uniqueValues.includes(14)) {
    uniqueValues.push(1);
  }

  for (let index = 0; index <= uniqueValues.length - 5; index += 1) {
    const window = uniqueValues.slice(index, index + 5);
    const isStraight = window.every((value, valueIndex) => valueIndex === 0 || value === window[valueIndex - 1] - 1);

    if (isStraight) {
      return window[0] === 1 ? 5 : window[0];
    }
  }

  return null;
}

function compareRankObjects(first, second) {
  if (first.categoryRank !== second.categoryRank) {
    return first.categoryRank > second.categoryRank ? 1 : -1;
  }

  const maxLength = Math.max(first.tiebreakers.length, second.tiebreakers.length);

  for (let index = 0; index < maxLength; index += 1) {
    const firstValue = first.tiebreakers[index] || 0;
    const secondValue = second.tiebreakers[index] || 0;

    if (firstValue !== secondValue) {
      return firstValue > secondValue ? 1 : -1;
    }
  }

  return 0;
}

function evaluateFiveCards(cards) {
  const values = cards.map(getCardValue).sort((a, b) => b - a);
  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = getStraightHigh(values);
  const countByValue = values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
  const groups = Object.entries(countByValue)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((first, second) => second.count - first.count || second.value - first.value);

  if (isFlush && straightHigh) {
    const isRoyal = straightHigh === 14;
    return {
      category: isRoyal ? 'royal-flush' : 'straight-flush',
      categoryLabel: categoryLabels[isRoyal ? 9 : 8],
      categoryRank: isRoyal ? 9 : 8,
      tiebreakers: [straightHigh],
      bestFive: cards
    };
  }

  if (groups[0].count === 4) {
    return {
      category: 'quads',
      categoryLabel: categoryLabels[7],
      categoryRank: 7,
      tiebreakers: [groups[0].value, groups[1].value],
      bestFive: cards
    };
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    return {
      category: 'full-house',
      categoryLabel: categoryLabels[6],
      categoryRank: 6,
      tiebreakers: [groups[0].value, groups[1].value],
      bestFive: cards
    };
  }

  if (isFlush) {
    return {
      category: 'flush',
      categoryLabel: categoryLabels[5],
      categoryRank: 5,
      tiebreakers: values,
      bestFive: cards
    };
  }

  if (straightHigh) {
    return {
      category: 'straight',
      categoryLabel: categoryLabels[4],
      categoryRank: 4,
      tiebreakers: [straightHigh],
      bestFive: cards
    };
  }

  if (groups[0].count === 3) {
    return {
      category: 'trips',
      categoryLabel: categoryLabels[3],
      categoryRank: 3,
      tiebreakers: [groups[0].value, ...groups.slice(1).map((group) => group.value).sort((a, b) => b - a)],
      bestFive: cards
    };
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairValues = groups
      .filter((group) => group.count === 2)
      .map((group) => group.value)
      .sort((a, b) => b - a);
    const kicker = groups.find((group) => group.count === 1).value;

    return {
      category: 'two-pair',
      categoryLabel: categoryLabels[2],
      categoryRank: 2,
      tiebreakers: [...pairValues, kicker],
      bestFive: cards
    };
  }

  if (groups[0].count === 2) {
    return {
      category: 'one-pair',
      categoryLabel: categoryLabels[1],
      categoryRank: 1,
      tiebreakers: [groups[0].value, ...groups.slice(1).map((group) => group.value).sort((a, b) => b - a)],
      bestFive: cards
    };
  }

  return {
    category: 'high-card',
    categoryLabel: categoryLabels[0],
    categoryRank: 0,
    tiebreakers: values,
    bestFive: cards
  };
}

function evaluateSevenCards(cards) {
  return getFiveCardCombinations(cards)
    .map(evaluateFiveCards)
    .sort((first, second) => compareRankObjects(second, first))[0];
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
    handNumber: room?.handNumber || 1,
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
    isTie: room?.isTie || false,
    showdownHands: room?.showdownHands || null,
    handRanks: room?.handRanks || null,
    showdownResult: room?.showdownResult || null,
    actionLog: room?.actionLog || [],
    countdown: room?.countdown || null,
    nextHandStartsAt: room?.nextHandStartsAt || null
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

function awardPotToSeat(room, seats, seatNumber) {
  const winner = getPlayerBySeat(seats, seatNumber);
  const awardedPot = room.pot;

  winner.chips += awardedPot;
  room.pot = 0;

  return awardedPot;
}

function splitPot(room, seats) {
  const splitAmount = Math.floor(room.pot / 2);
  const remainder = room.pot % 2;

  seats.player1.chips += splitAmount + remainder;
  seats.player2.chips += splitAmount;
  room.pot = 0;

  return { splitAmount, remainderToSeat: remainder ? 1 : null };
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

function performShowdown(roomId, room, seats) {
  const hands = roomHands.get(roomId);
  const player1Hand = hands?.get(seats.player1.socketId);
  const player2Hand = hands?.get(seats.player2.socketId);

  if (!player1Hand || !player2Hand || room.communityCards.length < 5) {
    return;
  }

  const player1Rank = evaluateSevenCards([...player1Hand, ...room.communityCards]);
  const player2Rank = evaluateSevenCards([...player2Hand, ...room.communityCards]);
  const comparison = compareRankObjects(player1Rank, player2Rank);
  const originalPot = room.pot;

  room.street = 'showdown';
  room.gameState = 'ended';
  room.handEnded = true;
  room.currentTurn = null;
  room.hasVoluntaryRaise = false;
  room.actedThisRound = { 1: false, 2: false };
  room.showdownHands = {
    player1: player1Hand,
    player2: player2Hand
  };
  room.handRanks = {
    player1: player1Rank,
    player2: player2Rank
  };

  if (comparison > 0) {
    room.winnerSeat = 1;
    room.isTie = false;
    awardPotToSeat(room, seats, 1);
    room.showdownResult = {
      winnerSeat: 1,
      isTie: false,
      potAwarded: originalPot,
      winningCategory: player1Rank.categoryLabel
    };
    room.actionLog.push(`Player 1 wins with ${player1Rank.categoryLabel}`);
    scheduleNextHand(roomId);
    return;
  }

  if (comparison < 0) {
    room.winnerSeat = 2;
    room.isTie = false;
    awardPotToSeat(room, seats, 2);
    room.showdownResult = {
      winnerSeat: 2,
      isTie: false,
      potAwarded: originalPot,
      winningCategory: player2Rank.categoryLabel
    };
    room.actionLog.push(`Player 2 wins with ${player2Rank.categoryLabel}`);
    scheduleNextHand(roomId);
    return;
  }

  const splitResult = splitPot(room, seats);
  room.winnerSeat = null;
  room.isTie = true;
  room.showdownResult = {
    winnerSeat: null,
    isTie: true,
    potAwarded: originalPot,
    splitAmount: splitResult.splitAmount,
    remainderToSeat: splitResult.remainderToSeat,
    winningCategory: player1Rank.categoryLabel
  };
  room.actionLog.push(`Split pot with ${player1Rank.categoryLabel}`);
  scheduleNextHand(roomId);
}

function advanceFromStreet(roomId, room, seats) {
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
    performShowdown(roomId, room, seats);
  }
}

function finishPreflop(roomId) {
  const room = rooms.get(roomId);

  if (!room || room.street !== 'preflop' || room.handEnded) {
    return;
  }

  const seats = roomPlayers.get(roomId);

  if (!seats) {
    return;
  }

  advanceFromStreet(roomId, room, seats);
  broadcastRoomPlayers(roomId);
  broadcastRoomState(roomId);
  broadcastGameUpdated(roomId);
}

function finishCurrentStreet(roomId) {
  const room = rooms.get(roomId);

  if (!room || room.handEnded) {
    return;
  }

  const seats = roomPlayers.get(roomId);

  if (!seats) {
    return;
  }

  advanceFromStreet(roomId, room, seats);
  broadcastRoomPlayers(roomId);
  broadcastRoomState(roomId);
  broadcastGameUpdated(roomId);
}

function handleFold(room, seats, seatNumber) {
  const opponentSeat = getOpponentSeat(seatNumber);
  collectBetsToPot(room);
  const awardedPot = awardPotToSeat(room, seats, opponentSeat);

  room.handEnded = true;
  room.gameState = 'ended';
  room.winnerSeat = opponentSeat;
  room.isTie = false;
  room.currentTurn = null;
  room.showdownResult = {
    winnerSeat: opponentSeat,
    isTie: false,
    potAwarded: awardedPot,
    winningCategory: null
  };
  room.actionLog.push(`Player ${seatNumber} folds`);
  room.actionLog.push(`Player ${opponentSeat} wins pot ${awardedPot}`);
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
    room.actedThisRound?.[1] === true &&
    room.actedThisRound?.[2] === true
  );
}

function handlePublicCheck(roomId, room, seatNumber) {
  const opponentSeat = getOpponentSeat(seatNumber);
  room.actedThisRound[seatNumber] = true;
  room.currentTurn = opponentSeat;
  room.actionLog.push(`Player ${seatNumber} checks`);

  if (publicStreetIsComplete(room)) {
    finishCurrentStreet(roomId);
    return true;
  }

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

function clearNextHandTimer(room) {
  if (room.nextHandTimer) {
    clearTimeout(room.nextHandTimer);
  }

  room.nextHandTimer = null;
  room.nextHandStartsAt = null;
}

function resetHandState(room) {
  room.deck = [];
  room.communityCards = [];
  room.currentBets = { 1: 0, 2: 0 };
  room.pot = 0;
  room.currentTurn = null;
  room.street = 'preflop';
  room.hasVoluntaryRaise = false;
  room.actedThisRound = { 1: false, 2: false };
  room.handEnded = false;
  room.winnerSeat = null;
  room.isTie = false;
  room.showdownHands = null;
  room.handRanks = null;
  room.showdownResult = null;
  room.actionLog = [];
}

function startHand(roomId, { rotateDealer = false } = {}) {
  const room = rooms.get(roomId);
  const seats = roomPlayers.get(roomId);

  if (!room || !seats?.player1 || !seats?.player2) {
    if (room) {
      clearNextHandTimer(room);
      resetHandState(room);
      room.gameState = 'waiting';
      broadcastGame(roomId);
    }

    return false;
  }

  clearNextHandTimer(room);

  if (rotateDealer) {
    room.handNumber += 1;
    room.dealerSeat = room.dealerSeat === 1 ? 2 : 1;
  }

  resetHandState(room);
  room.gameState = 'playing';
  postBlinds(room, seats);

  const deck = shuffle(createDeck());
  const holeCards = dealHoleCards(deck);
  const hands = new Map([
    [seats.player1.socketId, holeCards.player1],
    [seats.player2.socketId, holeCards.player2]
  ]);

  room.deck = deck;
  room.currentTurn = room.smallBlindSeat;
  roomHands.set(roomId, hands);
  io.sockets.sockets.get(seats.player1.socketId)?.emit('hand', holeCards.player1);
  io.sockets.sockets.get(seats.player2.socketId)?.emit('hand', holeCards.player2);
  broadcastGame(roomId);

  return true;
}

function scheduleNextHand(roomId) {
  const room = rooms.get(roomId);

  if (!room || room.nextHandTimer) {
    return;
  }

  room.nextHandStartsAt = Date.now() + 4000;
  room.nextHandTimer = setTimeout(() => {
    startHand(roomId, { rotateDealer: true });
  }, 4000);
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
  startHand(roomId);
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
        handNumber: 1,
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
        isTie: false,
        showdownHands: null,
        handRanks: null,
        showdownResult: null,
        actionLog: [],
        countdown: null,
        nextHandStartsAt: null
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
      handleFold(room, seats, seatNumber);
      scheduleNextHand(roomId);
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
