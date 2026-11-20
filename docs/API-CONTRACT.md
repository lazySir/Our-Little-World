# API contract v1

Prefix `/api`. JSON responses are direct objects/arrays, no wrapper. Failures: `{ message: string, code?: string }` with accurate 400/401/403/404/409/413/429 codes. Auth: `Authorization: Bearer <token>`. All dates are local calendar strings `YYYY-MM-DD`; timestamps ISO UTC. IDs are opaque strings. Every non-public resource is scoped to authenticated space.

## Auth

- `GET /auth/status` public → `{ initialized: boolean }`.
- `POST /auth/setup` public → accepts `{ setupToken,username,password,nickname,spaceName,startDate }`, once only. The generated one-time code has 256 bits of entropy and is stored on the server; a configured `SETUP_TOKEN` must contain at least 32 bytes and no more than 256 characters. Invalid or missing values return 403 without creating data. Generated token files are removed after successful creation.
- `POST /auth/login` public `{username,password}` → `{token,user,space}`.
- `POST /auth/join` public `{code,username,password,nickname}` → `{token,user,space}`; maximum 2 members.
- `GET /auth/me` → `{user,space,partner}`. user `{id,username,nickname,role}`, space `{id,name,startDate,theme}`; partner same public user or null.
- `POST /auth/invite` → `{code,expiresAt}` (24h, one use).
- `POST /auth/logout` → `{ok:true}`.
- `PATCH /auth/password` `{currentPassword,newPassword}` → `{ok:true}`; revoke other sessions.
- `PATCH /auth/profile` `{nickname}` → user.
- `PATCH /space` `{name,startDate,theme}` → space. theme `cream|rose|sage`.

## Resources

Every resource below supports `GET /<path>` array, `POST /<path>` object, `PATCH /<path>/:id` object, `DELETE /<path>/:id` `{ok:true}`. IDs/spaceId/authorId/createdAt/updatedAt assigned server-side. GET returns the complete history for the authenticated space in descending creation order; frontend filters/searches locally. Resource objects contain the fields listed below plus id/createdAt/updatedAt and authorId if relevant. PATCH validates merged data and preserves omitted fields; clients may send full writable objects. For WeChat, the same PATCH routes accept POST with the exact `X-HTTP-Method-Override: PATCH` header and identical authentication.

- `wishes`: `{title,description:'',category:'travel|food|life|other',status:'todo|done',targetDate:null|string,completedAt:null|string}`.
- `menu`: `{name,category:'dish|drink|restaurant',description:'',priceCents:0,assetId:null|string,favorite:false}`.
- `orders`: `{items:[{menuItemId,name,quantity}],note:'',status:'pending|done'}`; menuItemId belongs to same space; server snapshots name and recomputes totalCents. Accept clients' optional name but trust persisted menu name. Quantity 1–99. GET returns totalCents and items.
- `ledger`: `{type:'income|expense',amountCents:positive integer,category:string,date:string,note:'',payer:string}`.
- `anniversaries`: `{title,date,recurring:true,description:'',icon:'heart'}`.
- `memories`: `{title,content:'',date,assetIds:[],tags:[],kind:'couple|baby'}`.
- `growth`: `{title,date,type:'growth|feeding|sleep|health|milestone',content:'',heightCm:null|number,weightKg:null|number,amountMl:null|number,durationMinutes:null|number,assetIds:[]}`.
- `work`: `{title,date,content:'',tags:[],assetIds:[]}`.
- `letters`: `{title,content,unlockDate,recipient:'partner|both'}`. GET adds `{isLocked:boolean,author:{nickname}}`; omit content until unlockDate even for author. Only author may edit/delete; PATCH forbidden after unlock.
- `moods`: `{mood:'great|good|okay|low|tired',note:'',date}`. POST upserts the current user's date; omitting `date` uses the service's calendar day at save time (`TZ`, default `Asia/Shanghai`). An explicit date retains historical upserts; null is invalid. Stored and restored moods always require a valid date, and PATCH preserves the existing date when omitted. GET adds author nickname. Only author may edit/delete.

`GET /baby` → null or `{id,name,birthday:null|string,gender:'unknown|girl|boy',notes:'',avatarId:null|string}`. `PUT /baby` saves same writable shape. No delete endpoint needed; UI may reset through settings with confirmation later.

`GET /dashboard` → `{date,daysTogether,counts:{wishes,memories,anniversaries,work},monthly:{incomeCents,expenseCents,balanceCents},recentMemories:[],upcomingAnniversaries:[],pendingWishes:[],moods:[]}`. `date` is the service's current calendar day (`YYYY-MM-DD`, configured by `TZ`, default `Asia/Shanghai`), captured once for the entire response. Days together, monthly totals, upcoming anniversaries and today's moods use this date. Home clients use it for date/month labels and anniversary countdowns, omit mood dates so a page left open across midnight saves on the new service day, and reset the mood input when the response contains no current-user mood. Explicit record-date forms keep the user's selected calendar date. Dashboard can also derive from resource endpoints if needed.

`GET /calendar?month=YYYY-MM` → `{month,date,events:CalendarEvent[]}`. `month` is optional and defaults to the service's current month; invalid months return 400. Each event has `{id,sourceId,kind,date,title}` and may include `description`, `recurring`, `locked`, or `icon`. `kind` is `anniversary|wish|letter|memory|growth|baby`. The authenticated space's dated records are aggregated for the requested month, including annual anniversary and baby-birthday occurrences; February 29 recurrences fall on February 28 in non-leap years. Events are ordered by date, kind, title, then source ID. Future letters expose only title and `locked:true`; their content is never included.

## Assets

- `POST /assets` multipart field `file` JPEG/PNG/WebP/GIF <=10MiB → `{id,url,mime,size,originalName}`.
- `GET /assets` → asset array, same shape.
- `GET /assets/:id/url` authenticated → `{id,url,mime,size,originalName}` with a new 30-minute signed URL. Only assets in the caller's space can be renewed; other-space or missing assets return 404.
- Every asset referenced by resource must belong to same space; include `assets: [{id,url,...}]` in list/detail responses of memories/work/growth and optional `asset` in menu/baby.
- `GET /assets/:id/file?expires=...&signature=...` returns binary only after a valid short-lived signature (30 minutes maximum); URL contains no session token and responses are marked `private, no-store`. Clients renew a URL after an image load error; uni-app also renews before opening the native preview. Assets are not publicly enumerable.
- `DELETE /assets/:id` guarded and rejects still referenced files.

## Data portability

- `GET /backup/export` authenticated → JSON full data export; exclude passwords/sessions/invite tokens; include record metadata/assets metadata. UI downloads JSON.
- `GET /backup/download` authenticated owner → zip with consistent database and files.
- `POST /backup/restore` owner multipart field `file` zip → `{ok:true,restartRequired:false,safetyBackup,safetyMissingAssets,safetyDamagedAssets}`; validate manifest/version/path containment, save a uniquely named pre-restore backup, then restore records transactionally with file rollback on failure. After a successful commit, remove unreferenced WebP files while retaining every filename still referenced by any space. Keep the latest 7 pre-restore backups independently from automatic backups. Current accounts, passwords and sessions remain; invites are removed. A restore must not remove the owner's ability to log in.

Complete ZIP download, automatic ZIP, safety archives and incoming restore use the same budgets: at most 10000 records, 10000 ZIP members (including 3 fixed files), 2 users, 10MiB per image, 250MiB expanded total and 100MiB ZIP. Over-limit current data returns 413 with offline copy guidance, before mutation or replacing existing automatic archives. Use a stopped-service copy of data/storage/.env for larger archives. A safety archive may retain missing or damaged current-image metadata in `manifest.json` (`complete:false`, `missingAssets`, `damagedAssets`) so a previous complete archive can repair current files; an incomplete safety archive is rejected as a complete restore source. Ordinary downloads refuse missing or size-inconsistent files.

All client requests use environment configurable API base. Web default `/api`, Vite proxies to 3000. Uni initial default `http://127.0.0.1:3000/api` for development; settings allows LAN/HTTPS address persisted locally. Never pretend a developer AppID is a production AppID.
