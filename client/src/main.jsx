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
      return undefined;
    }

    const savedNickname = localStorage.getItem('nickname') || '';
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
    socket.on('room-full', () => {
      setRoomFull(true);
    });

    return () => {
      setSocketId('');
      socketRef.current = null;
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

  function handleReady() {
    socketRef.current?.emit('player-ready');
  }

  if (roomMatch) {
    const mySeatKey = playerSeats.player1?.socketId === socketId ? 'player1' : 'player2';
    const mySeat = playerSeats[mySeatKey]?.socketId === socketId ? playerSeats[mySeatKey] : null;
    const bothPlayersReady = Boolean(playerSeats.player1?.ready && playerSeats.player2?.ready);
    const readyMessage = bothPlayersReady
      ? '双方已准备，可以开始游戏'
      : '等待另一位玩家';

    return (
      <main>
        <h1>德州扑克房间</h1>
        <p>当前房间号：{currentRoomId}</p>
        <p>当前玩家数量：{playerCount}</p>
        {roomFull && <p>房间已满</p>}
        <section>
          <p>
            Player 1：{playerSeats.player1?.nickname || '等待加入...'}
            {playerSeats.player1 && ` ${playerSeats.player1.ready ? '已准备' : '未准备'}`}
          </p>
          <p>
            Player 2：{playerSeats.player2?.nickname || '等待加入...'}
            {playerSeats.player2 && ` ${playerSeats.player2.ready ? '已准备' : '未准备'}`}
          </p>
        </section>
        {mySeat && !mySeat.ready && (
          <button type="button" onClick={handleReady}>
            准备
          </button>
        )}
        <p>{readyMessage}</p>
        <section>
          <p>玩家列表：</p>
          <ul>
            {players.map((player) => (
              <li key={player.socketId}>{player.nickname}</li>
            ))}
          </ul>
        </section>
        <p>已进入房间</p>
      </main>
    );
  }

  return (
    <main>
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
