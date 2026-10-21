/**
 * OUR LITTLE BOOTH — MAIN PHOTOBOOTH CONTROLLER
 * Coordinates Camera, Filters, Canvas Strip Generation, Countdown, Audio,
 * Thumbnails, and Modals.
 */

document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------------------
    // Synthesized Web Audio Sound Effects (100% reliable, zero external MP3s)
    // -------------------------------------------------------------------------
    const SoundEffects = {
        ctx: null,
        init() {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) this.ctx = new AudioCtx();
            }
        },
        playBeep(freq = 440, type = 'sine', duration = 0.1) {
            try {
                this.init();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') this.ctx.resume();

                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
                gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start();
                osc.stop(this.ctx.currentTime + duration);
            } catch (e) {
                console.warn('Audio notice:', e);
            }
        },
        playShutter() {
            try {
                this.init();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') this.ctx.resume();

                // Realistic camera mechanical click
                const bufferSize = this.ctx.sampleRate * 0.12;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.02));
                }
                const noise = this.ctx.createBufferSource();
                noise.buffer = buffer;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 1200;
                noise.connect(filter);
                filter.connect(this.ctx.destination);
                noise.start();
            } catch (e) {
                console.warn('Audio notice:', e);
            }
        },
        playSuccess() {
            // Cute cheerful rising chime
            this.playBeep(523.25, 'triangle', 0.1); // C5
            setTimeout(() => this.playBeep(659.25, 'triangle', 0.1), 100); // E5
            setTimeout(() => this.playBeep(783.99, 'triangle', 0.2), 200); // G5
        }
    };

    // -------------------------------------------------------------------------
    // Confetti Celebration Generator
    // -------------------------------------------------------------------------
    const Confetti = {
        canvas: document.getElementById('confetti-canvas'),
        particles: [],
        animId: null,
        fire() {
            if (!this.canvas) return;
            this.canvas.classList.remove('is-hidden');
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            const ctx = this.canvas.getContext('2d');
            this.particles = [];

            const colors = ['#F5D9DC', '#E8B4B8', '#74564A', '#E8E2F5', '#E2ECE4', '#D4AF37', '#FFFFFF'];
            for (let i = 0; i < 90; i++) {
                this.particles.push({
                    x: window.innerWidth * 0.5 + (Math.random() * 200 - 100),
                    y: window.innerHeight * 0.35,
                    vx: (Math.random() - 0.5) * 16,
                    vy: Math.random() * -12 - 4,
                    size: Math.random() * 10 + 6,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    rotation: Math.random() * 360,
                    rotationSpeed: (Math.random() - 0.5) * 12,
                    opacity: 1
                });
            }

            let start = Date.now();
            const animate = () => {
                const elapsed = Date.now() - start;
                ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

                let aliveCount = 0;
                for (const p of this.particles) {
                    p.x += p.vx;
                    p.y += p.vy;
                    p.vy += 0.35; // gravity
                    p.rotation += p.rotationSpeed;
                    p.opacity = Math.max(0, 1 - elapsed / 3000);

                    if (p.opacity > 0) {
                        aliveCount++;
                        ctx.save();
                        ctx.globalAlpha = p.opacity;
                        ctx.translate(p.x, p.y);
                        ctx.rotate((p.rotation * Math.PI) / 180);
                        ctx.fillStyle = p.color;
                        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                        ctx.restore();
                    }
                }

                if (aliveCount > 0 && elapsed < 3200) {
                    this.animId = requestAnimationFrame(animate);
                } else {
                    this.canvas.classList.add('is-hidden');
                }
            };

            cancelAnimationFrame(this.animId);
            animate();
        }
    };

    // -------------------------------------------------------------------------
    // Toast Messenger
    // -------------------------------------------------------------------------
    function showToast(message, icon = '♡') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

    // -------------------------------------------------------------------------
    // DOM Elements
    // -------------------------------------------------------------------------
    const videoElem = document.getElementById('webcam-video');
    const reviewCanvas = document.getElementById('review-canvas');
    const flashOverlay = document.getElementById('camera-flash');
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownNumber = document.getElementById('countdown-number');
    const idleScreen = document.getElementById('camera-idle-screen');
    const errorScreen = document.getElementById('camera-error-screen');
    const cameraErrorMsg = document.getElementById('camera-error-message');
    const reviewActionOverlay = document.getElementById('review-action-overlay');
    const sessionStatusText = document.getElementById('session-status-text');

    // Controls
    const btnStartCamera = document.getElementById('btn-start-camera');
    const btnRetryCamera = document.getElementById('btn-retry-camera');
    const btnMockMode = document.getElementById('btn-use-mock-mode');
    const btnFallbackError = document.getElementById('btn-fallback-from-error');
    const uploadInput = document.getElementById('upload-photo-input');

    const btnToggleMirror = document.getElementById('btn-toggle-mirror');
    const btnFlipCamera = document.getElementById('btn-flip-camera');
    const cameraDeviceSelect = document.getElementById('camera-device-select');
    const btnCapturePhoto = document.getElementById('btn-capture-photo');
    const btnKeepPhoto = document.getElementById('btn-keep-photo');
    const btnRetakePhoto = document.getElementById('btn-retake-photo');
    const btnResetSession = document.getElementById('btn-reset-session');

    // Sidebar & Strip UI
    const photoProgressBadge = document.getElementById('photo-progress-badge');
    const thumbnailsContainer = document.getElementById('thumbnails-container');
    const btnGenerateStripNow = document.getElementById('btn-generate-strip-now');
    const formatButtons = document.querySelectorAll('.format-btn');
    const timerButtons = document.querySelectorAll('.timer-opt');

    // Filter controls
    const filtersGrid = document.getElementById('filters-grid');
    const activeFilterLabel = document.getElementById('active-filter-label');
    const filterIntensitySlider = document.getElementById('filter-intensity-slider');
    const intensityVal = document.getElementById('intensity-val');

    // Customizer controls
    const cameraStage = document.getElementById('camera-stage');
    const stripStage = document.getElementById('strip-stage');
    const photoStripCanvas = document.getElementById('photo-strip-canvas');
    const btnBackToCamera = document.getElementById('btn-back-to-camera');
    const btnDownloadStrip = document.getElementById('btn-download-strip');
    const btnDownloadSingles = document.getElementById('btn-download-singles');
    const btnSaveServerOptin = document.getElementById('btn-save-server-optin');
    const btnViewGallery = document.getElementById('btn-view-gallery');

    const colorSwatches = document.querySelectorAll('.color-swatch');
    const layoutButtons = document.querySelectorAll('.layout-opt-btn');
    const toggleSprockets = document.getElementById('toggle-film-sprockets');
    const toggleRounded = document.getElementById('toggle-rounded-corners');
    const toggleWashiTape = document.getElementById('toggle-washi-tape');
    const toggleDateStamp = document.getElementById('toggle-date-stamp');
    const spacingSlider = document.getElementById('spacing-slider');
    const spacingVal = document.getElementById('spacing-val');
    const sessionTitleInput = document.getElementById('session-title-input');
    const siblingsNicknamesInput = document.getElementById('siblings-nicknames-input');
    const sessionFooterInput = document.getElementById('session-footer-input');
    const toggleStickers = document.getElementById('toggle-stickers-enabled');
    const stickerChips = document.querySelectorAll('.sticker-chip');

    // Modals
    const galleryModal = document.getElementById('gallery-modal');
    const btnCloseGallery = document.getElementById('btn-close-gallery');
    const btnDoneGallery = document.getElementById('btn-done-gallery');
    const btnClearLocalGallery = document.getElementById('btn-clear-local-gallery');
    const galleryGrid = document.getElementById('gallery-grid');
    const galleryEmptyState = document.getElementById('gallery-empty-state');

    const resetModal = document.getElementById('reset-confirm-modal');
    const btnCancelReset = document.getElementById('btn-cancel-reset');
    const btnConfirmReset = document.getElementById('btn-confirm-reset');

    // -------------------------------------------------------------------------
    // Session State
    // -------------------------------------------------------------------------
    const state = {
        targetCount: 4, // 3, 4, or 1
        photos: [], // Array of { canvas, isMirrored, timestamp }
        pendingCapturedFrame: null, // Temporary frame under review
        countdownSeconds: 3,
        isCountingDown: false,
        activeFilter: 'vintage',
        filterIntensity: 85,
        layout: 'vertical-4',
        bgColor: '#FFF8EF',
        spacing: 30,
        hasSprockets: true,
        hasRoundedCorners: true,
        hasWashiTape: true,
        hasDateStamp: true,
        stickersEnabled: true,
        stickerSet: 'hearts',
        sessionTitle: 'our little booth ♡',
        nicknames: 'Ahmad & Sis',
        footerText: 'our little memories ♡'
    };

    // Set today's date label
    const todayDateElem = document.getElementById('today-date-text');
    if (todayDateElem) {
        todayDateElem.textContent = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    }

    // -------------------------------------------------------------------------
    // Camera Manager Setup
    // -------------------------------------------------------------------------
    const camera = new CameraManager(videoElem, {
        onStreamReady: (stream) => {
            idleScreen.classList.add('is-hidden');
            errorScreen.classList.add('is-hidden');
            sessionStatusText.textContent = camera.isMockMode ? 'Virtual Poses Live' : 'Camera Live';
            btnCapturePhoto.disabled = false;
            updateFilterDisplay();
        },
        onError: (err) => {
            idleScreen.classList.add('is-hidden');
            errorScreen.classList.remove('is-hidden');
            sessionStatusText.textContent = 'Camera Error';
            btnCapturePhoto.disabled = true;

            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                cameraErrorMsg.textContent = 'Camera permission was denied. Please allow camera access in your browser address bar.';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                cameraErrorMsg.textContent = 'No camera device found on this system. You can use our Virtual Sibling Poses mode!';
            } else if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                cameraErrorMsg.textContent = 'Webcams are blocked on plain HTTP networks. Please access via http://127.0.0.1:5000 or HTTPS.';
            } else {
                cameraErrorMsg.textContent = `Could not start camera (${err.message || err.name}). Try clicking retry or test with Virtual Poses!`;
            }
        },
        onDeviceChange: (devices, currentId) => {
            if (!cameraDeviceSelect) return;
            cameraDeviceSelect.innerHTML = '';
            if (devices.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'Default Camera';
                cameraDeviceSelect.appendChild(opt);
                return;
            }
            devices.forEach((d, idx) => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `Camera ${idx + 1}`;
                if (d.deviceId === currentId) opt.selected = true;
                cameraDeviceSelect.appendChild(opt);
            });
        }
    });

    // -------------------------------------------------------------------------
    // Filter UI Population & Real-time Update
    // -------------------------------------------------------------------------
    function initFiltersUI() {
        if (!filtersGrid) return;
        filtersGrid.innerHTML = '';
        const filterList = PhotoFilters.getFilterList();

        filterList.forEach(f => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `filter-item-btn ${f.id === state.activeFilter ? 'active' : ''}`;
            btn.dataset.filterId = f.id;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', f.id === state.activeFilter);

            // Miniature circle with preview emoji and filter
            const circle = document.createElement('span');
            circle.className = 'filter-preview-circle';
            circle.style.filter = PhotoFilters.getCssFilter(f.id, 85);
            circle.style.background = '#FFEAD7';
            circle.textContent = f.icon;

            const name = document.createElement('span');
            name.className = 'filter-title';
            name.textContent = f.name;

            btn.appendChild(circle);
            btn.appendChild(name);

            btn.addEventListener('click', () => {
                state.activeFilter = f.id;
                document.querySelectorAll('.filter-item-btn').forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-checked', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-checked', 'true');
                if (activeFilterLabel) activeFilterLabel.textContent = f.name;

                updateFilterDisplay();
                // If strip is currently open, re-render immediately
                if (!stripStage.classList.contains('is-hidden')) {
                    renderPhotoStrip();
                }
            });

            filtersGrid.appendChild(btn);
        });
    }

    function updateFilterDisplay() {
        const cssFilter = PhotoFilters.getCssFilter(state.activeFilter, state.filterIntensity);
        if (videoElem) {
            videoElem.style.filter = cssFilter;
        }
        if (reviewCanvas) {
            reviewCanvas.style.filter = cssFilter;
        }
    }

    // -------------------------------------------------------------------------
    // Thumbnails & Session Tracker
    // -------------------------------------------------------------------------
    function updateThumbnailsUI() {
        if (!thumbnailsContainer) return;
        thumbnailsContainer.innerHTML = '';

        for (let i = 0; i < state.targetCount; i++) {
            const slot = document.createElement('div');
            slot.className = 'thumb-slot';

            if (state.photos[i]) {
                slot.classList.add('filled');
                const img = document.createElement('img');
                img.className = 'thumb-img';
                img.src = state.photos[i].canvas.toDataURL('image/jpeg', 0.85);
                img.style.filter = PhotoFilters.getCssFilter(state.activeFilter, state.filterIntensity);
                slot.appendChild(img);

                // Quick retake/delete button for this individual photo
                const delBtn = document.createElement('button');
                delBtn.className = 'thumb-delete-btn';
                delBtn.title = `Retake Photo ${i + 1}`;
                delBtn.innerHTML = '&times;';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removePhotoAt(i);
                });
                slot.appendChild(delBtn);
            } else {
                if (i === state.photos.length) {
                    slot.classList.add('current-active');
                }
                const num = document.createElement('span');
                num.className = 'thumb-placeholder-num';
                num.textContent = `${i + 1}`;
                slot.appendChild(num);
            }

            thumbnailsContainer.appendChild(slot);
        }

        // Progress badge text
        const currentIdx = Math.min(state.photos.length + 1, state.targetCount);
        if (photoProgressBadge) {
            photoProgressBadge.textContent = state.photos.length >= state.targetCount
                ? 'All Photos Captured! ✨'
                : `Photo ${currentIdx} of ${state.targetCount}`;
        }

        // Enable or disable the "Create My Photo Strip" button
        if (btnGenerateStripNow) {
            const isReady = (state.photos.length >= 1);
            btnGenerateStripNow.disabled = !isReady;
            if (state.photos.length >= state.targetCount) {
                btnGenerateStripNow.classList.add('pulse-hover');
            } else {
                btnGenerateStripNow.classList.remove('pulse-hover');
            }
        }
    }

    function removePhotoAt(index) {
        state.photos.splice(index, 1);
        updateThumbnailsUI();
        showToast(`Photo ${index + 1} removed. Ready to retake!`, '📸');
        // Return to camera stage if in strip stage
        switchToCameraStage();
    }

    // -------------------------------------------------------------------------
    // Capture & Countdown Workflow
    // -------------------------------------------------------------------------
    async function startCaptureSequence() {
        if (state.isCountingDown) return;
        if (!camera.isActive && !camera.isMockMode) {
            showToast('Please start the camera first!', '⚠️');
            return;
        }

        if (state.photos.length >= state.targetCount) {
            showToast(`You have captured all ${state.targetCount} photos! You can create your strip now or remove a photo to retake.`, '✨');
            return;
        }

        const duration = state.countdownSeconds;

        if (duration === 0) {
            // Instant capture
            executeInstantCapture();
            return;
        }

        state.isCountingDown = true;
        btnCapturePhoto.disabled = true;
        countdownOverlay.classList.remove('is-hidden');

        let remaining = duration;
        countdownNumber.textContent = remaining;
        SoundEffects.playBeep(440, 'sine', 0.08);

        const countdownInterval = setInterval(() => {
            remaining--;
            if (remaining > 0) {
                countdownNumber.textContent = remaining;
                SoundEffects.playBeep(440, 'sine', 0.08);
            } else {
                clearInterval(countdownInterval);
                countdownNumber.textContent = '📸';
                document.getElementById('countdown-smile').textContent = 'SMILE! ♡';
                SoundEffects.playBeep(880, 'sine', 0.15);

                setTimeout(() => {
                    countdownOverlay.classList.add('is-hidden');
                    document.getElementById('countdown-smile').textContent = 'Get Ready! ♡';
                    executeInstantCapture();
                    state.isCountingDown = false;
                    btnCapturePhoto.disabled = false;
                }, 350);
            }
        }, 1000);
    }

    function executeInstantCapture() {
        // 1. Shutter sound
        SoundEffects.playShutter();

        // 2. Visual flash animation
        flashOverlay.classList.remove('flash-active');
        void flashOverlay.offsetWidth; // trigger reflow
        flashOverlay.classList.add('flash-active');

        // 3. Freeze captured frame
        try {
            const captured = camera.captureFrame();
            state.pendingCapturedFrame = captured;

            // Draw to review canvas
            reviewCanvas.width = captured.width;
            reviewCanvas.height = captured.height;
            const rCtx = reviewCanvas.getContext('2d');
            rCtx.save();
            if (captured.isMirrored) {
                rCtx.translate(captured.width, 0);
                rCtx.scale(-1, 1);
            }
            rCtx.drawImage(captured.canvas, 0, 0);
            rCtx.restore();

            // Show review overlay
            reviewCanvas.classList.remove('is-hidden');
            reviewActionOverlay.classList.remove('is-hidden');
            btnCapturePhoto.disabled = true;
        } catch (e) {
            console.error('Capture failed:', e);
            showToast('Could not capture frame. Please retry.', '⚠️');
        }
    }

    function keepCapturedPhoto() {
        if (!state.pendingCapturedFrame) return;

        state.photos.push(state.pendingCapturedFrame);
        state.pendingCapturedFrame = null;

        // Hide review
        reviewCanvas.classList.add('is-hidden');
        reviewActionOverlay.classList.add('is-hidden');
        btnCapturePhoto.disabled = false;

        SoundEffects.playSuccess();
        updateThumbnailsUI();

        if (state.photos.length >= state.targetCount) {
            showToast(`All ${state.targetCount} photos captured! Generating strip...`, '✨');
            setTimeout(() => {
                switchToStripStage();
            }, 600);
        } else {
            showToast(`Photo ${state.photos.length} kept! Next pose ready.`, '♡');
        }
    }

    function retakeCapturedPhoto() {
        state.pendingCapturedFrame = null;
        reviewCanvas.classList.add('is-hidden');
        reviewActionOverlay.classList.add('is-hidden');
        btnCapturePhoto.disabled = false;
        showToast('Photo discarded. Ready to retake!', '📸');
    }

    // -------------------------------------------------------------------------
    // Switching Stages (Camera <--> Photo Strip Customizer)
    // -------------------------------------------------------------------------
    function switchToStripStage() {
        if (state.photos.length === 0) {
            showToast('Please take at least one photo first!', '📸');
            return;
        }

        cameraStage.classList.add('is-hidden');
        stripStage.classList.remove('is-hidden');
        renderPhotoStrip();
        Confetti.fire();
        SoundEffects.playSuccess();

        // Scroll smoothly to strip stage
        stripStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function switchToCameraStage() {
        stripStage.classList.add('is-hidden');
        cameraStage.classList.remove('is-hidden');
        updateThumbnailsUI();
    }

    async function renderPhotoStrip() {
        if (!photoStripCanvas) return;

        await PhotoStripGenerator.renderStrip(photoStripCanvas, {
            photos: state.photos,
            layout: state.layout,
            filterId: state.activeFilter,
            filterIntensity: state.filterIntensity,
            bgColor: state.bgColor,
            spacing: state.spacing,
            hasSprockets: state.hasSprockets,
            hasRoundedCorners: state.hasRoundedCorners,
            hasWashiTape: state.hasWashiTape,
            hasDateStamp: state.hasDateStamp,
            sessionTitle: state.sessionTitle,
            nicknames: state.nicknames,
            footerText: state.footerText,
            stickersEnabled: state.stickersEnabled,
            stickerSet: state.stickerSet
        });
    }

    // -------------------------------------------------------------------------
    // Downloads & Server Opt-in Save
    // -------------------------------------------------------------------------
    async function downloadStrip() {
        if (!photoStripCanvas) return;
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `our-little-booth-${dateStr}.png`;

        try {
            await PhotoStripGenerator.downloadCanvasAsPng(photoStripCanvas, filename);
            showToast('Photo strip downloaded successfully! ♡', '🎉');
            saveToSessionGalleryLocal(photoStripCanvas.toDataURL('image/png'));
        } catch (e) {
            console.error('Download error:', e);
            showToast('Could not download photo strip', '⚠️');
        }
    }

    async function downloadIndividualPhotos() {
        if (state.photos.length === 0) {
            showToast('No photos to download', '⚠️');
            return;
        }

        try {
            for (let i = 0; i < state.photos.length; i++) {
                await PhotoStripGenerator.downloadSinglePhoto(
                    state.photos[i],
                    state.activeFilter,
                    state.filterIntensity,
                    i + 1
                );
            }
            showToast(`Downloaded ${state.photos.length} individual photos! ♡`, '📷');
        } catch (e) {
            console.error('Individual download error:', e);
            showToast('Error downloading photos', '⚠️');
        }
    }

    async function saveToServerOptin() {
        if (!photoStripCanvas) return;
        const base64Data = photoStripCanvas.toDataURL('image/png');

        showToast('Saving strip to server gallery...', '⏳');

        try {
            const resp = await fetch('/api/save-strip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: base64Data,
                    title: state.sessionTitle || 'our-little-strip',
                    layout: state.layout
                })
            });

            const result = await resp.json();
            if (resp.ok && result.success) {
                showToast('Safely saved to local server gallery! ♡', '💾');
                saveToSessionGalleryLocal(base64Data);
            } else {
                throw new Error(result.error || 'Server error');
            }
        } catch (e) {
            console.error('Server save error:', e);
            showToast('Server save failed. Downloading locally instead.', '⚠️');
            downloadStrip();
        }
    }

    // -------------------------------------------------------------------------
    // Session Gallery Modal (localStorage + server gallery)
    // -------------------------------------------------------------------------
    function saveToSessionGalleryLocal(dataUrl) {
        try {
            let gallery = JSON.parse(localStorage.getItem('our_little_booth_gallery') || '[]');
            gallery.unshift({
                id: Date.now(),
                url: dataUrl,
                date: new Date().toLocaleDateString()
            });
            // Keep recent 12
            gallery = gallery.slice(0, 12);
            localStorage.setItem('our_little_booth_gallery', JSON.stringify(gallery));
        } catch (e) {
            console.warn('localStorage gallery notice:', e);
        }
    }

    function openGalleryModal() {
        if (!galleryModal) return;
        galleryModal.classList.remove('is-hidden');
        renderGalleryItems();
    }

    function closeGalleryModal() {
        if (galleryModal) galleryModal.classList.add('is-hidden');
    }

    function renderGalleryItems() {
        if (!galleryGrid || !galleryEmptyState) return;
        galleryGrid.innerHTML = '';

        let items = [];
        try {
            items = JSON.parse(localStorage.getItem('our_little_booth_gallery') || '[]');
        } catch (e) {
            items = [];
        }

        if (items.length === 0) {
            galleryEmptyState.classList.remove('is-hidden');
            return;
        }

        galleryEmptyState.classList.add('is-hidden');
        items.forEach((item, idx) => {
            const card = document.createElement('div');
            card.className = 'gallery-item-card';

            const img = document.createElement('img');
            img.className = 'gallery-thumb-img';
            img.src = item.url;
            img.alt = `Saved Strip ${idx + 1}`;

            const link = document.createElement('a');
            link.className = 'gallery-download-link';
            link.href = item.url;
            link.download = `our-little-booth-saved-${idx + 1}.png`;
            link.textContent = 'Download PNG';

            card.appendChild(img);
            card.appendChild(link);
            galleryGrid.appendChild(card);
        });
    }

    // -------------------------------------------------------------------------
    // Reset Session Workflow
    // -------------------------------------------------------------------------
    function openResetModal() {
        if (resetModal) resetModal.classList.remove('is-hidden');
    }

    function closeResetModal() {
        if (resetModal) resetModal.classList.add('is-hidden');
    }

    function confirmResetSession() {
        state.photos = [];
        state.pendingCapturedFrame = null;
        reviewCanvas.classList.add('is-hidden');
        reviewActionOverlay.classList.add('is-hidden');
        closeResetModal();
        updateThumbnailsUI();
        switchToCameraStage();
        showToast('Session reset. Ready for new memories! ♡', '✨');
    }

    // -------------------------------------------------------------------------
    // Event Listeners Binding
    // -------------------------------------------------------------------------

    // Start Camera Button
    btnStartCamera.addEventListener('click', async () => {
        try {
            await camera.start();
        } catch (e) {
            // Handled in onError callback
        }
    });

    btnRetryCamera.addEventListener('click', async () => {
        try {
            await camera.start();
        } catch (e) {
            // Handled in onError callback
        }
    });

    // Mock Mode & Upload Fallbacks
    btnMockMode.addEventListener('click', () => {
        camera.startMockMode();
    });

    btnFallbackError.addEventListener('click', () => {
        errorScreen.classList.add('is-hidden');
        camera.startMockMode();
    });

    uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                camera.startMockMode(img);
                showToast('Uploaded photo loaded into booth!', '📸');
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    // Mirror & Flip
    btnToggleMirror.addEventListener('click', () => {
        const isMirrored = camera.toggleMirror();
        btnToggleMirror.classList.toggle('active', isMirrored);
        btnToggleMirror.setAttribute('aria-pressed', isMirrored);
        showToast(isMirrored ? 'Mirror view ON' : 'Mirror view OFF', '🪞');
    });

    btnFlipCamera.addEventListener('click', async () => {
        try {
            await camera.flipCamera();
            btnToggleMirror.classList.toggle('active', camera.isMirrored);
            showToast('Switched camera!', '🔄');
        } catch (e) {
            showToast('Could not flip camera', '⚠️');
        }
    });

    cameraDeviceSelect.addEventListener('change', async (e) => {
        try {
            await camera.switchCameraDevice(e.target.value);
            showToast('Camera changed', '📹');
        } catch (err) {
            showToast('Error switching camera', '⚠️');
        }
    });

    // Capture & Review
    btnCapturePhoto.addEventListener('click', startCaptureSequence);
    btnKeepPhoto.addEventListener('click', keepCapturedPhoto);
    btnRetakePhoto.addEventListener('click', retakeCapturedPhoto);

    // Keyboard Shortcuts: Spacebar to capture, Escape for modals
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space') {
            e.preventDefault();
            if (!reviewActionOverlay.classList.contains('is-hidden')) {
                keepCapturedPhoto();
            } else if (!cameraStage.classList.contains('is-hidden')) {
                startCaptureSequence();
            }
        } else if (e.code === 'Escape') {
            closeGalleryModal();
            closeResetModal();
        }
    });

    // Countdown buttons
    timerButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            timerButtons.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-checked', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-checked', 'true');
            state.countdownSeconds = parseInt(btn.dataset.seconds, 10);
            showToast(`Countdown set to ${btn.textContent}`, '⏱️');
        });
    });

    // Format buttons (3, 4, 1)
    formatButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            formatButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const count = parseInt(btn.dataset.count, 10);
            state.targetCount = count;

            if (count === 3) state.layout = 'vertical-3';
            else if (count === 4) state.layout = 'vertical-4';
            else if (count === 1) state.layout = 'polaroid-single';

            // Sync layout buttons in customizer
            layoutButtons.forEach(lb => {
                lb.classList.toggle('active', lb.dataset.layout === state.layout);
            });

            updateThumbnailsUI();
            if (!stripStage.classList.contains('is-hidden')) {
                renderPhotoStrip();
            }
        });
    });

    // Filter intensity slider
    filterIntensitySlider.addEventListener('input', (e) => {
        state.filterIntensity = parseInt(e.target.value, 10);
        if (intensityVal) intensityVal.textContent = `${state.filterIntensity}%`;
        updateFilterDisplay();
        if (!stripStage.classList.contains('is-hidden')) {
            renderPhotoStrip();
        }
    });

    // Layout buttons in customizer
    layoutButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            layoutButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.layout = btn.dataset.layout;

            if (state.layout === 'vertical-3') state.targetCount = 3;
            else if (state.layout === 'vertical-4') state.targetCount = 4;
            else if (state.layout === 'polaroid-single') state.targetCount = 1;
            else if (state.layout === 'grid-2x2') state.targetCount = 4;

            // Sync format buttons
            formatButtons.forEach(fb => {
                fb.classList.toggle('active', parseInt(fb.dataset.count, 10) === state.targetCount);
            });

            updateThumbnailsUI();
            renderPhotoStrip();
        });
    });

    // Background color swatches
    colorSwatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            colorSwatches.forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            state.bgColor = swatch.dataset.color;
            renderPhotoStrip();
        });
    });

    // Frame style toggles
    toggleSprockets.addEventListener('change', (e) => {
        state.hasSprockets = e.target.checked;
        renderPhotoStrip();
    });

    toggleRounded.addEventListener('change', (e) => {
        state.hasRoundedCorners = e.target.checked;
        renderPhotoStrip();
    });

    toggleWashiTape.addEventListener('change', (e) => {
        state.hasWashiTape = e.target.checked;
        renderPhotoStrip();
    });

    toggleDateStamp.addEventListener('change', (e) => {
        state.hasDateStamp = e.target.checked;
        renderPhotoStrip();
    });

    spacingSlider.addEventListener('input', (e) => {
        state.spacing = parseInt(e.target.value, 10);
        if (spacingVal) {
            spacingVal.textContent = state.spacing < 20 ? 'Tight' : state.spacing > 45 ? 'Spacious' : 'Medium';
        }
        renderPhotoStrip();
    });

    // Text inputs
    sessionTitleInput.addEventListener('input', (e) => {
        state.sessionTitle = e.target.value;
        renderPhotoStrip();
    });

    siblingsNicknamesInput.addEventListener('input', (e) => {
        state.nicknames = e.target.value;
        renderPhotoStrip();
    });

    sessionFooterInput.addEventListener('input', (e) => {
        state.footerText = e.target.value;
        renderPhotoStrip();
    });

    // Stickers
    toggleStickers.addEventListener('change', (e) => {
        state.stickersEnabled = e.target.checked;
        renderPhotoStrip();
    });

    stickerChips.forEach(chip => {
        chip.addEventListener('click', () => {
            stickerChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.stickerSet = chip.dataset.stickerSet;
            state.stickersEnabled = true;
            toggleStickers.checked = true;
            renderPhotoStrip();
        });
    });

    // Strip actions
    btnGenerateStripNow.addEventListener('click', switchToStripStage);
    btnBackToCamera.addEventListener('click', switchToCameraStage);
    btnDownloadStrip.addEventListener('click', downloadStrip);
    btnDownloadSingles.addEventListener('click', downloadIndividualPhotos);
    btnSaveServerOptin.addEventListener('click', saveToServerOptin);

    // Modals
    btnResetSession.addEventListener('click', openResetModal);
    btnCancelReset.addEventListener('click', closeResetModal);
    btnConfirmReset.addEventListener('click', confirmResetSession);

    btnViewGallery.addEventListener('click', openGalleryModal);
    btnCloseGallery.addEventListener('click', closeGalleryModal);
    btnDoneGallery.addEventListener('click', closeGalleryModal);
    btnClearLocalGallery.addEventListener('click', () => {
        localStorage.removeItem('our_little_booth_gallery');
        renderGalleryItems();
        showToast('Local gallery cleared', '🗑️');
    });

    // Click outside modal box to close
    [galleryModal, resetModal].forEach(modal => {
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('is-hidden');
            }
        });
    });

    // Initializations
    initFiltersUI();
    updateThumbnailsUI();
});
