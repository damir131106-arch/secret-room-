const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ===== НАСТРОЙКИ TELEGRAM (ВАШИ ДАННЫЕ) =====
const TELEGRAM_BOT_TOKEN = '8418856066:AAHSBBdKcrmMAn1-lLBhZB9D5MlMiEiZYU8';
const TELEGRAM_CHAT_ID = '5137760110';
// ============================================

// Middleware для обработки JSON
app.use(express.json());
app.use(express.static('public'));

// ===== API ДЛЯ ОТПРАВКИ ЗАДАЧ В TELEGRAM =====
app.post('/api/send-task', async (req, res) => {
    const { task, user } = req.body;
    
    if (!task) {
        return res.status(400).json({ success: false, error: 'Нет текста задачи' });
    }
    
    const message = `📝 *Новая задача от пользователя ${user || 'Гость'}!*\n\n📌 Задача: ${task}\n\n🧠 Помни: маленькие шаги ведут к большим победам! #СистемныйКонтроль`;
    
    try {
        const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await axios.post(telegramUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        
        if (response.data && response.data.ok) {
            res.json({ success: true, message: 'Задача отправлена в Telegram!' });
        } else {
            res.status(500).json({ success: false, error: 'Ошибка при отправке в Telegram' });
        }
    } catch (error) {
        console.error('Ошибка отправки в Telegram:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== ВЕБСОКЕТ ДЛЯ ЧАТА =====
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
            console.error('Ошибка обработки сообщения:', e);
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

// ===== ЗАПУСК СЕРВЕРА =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Telegram бот настроен, chat_id: ${TELEGRAM_CHAT_ID}`);
});