import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  const [roomId, setRoomId] = useState('');

  function handleCreateRoom() {
    console.log('创建房间');
  }

  function handleJoinRoom() {
    console.log('加入房间', roomId);
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
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
