const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Statische Dateien bereitstellen
app.use(express.static('public'));

// Game State
const gameRooms = new Map();

class GameRoom {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.players = new Map();
    this.created = Date.now();
  }
  
  addPlayer(socket, playerData) {
    const player = {
      id: socket.id,
      name: playerData.name || `Player ${this.players.size + 1}`,
      socket: socket,
      position: { x: 0, z: 0 },
      color: this.getPlayerColor(),
      joinTime: Date.now()
    };
    
    this.players.set(socket.id, player);
    return player;
  }
  
  removePlayer(socketId) {
    this.players.delete(socketId);
  }
  
  getPlayerColor() {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff'];
    return colors[this.players.size % colors.length];
  }
  
  movePlayer(socketId, direction) {
    const player = this.players.get(socketId);
    if (!player) return;
    
    const moveSpeed = 0.5;
    const bounds = { x: 9, z: 14 };
    
    switch(direction) {
      case 'left':
        player.position.x = Math.max(-bounds.x, player.position.x - moveSpeed);
        break;
      case 'right':
        player.position.x = Math.min(bounds.x, player.position.x + moveSpeed);
        break;
      case 'up':
        player.position.z = Math.max(-bounds.z, player.position.z - moveSpeed);
        break;
      case 'down':
        player.position.z = Math.min(bounds.z, player.position.z + moveSpeed);
        break;
    }
    
    // Broadcast player movement to all clients in room
    this.broadcastToRoom('playerMoved', {
      playerId: socketId,
      position: player.position,
      direction: direction
    });
  }
  
  broadcastToRoom(event, data) {
    this.players.forEach(player => {
      player.socket.emit(event, data);
    });
  }
  
  getPlayersData() {
    const playersArray = [];
    this.players.forEach(player => {
      playersArray.push({
        id: player.id,
        name: player.name,
        color: player.color,
        position: player.position
      });
    });
    return playersArray;
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/controller', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

app.get('/qr/:roomCode', async (req, res) => {
  try {
    const roomCode = req.params.roomCode;
    const url = `http://${req.get('host')}/controller?room=${roomCode}`;
    const qrCode = await QRCode.toDataURL(url);
    res.json({ qrCode, url });
  } catch (error) {
    res.status(500).json({ error: 'QR Code generation failed' });
  }
});

// Socket.IO Verbindungen
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Create or join room
  socket.on('createRoom', () => {
    const roomCode = generateRoomCode();
    const room = new GameRoom(roomCode);
    gameRooms.set(roomCode, room);
    
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, room: room.getPlayersData() });
    
    console.log(`Room created: ${roomCode}`);
  });
  
  socket.on('joinRoom', (data) => {
    const { roomCode, playerName } = data;
    const room = gameRooms.get(roomCode.toUpperCase());
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    socket.join(roomCode);
    const player = room.addPlayer(socket, { name: playerName });
    
    // Notify player
    socket.emit('joinedRoom', {
      roomCode,
      player: {
        id: player.id,
        name: player.name,
        color: player.color,
        position: player.position
      },
      players: room.getPlayersData()
    });
    
    // Notify other players
    socket.to(roomCode).emit('playerJoined', {
      player: {
        id: player.id,
        name: player.name,
        color: player.color,
        position: player.position
      },
      players: room.getPlayersData()
    });
    
    console.log(`Player ${playerName} joined room ${roomCode}`);
  });
  
  socket.on('move', (data) => {
    const { roomCode, direction } = data;
    const room = gameRooms.get(roomCode);
    
    if (room) {
      room.movePlayer(socket.id, direction);
    }
  });
  
  socket.on('playSound', (data) => {
    const { roomCode, soundName } = data;
    socket.to(roomCode).emit('playSound', { soundName });
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove player from all rooms
    gameRooms.forEach((room, roomCode) => {
      if (room.players.has(socket.id)) {
        room.removePlayer(socket.id);
        
        // Notify other players
        socket.to(roomCode).emit('playerLeft', {
          playerId: socket.id,
          players: room.getPlayersData()
        });
        
        // Remove empty rooms
        if (room.players.size === 0) {
          gameRooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (empty)`);
        }
      }
    });
  });
});

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Main Display: http://localhost:${PORT}`);
  console.log(`🎮 Controller: http://localhost:${PORT}/controller`);
});
