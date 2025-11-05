```markdown
# mini-discord-node — Setup & Deployment (public-friendly)

This repository is a small demo "Discord-like" WebSocket server + single-file client intended for self-hosted demos, Codespaces or Replit. It includes:

- server.js — Node/Express + ws WebSocket server with admin features, family-friendly filtering, config persistence.
- public/index.html — Single-file browser client.
- config.example.json — Example non-secret server config.
- .devcontainer / Dockerfile — helpful for GitHub Codespaces or local Docker.
- package.json — deps and start scripts.

Important: this project is meant for demos. Do NOT commit secrets (ADMIN_PASSWORD or other private keys) to a public repo. The instructions below show how to run this publicly but safely using environment variables or IDE secrets.

Quick overview of admin behavior
- To be granted admin rights on join you must either:
  - Have a username listed in the ADMIN_USERS env var (insecure; any user can pick that name), or
  - Provide the admin password (ADMIN_PASSWORD) when joining (preferred). If you pick the special username "localadmin", the client will prompt for the admin password.
- Admins get an Admin Panel with controls: delete messages, kick/ban by name, IP ban, disconnect, impersonate (send msgs as another user), and toggle/save family-friendly config.

1) Prepare the repo (fork / clone)
- Public repo workflow:
  - Fork or create a public repo and push these files.
  - Ensure .gitignore contains at least: node_modules, .env, config.json (so you don't accidentally commit secrets / local config).
- Local clone:
  git clone <your-repo-url>
  cd <repo>

2) Create config.json (non-secret settings)
- A config file stores non-secret server settings like familyFriendly and profanity list.
- Create config.json from the example:
  cp config.example.json config.json
- Edit config.json as desired. This file is safe to commit if it does not contain secrets, but consider adding it to .gitignore if you prefer per-instance settings.

3) Set the admin password (secret) — do NOT commit this
- The server checks ADMIN_PASSWORD from environment variables.
- Choose a strong ADMIN_PASSWORD and keep it secret. Do NOT put it into config.json or commit it.

How to set ADMIN_PASSWORD depending on environment:

- GitHub Codespaces (quick method)
  - Option A — temporary in terminal:
    - Open the Codespace for the repo.
    - In the Codespaces terminal run:
      export ADMIN_PASSWORD="your-super-secret"
      npm install
      npm start
    - The Codespace terminal process will have that env var for the session.
  - Option B — repository secrets (recommended for repeated use):
    - Add the secret in your org/repo Codespaces secrets (see GitHub docs → Repository > Settings > Secrets / Codespaces).
    - Or use the Codespaces UI to add environment variables in the devcontainer config.

- Replit
  - Open the Repl running this code.
  - In the Repl sidebar choose "Secrets" (Environment variables) and add:
    - Key: ADMIN_PASSWORD
    - Value: your-super-secret
  - Start the Repl (Replit will inject the env var at runtime).

- Local (development)
  - On macOS / Linux:
    export ADMIN_PASSWORD="your-super-secret"
    npm install
    npm start
  - On Windows PowerShell:
    $env:ADMIN_PASSWORD="your-super-secret"
    npm install
    npm start

4) Optional: ADMIN_USERS (insecure)
- If you want certain names to always be admin (NOT recommended for public servers), set:
  export ADMIN_USERS="localadmin,alice"
- Any connecting client that sets their name to one of those will be granted admin rights automatically.

5) Run server locally (or in Codespaces / Replit)
- Install deps:
  npm install
- Start:
  npm start
- The server listens on PORT (default 3000) — in Codespaces/Replit this will be picked up and forwarded.

6) Client usage & WebSocket URL
- Open the client at `public/index.html` (open as a file in your browser) OR have the server serve it (if public/index.html is in `public/`, visit the server root).
- In the client UI, set "Server" to the WebSocket endpoint:
  - If running locally: ws://localhost:3000
  - If running in Codespaces preview or Replit (HTTPS), use wss://<preview-host>  (secure websockets)
- Pick a name and click Connect.
- If you select the name `localadmin`, the client will prompt you for the admin password (if you did not already enter it in the Admin Password field). Enter the ADMIN_PASSWORD you set earlier.
- After successful admin auth you'll see an "Admin Panel" button on the right.

7) Admin Panel features
- Opens a modal with:
  - Message history (for the current channel) — select messages and "Delete selected".
  - Users list with options: Kick, Ban (name), IP Ban.
  - Impersonate: send a message as another username (admin-only).
  - Config: toggle Family Friendly mode and edit profanity list (saved to config.json).
- Actions are enforced server-side; admin operations are subject to server checks.

8) Family-friendly mode
- When enabled via the Admin Panel (or by editing config.json), server applies a simple profanity filter (word-based) to messages before saving/broadcasting.
- Edit `config.json` → `profanity` array to customize words to filter.

9) IPs & privacy
- IP addresses are exposed in the user list only to admin recipients (so admins can IP-ban). Non-admins do NOT receive IPs.
- IP bans are enforced on connection and will disconnect matching clients.

10) Security notes (read this)
- Do NOT commit ADMIN_PASSWORD or any secret to the repo.
- The ADMIN_PASSWORD in this project is compared directly (plain-text). For production, use hashed passwords (bcrypt) and proper auth (OAuth/JWT).
- Admin impersonation, IP bans, and deletes are powerful: only grant ADMIN_PASSWORD to people you trust.
- The brute-force protection in the server is simple (IP-based temporary locks) and is not production-grade.
- For long-term public hosting consider a dedicated host (VPS/Render/Railway) and persistent storage (Postgres/SQLite) for roles and messages.

11) Running in Docker (optional)
- Build:
  docker build -t mini-discord-node .
- Run (example):
  docker run -e ADMIN_PASSWORD="your-secret" -p 3000:3000 mini-discord-node

12) Tips for publishing a public demo safely
- If posting this repository publicly:
  - Do NOT include ADMIN_PASSWORD or any secret in the repository.
  - Consider removing ADMIN_USERS or leaving it blank.
  - Keep config.json in `.gitignore` or sanitize it before push.
  - Use Codespaces / Replit secret management to distribute admin access to trusted people only.

13) Troubleshooting
- WebSocket connect errors:
  - Browser pages served over HTTPS require wss:// endpoints. Do not mix ws:// on an https page.
  - If Codespaces preview gives an HTTPS URL, use that with wss://.
- No Admin Panel shown after entering password:
  - Verify ADMIN_PASSWORD in your server's environment matches what you entered in the client.
  - Check server logs for "Admin password is set" or authentication errors.
- Messages not appearing:
  - Check server logs for errors; ensure PORT is reachable and the client uses the correct wss/ws URL.

14) Where to edit defaults
- config.example.json — copy to config.json and edit:
  - familyFriendly (boolean)
  - profanity (array of words)
- .devcontainer / Dockerfile — helpful to open in Codespaces or run in containerized dev.

15) If you want more secure admin setup
- I can add a simple CLI to store a bcrypt-hashed admin password and change the server to validate the hashed password instead of plain-text env values — this avoids putting raw passwords into environment variables. Tell me if you want that.

Thanks — this README is intentionally explicit and avoids committing secrets. If you'd like, I can:
- Produce a short checklist to paste in the repo's web description when you publish it publicly.
- Add a small script to generate config.json and to initialize a bcrypt admin hash.
```
