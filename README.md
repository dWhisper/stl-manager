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
//192.168.1.100/STLFiles  /mnt/nas/stl  cifs  credentials=/etc/samba/nas-credentials,uid=1000,gid=1000,iocharset=utf8,_netdev,nofail,x-systemd.automount  0  0
```

`nofail` and `x-systemd.automount` let the machine boot normally when the NAS is off. The share then mounts the first time something opens the folder. If the share name has a space in it, write the space as `\040`, e.g. `//192.168.1.100/3D\040Files`.

Create the mount point and mount it now without rebooting:

```bash
sudo mkdir -p /mnt/nas/stl
sudo systemctl daemon-reload
sudo mount -a
```

### Linux (Arch / CachyOS)

Install cifs-utils if not already present:

```bash
sudo pacman -S cifs-utils
```

Create a credentials file (keeps your password out of `/etc/fstab`):

```bash
sudo mkdir -p /etc/samba
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
//192.168.1.100/STLFiles  /mnt/nas/stl  cifs  credentials=/etc/samba/nas-credentials,uid=1000,gid=1000,iocharset=utf8,_netdev,nofail,x-systemd.automount  0  0
```

`nofail` and `x-systemd.automount` let the machine boot normally when the NAS is off. The share then mounts the first time something opens the folder. If the share name has a space in it, write the space as `\040`, e.g. `//192.168.1.100/3D\040Files`.

Create the mount point and mount it now without rebooting:

```bash
sudo mkdir -p /mnt/nas/stl
sudo systemctl daemon-reload
sudo mount -a
```

Docker and Docker Compose are available in the official Arch/CachyOS repos and the `docker-compose` community plugin:

```bash
sudo pacman -S docker docker-compose
sudo systemctl enable --now docker
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

### HTTPS on the local network

Browsers warn about any self-signed certificate they haven't been told to trust. To avoid that, `scripts/make-certs.sh` creates a small private certificate authority (CA) and uses it to sign the server's certificate. Install the CA on each device once, and the site loads with no warnings.

**1. Make the certificates** (on the machine you deploy from). List every address you'll type into the browser:

```bash
scripts/make-certs.sh 192.168.5.125 nas.local
```

With no arguments it uses `192.168.5.125 localhost 127.0.0.1`. This writes the following to `certs/` (git ignores it):

| File | What it is |
|---|---|
| `ca.crt` | The CA certificate. Install this on your devices. |
| `ca.key` | The CA private key. Keep it private and never copy it to the NAS. |
| `server.crt` / `server.key` | The certificate and key nginx serves. |

The server certificate lasts 825 days, the longest Apple devices accept. To renew it, or to add an address, run the script again. It keeps the existing CA, so you don't have to reinstall anything on your devices.

**2. Copy the server cert to the NAS and deploy.** Run these on the machine that has the `nas` Docker context. The first command copies the files through the Docker API, so it doesn't need SSH:

```bash
tar -C certs -c server.crt server.key | docker --context nas run --rm -i \
  -v /volume1/docker/stl-manager/certs:/certs alpine tar -x -C /certs

CERT_DIR=/volume1/docker/stl-manager/certs \
docker --context nas compose -f docker-compose.yml -f docker-compose.nas.yml \
  -f docker-compose.https.yml up -d --build
```

The app is then at **https://192.168.5.125:8443**. Plain HTTP on port 8080 redirects to it. To use other ports, set `HTTP_PORT` and `HTTPS_PORT`. To run with HTTPS on the local machine instead, leave out `CERT_DIR` and the NAS file. The certs are then read from `./certs`.

**3. Trust `certs/ca.crt` on each device:**

- **macOS:** Double-click `ca.crt` to add it to the **System** keychain. In Keychain Access, open *STL Manager Local CA*, expand **Trust** and set it to **Always Trust**.
- **Windows:** Double-click `ca.crt`, then choose **Install Certificate → Local Machine → Place all certificates in the following store → Trusted Root Certification Authorities**.
- **iOS / iPadOS:** AirDrop or email `ca.crt` to the device and open it. Install the profile under **Settings → General → VPN & Device Management**. Then turn it on under **Settings → General → About → Certificate Trust Settings**.
- **Android:** Go to **Settings → Security → More security settings → Encryption & credentials → Install a certificate → CA certificate** and pick `ca.crt`. Menu names vary between phone makers.
- **Arch / CachyOS:** `sudo trust anchor --store certs/ca.crt`
- **Firefox** keeps its own list of trusted certificates. Either import `ca.crt` under **Settings → Privacy & Security → View Certificates → Authorities → Import** and tick *websites*, or set `security.enterprise_roots.enabled` to `true` in `about:config` so it uses the system's list.

Restart the browser afterwards. Chrome, Edge and Safari use the system's list.

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

## 7. Duplicates

The **Duplicates** page (linked in the sidebar) finds copies of the same files, folders and zips in your library so you can pick one to keep. The app never changes the library: it is mounted read-only. It finds duplicates and exports a shell script that you run yourself to remove the extra copies.

Every file gets a CRC32 + size fingerprint. Zip entries are read from each zip's directory; loose files are hashed in the background after startup, which takes hours on a large library. The page shows how many files are still pending, and groups are incomplete until that reaches zero. STL files also get a geometry fingerprint (triangle count, bounding box, surface area and volume) to find the same model saved in different bytes.

The four tabs:

- **Folders & zips**: identical folders or zips, including a zip next to its own extracted folder.
- **Contained**: a folder whose files all exist in a bigger folder.
- **Files**: identical files.
- **Likely same**: same geometry, different bytes. This is a heuristic, and mirrored copies (left and right parts) match too, so check the thumbnails before keeping anything.

For each group, pick the copy to keep, or mark it **Not a duplicate** to hide it. The app suggests a keeper, but a suggestion is not saved until you pick one. Zip-vs-folder groups have no suggestion.

### Exporting the script

Click **Export** and choose a mode:

- **mv** (default) moves each removed copy into `_duplicates/` at the library root, keeping its path. This is reversible: delete `_duplicates/` once you are satisfied.
- **rm** permanently deletes removed copies that are single loose model files. Folders and zips are still moved to `_duplicates/`, never deleted, because only model files (`.stl`, `.3mf`, `.obj`) are compared: a folder or zip judged identical can still hold unique images, PDFs or project files.

Every action checks that the kept copy still exists and that the removed copy is unchanged: a file's byte size, or a folder's count of model and zip files. If either check fails, the script prints `SKIP` and continues. Files inside a zip are never removed one by one; those cases are listed as `# MANUAL` comments for you to handle.

Run the script from your computer:

```bash
ssh nas 'bash -s' < dedupe-mv.sh
```

or copy it to the NAS and run it there with `bash`.

`DEDUPE_HOST_ROOT` sets the library path on the host. It defaults to `/volume1/3D Files`. Set it as a backend environment variable before exporting, or pass it when running the script, e.g. `ssh nas "DEDUPE_HOST_ROOT='/volume1/Other' bash -s" < dedupe-mv.sh`.

---

## 8. Data persistence

All persistent data lives in `./data/` relative to the `docker-compose.yml` file:

```
data/
├── stl-manager.db       # SQLite database (tags, collections, origins, credentials)
├── cache/               # Extracted zip entry cache (safe to delete — rebuilt on demand)
└── thumbnails/          # Generated JPEG thumbnails (safe to delete — rebuilt on demand)
```

`./data/` is listed in `.gitignore` and is never committed. Back it up if you want to preserve tags, collections, and origins across a full reinstall.

---

## 9. Updating

```bash
git pull
docker compose up -d --build
```

The database schema applies additive migrations automatically on startup — existing data is preserved.

---

## 10. Troubleshooting

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
