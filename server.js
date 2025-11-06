// server.js — WebSocket + Express server with admin-password support, admin panel actions, config persistence, and family-friendly mode
// Usage:
//   export ADMIN_PASSWORD="supersecret"   (set this in Codespaces/Replit/Env)
//   node server.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3000;
const HISTORY_PER_CHANNEL = parseInt(process.env.HISTORY_PER_CHANNEL || '200', 10);

// Admin config (env)
const ADMIN_USERS = new Set(
  (process.env.ADMIN_USERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'REPLACE THIS PASSWORD'; // secret password — DO NOT COMMIT

// Config file (non-secret settings)
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  familyFriendly: false,
  profanity: ["fuck", "shit", "bitch", "asshole"] // simple example list
};

let CONFIG = DEFAULT_CONFIG;
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    CONFIG = JSON.parse(raw);
  } else {
    // create default config.json so Codespaces users can edit
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    CONFIG = DEFAULT_CONFIG;
  }
} catch (e) {
  console.error('Failed to load config.json, using defaults', e);
  CONFIG = DEFAULT_CONFIG;
}

// Simple in-memory stores
const clients = new Map(); // ws => {id, name, channel, isAdmin, mutedUntil, ip}
const channels = new Set(['general']);
const history = new Map(); // channel => [messages]
const bannedNames = new Set(); // name-based bans
const bannedIps = new Set(); // IP-based bans

// Brute-force throttle keyed by remote IP
const failedAuth = new Map(); // ip -> { count, lockedUntil (ms), lastAttempt (ms) }
const LOCK_THRESHOLD = 5;      // attempts before lock
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes lock

function persistConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to write config.json', e);
    return false;
  }
}

function addToHistory(channel, msg) {
  if (!history.has(channel)) history.set(channel, []);
  const arr = history.get(channel);
  arr.push(msg);
  if (arr.length > HISTORY_PER_CHANNEL) arr.splice(0, arr.length - HISTORY_PER_CHANNEL);
}

function sanitizeText(text) {
  if (!CONFIG.familyFriendly || !Array.isArray(CONFIG.profanity) || !text) return text;
  let out = text;
  for (const bad of CONFIG.profanity) {
    if (!bad) continue;
    const re = new RegExp('\\b' + bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'ig');
    out = out.replace(re, (m) => '*'.repeat(m.length));
  }
  return out;
}

// Broadcast helpers
function broadcastJSON(obj, filterFn = () => true) {
  const s = JSON.stringify(obj);
  for (const [ws, meta] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN && filterFn(ws, meta)) {
      try { ws.send(s); } catch (e) { /* ignore */ }
    }
  }
}

// Send user list; include ip field only for admin recipients
function sendUserList() {
  for (const [recipientWs, recipientMeta] of clients.entries()) {
    if (recipientWs.readyState !== WebSocket.OPEN) continue;
    const showIp = !!recipientMeta.isAdmin;
    const list = Array.from(clients.values()).map(c => {
      const base = { id: c.id, name: c.name, channel: c.channel, isAdmin: !!c.isAdmin, mutedUntil: c.mutedUntil || 0 };
      if (showIp) base.ip = c.ip || 'unknown';
      return base;
    });
    try {
      recipientWs.send(JSON.stringify({ type: 'userlist', users: list }));
    } catch (e) {}
  }
}

function sendChannels() {
  broadcastJSON({ type: 'channels', channels: Array.from(channels) });
}

// Simple REST: health and history & config (GET)
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/messages/:channel', (req, res) => {
  const ch = req.params.channel || 'general';
  res.json({ channel: ch, messages: history.get(ch) || [] });
});
app.get('/config', (req, res) => {
  // Return public config (familyFriendly and profanity) — non-secret
  res.json({ config: CONFIG });
});
app.use(express.static('public'));

// Helper to derive IP for a connection
function ipForReq(req, ws) {
  // Try common headers first (if proxied) then socket remoteAddress
  const forwarded = req && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (forwarded) {
    // x-forwarded-for can be comma separated list
    return forwarded.split(',')[0].trim();
  }
  if (req && req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  if (ws && ws._socket && ws._socket.remoteAddress) return ws._socket.remoteAddress;
  return 'unknown';
}

wss.on('connection', (ws, req) => {
  const id = uuidv4();
  const ip = ipForReq(req, ws);
  const meta = { id, name: 'Anonymous', channel: 'general', isAdmin: false, ip };
  clients.set(ws, meta);

  // Check IP bans immediately and close if banned
  if (bannedIps.has(ip)) {
    try { ws.send(JSON.stringify({ type: 'error', message: 'Your IP is banned.' })); } catch(e){}
    ws.close();
    return;
  }

  // let client know it joined and send recent history
  try {
    ws.send(JSON.stringify({
      type: 'joined',
      clientId: id,
      users: Array.from(clients.values()).map(c => ({ id: c.id, name: c.name, channel: c.channel, isAdmin: !!c.isAdmin })),
      channels: Array.from(channels)
    }));
  } catch (e) {}

  // send history for general by default
  const hDefault = history.get('general') || [];
  if (hDefault.length) {
    try { ws.send(JSON.stringify({ type: 'history', channel: 'general', messages: hDefault })); } catch(e){}
  }

  sendUserList();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    const meta = clients.get(ws);
    if (!meta) return;

    const remoteIp = meta.ip || ipForReq(req, ws);
    // cleanup stale lock if past lockedUntil
    const locker = failedAuth.get(remoteIp);
    if (locker && locker.lockedUntil && Date.now() > locker.lockedUntil) {
      failedAuth.delete(remoteIp);
    }

    if (msg.type === 'join') {
      const requestedName = (msg.name || meta.name).toString().substring(0, 50);
      if (bannedNames.has(requestedName) || bannedIps.has(remoteIp)) {
        try { ws.send(JSON.stringify({ type: 'error', message: 'You are banned.' })); } catch(e){}
        ws.close();
        return;
      }

      // check if IP is locked due to auth failures
      const attemptInfo = failedAuth.get(remoteIp);
      if (attemptInfo && attemptInfo.lockedUntil && Date.now() < attemptInfo.lockedUntil) {
        try { ws.send(JSON.stringify({ type: 'error', message: 'Too many failed admin attempts from your IP. Try later.' })); } catch(e){}
        // allow join but no admin rights
      }

      meta.name = requestedName;
      meta.channel = (msg.channel || meta.channel) || 'general';

      // Admin detection via ENV list
      if (ADMIN_USERS.has(meta.name)) meta.isAdmin = true;

      // Admin detection via password (if provided and env set)
      if (!meta.isAdmin && ADMIN_PASSWORD) {
        if (typeof msg.adminPassword === 'string' && msg.adminPassword.length) {
          if (msg.adminPassword === ADMIN_PASSWORD) {
            meta.isAdmin = true;
            if (failedAuth.has(remoteIp)) failedAuth.delete(remoteIp);
          } else {
            const prev = failedAuth.get(remoteIp) || { count: 0, lastAttempt: 0 };
            prev.count = (prev.count || 0) + 1;
            prev.lastAttempt = Date.now();
            if (prev.count >= LOCK_THRESHOLD) {
              prev.lockedUntil = Date.now() + LOCK_DURATION_MS;
            }
            failedAuth.set(remoteIp, prev);
            try { ws.send(JSON.stringify({ type: 'error', message: 'Admin password incorrect.' })); } catch(e){}
          }
        }
      }

      channels.add(meta.channel);
      // send history for the newly joined channel
      const h = history.get(meta.channel) || [];
      if (h.length) {
        try { ws.send(JSON.stringify({ type: 'history', channel: meta.channel, messages: h })); } catch(e){}
      }

      broadcastJSON({ type: 'message', id: uuidv4(), from: 'system', text: `${meta.name} joined ${meta.channel}`, channel: meta.channel, time: Date.now() });
      sendChannels();
      sendUserList();
    } else if (msg.type === 'create_channel') {
      if (msg.channel) {
        channels.add(msg.channel);
        sendChannels();
      }
    } else if (msg.type === 'message') {
      if (meta.mutedUntil && meta.mutedUntil > Date.now()) {
        try { ws.send(JSON.stringify({ type: 'error', message: 'You are muted.' })); } catch(e){}
        return;
      }
      let text = (msg.text || '').toString().substring(0, 2000);
      const channel = msg.channel || meta.channel || 'general';
      // apply family-friendly sanitize if enabled
      text = sanitizeText(text);
      const payload = { type: 'message', id: uuidv4(), from: meta.name, text, channel, time: Date.now() };
      addToHistory(channel, payload);
      broadcastJSON(payload);
    } else if (msg.type === 'typing') {
      broadcastJSON({ type: 'typing', from: meta.name, channel: meta.channel }, (ws2, m2) => m2.channel === meta.channel);
    } else if (msg.type === 'admin') {
      // Admin-only actions: verify admin flag
      if (!meta.isAdmin) {
        try { ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: admin only' })); } catch(e){}
        return;
      }
      const action = msg.action;
      if (action === 'kick') {
        const targetId = msg.targetId;
        let found = false;
        for (const [ws2, m2] of clients.entries()) {
          if (m2.id === targetId) {
            found = true;
            try { ws2.send(JSON.stringify({ type: 'message', id: uuidv4(), from: 'system', text: `You were kicked by ${meta.name}`, time: Date.now() })); } catch(e){}
            try { ws2.close(); } catch(e){}
            break;
          }
        }
        try { ws.send(JSON.stringify({ type: 'admin_action_result', action, ok: found })); } catch(e){}
      } else if (action === 'ban') {
        const targetName = msg.targetName;
        if (!targetName) { try { ws.send(JSON.stringify({ type: 'error', message: 'ban needs targetName' })); } catch(e){}; return; }
        bannedNames.add(targetName);
        // kick anyone with that name now
        for (const [ws2, m2] of clients.entries()) {
          if (m2.name === targetName) {
            try { ws2.close(); } catch(e){}
          }
        }
        try { ws.send(JSON.stringify({ type: 'admin_action_result', action, ok: true })); } catch(e){}
        broadcastJSON({ type: 'message', id: uuidv4(), from: 'system', text: `${targetName} was banned by ${meta.name}`, time: Date.now() });
      } else if (action === 'ip_ban') {
        const targetIp = msg.ip;
        if (!targetIp) { try { ws.send(JSON.stringify({ type: 'error', message: 'ip_ban needs ip' })); } catch(e){}; return; }
        bannedIps.add(targetIp);
        // disconnect any clients with that IP
        for (const [ws2, m2] of clients.entries()) {
          if (m2.ip === targetIp) {
            try { ws2.close(); } catch(e){}
          }
        }
        try { ws.send(JSON.stringify({ type: 'admin_action_result', action, ok: true })); } catch(e){}
        broadcastJSON({ type: 'message', id: uuidv4(), from: 'system', text: `IP ${targetIp} was banned by ${meta.name}`, time: Date.now() });
      } else if (action === 'disconnect') {
        const targetId = msg.targetId;
        let ok = false;
        for (const [ws2, m2] of clients.entries()) {
          if (m2.id === targetId) {
            ok = true;
            try { ws2.close(); } catch(e){}
            break;
          }
        }
        try { ws.send(JSON.stringify({ type: 'admin_action_result', action, ok })); } catch(e){}
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
        try { ws.send(JSON.stringify({ type: 'admin_action_result', action, ok })); } catch(e){}
        sendUserList();
      } else if (action === 'delete_messages') {
        // delete multiple message ids
        const messageIds = Array.isArray(msg.messageIds) ? msg.messageIds : [];
        let deleted = 0;
        for (const messageId of messageIds) {
          for (const [ch, arr] of history.entries()) {
            const idx = arr.findIndex(m => m.id === messageId);
            if (idx !== -1) {
              arr.splice(idx, 1);
              deleted++;
              broadcastJSON({ type: 'delete_message', messageId, channel: ch });
              break;
            }
          }
        }
        try { ws.send(JSON.stringify({ type: 'admin_action_result', action: 'delete_messages', ok: true, deleted })); } catch(e){}
      } else if (action === 'impersonate') {
        const asName = (msg.asName || '').toString().substring(0, 50);
        let text = (msg.text || '').toString().substring(0, 2000);
        const channel = msg.channel || meta.channel || 'general';
        if (!asName || !text) { try { ws.send(JSON.stringify({ type: 'error', message: 'impersonate needs asName and text' })); } catch(e){}; return; }
        // apply family-friendly filter
        text = sanitizeText(text);
        const payload = { type: 'message', id: uuidv4(), from: asName, text, channel, time: Date.now(), viaAdmin: true };
        addToHistory(channel, payload);
        broadcastJSON(payload);
        try { ws.send(JSON.stringify({ type: 'admin_action_result', action: 'impersonate', ok: true })); } catch(e){}
      } else if (action === 'set_config') {
        // msg.config contains keys to update
        const newCfg = msg.config || {};
        // only allow known keys
        if (typeof newCfg.familyFriendly === 'boolean') CONFIG.familyFriendly = newCfg.familyFriendly;
        if (Array.isArray(newCfg.profanity)) CONFIG.profanity = newCfg.profanity.map(s => s.toString());
        const ok = persistConfig();
        try { ws.send(JSON.stringify({ type: 'admin_action_result', action: 'set_config', ok })); } catch(e){}
        // inform all clients of new config (public view)
        broadcastJSON({ type: 'config_updated', config: { familyFriendly: CONFIG.familyFriendly } });
      } else {
        try { ws.send(JSON.stringify({ type: 'error', message: 'unknown admin action' })); } catch(e){}
      }
      // after any admin action, refresh userlist/channels as necessary
      sendUserList();
      sendChannels();
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    clients.delete(ws);
    if (info) {
      broadcastJSON({ type: 'message', id: uuidv4(), from: 'system', text: `${info.name} left.`, time: Date.now() });
      sendUserList();
    }
  });
});

// upgrade http to ws (capture req for IP)
server.on('upgrade', (req, socket, head) => {
  // Accept all origins here — in production check req.headers.origin
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Admin users (env):', Array.from(ADMIN_USERS).join(',') || '(none)');
  if (ADMIN_PASSWORD) console.log('Admin password is set (secret)');
  console.log('Config loaded from', CONFIG_PATH);
});
