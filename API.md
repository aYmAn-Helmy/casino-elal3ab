# Casino Party LAN — WebSocket protocol (MVP)

Connect to: `ws://CASAOS_IP:3000/ws` on the local LAN. For browser origins, connect from the same host; non-browser mobile clients may have no Origin header.

Each message is a single JSON object (`type` field required). All clients receive `{ "type": "state", "state": {...} }` on connect and whenever game state changes. The server, not clients, decides the winner.

## Player actions

```json
{ "type": "join", "name": "Ahmed", "token": "" }
```

Server responds:

```json
{ "type": "joined", "player": { "id": "UUID", "name": "Ahmed", "score": 0, "token": "64_HEX_CHARS" } }
```

Save `token` securely per installation and send it on the next `join` to restore the same player's score. Never share it with other players.

When `state.phase == "open"`, send the **last server-announced** round ID:

```json
{ "type": "buzz", "roundId": 1 }
```

Server responds to sender with `{ "type": "buzz-result", "ok": true|false, "reason": "..." }` and broadcasts `state` if the buzz succeeds. The first accepted message at the server wins; client timestamps are **not** trusted.

## Host actions

```json
{ "type": "host-login", "pin": "PRIVATE_ADMIN_PIN" }
```

Responds `{ "type": "host-ok" }` on success. Only this authorized socket can send:

```json
{ "type": "host-action", "action": "open" }
```

Actions: `open`, `correct`, `wrong`, `close`, `reset-scores`, `clear-players`. Correct adds `CORRECT_POINTS`. Wrong deducts `WRONG_POINTS` and reopens the buzzer for other connected players. Every reopening increases `roundId` to reject delayed packets.

State fields: `roomName`, `phase` (`idle`, `open`, `answering`, `closed`), `roundId`, `winnerId`, `winnerName`, `players` (`id`, `name`, `score`, `connected`, `excluded`), `correctPoints`, `wrongPoints`, `lastEvent`, `serverTime`.

## HTTP endpoints

- `/` — landing
- `/play` — mobile-friendly player UI (already usable without APK)
- `/admin` — host dashboard (PIN required for control)
- `/screen` — public live scores/TV view
- `/download` — APK binary only **after** an `.apk` file is placed in the CasaOS `/DATA/AppData/casino-party-lan/apk` folder; responds 404 otherwise
- `/api/health` — health and APK readiness

## Network/security notes

- Put all devices on the same Wi-Fi/LAN. Disable AP/client isolation on the router.
- Do **not** forward port 3000 to the public internet. HTTP and WS are unencrypted on the local network.
- Restrict the admin PIN to the host. Repeated failed logins on one connection are limited.
- No remote code execution, Docker socket mount, privileged container, or public API key is required.
- Winner is **first arrival at server**, not necessarily the first physical touch if Wi-Fi latency differs.
## Question-bank actions (host only)

After `host-login` succeeds:

```json
{ "type": "questions-import", "questions": [{ "text": "سؤال", "answer": "الإجابة", "category": "عام", "source": "مصدر المستخدم", "reference": "مرجع اختياري" }] }
```

Import atomically replaces the whole bank; 1–1000 distinct questions. Required string fields: text, answer, category; optional: source, reference. The host receives `import-ok` and a private `host-question` message. All users see only `state.question` (id, text, category) and `state.questionStats` (total, remaining), never the answer.

Additional host commands: `{ "type": "host-action", "action": "next-question" }` and `{ "type": "host-action", "action": "reset-question-usage" }`.

No third-party commercial questions are bundled.


## Player-only scoring notification (v0.1.2)

When the host sends `{ "type": "host-action", "action": "correct" }` for the player who currently has the answering right, the server commits the score update and **only then** sends to that player's connected WebSocket:

```json
{ "type": "answer-correct", "playerId": "UUID", "roundId": 7, "points": 10 }
```

This notification is **not** sent when a buzzer is won (`buzz-result.ok`) or when the host marks an answer wrong; only a correct answer and awarded points should cause the player-side reward chime. The tap bell stays local to the tap gesture. There are no lock sounds.
