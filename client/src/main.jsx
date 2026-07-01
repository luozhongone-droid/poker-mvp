import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

function App() {
  const socketRef = useRef(null);
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState(() => localStorage.getItem('nickname') || '');
  const [statusText, setStatusText] = useState('');
  const [path, setPath] = useState(window.location.pathname);
  const [playerCount, setPlayerCount] = useState(0);
  const [players, setPlayers] = useState([]);
  const [playerSeats, setPlayerSeats] = useState({ player1: null, player2: null });
  const [roomFull, setRoomFull] = useState(false);
  const [socketId, setSocketId] = useState('');
  const [roomState, setRoomState] = useState({
    gameState: 'waiting',
    street: 'preflop',
    communityCards: [],
    currentTurn: null,
    pot: 0,
    winnerSeat: null,
    handEnded: false,
    actionLog: [],
    countdown: null
  });
  const [hand, setHand] = useState([]);
  const [actionMessage, setActionMessage] = useState('');
  const roomMatch = path.match(/^\/room\/([^/]+)$/);
  const currentRoomId = roomMatch?.[1];

  useEffect(() => {
    function handlePopState() {
      setPath(window.location.pathname);
    }

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!currentRoomId) {
      setPlayerCount(0);
      setPlayers([]);
      setPlayerSeats({ player1: null, player2: null });
      setRoomFull(false);
      setSocketId('');
      setRoomState({
        gameState: 'waiting',
        street: 'preflop',
        communityCards: [],
        currentTurn: null,
        pot: 0,
        winnerSeat: null,
        handEnded: false,
        actionLog: [],
        countdown: null
      });
      setHand([]);
      setActionMessage('');
      return undefined;
    }

    const savedNickname = localStorage.getItem('nickname') || '';
    setRoomState({
      gameState: 'waiting',
      street: 'preflop',
      communityCards: [],
      currentTurn: null,
      pot: 0,
      winnerSeat: null,
      handEnded: false,
      actionLog: [],
      countdown: null
    });
    setHand([]);
    setActionMessage('');
    setRoomFull(false);
    const socket = io({
      path: '/socket.io'
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketId(socket.id);
      socket.emit('join-room', {
        roomId: currentRoomId,
        nickname: savedNickname
      });
    });
    socket.on('player-count', (count) => {
      setPlayerCount(count);
    });
    socket.on('player-list', (nextPlayers) => {
      setPlayers(nextPlayers);
    });
    socket.on('players-updated', (nextSeats) => {
      setPlayerSeats(nextSeats);
    });
    socket.on('room-state', (nextRoomState) => {
      setRoomState(nextRoomState);
    });
    socket.on('game-updated', (nextRoomState) => {
      setRoomState(nextRoomState);
      setActionMessage('');
    });
    socket.on('action-error', (error) => {
      setActionMessage(error?.message || '操作失败');
    });
    socket.on('hand', (nextHand) => {
      setHand(nextHand);
    });
    socket.on('room-full', () => {
      setRoomFull(true);
    });

    return () => {
      setSocketId('');
      socketRef.current = null;
      setHand([]);
      setActionMessage('');
      socket.disconnect();
    };
  }, [currentRoomId]);

  async function handleCreateRoom() {
    console.log('创建房间');
    const nextNickname = nickname.trim();

    if (!nextNickname) {
      setStatusText('请先输入昵称');
      return;
    }

    try {
      const response = await fetch('/api/rooms', { method: 'POST' });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error('创建房间失败');
      }

      localStorage.setItem('nickname', nextNickname);
      setStatusText(`房间已创建：${data.roomId}`);
      window.history.pushState({}, '', `/room/${data.roomId}`);
      setPath(window.location.pathname);
    } catch (error) {
      console.error(error);
      setStatusText('创建房间失败');
    }
  }

  async function handleJoinRoom() {
    const targetRoomId = roomId.trim();
    const nextNickname = nickname.trim();
    console.log('加入房间', targetRoomId);

    if (!nextNickname) {
      setStatusText('请先输入昵称');
      return;
    }

    if (!targetRoomId) {
      setStatusText('房间不存在');
      return;
    }

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(targetRoomId)}/join`, {
        method: 'POST'
      });
      const data = await response.json();

      if (response.status === 404) {
        setStatusText('房间不存在');
        return;
      }

      if (!response.ok || !data.ok) {
        throw new Error('加入房间失败');
      }

      localStorage.setItem('nickname', nextNickname);
      window.history.pushState({}, '', `/room/${data.roomId}`);
      setPath(window.location.pathname);
    } catch (error) {
      console.error(error);
      setStatusText('加入房间失败');
    }
  }

  function handleReady(ready) {
    socketRef.current?.emit('player-ready', { ready });
  }

  function handlePlayerAction(action, extra = {}) {
    socketRef.current?.emit('player-action', { action, ...extra });
  }

  if (roomMatch) {
    const bettingStreets = ['preflop', 'flop', 'turn', 'river'];
    const mySeatKey = playerSeats.player1?.socketId === socketId ? 'player1' : 'player2';
    const mySeat = playerSeats[mySeatKey]?.socketId === socketId ? playerSeats[mySeatKey] : null;
    const mySeatNumber = mySeatKey === 'player1' && mySeat ? 1 : mySeat ? 2 : null;
    const opponentSeat = mySeatNumber === 1 ? playerSeats.player2 : playerSeats.player1;
    const gameState = roomState.gameState;
    const countdown = roomState.countdown;
    const street = roomState.street;
    const communityCards = roomState.communityCards || [];
    const isBettingStreet = bettingStreets.includes(street);
    const isMyTurn = Boolean(
      mySeatNumber && gameState === 'playing' && isBettingStreet && roomState.currentTurn === mySeatNumber
    );
    const toCall = mySeat && opponentSeat ? Math.max(0, opponentSeat.currentBet - mySeat.currentBet) : 0;
    const raiseTo = 4;
    const raiseAmount = mySeat ? raiseTo - mySeat.currentBet : 0;
    const canRaise = Boolean(
      mySeat &&
        opponentSeat &&
        isBettingStreet &&
        raiseTo > mySeat.currentBet &&
        raiseTo > opponentSeat.currentBet &&
        mySeat.chips >= raiseAmount
    );
    const canBet2 = Boolean(mySeat && street !== 'preflop' && toCall === 0 && mySeat.currentBet < 2 && mySeat.chips >= 2);
    const canBet4 = Boolean(mySeat && street !== 'preflop' && toCall === 0 && mySeat.currentBet < 4 && mySeat.chips >= 4);
    const streetLabelMap = {
      preflop: 'Preflop',
      flop: 'Flop',
      turn: 'Turn',
      river: 'River',
      'showdown-ready': 'Showdown Ready'
    };
    const streetLabel = streetLabelMap[street] || 'Preflop';
    const winnerText =
      gameState === 'ended' && roomState.winnerSeat
        ? roomState.winnerSeat === mySeatNumber
          ? '对手弃牌，你赢得本局'
          : '你已弃牌，对手赢得本局'
        : '';
    const tableStatus =
      gameState === 'countdown' && countdown
        ? `双方已准备，${countdown} 秒后开始游戏`
        : gameState === 'ended'
          ? '本局结束'
        : gameState === 'playing'
          ? street === 'showdown-ready'
            ? 'Showdown Ready'
            : `${streetLabel} · 轮到 Player ${roomState.currentTurn || '-'}`
          : playerCount < 2
            ? '等待另一位玩家加入'
            : '等待双方准备';

    function renderHoleCards(cards) {
      return (
        <div className="card-row" aria-label="我的手牌">
          {cards.map((card) => (
            <span
              className={`playing-card ${card.suit === '♥' || card.suit === '♦' ? 'is-red' : 'is-black'}`}
              key={`${card.rank}${card.suit}`}
            >
              {card.rank}
              {card.suit}
            </span>
          ))}
        </div>
      );
    }

    function renderCardBacks() {
      return (
        <div className="card-row" aria-label="对手盖牌">
          <span className="playing-card card-back">♠</span>
          <span className="playing-card card-back">♠</span>
        </div>
      );
    }

    function renderCommunityCards(cards) {
      if (!cards.length) {
        return null;
      }

      return (
        <div className="community-cards" aria-label="公共牌">
          <span className="community-cards__label">{streetLabel}</span>
          <div className="card-row card-row--community">
            {cards.map((card) => (
              <span
                className={`playing-card ${card.suit === '♥' || card.suit === '♦' ? 'is-red' : 'is-black'}`}
                key={`${card.rank}${card.suit}`}
              >
                {card.rank}
                {card.suit}
              </span>
            ))}
          </div>
        </div>
      );
    }

    function renderBetChip(player, position) {
      const currentBet = player?.currentBet || 0;

      if (currentBet <= 0) {
        return null;
      }

      return (
        <div className={`table-bet table-bet--${position}`} aria-label={`${position} player current bet`}>
          <span className="chip-icon" />
          <span>{currentBet}</span>
        </div>
      );
    }

    function renderPot() {
      if (street === 'preflop' || !roomState.pot) {
        return null;
      }

      return <div className="pot-badge">Pot: {roomState.pot}</div>;
    }

    function renderPlayerCard(label, player) {
      const isCurrentPlayer = player?.socketId === socketId;
      const statusText = player ? (player.ready ? '已准备' : '未准备') : '等待加入';
      const statusClassName = player
        ? `player-card__status ${player.ready ? 'is-ready' : 'is-waiting'}`
        : 'player-card__status is-empty';
      const showOwnHand = Boolean(player?.hasHand && isCurrentPlayer && hand.length);
      const showOpponentDealt = Boolean(player?.hasHand && !isCurrentPlayer);
      const showReadyStatus = gameState !== 'playing';

      return (
        <section className="player-card">
          <span className="player-card__label">
            {label}
            {player?.isDealer && <span className="role-badge">D</span>}
            {player?.blindLabel && <span className="role-badge role-badge--blind">{player.blindLabel}</span>}
          </span>
          {player ? (
            <strong className="player-card__name">
              {player.nickname}
              <span className="player-card__chips"> · {player.chips} chips</span>
            </strong>
          ) : (
            <strong className="player-card__name">等待加入...</strong>
          )}
          {showReadyStatus && <span className={statusClassName}>{statusText}</span>}
          {showOwnHand && renderHoleCards(hand)}
          {showOpponentDealt && renderCardBacks()}
        </section>
      );
    }

    function renderActionLog() {
      const actionLog = roomState.actionLog || [];

      if (!actionLog.length) {
        return null;
      }

      return (
        <div className="action-log" aria-label="行动记录">
          {actionLog.slice(-4).map((action, index) => (
            <span key={`${action}-${index}`}>{action}</span>
          ))}
        </div>
      );
    }

    function renderRoomActions() {
      if (!mySeat) {
        return <p>{roomFull ? '房间已满' : '等待入座'}</p>;
      }

      if (gameState === 'ended') {
        return <p>{winnerText || '本局结束'}</p>;
      }

      if (gameState !== 'playing') {
        return (
          <button type="button" onClick={() => handleReady(!mySeat.ready)}>
            {mySeat.ready ? '取消准备' : '准备'}
          </button>
        );
      }

      if (street === 'showdown-ready') {
        return <p>下注结束，等待摊牌</p>;
      }

      if (!isBettingStreet) {
        return <p>{streetLabel}</p>;
      }

      if (!isMyTurn) {
        return <p>等待对方操作</p>;
      }

      if (toCall > 0) {
        return (
          <div className="action-buttons">
            <button type="button" onClick={() => handlePlayerAction('fold')}>
              Fold
            </button>
            <button type="button" onClick={() => handlePlayerAction('call')}>
              Call {toCall}
            </button>
            <button
              type="button"
              onClick={() => handlePlayerAction('raise', { raiseTo })}
              disabled={!canRaise}
            >
              Raise to 4
            </button>
          </div>
        );
      }

      return (
        <div className="action-buttons">
          <button type="button" onClick={() => handlePlayerAction('check')}>
            Check
          </button>
          {street === 'preflop' ? (
            <button
              type="button"
              onClick={() => handlePlayerAction('raise', { raiseTo })}
              disabled={!canRaise}
            >
              Raise to 4
            </button>
          ) : (
            <>
              <button type="button" onClick={() => handlePlayerAction('bet', { betTo: 2 })} disabled={!canBet2}>
                Bet 2
              </button>
              <button type="button" onClick={() => handlePlayerAction('bet', { betTo: 4 })} disabled={!canBet4}>
                Bet 4
              </button>
            </>
          )}
        </div>
      );
    }

    return (
      <main className="room-page">
        <header className="room-header">
          <h1>Room: {currentRoomId}</h1>
          <p>当前玩家数量：{playerCount}</p>
        </header>

        <section className="table-area" aria-label="德州扑克房间">
          <div className="seat seat--top">{renderPlayerCard('Player 1', playerSeats.player1)}</div>

          <div className="poker-table">
            {renderBetChip(playerSeats.player1, 'top')}
            <div className="table-status">
              {roomFull ? '房间已满' : tableStatus}
            </div>
            {renderPot()}
            {renderCommunityCards(communityCards)}
            {renderBetChip(playerSeats.player2, 'bottom')}
          </div>

          <div className="seat seat--bottom">{renderPlayerCard('Player 2', playerSeats.player2)}</div>
        </section>

        <footer className="room-actions">
          {renderRoomActions()}
          {actionMessage && <p className="action-message">{actionMessage}</p>}
          {playerCount < 2 && !roomFull && <p>等待另一位玩家加入</p>}
          {renderActionLog()}
        </footer>
      </main>
    );
  }

  return (
    <main className="home-page">
      <h1>德州扑克 MVP</h1>

      <button type="button" onClick={handleCreateRoom}>
        创建房间
      </button>

      <input
        aria-label="昵称"
        placeholder="输入昵称"
        value={nickname}
        onChange={(event) => {
          setNickname(event.target.value);
          localStorage.setItem('nickname', event.target.value);
        }}
      />

      <div>
        <input
          aria-label="房间号"
          placeholder="输入房间号"
          value={roomId}
          onChange={(event) => setRoomId(event.target.value)}
        />
        <button type="button" onClick={handleJoinRoom}>
          加入房间
        </button>
      </div>

      {statusText && <p>{statusText}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
