import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

function App() {
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState(() => localStorage.getItem('nickname') || '');
  const [statusText, setStatusText] = useState('');
  const [path, setPath] = useState(window.location.pathname);
  const [playerCount, setPlayerCount] = useState(0);
  const [players, setPlayers] = useState([]);
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
      return undefined;
    }

    const savedNickname = localStorage.getItem('nickname') || '';
    const socket = io({
      path: '/socket.io'
    });

    socket.emit('join-room', {
      roomId: currentRoomId,
      nickname: savedNickname
    });
    socket.on('player-count', (count) => {
      setPlayerCount(count);
    });
    socket.on('player-list', (nextPlayers) => {
      setPlayers(nextPlayers);
    });

    return () => {
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

  if (roomMatch) {
    return (
      <main>
        <h1>德州扑克房间</h1>
        <p>当前房间号：{currentRoomId}</p>
        <p>当前玩家数量：{playerCount}</p>
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
