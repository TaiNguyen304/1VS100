const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ==========================================
// ĐỊNH TUYẾN (ROUTING) AN TOÀN
// Trả về file HTML trực tiếp từ thư mục gốc
// ==========================================

app.get('/', (req, res) => {
    res.send('Hệ thống AceStudio Quiz đang chạy! Vui lòng truy cập /Controller.html hoặc /Contestant.html');
});

app.get('/Contestant.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'Contestant.html'));
});

app.get('/Controller.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'Controller.html'));
});

// ==========================================
// TRẠNG THÁI CÁC PHÒNG
// ==========================================
const rooms = {};

io.on('connection', (socket) => {
    
    // --- LOGIC CHO CONTROLLER (HOST) ---
    socket.on('controller_join', (roomId, callback) => {
        socket.join(`controller_${roomId}`);
        
        if (!rooms[roomId]) {
            rooms[roomId] = {
                roomCode: roomId,
                loginStatus: 'open',
                answerStatus: 'closed',
                correctAnswer: null,
                users: {},
                banned: {}
            };
        }
        callback({ success: true, roomState: rooms[roomId] });
        io.to(`controller_${roomId}`).emit('room_state_update', rooms[roomId]);
    });

    socket.on('update_room_state', ({ roomId, key, value }) => {
        if (rooms[roomId]) {
            rooms[roomId][key] = value;
            io.to(`controller_${roomId}`).emit('room_state_update', rooms[roomId]);
            io.to(roomId).emit('state_changed', { key, value });
        }
    });

    socket.on('clear_answers', (roomId) => {
        if (rooms[roomId]) {
            for (let user in rooms[roomId].users) {
                rooms[roomId].users[user].answer = "";
                rooms[roomId].users[user].time = "";
            }
            io.to(`controller_${roomId}`).emit('room_state_update', rooms[roomId]);
        }
    });

    socket.on('kick_user', ({ roomId, username }) => {
        if (rooms[roomId] && rooms[roomId].users[username]) {
            const userSocketId = rooms[roomId].users[username].socketId;
            delete rooms[roomId].users[username];
            io.to(userSocketId).emit('kicked');
            io.to(`controller_${roomId}`).emit('room_state_update', rooms[roomId]);
        }
    });

    socket.on('ban_user', ({ roomId, username }) => {
        if (rooms[roomId]) {
            rooms[roomId].banned[username] = Date.now();
            if (rooms[roomId].users[username]) {
                const userSocketId = rooms[roomId].users[username].socketId;
                delete rooms[roomId].users[username];
                io.to(userSocketId).emit('banned');
            }
            io.to(`controller_${roomId}`).emit('room_state_update', rooms[roomId]);
        }
    });

    socket.on('unban_user', ({ roomId, username }) => {
        if (rooms[roomId] && rooms[roomId].banned[username]) {
            delete rooms[roomId].banned[username];
            io.to(`controller_${roomId}`).emit('room_state_update', rooms[roomId]);
        }
    });

    // --- LOGIC CHO CONTESTANT ---
    socket.on('contestant_login', ({ username, roomCode }, callback) => {
        const room = rooms[roomCode];
        if (!room) {
            return callback({ success: false, message: 'Mã phòng không tồn tại!' });
        }
        if (room.banned[username]) {
            return callback({ success: false, message: 'Bạn đã bị BAN khỏi phòng này!' });
        }
        if (room.loginStatus !== 'open') {
            return callback({ success: false, message: 'Phòng đã đóng đăng nhập!' });
        }

        socket.join(roomCode);
        room.users[username] = {
            name: username,
            answer: '',
            time: '',
            socketId: socket.id
        };

        callback({ 
            success: true, 
            answerStatus: room.answerStatus,
            correctAnswer: room.correctAnswer
        });

        io.to(`controller_${roomCode}`).emit('room_state_update', room);
        socket.contestantData = { username, roomCode };
    });

    socket.on('submit_answer', ({ answer, time }) => {
        if (socket.contestantData) {
            const { username, roomCode } = socket.contestantData;
            if (rooms[roomCode] && rooms[roomCode].users[username]) {
                rooms[roomCode].users[username].answer = answer;
                rooms[roomCode].users[username].time = time;
                io.to(`controller_${roomCode}`).emit('room_state_update', rooms[roomCode]);
            }
        }
    });

    socket.on('contestant_logout', () => {
        handleDisconnect(socket);
    });

    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });

    function handleDisconnect(sock) {
        if (sock.contestantData) {
            const { username, roomCode } = sock.contestantData;
            if (rooms[roomCode] && rooms[roomCode].users[username]) {
                delete rooms[roomCode].users[username];
                io.to(`controller_${roomCode}`).emit('room_state_update', rooms[roomCode]);
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});