# Our Little Booth — Virtual Online Photobooth ♡

A cute, nostalgic, scrapbook-inspired virtual photobooth designed for siblings to take adorable photos together right in their browser, apply authentic retro filters, customize vintage photo strips, and download high-resolution PNG keepsakes.

---

## ✨ Features

- **Cozy Scrapbook Aesthetic**: Warm cream (`#FFF8EF`), blush pink (`#F5D9DC`), and cocoa brown (`#74564A`) theme with delicate paper grain textures, washi tape accents, and floating star/heart doodles.
- **Camera Studio Controls**:
  - Direct integration with `navigator.mediaDevices.getUserMedia()`.
  - Permission requested only after user clicks **Start Camera**.
  - Front / rear camera switching and camera device selector.
  - Horizontal mirror view toggle.
  - Configurable countdown timer: **Off**, **3s**, **5s**, or **10s** with animated numbers.
  - Realistic shutter flash animation and synthesized mechanical shutter audio (via Web Audio API).
  - Review screen with instant **Keep Photo ♡** or **Retake Photo** options.
  - Virtual Sibling Poses (Demo Mode) and photo upload fallback for testing or devices without a physical camera.
- **Photo Session Manager**:
  - Choose between 4-photo strips, 3-photo strips, or 1-photo Polaroid layout.
  - Real-time photo counter (`Photo 2 of 4`) and visual filmstrip thumbnails.
  - Delete or retake any specific photo in the session without losing other snaps.
- **8 Retro & Aesthetic Filters**:
  1. *Original* (Natural authentic look)
  2. *Vintage* (Warm, faded 90s film look with subtle vignette)
  3. *Black & White* (Classic monochrome silver screen)
  4. *Warm Film* (Golden hour amber glow)
  5. *Soft Pink* (Dreamy pastel blush tone)
  6. *Sepia* (Antique Victorian scrapbook brown)
  7. *Cool Tone* (Nostalgic cyan/blue chill tint)
  8. *High Pop* (Punchy saturated vivid contrast)
  - Real-time intensity slider (0% to 100%).
  - Filters are applied directly to the final Canvas drawing operations on export, preserving the raw original frames in memory.
- **High-Resolution Photo Strip Generator**:
  - Layout options: **Classic Vertical 4-Strip**, **Vertical 3-Strip**, **2x2 Photo Grid**, and **Polaroid**.
  - Background color palette: Warm Cream, Blush Pink, Classic White, Vintage Noir Black, Pastel Lavender, and Soft Sage Mint.
  - Vintage film borders, film sprocket holes, and cute washi tape toggles.
  - Adjustable photo spacing slider.
  - Customizable session title, date stamp, and sibling nicknames.
  - Cute sticker packs: Hearts, Stars & Sparkles, Flowers & Daisies, Silly Smiles, or a Cute Mix.
  - Celebration confetti animation when the photo strip is finalized.
- **Export & Download**:
  - One-click client-side download as high-resolution PNG (`our-little-booth-YYYY-MM-DD.png`) using `HTMLCanvasElement.toBlob()`.
  - Download individual photos as separate PNG files.
  - Opt-in server-side gallery save via secure Flask API (`/api/save-strip`), verified by Pillow.
  - Built-in session gallery to view and re-download past strips.

---

## 🛠️ Technology Stack

- **Backend**: Python 3.11+, Flask 3.0+, Pillow (PIL), Werkzeug.
- **Frontend**: HTML5, CSS3 (Modern Flexbox/Grid, CSS Custom Properties, Keyframe Animations), Vanilla JavaScript (ES6+).
- **APIs**: Browser MediaDevices API (`getUserMedia`, `enumerateDevices`), HTML5 Canvas API, Web Audio API.

---

## 🚀 Running the Project Locally (Windows PowerShell)

Follow these exact steps in Windows PowerShell to set up and start the application:

### Step 1: Create Virtual Environment
```powershell
python -m venv .venv
```

### Step 2: Activate Virtual Environment
```powershell
.\.venv\Scripts\Activate.ps1
```
*(Note: If PowerShell displays an execution policy warning, you can run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` before activating).*

### Step 3: Install Dependencies
```powershell
pip install -r requirements.txt
```

### Step 4: Start the Application
```powershell
python app.py
```

### Step 5: Open in Browser
Visit in your web browser:
```text
http://127.0.0.1:5000
```

---

## 🔒 Camera Access & Security Notice (Localhost vs HTTPS)

Modern web browsers enforce strict security policies regarding camera and microphone access:
- **Localhost is a Secure Context**: Opening `http://127.0.0.1:5000` or `http://localhost:5000` is automatically treated as a secure context, allowing full camera access without an SSL certificate.
- **Accessing from Mobile / Another Device on LAN**: If you connect to your machine via an HTTP local network IP (e.g. `http://192.168.1.50:5000`), mobile browsers (Safari on iOS, Chrome on Android) **will block camera permissions** due to standard browser security requirements.
- To use the camera from a phone or other device, either:
  1. Access the booth directly on the computer where it is running, or
  2. Use a secure tunneling tool (such as ngrok or cloudflare tunnel: `cloudflared tunnel --url http://localhost:5000`) to provide an HTTPS endpoint.
- If no physical camera is connected or permission is denied, click **"Use Virtual Sibling Poses (Demo Mode)"** or **"Upload a Photo"** in the studio to test all features with simulated camera streams.

---

## 📁 Project Structure

```text
photoboth/
├── app.py                      # Flask server routes, health check, and secure save API
├── requirements.txt            # Python dependencies (Flask, Pillow, Werkzeug)
├── README.md                   # Complete documentation and run instructions
├── instance/
│   ├── .gitkeep
│   └── saved_strips/           # Opt-in saved photo strips
├── templates/
│   ├── base.html               # Shared layout, fonts, header, floating doodles, footer
│   ├── index.html              # Scrapbook landing page, preview strip, 3-step guide
│   └── booth.html              # Photobooth camera studio, live preview & customizer
└── static/
    ├── css/
    │   └── style.css           # Aesthetic responsive styles, animations, scrapbook theme
    └── js/
        ├── camera.js           # MediaDevices manager, mirror, flip, fallback simulation
        ├── filters.js          # 8 retro filter algorithms (CSS + Canvas export)
        ├── photo-strip.js      # Canvas composition engine (layouts, borders, stickers, export)
        └── photobooth.js       # Session state, countdown, review, audio, and UI controller
```

---

## 🧪 Testing Verification

You can test the application using Python `unittest` or by launching the server:

```powershell
python -m unittest tests/test_app.py
```

All core routes (`/`, `/booth`, `/health`, `/api/save-strip`) have been verified for stability, response status, and security.

---

## ♡ Personal Touches

Made with love for two siblings to preserve their silly poses and childhood memories together!
