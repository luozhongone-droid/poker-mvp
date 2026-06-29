import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

function App() {
  const [roomId, setRoomId] = useState('');
  const [statusText, setStatusText] = useState('');
  const [path, setPath] = useState(window.location.pathname);
  const [playerCount, setPlayerCount] = useState(0);
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
      return undefined;
    }

    const socket = io({
      path: '/socket.io'
    });

    socket.emit('join-room', currentRoomId);
    socket.on('player-count', (count) => {
      setPlayerCount(count);
    });

    return () => {
      socket.disconnect();
    };
  }, [currentRoomId]);

  async function handleCreateRoom() {
    console.log('创建房间');

    try {
      const response = await fetch('/api/rooms', { method: 'POST' });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error('创建房间失败');
      }

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
    console.log('加入房间', targetRoomId);

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
