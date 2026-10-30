# Little Memories — Dual-Mode Photobooth ♡

> *"Every moment deserves a picture."*

**Little Memories** is a romantic, playful, modern photobooth web application built with Python Flask, WebRTC, HTML5 Canvas, and Vanilla JavaScript. It offers two distinct photobooth modes tailored for couples and friends:

1. **LDR Photobooth (Long-Distance Couple Mode)**: Designed for two participants on different devices and networks (e.g., laptop and mobile phone). Join the same private room, see and hear each other live with peer-to-peer WebRTC, trigger synchronized countdowns, exchange captured frames, review or retake shots, and compose a shared couple photostrip to download as a high-resolution PNG.
2. **Friends Photobooth**:
   - **Local Mode**: Friends gathered together in front of one device camera. Zero setup, instant photoshoot, retro filters, and classic photo strip customizer.
   - **Remote Mode**: Friends in different locations. Group WebRTC room supporting up to 4 participants, synchronized squad poses, individual retakes, and downloadable squad photostrip.

---

## ✨ Key Features

### 1. Dual-Mode Experience
- **LDR Couple Studio (`/ldr` & `/ldr/<room_id>`)**:
  - Private 2-person room with unique shareable invite link (`/ldr/XXXXXX`).
  - Strict 2-participant limit with automatic room code generation or custom code entry.
  - Live bidirectional peer-to-peer WebRTC audio and video streaming.
  - Synchronized countdown with target-timestamp synchronization so both partners capture frames at the exact same millisecond.
  - Local high-resolution frame capture sent over `RTCDataChannel` (chunked base64 transfer) with fallback to REST signaling.
  - Dual review stage: preview both your shot and your partner's shot with instant individual **Retake** or **Keep Shot ♡** actions.
  - Shared customizable photostrip generator combining both partners' snaps into alternating vertical, 2x2 grid, or polaroid strips.

- **Friends Studio — Local Mode (`/booth` & `/friends/local`)**:
  - Single-camera photobooth for in-person gatherings.
  - 8 retro filters, stickers, custom background colors, and instant download.
  - Virtual poses (Demo Mode) and photo upload fallback for testing without a webcam.

- **Friends Studio — Remote Squad Mode (`/friends/remote` & `/friends/remote/<room_id>`)**:
  - Multi-participant WebRTC room supporting up to 4 friends.
  - Dynamic responsive video grid (1-4 feeds).
  - Synchronized squad countdown and automatic frame collection into a squad photostrip.

### 2. Aesthetic Design & Micro-Interactions
- Scrapbook and vintage camera visual language: warm cream (`#FFF8EF`), blush pink (`#F5D9DC`), cocoa brown (`#74564A`), lavender, and white.
- Soft shadows, rounded corners, washi tape accents, and delicate paper textures.
- Studio audio effects synthesized using the Web Audio API (countdown beeps, realistic mechanical camera shutter, celebration chime).
- Canvas confetti particle effects upon finalizing photostrips.
- Responsive mobile & desktop layouts (side-by-side video feeds on desktop, stacked on mobile).

### 3. Retro & Aesthetic Filters (Canvas & Real-Time CSS)
1. **Original** — Natural authentic preview
2. **Vintage** — Faded 90s film look with warm vignette
3. **Black & White** — Classic silver screen monochrome
4. **Warm Film** — Golden hour amber tones
5. **Soft Pink** — Dreamy pastel blush
6. **Sepia** — Victorian antique scrapbook tone
7. **Cool Tone** — Cyan / chilled nostalgic hue
8. **High Pop** — Punchy saturated contrast

### 4. High-Resolution Strip Generator & Customization
- **Layouts**: Classic Vertical 4-Strip, Vertical 3-Strip, 2x2 Grid, and Polaroid.
- **Palette**: Warm Cream, Blush Pink, Classic White, Noir Black, Lavender, and Sage Mint.
- **Cute Stickers**: Hearts, Stars, Flowers, and Silly Smiles.
- **Export**: Client-side lossless PNG export (`HTMLCanvasElement.toBlob()`) with optional individual photo downloads.

---

## 🛠️ Architecture & Vercel Compatibility

- **WebRTC Peer-to-Peer Media**: Video and audio streams flow directly peer-to-peer between devices via Google STUN servers (`stun:stun.l.google.com:19302`). Flask never handles continuous video streams, ensuring minimal latency and zero server bandwidth bottlenecks.
- **Serverless REST Signaling Bridge**: Vercel Serverless Functions do not support persistent WebSockets. To make real-time rooms work seamlessly on Vercel, `app.py` implements a robust REST polling signaling bridge (`/api/rooms/...`) that relays SDP offers, answers, ICE candidates, and countdown events with an 800ms adaptive poll rate.
- **Optional Standalone WebSocket Server**: For persistent VPS, Render, or Railway hosts, `signaling_server.py` is provided for sub-10ms WebSocket signaling.
- **Read-Only Filesystem Safe**: Uses dynamic temporary directory fallback (`/tmp/saved_strips`) on AWS Lambda/Vercel environments.
- **Static Assets Routing**: Assets are served both via Flask's static routes and directly via Vercel's Edge CDN through the mirrored `public/static/` directory.

---

## 🚀 Running Locally (Windows PowerShell)

### Step 1: Create Virtual Environment
```powershell
python -m venv .venv
```

### Step 2: Activate Virtual Environment
```powershell
.\.venv\Scripts\Activate.ps1
```

### Step 3: Install Dependencies
```powershell
pip install -r requirements.txt
```

### Step 4: Run Application
```powershell
python app.py
```

### Step 5: Open in Browser
Visit in your web browser:
```text
http://127.0.0.1:5000
```

---

## 📱 Testing with Two Devices (Laptop & Mobile Phone)

Modern mobile browsers (iOS Safari, Android Chrome) enforce strict security and **block camera and microphone access on non-secure HTTP connections** (except `localhost`).

To test LDR Mode between a laptop and a smartphone on different networks:

### Option A: Using the Deployed Vercel HTTPS URL (Recommended)
1. Open your live Vercel URL on your laptop: `https://your-site.vercel.app`
2. Click **Create LDR Room** and choose a nickname (e.g. `Laptop`).
3. Click **Copy Invite Link** and send the URL (`https://your-site.vercel.app/ldr/XXXXXX`) to your phone.
4. Open the link on your phone browser, enter your partner nickname (e.g. `Mobile`), and tap **Join**.
5. Grant camera permissions on both devices. You will now see and hear each other live!

### Option B: Using an HTTPS Tunnel Locally
Run the app on your laptop (`python app.py`), and in another terminal run a free tunnel tool:
```powershell
cloudflared tunnel --url http://localhost:5000
# or
ngrok http 5000
```
Open the generated HTTPS URL on both your laptop and your mobile device.

---

## 🧪 Running Unit Tests

Run the test suite to verify routes, room limits, and signaling:
```powershell
python -m unittest discover tests
```

---

## 📂 Project Structure

```text
photobooth-website/
├── app.py                      # Flask app, REST signaling bridge & room manager
├── signaling_server.py         # Optional standalone WebSocket signaling server
├── requirements.txt            # Python dependencies (Flask, Pillow, Werkzeug)
├── vercel.json                 # Vercel serverless deployment & static routing config
├── .python-version             # Python 3.12 runtime specification for Vercel
├── templates/
│   ├── base.html               # Little Memories base layout, nav & footer
│   ├── index.html              # Landing page with Dual-Mode cards & room modals
│   ├── booth.html              # Friends Studio (Local Mode)
│   ├── ldr.html                # LDR Couple Studio (2-person WebRTC)
│   └── friends_remote.html     # Remote Friends Studio (up to 4 WebRTC)
├── static/
│   ├── css/
│   │   └── style.css           # Little Memories cozy scrapbook styling
│   └── js/
│       ├── camera.js           # Local webcam & device enumeration helper
│       ├── filters.js          # Retro & aesthetic Canvas image filters
│       ├── photo-strip.js      # Multi-layout Canvas photo strip generator
│       ├── photobooth.js       # Local booth controller
│       ├── webrtc-room.js      # WebRTC peer connection & signaling client
│       ├── ldr-booth.js        # LDR couple studio client orchestrator
│       └── friends-booth.js    # Remote friends squad client orchestrator
├── public/                     # Mirrored static assets for Vercel CDN
└── tests/
    └── test_app.py             # 9 unit tests covering routes, rooms & signaling
```

---

## 📄 License & Privacy Notice

Photos taken in Little Memories are processed and composed entirely inside your browser using the HTML5 Canvas API. Video and audio streams in LDR and Remote Friends modes travel peer-to-peer directly between your devices. No camera footage is uploaded to or stored on our servers.
