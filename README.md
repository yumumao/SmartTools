# SmartTools - An Editable Online Bookmark System

> 🌏 [中文版 README](./README_CN.md)

A personal bookmark system featuring **multiple card styles, visual configuration, and dual-mode deployment**, with a collection of self-made utility tools as one of its sections.

This project started as a few small online tools I wrote for my kids, and gradually evolved into the current **online bookmark system**, with those utilities preserved as one section. Bookmarks, URLs, and frequently-used tools can all be edited directly through a web interface — **no code changes or redeployment required**.

---

## ✨ Key Features

### 📚 Bookmark System

- **Multiple card styles**: full-card link (`simple`), clickable description (`desc-clickable`), expandable submenu (`expandable`, supporting multi-level sub-cards)
- **Rich icon support**: Emoji / text / image URL / inline SVG — your choice
- **Visual admin panel**: all cards, sub-cards, and categories can be added, edited, deleted, drag-sorted, and moved across categories directly in the browser
- **Custom categories**: in addition to the built-in groups ("Online USB Drive", "Teaching Materials", "Web Resources", "Video Aggregators", "Email", "Other Contacts"), you can freely add/remove/rename/reorder your own categories, and configure per-category expand/collapse behavior on mobile
- **🔐 Encrypted Categories (Privacy Protection)**: Any custom category can be encrypted with one click. Content is encrypted locally in the browser using **AES-GCM 256-bit** before being written to `data.js` — only ciphertext is stored on the server and in the repository. Accessing an encrypted category requires a separate password; decryption happens purely in memory. The unlocked state lives only in the current tab's `sessionStorage` and clears automatically when the tab closes. A floating **"Lock Now"** button in the bottom-right corner lets you re-lock instantly. When locked, even the category title is hidden — only a subtle pill-shaped placeholder remains, so **even if `data.js` is published to a public GitHub repo, the content cannot be recovered**
- **Dual-mode deployment**:
  - ☁️ **Online mode**: deploy to Cloudflare Pages with data stored in KV — edit from any device or browser after login
  - 💻 **Local mode**: read/write the local `data.js` directly from the browser (powered by the File System Access API, requires Chrome / Edge)
- **Version management**: every save automatically backs up the previous version; preview, download, and one-click restore any historical version
- **Data source switching**: in online mode, instantly toggle between "KV live data" and "static `data.js` in the GitHub repo"
- **Automatic fallback**: if KV is selected as the data source but no data exists yet in KV, the system automatically falls back to the static `data.js` in the repository — no blank pages
- **Import / Export**: import from any `data.js` file, or preview/download the current data at any time
- **Security**: online mode uses HttpOnly cookies with HMAC-SHA256-signed session tokens; local-mode credentials are hashed with SHA-256 and stored only in the browser

### 🧰 Built-in Utility Tools

This section holds the small online tools I originally wrote for my kids' daily study. They now live as one category within the bookmark system (accessible from the top of the homepage). All are responsive, work out of the box, and require no installation:

- **Estimation Calculator**: trains mental estimation of addition, subtraction, multiplication, and division. Provides multiple methods such as leading-digit estimation, rounding to tens, and secondary-digit rounding, with detailed steps and comparisons to the exact result — helping children systematically master estimation techniques.
- **Poetry 9-Grid Game**: a 3×3 grid game that helps kids memorize classical Chinese poems. Comes with a built-in library for grades 1–6 (one poem per week for each semester), supports random poems (via the Jinrishici API), and custom input — learning through play.
- **Daily Math Practice**: automatically generates elementary-school mental arithmetic, vertical calculations, step-by-step expressions, and word problems, with full answers and solution steps. Print-friendly, designed for daily drilling.
- **AI Mistake Notebook**: snap a photo of a problem → AI analyzes it → generates variant practice problems. Multi-subject management, automatic knowledge-point tagging, PWA offline support, and compatibility with Gemini / OpenAI APIs — turning mistakes into real improvement.
- **Physiology Knowledge Outline**: a systematic four-level knowledge tree covering 12 core chapters of human physiology, with clinical application examples and disease correlations — suitable as a reference for medical students and healthcare professionals.
- **Password Manager**: a purely local password generator supporting custom length and character combinations, with real-time strength evaluation. No data is ever uploaded.
- **Video Aggregator**: a serverless video aggregator/player based on [MoonTV](https://github.com/gagabba/MoonTV-gas), featuring multi-source search, online playback, automatic ad-removal, and cloud-synced favorites.

---

## 🚀 Getting Started

### Option 1: Deploy to Cloudflare Pages (Recommended — Online Editing)

#### 1. Fork / Import the Repository

1. Fork this repo to your GitHub account.
2. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**, and select the repo.
3. Keep the default build settings (pure static + Functions, no build step needed):
   - Build command: *leave empty*
   - Build output directory: `/`

After the first deployment completes, **don't rush to visit the site yet** — you still need to configure environment variables and bind KV.

#### 2. Configure Environment Variables

Go to **Project → Settings → Environment variables → Production** and add the following **3 variables** (it's recommended to mark all of them as **Encrypt / Secret**):

| Variable | Required | Example | Description |
|---|---|---|---|
| `ADMIN_USER` | ✅ | `admin` | Admin login username |
| `ADMIN_PASS` | ✅ | `YourStrongPassword!2026` | Admin login password — use a strong one |
| `AUTH_SECRET` | ✅ | *(see generation commands below)* | Secret key used to HMAC-SHA256-sign the session cookie |

> ⚠️ **`AUTH_SECRET` MUST be changed!**
> ~~There is a fallback default value `please-change-this-secret` in the code. If you forget to set it, the system will still work, but the signing key becomes a public string, and **anyone can forge a valid login session**.~~

Recommended ways to generate a secret (pick any):

```bash
# macOS / Linux
openssl rand -base64 48

# Node.js
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# Python
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Paste the generated random string (at least 32 characters) into `AUTH_SECRET`.

#### 3. Create and Bind a KV Namespace

**3.1 Create a KV namespace**

Go to **Workers & Pages → KV → Create a namespace**. Pick any name, e.g. `smarttools-fav`.

**3.2 Bind it to the Pages project**

Back in your Pages project → **Settings → Functions → KV namespace bindings → Add binding**:

| Variable name | KV namespace |
|---|---|
| **`FAV_KV`** | Select the namespace you just created |

> ⚠️ **The Variable name MUST be exactly `FAV_KV`** (uppercase, underscore).
> The code accesses this KV via `env.FAV_KV`; any typo will break saving and silently fall back to read-only mode.

**3.3 Keys stored in KV** (no manual setup required — the system writes them automatically)

| Key | Type | Description |
|---|---|---|
| `data_js` | text | Full content of `data.js` (all bookmark data) |
| `data_source` | `kv` / `static` | Data source switch — determines what the frontend reads |

#### 4. Trigger a Redeployment

Once the environment variables and KV binding are ready, go to **Deployments → latest deployment → Retry deployment** so the new configuration takes effect.

#### 5. First Login and Initialization

1. Open your site: `https://<your-project-name>.pages.dev`
2. Visit `/config.html` and log in with `ADMIN_USER` / `ADMIN_PASS`.
3. Edit your content and click **Save**.
4. On a successful save, `data_js` is written into KV and the frontend will start reading from KV.

---

### Option 2: Local Mode (Zero Backend, Pure Static)

1. Clone or download the repo locally.
2. Open `index.html` using **Chrome / Edge** (preferably through a local server such as `python -m http.server`; do **not** use `file://`).
3. Visit `config.html` and choose **"💻 Local Mode"**.
4. Set a username and password on first use (hashed and stored only in the current browser).
5. Click **"📂 Connect Folder"** and select the repo directory — you can now edit the local `data.js` directly.

### Option 3: Pure Static, Read-Only

If you only want to display your bookmarks without editing them, just modify `data.js` manually and deploy to any static host (GitHub Pages / Vercel / Netlify, etc.). You don't need to open or expose `config.html` at all.

---

## 🔄 Data Source Switching

In online mode, the system supports two data sources, controlled by the `data_source` key in KV:

| Value | Frontend data source | Use case |
|---|---|---|
| `kv` (recommended default) | `data_js` in KV | Daily use — saves take effect immediately |
| `static` | `data.js` in the repo | Emergency rollback / debugging / read-only display |

You can toggle this from the top of `config.html` with one click, or preview via query parameters:

```
/api/data?format=json                 # Returns the currently active content
/api/data?format=json&source=kv       # Force-preview the KV version
/api/data?format=json&source=static   # Force-preview the static repo version
```

**Automatic fallback**: when `kv` is selected but KV is empty, the system falls back to the repo's `data.js`, and the response includes `X-Data-Source: static-fallback` — ensuring the page is never blank.

---

## 🔑 Authentication (Online Mode)

- On successful login, the server issues a token and sets it as a cookie named `auth`.
- Token format: `base64url(payload).base64url(HMAC-SHA256(payload, AUTH_SECRET))`
- Payload: `{ "u": "<username>", "exp": <millisecond timestamp> }`
- Cookie attributes: `HttpOnly; Secure; SameSite=Strict; Max-Age=604800` (7 days)
- On every request to a protected endpoint, the server:
  1. Reads the `auth` cookie.
  2. Recomputes the signature using `AUTH_SECRET` and compares.
  3. Verifies `exp` has not expired.
  4. Allows the request if valid; otherwise returns `401`.

---

## 📁 Project Structure

```
/
├── index.html              # Bookmark homepage
├── login.html              # Login page
├── config.html             # Admin panel (supports both online & local modes)
├── data.js                 # Static data file (fallback when KV is empty)
├── functions/              # Cloudflare Pages Functions (online-mode API)
│   ├── _shared/
│   │   └── auth.js         # Auth utilities (issue / verify tokens)
│   └── api/
│       ├── login.js        # POST /api/login
│       ├── logout.js       # POST /api/logout
│       ├── data.js         # GET  /api/data
│       ├── save.js         # POST /api/save
│       ├── source.js       # GET/POST /api/source
│       └── backups.js      # Version history management
├── scripts/
│   └── update-timestamp.js # Helper for stamping data.js version/timestamp
├── tools/                  # Built-in utility tools
│   ├── font/               # Fonts used by the tools
│   ├── ydyjsq.html         # Estimation Calculator
│   ├── 9gg3.html           # Poetry 9-Grid Game
│   ├── math3.html          # Daily Math Practice (Grade 3)
│   ├── math3-4.html        # Daily Math Practice (Grade 3 → 4)
│   └── slxzsd.html         # Physiology Knowledge Outline
└── README.md
```

> Directories starting with `_` are **not** treated as routes by Cloudflare Pages — they're used for shared modules.

---

## 🎨 Card Types

| Type | Purpose | Example |
|------|---------|---------|
| `simple` | Entire card is clickable | Regular URL bookmarks |
| `desc-clickable` | Title links to A, description links to B | "GitHub" → homepage; description "My Repos" → repos page |
| `expandable` | Shows multiple sub-cards when expanded | Grouped items, e.g. an "AI Tools" card containing many AI sites |

Sub-cards also support two styles: **two-line** (icon + title + description) and **compact** (icon + single line).

---

## 🧩 API Reference (Online Mode)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/login` | No | Log in; body: `{username, password}` |
| `POST` | `/api/logout` | No | Log out and clear the cookie |
| `GET`  | `/api/data` | No | Returns raw `data.js` text; `?format=json` returns JSON |
| `POST` | `/api/save` | Yes | Save data into KV; body: `{content}` |
| `GET`  | `/api/source` | Yes | Get the current data-source setting |
| `POST` | `/api/source` | Yes | Switch data source; body: `{source: "kv" \| "static"}` |
| `GET`  | `/api/backups` | Yes | List / preview / restore historical versions |

---

## 🖼 Screenshots

### Bookmark Homepage
![Homepage — Notion theme](./screenshot/screenshot1.png)
![Homepage — Framer theme](./screenshot/screenshot2.png)

### Admin Panel
![Admin panel](./screenshot/screenshot6.png)

### Card Editor
![Card editor](./screenshot/screenshot5.png)

---

## 📱 Compatibility

- **Bookmark homepage**: all modern browsers (Chrome / Edge / Firefox / Safari / mobile). Responsive design works on phones, tablets, and desktops.
- **Admin panel (online mode)**: all modern browsers.
- **Admin panel (local mode)**: requires **Chrome 86+ / Edge 86+** (depends on the File System Access API) and must be served over `http://` or `https://` — `file://` is **not** supported.

---

## 🛡️ Security Recommendations

1. **Always set a strong `AUTH_SECRET`** — never leave it at the default.
2. **Use a strong password** for `ADMIN_PASS`, and don't reuse it elsewhere.
3. Mark `ADMIN_USER` / `ADMIN_PASS` / `AUTH_SECRET` all as **Secret** (encrypted) variables.
4. Cloudflare Pages enforces HTTPS by default — don't disable it.
5. If the site is used by multiple people, consider adding a **Cloudflare Access / Zero Trust** policy in front.
6. Rotate `AUTH_SECRET` periodically (note that after rotation, all logged-in devices will need to log in again).
7. **Use a dedicated password for encrypted categories — never reuse your login password**: Encryption uses PBKDF2 (SHA-256, 250,000 iterations) for key derivation + AES-GCM for encryption. Security depends entirely on the strength of your password. If forgotten, **no one (including the author) can recover the data** — be sure to save it in a password manager

---

## 🔒 Privacy

- **Online mode**: all data is stored in your own Cloudflare KV account — nothing passes through any third-party server.
- **Local mode**: data and credentials are kept entirely on your local device; nothing is uploaded.
- **Built-in tools** (password manager, estimation calculator, etc.): all run purely in the browser and never send data to any server.
- The AI Mistake Notebook uses your own Gemini / OpenAI API key — requests go directly from your browser to the provider, not through this site.

---

## ❓ FAQ

**Q1: I saved from the admin panel, but the frontend didn't change. Why?**
A: Check that the KV binding's Variable name is exactly `FAV_KV` (case-sensitive), and that the data source in `config.html` is set to `kv`.

**Q2: Login shows "Server has not configured ADMIN_USER / ADMIN_PASS environment variables".**
A: Go to Pages → Settings → Environment variables, confirm the variables are added to the **Production** environment, and **trigger a fresh deployment** so they take effect.

**Q3: Login succeeds, but I have to log in again after a refresh.**
A: Usually `AUTH_SECRET` changed between requests (e.g. you edited the variable but didn't redeploy, causing inconsistency). Make sure the value is stable and redeploy.

**Q4: Can I develop locally?**
A: Yes — use Cloudflare's official tool [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npm i -g wrangler
wrangler pages dev . --kv FAV_KV
```

Provide environment variables via a `.dev.vars` file.

**Q5: How do I export my data for backup?**
A: Visit `/api/data?format=json` and save the `content` field as `data.js`. You can also download any historical version with one click from the "Version Management" section of the admin panel.

---

## 📝 License

MIT License

---

## 🙏 Acknowledgements

- The Video Aggregator section is based on [MoonTV](https://github.com/gagabba/MoonTV-gas).
- The random-poem feature uses the [Jinrishici API](https://www.jinrishici.com/).
- Some icons come from Emoji sets and the official logos of the respective sites.
- Hosted on [Cloudflare Pages](https://pages.cloudflare.com/) with [Workers KV](https://developers.cloudflare.com/kv/).

---

> If you find this project helpful, please give it a Star ⭐️