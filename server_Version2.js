// Minimal Node WebSocket + Express server with simple message history and REST endpoint
// Usage: node server.js
// Designed for Codespaces / Replit / local dev
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3000;
const HISTORY_PER_CHANNEL = parseInt(process.env.HISTORY_PER_CHANNEL || '200', 10);

// In-memory store (not persistent)
const clients = new Map(); // ws => {id, name, channel}
const channels = new Set(['general']);
const history = new Map(); // channel => array of message objects

function addToHistory(channel, msg) {
  if (!history.has(channel)) history.set(channel, []);
  const arr = history.get(channel);
  arr.push(msg);
  if (arr.length > HISTORY_PER_CHANNEL) arr.splice(0, arr.length - HISTORY_PER_CHANNEL);
}

function broadcastJSON(obj, filterFn = () => true) {
  const s = JSON.stringify(obj);
  for (const [ws, meta] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN && filterFn(ws, meta)) {
      ws.send(s);
    }
  }
}

function sendUserList() {
  const list = Array.from(clients.values()).map(c => ({
    id: c.id, name: c.name, channel: c.channel
  }));
  broadcastJSON({type:'userlist', users:list});
}

function sendChannels() {
  broadcastJSON({type:'channels', channels:Array.from(channels)});
}

// Simple REST: health and history
app.get('/health', (req, res) => res.json({ok:true, uptime: process.uptime()}));
app.get('/messages/:channel', (req, res) => {
  const ch = req.params.channel || 'general';
  res.json({channel: ch, messages: history.get(ch) || []});
});

// Serve static files if provided (public/index.html)
app.use(express.static('public'));

wss.on('connection', (ws) => {
  const id = uuidv4();
  clients.set(ws, { id, name: 'Anonymous', channel: 'general' });

  // let client know it joined and send recent history
  ws.send(JSON.stringify({
    type: 'joined',
    clientId: id,
    users: Array.from(clients.values()).map(c => ({id:c.id, name:c.name, channel:c.channel})),
    channels: Array.from(channels)
  }));

  // send history for general by default
  const h = history.get('general') || [];
  if (h.length) {
    ws.send(JSON.stringify({type:'history', channel:'general', messages: h}));
  }

  sendUserList();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    const meta = clients.get(ws);
    if (!meta) return;

    if (msg.type === 'join') {
      meta.name = (msg.name||meta.name).toString().substring(0,50);
      meta.channel = (msg.channel||meta.channel) || 'general';
      channels.add(meta.channel);
      sendUserList();
      sendChannels();
      // send history for the newly joined channel
      const h = history.get(meta.channel) || [];
      if (h.length) {
        ws.send(JSON.stringify({type:'history', channel:meta.channel, messages: h}));
      }
      broadcastJSON({type:'message', id: uuidv4(), from: 'system', text: `${meta.name} joined ${meta.channel}`, channel: meta.channel, time: Date.now()});
    } else if (msg.type === 'create_channel') {
      if (msg.channel) {
        channels.add(msg.channel);
        sendChannels();
      }
    } else if (msg.type === 'message') {
      const text = (msg.text || '').toString().substring(0,2000);
      const channel = msg.channel || meta.channel || 'general';
      const payload = { type:'message', id: uuidv4(), from: meta.name, text, channel, time: Date.now() };
      // Save to history
      addToHistory(channel, payload);
      // Broadcast to all (clients can filter by channel); change filter if you want same-channel only
      broadcastJSON(payload);
    } else if (msg.type === 'typing') {
      // optional typing indicator forward (limit to same channel)
      broadcastJSON({type:'typing', from: meta.name, channel: meta.channel}, (ws2, m2) => m2.channel === meta.channel);
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    clients.delete(ws);
    if (info) {
      broadcastJSON({type:'message', id: uuidv4(), from: 'system', text: `${info.name} left.`, time: Date.now()});
      sendUserList();
    }
  });
});

// upgrade http to ws
server.on('upgrade', (req, socket, head) => {
  // Accept all origins here — in production check req.headers.origin
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});