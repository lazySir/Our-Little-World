# API contract v1

Prefix `/api`. JSON responses are direct objects/arrays, no wrapper. Failures: `{ message: string, code?: string }` with accurate 400/401/403/404/409/413/429 codes. Auth: `Authorization: Bearer <token>`. All dates are local calendar strings `YYYY-MM-DD`; timestamps ISO UTC. IDs are opaque strings. Every non-public resource is scoped to authenticated space.

## Auth

- `GET /auth/status` public → `{ initialized: boolean }`.
- `POST /auth/setup` public → accepts `{ username,password,nickname,spaceName,startDate }`, once only; returns `{token,user,space}`.
- `POST /auth/login` public `{username,password}` → `{token,user,space}`.
- `POST /auth/join` public `{code,username,password,nickname}` → `{token,user,space}`; maximum 2 members.
- `GET /auth/me` → `{user,space,partner}`. user `{id,username,nickname,role}`, space `{id,name,startDate,theme}`; partner same public user or null.
- `POST /auth/invite` → `{code,expiresAt}` (24h, one use).
- `POST /auth/logout` → `{ok:true}`.
- `PATCH /auth/password` `{currentPassword,newPassword}` → `{ok:true}`; revoke other sessions.
- `PATCH /auth/profile` `{nickname}` → user.
- `PATCH /space` `{name,startDate,theme}` → space. theme `cream|rose|sage`.

## Resources

Every resource below supports `GET /<path>` array, `POST /<path>` object, `PATCH /<path>/:id` object, `DELETE /<path>/:id` `{ok:true}`. IDs/spaceId/authorId/createdAt/updatedAt assigned server-side. GET list may return up to 1000 records; frontend filters/searches locally. Resource objects contain the fields listed below plus id/createdAt/updatedAt and authorId if relevant. PATCH validates merged data; clients may send full writable object.

- `wishes`: `{title,description:'',category:'travel|food|life|other',status:'todo|done',targetDate:null|string,completedAt:null|string}`.
- `menu`: `{name,category:'dish|drink|restaurant',description:'',priceCents:0,assetId:null|string,favorite:false}`.
- `orders`: `{items:[{menuItemId,name,quantity}],note:'',status:'pending|done'}`; menuItemId belongs to same space; server snapshots name and recomputes totalCents. Accept clients' optional name but trust persisted menu name. Quantity 1–99. GET returns totalCents and items.
- `ledger`: `{type:'income|expense',amountCents:positive integer,category:string,date:string,note:'',payer:string}`.
- `anniversaries`: `{title,date,recurring:true,description:'',icon:'heart'}`.
- `memories`: `{title,content:'',date,assetIds:[],tags:[],kind:'couple|baby'}`.
- `growth`: `{title,date,type:'growth|feeding|sleep|health|milestone',content:'',heightCm:null|number,weightKg:null|number,amountMl:null|number,durationMinutes:null|number,assetIds:[]}`.
- `work`: `{title,date,content:'',tags:[],assetIds:[]}`.
- `letters`: `{title,content,unlockDate,recipient:'partner|both'}`. GET adds `{isLocked:boolean,author:{nickname}}`; omit content until unlockDate even for author. Only author may edit/delete; PATCH forbidden after unlock.
- `moods`: `{mood:'great|good|okay|low|tired',note:'',date}`. POST upserts current user's date. GET adds author nickname. Only author may edit/delete.

`GET /baby` → null or `{id,name,birthday:null|string,gender:'unknown|girl|boy',notes:'',avatarId:null|string}`. `PUT /baby` saves same writable shape. No delete endpoint needed; UI may reset through settings with confirmation later.

`GET /dashboard` → `{daysTogether,counts:{wishes,memories,anniversaries,work},monthly:{incomeCents,expenseCents,balanceCents},recentMemories:[],upcomingAnniversaries:[],pendingWishes:[],moods:[]}`. Dashboard can also derive from resource endpoints if needed.

## Assets

- `POST /assets` multipart field `file` JPEG/PNG/WebP/GIF <=10MiB → `{id,url,mime,size,originalName}`.
- `GET /assets` → asset array, same shape.
- Every asset referenced by resource must belong to same space; include `assets: [{id,url,...}]` in list/detail responses of memories/work/growth and optional `asset` in menu/baby.
- `GET /assets/:id/file?expires=...&signature=...` returns binary only after valid signature; URL contains no session token. Assets not publicly enumerable.
- `DELETE /assets/:id` guarded and rejects still referenced files.

## Data portability

- `GET /backup/export` authenticated → JSON full data export; exclude passwords/sessions/invite tokens; include record metadata/assets metadata. UI downloads JSON.
- `GET /backup/download` authenticated owner → zip with consistent database and files.
- `POST /backup/restore` owner multipart field `file` zip → `{ok:true,restartRequired:false}`; validate manifest/version/path containment, save pre-restore backup, restore records atomically or stop API for swap; explicitly document actual semantics. A restore must not remove the only owner's ability to log in.

All client requests use environment configurable API base. Web default `/api`, Vite proxies to 3000. Uni initial default `http://127.0.0.1:3000/api` for development; settings allows LAN/HTTPS address persisted locally. Never pretend a developer AppID is a production AppID.

