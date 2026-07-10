# STL Manager

A self-hosted web app for browsing, tagging, and managing 3D printing STL files stored on a NAS. Files are read directly from an SMB/CIFS share; all metadata is kept in a local SQLite database for fast access without hitting the network on every request.

**Supported file types:** `.stl`, `.3mf`, `.obj` — including files inside `.zip` archives.

---

## Requirements

- **Docker** and **Docker Compose** (v2) on the machine running the container
- Your NAS share **mounted on the host** as a local directory before starting the container
- Outbound internet access only if you intend to use the Cults 3D or MyMiniFactory integrations

---

## 1. Mount your NAS share

The container expects the STL library to be available as a bind-mounted directory. Mount the SMB share on the **host machine** before starting Docker.

### macOS

```bash
# Replace with your NAS IP / share name
sudo mkdir -p /Volumes/stl
mount_smbfs //username@192.168.1.100/STLFiles /Volumes/stl
```

To mount automatically at login, add a login item via **System Settings → General → Login Items** using `smb://192.168.1.100/STLFiles`.

### Linux (Ubuntu / Debian)

Install cifs-utils if not already present:

```bash
sudo apt install cifs-utils
```

Create a credentials file (keeps your password out of `/etc/fstab`):

```bash
sudo nano /etc/samba/nas-credentials
```

```
username=your_nas_user
password=your_nas_password
```

```bash
sudo chmod 600 /etc/samba/nas-credentials
```

Add a line to `/etc/fstab` so it mounts on boot:

```
//192.168.1.100/STLFiles  /mnt/nas/stl  cifs  credentials=/etc/samba/nas-credentials,uid=1000,gid=1000,iocharset=utf8,_netdev  0  0
```

Mount it now without rebooting:

```bash
sudo mount -a
```

### uGreen NAS (via NAS OS)

The SMB share path will look like `//192.168.1.x/STLFiles` where the IP is your NAS's LAN address. Find it in the NAS OS network settings. The share name is whatever you named the shared folder in the File Manager.

---

## 2. Configure the environment

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and set `NAS_MOUNT_PATH` to wherever the share is mounted on the host:

```env
# Path on the HOST where your NAS SMB share is mounted
NAS_MOUNT_PATH=/mnt/nas/stl
```

The container maps this path to `/nas` (read-only). All other paths (`DB_PATH`, `CACHE_DIR`, `THUMB_DIR`) live inside `./data/` on the host — a local directory that Docker creates automatically and that persists across container restarts.

### All available environment variables

These are set in `docker-compose.yml`. You only need to change them if you want to tune behavior.

| Variable | Default | Description |
|---|---|---|
| `NAS_MOUNT_PATH` | `/mnt/nas` | Host path of the mounted NAS share |
| `DB_PATH` | `/data/stl-manager.db` | SQLite database location inside the container |
| `CACHE_DIR` | `/data/cache` | Extracted zip entry cache |
| `THUMB_DIR` | `/data/thumbnails` | Generated JPEG thumbnails |
| `STL_ROOT` | `/nas` | Root directory scanned for STL files (inside the container) |
| `CHOKIDAR_USEPOLLING` | `true` | Must be `true` for SMB mounts — they don't deliver filesystem events |
| `CHOKIDAR_INTERVAL` | `30000` | How often to poll for changes, in milliseconds |

**Why polling?** SMB/CIFS mounts on Linux don't forward inotify events from the NAS kernel to the host. Without polling, the watcher would never detect new or deleted files. The 30-second interval is a reasonable balance between responsiveness and CPU cost. Lower it (e.g. `5000`) if you add files frequently and want faster indexing; raise it (e.g. `60000`) on very large libraries.

---

## 3. Build and start

```bash
docker compose up -d --build
```

On first run this will:

1. Build the backend Node.js image (installs native dependencies including `sharp` for thumbnail generation)
2. Build the frontend image (Vite build → served by nginx)
3. Create `./data/` on the host and initialize the SQLite database
4. Start scanning the NAS mount and generating thumbnails in the background

Open the app at **http://localhost:8080**.

The backend API is also directly reachable at **http://localhost:3001** if you need to inspect it.

### Subsequent starts

```bash
docker compose up -d
```

No rebuild needed unless you change source files.

### View logs

```bash
# All services
docker compose logs -f

# Backend only
docker compose logs -f backend
```

---

## 4. File watching and indexing

The watcher starts automatically when the container starts. A status indicator in the bottom-left of the sidebar shows the current state:

- **Green** — watching and ready; library is fully indexed
- **Amber** — initial scan in progress
- **Red** — watcher stopped (check logs)

The file count shown (`247 files · 183 in zips`) updates live as files are discovered.

### Reconcile

If files are deleted while the container is stopped (or removed in a way the watcher missed), use the **Reconcile Library** button in the sidebar. It removes database rows whose source file no longer exists on disk. The watcher handles adds and changes continuously; reconcile is only needed to clean up deletions.

### Thumbnail generation

Thumbnails are generated in a background queue using a pure software rasterizer — no GPU required. On a large library this takes a while. You can see how many are pending in the toolbar ("Generating N thumbnails…"). Generation resumes automatically if the container restarts.

---

## 5. Platform integrations (optional)

The app can connect to **Cults 3D** and **MyMiniFactory** to browse your library, search for models, and link local files back to their source listing. These features require outbound internet access from the container.

Credentials are stored in the local SQLite database. They never leave your network except as API authentication headers sent to the respective platform.

### Connecting an account

1. Click **Integrations** at the bottom of the sidebar
2. Enter your username and API key for each platform
3. Click **Connect** — the app verifies the credentials immediately by fetching your profile

#### Cults 3D

Generate an API key at **https://cults3d.com/en/api/keys** (you must be logged in). The key is a long alphanumeric string shown only once — copy it immediately.

- **Username:** your Cults 3D login name (visible in your profile URL: `cults3d.com/en/users/USERNAME`)
- **API Key:** the key generated above

The Cults API uses your key as a Basic Auth password over HTTPS. The free tier allows approximately **500 requests per day**.

#### MyMiniFactory

MyMiniFactory uses your account password as the API key for Basic Auth.

- **Username:** your MyMiniFactory username
- **API Key:** your MyMiniFactory **account password**

You can find your username at **https://www.myminifactory.com/settings/profile**.

> Note: MyMiniFactory does not issue separate API keys — your password is the credential. If you change your password, you'll need to reconnect in the Integrations page.

### Using integrations when adding an origin

When you open a file and click **Add** under Origins, a **"Import from connected platform"** button appears if any platform is connected. Clicking it opens a browser where you can:

- **My Library** — browse items you've purchased or collected
- **Search** — search the full platform catalog by name

Selecting an item auto-fills the origin form (source, name, author, URL). You can then save or edit the fields before saving.

---

## 6. Slicer protocol handlers

The **Open in Slicer** buttons in the file detail panel use custom URI schemes that the slicer app must have registered on the host OS:

| Slicer | Protocol | Notes |
|---|---|---|
| Bambu Studio | `bambustudio://` | Registered automatically when Bambu Studio is installed |
| Chitubox | `chitubox://` | Registered automatically when Chitubox is installed |
| Lychee Slicer | `lychee://` | Registered automatically when Lychee is installed |

The browser on the host machine intercepts these links and hands off to the installed slicer. This works on macOS and Windows. On Linux it requires the slicer to have registered its handler with `xdg-mime`.

---

## 7. Data persistence

All persistent data lives in `./data/` relative to the `docker-compose.yml` file:

```
data/
├── stl-manager.db       # SQLite database (tags, collections, origins, credentials)
├── cache/               # Extracted zip entry cache (safe to delete — rebuilt on demand)
└── thumbnails/          # Generated JPEG thumbnails (safe to delete — rebuilt on demand)
```

`./data/` is listed in `.gitignore` and is never committed. Back it up if you want to preserve tags, collections, and origins across a full reinstall.

---

## 8. Updating

```bash
git pull
docker compose up -d --build
```

The database schema applies additive migrations automatically on startup — existing data is preserved.

---

## 9. Troubleshooting

**Files aren't appearing**

- Confirm the NAS share is mounted on the host: `ls $NAS_MOUNT_PATH` should list your STL directories
- Check the backend logs: `docker compose logs -f backend`
- The watcher status indicator in the sidebar shows amber while the initial scan is running — this can take several minutes on large libraries

**Thumbnails aren't generating**

- Thumbnail generation runs in a background queue. The toolbar shows "Generating N thumbnails…" while work is pending
- If thumbnails never appear, check backend logs for errors — usually a permissions issue writing to `./data/thumbnails/`

**Platform integration returns an error**

- Cults 3D: confirm your API key is active at `https://cults3d.com/en/api/keys`. Keys can be revoked or expire
- MyMiniFactory: the credential is your account password — if you changed it recently, reconnect
- Both platforms require outbound HTTPS from the container. If your network has strict egress rules, whitelist `cults3d.com` and `myminifactory.com` on port 443

**SMB mount lost after host reboot**

On Linux, verify `/etc/fstab` has `_netdev` in the options — this tells the OS to wait for the network before mounting. Without it, the mount may fail silently at boot and the container will start with an empty `/nas`.

**Container starts but the UI shows no files and the watcher is red**

The most common cause is that `NAS_MOUNT_PATH` in `.env` doesn't match where the share is actually mounted. Run `mount | grep cifs` (Linux) or `mount | grep smbfs` (macOS) to confirm the actual mount point.
