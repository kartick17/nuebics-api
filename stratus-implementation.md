# Stratus

A Next.js file manager that uploads files to **Zoho Catalyst Stratus** (cloud object storage) and tracks them in **MongoDB**.

You can upload, list, download, and delete files from a simple web UI, with drag-and-drop and live upload progress.

---

## Stack

| Layer | Tech |
|---|---|
| Cloud storage | Zoho Catalyst Stratus (via `zcatalyst-sdk-node` v3) |
| Metadata DB | MongoDB + Mongoose |
| Server | Next.js 16 API routes |
| Client | React 19 + Tailwind CSS 4 |
| Language | TypeScript |

---

## How it works

Files live in two places:

- **Stratus** holds the actual file bytes, saved under a UUID key.
- **MongoDB** holds the searchable info: original name, size, MIME type, upload date, and the Stratus key.

This split lets the UI search and sort fast (Mongo) while keeping storage cheap and scalable (Stratus). The original filename comes back on download via the `Content-Disposition` header.

---

## Project structure

```
app/
  page.tsx                       File manager UI (drag-drop, list, download, delete)
  layout.tsx                     Root layout
  api/
    files/route.ts               POST upload, GET list
    files/[...key]/route.ts      GET download, DELETE
    files/presigned/route.ts     POST presigned URL

hooks/
  use-stratus-files.ts           Client hook: state + API calls + XHR upload progress

lib/
  zoho-stratus.ts                Wrapper around the Zoho Catalyst SDK
  db.ts                          MongoDB connection (cached for hot reload)
  models/file.ts                 File metadata schema
```

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Run MongoDB

Make sure MongoDB is running locally (or point `MONGODB_URI` at a remote one).

### 3. Set up Zoho Catalyst

You need a Zoho Catalyst project with a Stratus bucket. From the Zoho Catalyst console get:

- Client ID and Client Secret (OAuth app)
- Refresh token
- Project ID and Project Key
- Bucket name

### 4. Create `.env`

```bash
# Zoho OAuth
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...

# Zoho Catalyst project
ZOHO_PROJECT_ID=...
ZOHO_PROJECT_KEY=...
ZOHO_BUCKET_NAME=...

# Region (India shown here — change for your DC)
ZOHO_ACCOUNTS_URL=https://accounts.zoho.in
X_ZOHO_CATALYST_ACCOUNTS_URL=https://accounts.zoho.in
X_ZOHO_CATALYST_CONSOLE_URL=https://console.catalyst.zoho.in

# Local DB
MONGODB_URI=mongodb://localhost:27017/stratus
```

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Features

### Upload
- Drag-and-drop or click to browse
- Multiple files at once
- Live progress bar (uses XHR, not `fetch`, so progress events work)
- Optional path prefix (folder-style organization)

### List
- Shows files newest first
- Filter by path prefix
- Pretty-printed file size and date
- Emoji icon based on extension

### Download
- Click `↓` on any row
- Original filename is restored on download

### Delete
- Click delete, then confirm with **Yes** / **No**
- Removes from Stratus and Mongo together

### Presigned URLs
- `POST /api/files/presigned` returns a temporary signed URL for direct GET or PUT access without going through the server

---

## API

### `POST /api/files`
Upload a file.

**Body** (multipart/form-data):
- `file` — the file
- `path` *(optional)* — folder prefix

**Returns:** `{ success, key, name, size }`

### `GET /api/files?prefix=<optional>`
List files. Filters by key prefix if given. Sorted newest first.

### `GET /api/files/[...key]`
Download a file. Streams from Stratus with the original filename.

### `DELETE /api/files/[...key]`
Delete a file from both Stratus and Mongo.

### `POST /api/files/presigned`
Generate a temporary signed URL.

**Body:**
```json
{
  "key": "path/to/file.ext",
  "action": "GET",
  "expiryInSeconds": 3600
}
```

---

## Client hook: `useStratusFiles`

```tsx
const {
  files, loading, error, uploading, uploadProgress,
  fetchFiles, uploadFile, deleteFile, downloadFile,
} = useStratusFiles();
```

- `fetchFiles(prefix?)` — load file list
- `uploadFile(file, path?)` — upload with progress tracking
- `deleteFile(key)` — delete + remove from local state
- `downloadFile(key)` — open download in new tab

---

## End-to-end flows

**Upload:** browser → `POST /api/files` (XHR with progress) → server makes UUID key → `uploadObject` to Stratus → save metadata in Mongo → response.

**List:** browser → `GET /api/files?prefix=` → Mongo query → JSON list.

**Download:** browser opens `/api/files/<key>` → server checks Mongo → streams from Stratus with `Content-Disposition`.

**Delete:** browser → `DELETE /api/files/<key>` → Stratus delete + Mongo delete.

---

## Notes

- **No user auth yet.** The server uses one Zoho refresh token for everyone, and any client can call the API. The Mongo lookup before download is the only gatekeeper. Add user identity and per-user file scoping before going public.
- **Stratus SDK init.** `lib/zoho-stratus.ts` uses a counter on app init to avoid the SDK's `duplicate_app` error during Next.js hot reload.
- **Mongo connection** is cached on `global` for the same reason.

---

## Scripts

```bash
npm run dev      # start dev server
npm run build    # production build
npm run start    # run production build
npm run lint     # eslint
```
