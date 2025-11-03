```markdown
# mini-discord-node — Fork & run in Codespaces or run locally

Quick summary
- Minimal WebSocket + Express server that stores short message history per channel.
- Single-file client at public/index.html (open directly or serve from the server).
- Devcontainer + Dockerfile included for GitHub Codespaces.

Run in GitHub Codespaces (fork & run)
1. Fork this repository to your GitHub account.
2. Open your fork, click "Code" → "Codespaces" → "Create codespace on main".
3. Wait for the codespace to initialize. The devcontainer will run `npm install`. If it doesn't, run it in terminal.
4. In Codespaces, open a terminal and press new terminal and type:
   npm start
5. Open the Ports panel, hit forward a port, set to port 3000, click "Open in Browser" — that'll preview the app.
6. Use the preview origin with wss:// for WebSocket connections (Codespaces handles TLS). In the client UI, paste the wss:// preview URL and click Connect.
7. Admin commands are built in, so just log in with user localadmin. In the codespace console, look in server.js for the password and replace it with your password. People who try to log into the admin account without that pw will be temp ip banned from your server. You dont have to have it though.

To Run locally
- npm install
- npm start
- Visit http://localhost:3000 (if index.html is in public/) or open public/index.html directly and set Server to ws://localhost:3000

Files included
- server.js — Node server with WebSocket and message history
- public/index.html — single-file browser client
- package.json — dependencies & start script
- Dockerfile — for reproducible dev environment
- .devcontainer/devcontainer.json — Codespaces / devcontainer config
- README.md — this file

Notes & next steps
- Might be buggy, I coded some but Github Copilot was what made all the connection server stuff..
```
