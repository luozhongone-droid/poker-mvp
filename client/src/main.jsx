import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  const [roomId, setRoomId] = useState('');
  const [statusText, setStatusText] = useState('');

  async function handleCreateRoom() {
    console.log('创建房间');

    try {
      const response = await fetch('/api/rooms', { method: 'POST' });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error('创建房间失败');
      }

      setStatusText(`房间已创建：${data.roomId}`);
    } catch (error) {
      console.error(error);
      setStatusText('创建房间失败');
    }
  }

  function handleJoinRoom() {
    console.log('加入房间', roomId);
    setStatusText(`加入房间按钮已点击：${roomId}`);
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
