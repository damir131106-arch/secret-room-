const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ===== TELEGRAM НАСТРОЙКИ =====
const TELEGRAM_BOT_TOKEN = '8418856066:AAHSBBdKcrmMAn1-lLBhZB9D5MlMiEiZYU8';

app.use(express.json());
app.use(express.static('public'));

// ===== API ДЛЯ ОТПРАВКИ ЗАДАЧ =====
app.post('/api/send-task', async (req, res) => {
    const { task, user, chatId } = req.body;
    
    if (!task) {
        return res.status(400).json({ success: false, error: 'Нет текста задачи' });
    }
    
    if (!chatId) {
        return res.status(400).json({ success: false, error: 'У пользователя не указан Telegram ID' });
    }
    
    const message = `📝 *Новая задача от ${user || 'Пользователь'}!*\n\n📌 Задача: ${task}\n\n🧠 #СистемныйКонтроль`;
    
    try {
        const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
        
        if (response.data && response.data.ok) {
            res.json({ success: true, message: 'Задача отправлена в Telegram!' });
        } else {
            res.status(500).json({ success: false, error: 'Ошибка при отправке' });
        }
    } catch (error) {
        console.error('Ошибка Telegram:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== ВЕБСОКЕТ ДЛЯ ЧАТА С СОХРАНЕНИЕМ КОМНАТ =====
// Хранилище комнат (сохраняется в памяти, но не теряется при отключении клиентов)
const rooms = new Map(); // roomCode -> Set of WebSocket connections
const roomMessages = new Map(); // roomCode -> array of messages
const roomInfo = new Map(); // roomCode -> { name: string, createdAt: date }

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
                    const roomName = message.roomName || 'Новая комната';
                    const newRoomCode = generateRoomCode();
                    currentRoom = newRoomCode;
                    
                    if (!rooms.has(currentRoom)) {
                        rooms.set(currentRoom, new Set());
                        roomMessages.set(currentRoom, []);
                        roomInfo.set(currentRoom, { name: roomName, createdAt: new Date() });
                    }
                    rooms.get(currentRoom).add(ws);
                    
                    ws.send(JSON.stringify({ 
                        type: 'room_created', 
                        roomCode: currentRoom,
                        roomName: roomName
                    }));
                    sendHistory(ws, currentRoom);
                    updateParticipantCount(currentRoom);
                    broadcastToRoom(currentRoom, { 
                        type: 'system', 
                        text: `🎉 Комната "${roomName}" создана! Код: ${currentRoom}`
                    });
                    break;
                
                case 'join_room':
                    const roomCode = message.roomCode.toUpperCase();
                    const existingRoom = rooms.get(roomCode);
                    const roomData = roomInfo.get(roomCode);
                    
                    if (existingRoom) {
                        currentRoom = roomCode;
                        existingRoom.add(ws);
                        ws.send(JSON.stringify({ 
                            type: 'room_joined', 
                            roomCode: currentRoom, 
                            success: true,
                            roomName: roomData ? roomData.name : 'Комната'
                        }));
                        sendHistory(ws, currentRoom);
                        broadcastToRoom(currentRoom, { 
                            type: 'system', 
                            text: '👤 Пользователь присоединился к комнате' 
                        }, ws);
                        updateParticipantCount(currentRoom);
                    } else {
                        ws.send(JSON.stringify({ 
                            type: 'room_joined', 
                            success: false, 
                            error: 'Комната не найдена' 
                        }));
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
                        // Храним до 500 сообщений на комнату
                        if (history.length > 500) history.shift();
                        roomMessages.set(currentRoom, history);
                        broadcastToRoom(currentRoom, msgData);
                    }
                    break;
            }
        } catch(e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    });
    
    ws.on('close', () => {
        const roomCode = currentRoom;
        if (roomCode) {
            const clients = rooms.get(roomCode);
            if (clients) {
                clients.delete(ws);
                updateParticipantCount(roomCode);
            }
        }
        console.log('Клиент отключился');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🤖 Telegram бот настроен`);
});