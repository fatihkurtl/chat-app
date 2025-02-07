import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import initializeDB from './database';
import { dbHelpers } from './database';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const upload = multer({
  storage: multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => {
      cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
    }
  })
});

const dbPromise = initializeDB();

interface User {
  id: string;
  username: string;
  ws: WebSocket;
  isAdmin?: boolean;
  pending?: boolean;
  sessionId?: string;
}

const users = new Map<string, User>();
let adminExists = false;

app.post('/upload', upload.single('file'), async (req: any, res: any) => {
  if (!req.file) return res.status(400).send('Dosya yüklenemedi');
  res.json({ 
    url: `/uploads/${req.file.filename}`,
    type: req.file.mimetype.split('/')[0] 
  });
});

wss.on('connection', async (ws: WebSocket) => {
  const db = await dbPromise;
  const userId = uuidv4();

  const defaultRoom = await dbHelpers.getDefaultRoom(db);
  const history = await db.all(
    'SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT 50',
    [defaultRoom.id]
  );

  ws.send(JSON.stringify({ 
    type: 'history', 
    messages: history.reverse(),
    roomId: defaultRoom.id
  }));

  ws.on('message', async (message: string) => {
    const data = JSON.parse(message);
    
    if (data.type === 'auth') {
      const existingUser = Array.from(users.values()).find(u => u.sessionId === data.sessionId);
      if (existingUser) {
        if (existingUser.ws.readyState === WebSocket.OPEN) {
          existingUser.ws.close();
        }
        existingUser.ws = ws;
        users.set(userId, existingUser);
        
        ws.send(JSON.stringify({
          type: 'authResponse',
          success: true,
          isAdmin: existingUser.isAdmin
        }));
        sendUserList();
        return;
      }
    }
    
    if (data.type === 'joinRequest') {
      const sessionId = uuidv4();
      if (!adminExists) {
        adminExists = true;
        const user = { 
          id: userId, 
          username: data.username, 
          ws, 
          isAdmin: true, 
          pending: false,
          sessionId
        };
        users.set(userId, user);
        
        ws.send(JSON.stringify({
          type: 'joinResponse',
          approved: true,
          sessionId
        }));
        
        ws.send(JSON.stringify({
          type: 'adminStatus',
          isAdmin: true
        }));

        broadcastSystemMessage(`${data.username} (Admin) sohbete katıldı`);
        sendUserList();
      } else {
        const user = { 
          id: userId, 
          username: data.username, 
          ws, 
          isAdmin: false, 
          pending: true,
          sessionId
        };
        users.set(userId, user);
        sendUserList();
        broadcastToAdmins({
          type: 'system',
          text: `${data.username} katılmak için onay bekliyor`,
          timestamp: new Date().toISOString()
        });
      }
    }
    else if (data.type === 'adminAction') {
      const user = Array.from(users.values()).find(u => u.username === data.username);
      if (user) {
        if (data.action === 'approve') {
          user.pending = false;
          user.ws.send(JSON.stringify({
            type: 'joinResponse',
            approved: true
          }));
          broadcastSystemMessage(`${user.username} sohbete katıldı`);
        } else {
          user.ws.send(JSON.stringify({
            type: 'joinResponse',
            approved: false
          }));
          users.delete(user.id);
        }
        sendUserList();
      }
    }
    else if (data.type === 'message') {
      const user = users.get(userId);
      if (user && !user.pending) {
        const messageData = {
          room_id: data.roomId || defaultRoom.id,
          username: data.username,
          content: data.content,
          file_url: data.file?.url,
          file_type: data.file?.type,
          timestamp: new Date().toISOString()
        };

        await db.run(
          'INSERT INTO messages (room_id, username, content, file_url, file_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [messageData.room_id, messageData.username, messageData.content, messageData.file_url, messageData.file_type, messageData.timestamp]
        );

        broadcastMessage(messageData);
      }
    }
  });

  ws.on('close', () => {
    const user = users.get(userId);
    if (user) {
      if (!user.pending) {
        broadcastSystemMessage(`${user.username} sohbetten ayrıldı`);
      }
      if (user.isAdmin) {
        adminExists = false;
      }
      users.delete(userId);
      sendUserList();
    }
  });
});

function broadcastSystemMessage(text: string) {
  broadcast({ type: 'system', text, timestamp: new Date().toISOString() });
}

function broadcastMessage(data: any) {
  broadcast({ type: 'message', ...data });
}

function broadcast(data: any) {
  const message = JSON.stringify(data);
  users.forEach(user => {
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(message);
    }
  });
}

function broadcastToAdmins(data: any) {
  const message = JSON.stringify(data);
  users.forEach(user => {
    if (user.isAdmin && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(message);
    }
  });
}

function sendUserList() {
  const userList = Array.from(users.values()).map(u => ({
    username: u.username,
    pending: u.pending,
    isAdmin: u.isAdmin
  }));
  broadcast({ type: 'userList', users: userList });
}

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

