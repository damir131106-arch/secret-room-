const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// Хранилище комнат
const rooms = new Map();
const roomMessages = new Map();
const clientRooms = new Map();

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function sendHistory(ws, roomCode) {
    const history = roomMessages.get(roomCode) || [];
    ws.send(JSON.stringify({ type: 'history', data: history }));
}

function broadcastToRoom(roomCode, message, exceptWs = null) {
    const clients = rooms.get(roomCode);
    if (!clients) return;
    const messageStr = JSON.stringify(message);
    clients.forEach(client => {
        if (client !== exceptWs && client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

function updateParticipantCount(roomCode) {
    const clients = rooms.get(roomCode);
    const count = clients ? clients.size : 0;
    broadcastToRoom(roomCode, { type: 'participants', count: count });
}

wss.on('connection', (ws) => {
    console.log('Клиент подключился');
    let currentRoom = null;
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            switch (message.type) {
                case 'create_room':
                    const newRoomCode = generateRoomCode();
                    currentRoom = newRoomCode;
                    if (!rooms.has(currentRoom)) {
                        rooms.set(currentRoom, new Set());
                        roomMessages.set(currentRoom, []);
                    }
                    rooms.get(currentRoom).add(ws);
                    clientRooms.set(ws, currentRoom);
                    ws.send(JSON.stringify({ type: 'room_created', roomCode: currentRoom }));
                    sendHistory(ws, currentRoom);
                    updateParticipantCount(currentRoom);
                    break;
                
                case 'join_room':
                    const roomCode = message.roomCode.toUpperCase();
                    const existingRoom = rooms.get(roomCode);
                    if (existingRoom) {
                        currentRoom = roomCode;
                        existingRoom.add(ws);
                        clientRooms.set(ws, currentRoom);
                        ws.send(JSON.stringify({ type: 'room_joined', roomCode: currentRoom, success: true }));
                        sendHistory(ws, currentRoom);
                        broadcastToRoom(currentRoom, { type: 'system', text: '👤 Пользователь присоединился' }, ws);
                        updateParticipantCount(currentRoom);
                    } else {
                        ws.send(JSON.stringify({ type: 'room_joined', success: false, error: 'Комната не найдена' }));
                    }
                    break;
                
                case 'message':
                    if (currentRoom) {
                        const msgData = {
                            type: 'message',
                            nickname: message.nickname,
                            text: message.text,
                            time: new Date().toLocaleTimeString()
                        };
                        const history = roomMessages.get(currentRoom) || [];
                        history.push(msgData);
                        if (history.length > 100) history.shift();
                        roomMessages.set(currentRoom, history);
                        broadcastToRoom(currentRoom, msgData);
                    }
                    break;
            }
        } catch(e) {
            console.error('Ошибка:', e);
        }
    });
    
    ws.on('close', () => {
        const roomCode = clientRooms.get(ws);
        if (roomCode) {
            const clients = rooms.get(roomCode);
            if (clients) {
                clients.delete(ws);
                updateParticipantCount(roomCode);
            }
            clientRooms.delete(ws);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});