```markdown
# mini-discord-node — Admin password, admin panel, family-friendly config

What's new
- localadmin requires an admin password (popup) when chosen as a name.
- Admin Panel (admins only) available from the right-side UI:
  - View messages in the current channel, select messages and delete them.
  - Kick, Ban (by name), IP Ban, Disconnect users.
  - Impersonate: send messages as another user (via admin).
  - Toggle Family Friendly mode and edit profanity list (saved to config.json).
- Server persists non-secret config to config.json (you can edit it in Codespaces).
- ADMIN_PASSWORD remains the secret — set it in your Codespace/Replit environment (do not commit).

How to enable admin password
- Set ADMIN_PASSWORD in environment:
  - Codespaces: set in repo / codespace environment or run in terminal: export ADMIN_PASSWORD="supersecret"
  - Replit: add a secret in the Repl's Secrets section
  - Local: export ADMIN_PASSWORD="supersecret" and start server
- Optionally set ADMIN_USERS env (comma-separated) for name-based admin trust (insecure).

Config
- config.json (created automatically on first run if missing) stores:
  - familyFriendly: boolean
  - profanity: array of words (used when familyFriendly==true)
- Use config.example.json as a template. Changes from the Admin Panel persist to config.json.

Admin usage flow
1. Open the client, set server (wss://...), choose name 'localadmin'.
2. When prompted (popup), enter the ADMIN_PASSWORD to be granted admin privileges.
3. Admin Panel button appears on the right — open it to manage users/messages/config.

Notes & security
- ADMIN_PASSWORD is required for granting admin rights at join; it's checked by the server.
- Do NOT commit secrets to the repo. Keep ADMIN_PASSWORD in Codespaces / Replit secrets.
- IP ban/mute/kick and impersonation are powerful operations — intended for demo/self-hosted runs.
- Family-friendly filtering is a simple word-matching filter (not comprehensive).
- For production: use proper authentication (OAuth/JWT), role storage in DB, stronger rate limiting, and avoid exposing IPs unless necessary.

Files changed
- server.js — admin actions & config persistence & family-friendly
- public/index.html — admin panel, popup password prompt, impersonate, message selection
- config.example.json — example config


```
