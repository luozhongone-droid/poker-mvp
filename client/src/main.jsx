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
  const [roomState, setRoomState] = useState({ gameState: 'waiting', countdown: null });
  const [hand, setHand] = useState([]);
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
      setRoomState({ gameState: 'waiting', countdown: null });
      setHand([]);
      return undefined;
    }

    const savedNickname = localStorage.getItem('nickname') || '';
    setRoomState({ gameState: 'waiting', countdown: null });
    setHand([]);
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

  if (roomMatch) {
    const mySeatKey = playerSeats.player1?.socketId === socketId ? 'player1' : 'player2';
    const mySeat = playerSeats[mySeatKey]?.socketId === socketId ? playerSeats[mySeatKey] : null;
    const gameState = roomState.gameState;
    const countdown = roomState.countdown;
    const tableStatus =
      gameState === 'countdown' && countdown
        ? `双方已准备，${countdown} 秒后开始游戏`
        : gameState === 'playing'
          ? '游戏已开始'
          : playerCount < 2
            ? '等待另一位玩家加入'
            : '等待双方准备';

    function renderHoleCards(cards) {
      return (
        <div className="hole-cards" aria-label="我的手牌">
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
        <div className="hole-cards" aria-label="对手盖牌">
          <span className="playing-card card-back">♠</span>
          <span className="playing-card card-back">♠</span>
        </div>
      );
    }

    function renderPlayerCard(label, player) {
      const isCurrentPlayer = player?.socketId === socketId;
      const statusText = player ? (player.ready ? '已准备' : '未准备') : '等待加入';
      const statusClassName = player
        ? `player-card__status ${player.ready ? 'is-ready' : 'is-waiting'}`
        : 'player-card__status is-empty';
      const showOwnHand = Boolean(player?.hasHand && isCurrentPlayer && hand.length);
      const showOpponentDealt = Boolean(player?.hasHand && !isCurrentPlayer);

      return (
        <section className="player-card">
          <span className="player-card__label">{label}</span>
          <strong className="player-card__name">{player?.nickname || '等待加入...'}</strong>
          <span className={statusClassName}>{statusText}</span>
          {showOwnHand && renderHoleCards(hand)}
          {showOpponentDealt && renderCardBacks()}
        </section>
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
            <div className="table-status">
              {roomFull ? '房间已满' : tableStatus}
            </div>
          </div>

          <div className="seat seat--bottom">{renderPlayerCard('Player 2', playerSeats.player2)}</div>
        </section>

        <footer className="room-actions">
          {mySeat ? (
            <button
              type="button"
              onClick={() => handleReady(!mySeat.ready)}
              disabled={gameState === 'playing'}
            >
              {gameState === 'playing' ? '已准备' : mySeat.ready ? '取消准备' : '准备'}
            </button>
          ) : (
            <p>{roomFull ? '房间已满' : '等待入座'}</p>
          )}
          {playerCount < 2 && !roomFull && <p>等待另一位玩家加入</p>}
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
