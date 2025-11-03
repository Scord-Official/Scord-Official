// server.js — WebSocket + Express server with admin-password support and simple lockout
// Usage:
//   export ADMIN_PASSWORD="supersecret"   (set this in Codespaces/Replit/Env)
//   node server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3000;
const HISTORY_PER_CHANNEL = parseInt(process.env.HISTORY_PER_CHANNEL || '200', 10);

// Admin config
const ADMIN_USERS = new Set(
  (process.env.ADMIN_USERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''; // secret password — DO NOT COMMIT

// Simple in-memory stores
const clients = new Map(); // ws => {id, name, channel, isAdmin, mutedUntil}
const channels = new Set(['general']);
const history = new Map(); // channel => [messages]
const bannedNames = new Set(); // simple ban list

// Brute-force throttle keyed by remote IP
const failedAuth = new Map(); // ip -> { count, lockedUntil (ms), lastAttempt (ms) }
const LOCK_THRESHOLD = 5;      // attempts before lock
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes lock

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
    id: c.id, name: c.name, channel: c.channel, isAdmin: !!c.isAdmin, mutedUntil: c.mutedUntil || 0
  }));
  broadcastJSON({type:'userlist', users:list});
}

function sendChannels() {
  broadcastJSON({type:'channels', channels:Array.from(channels)});
}

function ipForSocket(ws, req) {
  // prefer the upgrade req if provided; fallback to ws._socket
  const ip = (req && req.socket && req.socket.remoteAddress) ||
             (ws && ws._socket && ws._socket.remoteAddress) ||
             'unknown';
  return ip;
}

// Simple REST: health and history
app.get('/health', (req, res) => res.json({ok:true, uptime: process.uptime()}));
app.get('/messages/:channel', (req, res) => {
  const ch = req.params.channel || 'general';
  res.json({channel: ch, messages: history.get(ch) || []});
});
app.use(express.static('public'));

// Use (ws, req) so we can get IP for throttling
wss.on('connection', (ws, req) => {
  const id = uuidv4();
  clients.set(ws, { id, name: 'Anonymous', channel: 'general', isAdmin: false });

  // let client know it joined and send recent history
  ws.send(JSON.stringify({
    type: 'joined',
    clientId: id,
    users: Array.from(clients.values()).map(c => ({id:c.id, name:c.name, channel:c.channel, isAdmin: !!c.isAdmin})),
    channels: Array.from(channels)
  }));

  // send history for general by default
  const hDefault = history.get('general') || [];
  if (hDefault.length) {
    ws.send(JSON.stringify({type:'history', channel:'general', messages: hDefault}));
  }

  sendUserList();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    const meta = clients.get(ws);
    if (!meta) return;

    const remoteIp = ipForSocket(ws, req);
    // cleanup stale lock if past lockedUntil
    const info = failedAuth.get(remoteIp);
    if (info && info.lockedUntil && Date.now() > info.lockedUntil) {
      failedAuth.delete(remoteIp);
    }

    if (msg.type === 'join') {
      // simple sanitization
      const requestedName = (msg.name || meta.name).toString().substring(0,50);
      // check ban
      if (bannedNames.has(requestedName)) {
        ws.send(JSON.stringify({type:'error', message: 'You are banned.'}));
        ws.close();
        return;
      }

      // check if IP is locked due to auth failures
      const attemptInfo = failedAuth.get(remoteIp);
      if (attemptInfo && attemptInfo.lockedUntil && Date.now() < attemptInfo.lockedUntil) {
        ws.send(JSON.stringify({type:'error', message: 'Too many failed admin attempts from your IP. Try later.'}));
        // continue but do not grant admin
      }

      meta.name = requestedName;
      meta.channel = (msg.channel||meta.channel) || 'general';

      // Admin detection via ENV list
      if (ADMIN_USERS.has(meta.name)) meta.isAdmin = true;

      // Admin detection via password (if provided and env set)
      if (!meta.isAdmin && ADMIN_PASSWORD) {
        if (msg.adminPassword && typeof msg.adminPassword === 'string') {
          // match without logging actual password
          if (msg.adminPassword === ADMIN_PASSWORD) {
            meta.isAdmin = true;
            // reset failed attempts for IP on success
            if (failedAuth.has(remoteIp)) failedAuth.delete(remoteIp);
          } else {
            // record failed attempt for this IP
            const prev = failedAuth.get(remoteIp) || {count:0, lastAttempt:0};
            prev.count = (prev.count || 0) + 1;
            prev.lastAttempt = Date.now();
            if (prev.count >= LOCK_THRESHOLD) {
              prev.lockedUntil = Date.now() + LOCK_DURATION_MS;
            }
            failedAuth.set(remoteIp, prev);
            // don't reveal details but send generic error
            ws.send(JSON.stringify({type:'error', message: 'Admin password incorrect.'}));
          }
        }
      }

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
      // check muted
      if (meta.mutedUntil && meta.mutedUntil > Date.now()) {
        ws.send(JSON.stringify({type:'error', message: 'You are muted.'}));
        return;
      }
      const text = (msg.text || '').toString().substring(0,2000);
      const channel = msg.channel || meta.channel || 'general';
      const payload = { type:'message', id: uuidv4(), from: meta.name, text, channel, time: Date.now() };
      addToHistory(channel, payload);
      broadcastJSON(payload);
    } else if (msg.type === 'typing') {
      broadcastJSON({type:'typing', from: meta.name, channel: meta.channel}, (ws2, m2) => m2.channel === meta.channel);
    } else if (msg.type === 'admin') {
      // Admin-only actions: verify admin flag set
      if (!meta.isAdmin) {
        ws.send(JSON.stringify({type:'error', message:'Unauthorized: admin only'}));
        return;
      }
      const action = msg.action;
      if (action === 'kick') {
        const targetId = msg.targetId;
        let found = false;
        for (const [ws2, m2] of clients.entries()) {
          if (m2.id === targetId) {
            found = true;
            try { ws2.send(JSON.stringify({type:'message', id: uuidv4(), from: 'system', text: `You were kicked by ${meta.name}`, time: Date.now()})); } catch(e){}
            try { ws2.close(); } catch(e){}
            break;
          }
        }
        ws.send(JSON.stringify({type:'admin_action_result', action, ok: found}));
      } else if (action === 'ban') {
        const targetName = msg.targetName;
        if (!targetName) { ws.send(JSON.stringify({type:'error', message:'ban needs targetName'})); return; }
        bannedNames.add(targetName);
        // kick anyone with that name now
        for (const [ws2, m2] of clients.entries()) {
          if (m2.name === targetName) {
            try { ws2.close(); } catch(e){}
          }
        }
        ws.send(JSON.stringify({type:'admin_action_result', action, ok: true}));
        broadcastJSON({type:'message', id: uuidv4(), from: 'system', text: `${targetName} was banned by ${meta.name}`, time: Date.now()});
      } else if (action === 'mute') {
        const targetId = msg.targetId;
        const duration = parseInt(msg.duration || '0', 10); // seconds
        let ok = false;
        for (const m2 of clients.values()) {
          if (m2.id === targetId) {
            ok = true;
            m2.mutedUntil = Date.now() + Math.max(0, duration) * 1000;
            break;
          }
        }
        ws.send(JSON.stringify({type:'admin_action_result', action, ok}));
        sendUserList();
      } else if (action === 'delete_message') {
        const messageId = msg.messageId;
        if (!messageId) { ws.send(JSON.stringify({type:'error', message:'delete_message needs messageId'})); return; }
        for (const [ch, arr] of history.entries()) {
          const idx = arr.findIndex(m => m.id === messageId);
          if (idx !== -1) {
            arr.splice(idx, 1);
            broadcastJSON({type:'delete_message', messageId, channel: ch});
            break;
          }
        }
        ws.send(JSON.stringify({type:'admin_action_result', action, ok: true}));
      } else {
        ws.send(JSON.stringify({type:'error', message:'unknown admin action'}));
      }
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
  console.log('Admin users:', Array.from(ADMIN_USERS).join(',') || '(none)');
  if (ADMIN_PASSWORD) console.log('Admin password is set (secret)');
});