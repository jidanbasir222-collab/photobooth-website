/**
 * LITTLE MEMORIES — LDR PHOTOBOOTH CONTROLLER
 * Coordinates 2-person WebRTC video/audio call, synchronized countdown,
 * dual frame exchange, retakes, and couple photostrip generation.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Sound Effects
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
            } catch (e) {}
        },
        playShutter() {
            try {
                this.init();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') this.ctx.resume();
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
            } catch (e) {}
        },
        playSuccess() {
            this.playBeep(523.25, 'triangle', 0.1);
            setTimeout(() => this.playBeep(659.25, 'triangle', 0.1), 100);
            setTimeout(() => this.playBeep(783.99, 'triangle', 0.2), 200);
        }
    };

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

    // Confetti
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
                    p.vy += 0.35;
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

    // State
    const urlParams = new URLSearchParams(window.location.search);
    let roomId = window.INITIAL_ROOM_ID || urlParams.get('room') || window.location.pathname.split('/').pop();
    if (roomId === 'ldr') roomId = '';

    let peerId = urlParams.get('peer_id') || '';
    let nickname = urlParams.get('name') || localStorage.getItem('ldr_nickname') || 'Partner';
    let isHost = !!urlParams.get('peer_id'); // Created via create modal
    let partnerName = 'Sweetheart';

    const state = {
        targetShots: 4,
        currentShotIndex: 0,
        countdownSeconds: 3,
        isCountingDown: false,
        activeFilter: 'vintage',
        filterIntensity: 85,
        layout: 'vertical-4',
        bgColor: '#FFF8EF',
        spacing: 30,
        isReady: false,
        partnerReady: false,
        capturedPairs: [], // array of { local: Canvas, remote: Canvas }
        pendingShot: { local: null, remote: null }
    };

    // DOM Elements
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    const localPlaceholder = document.getElementById('local-placeholder');
    const remotePlaceholder = document.getElementById('remote-placeholder');
    const remotePlaceholderText = document.getElementById('remote-placeholder-text');
    const localNickDisplay = document.getElementById('local-nickname-display');
    const remoteNickDisplay = document.getElementById('remote-nickname-display');
    const sessionStatusText = document.getElementById('session-status-text');
    const connectionDot = document.getElementById('connection-dot');
    const copyBtnText = document.getElementById('copy-btn-text');
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownNumber = document.getElementById('countdown-number');
    const flashOverlay = document.getElementById('camera-flash');
    const reviewPanel = document.getElementById('review-action-panel');
    const thumbnailsContainer = document.getElementById('thumbnails-container');
    const btnGenerateStrip = document.getElementById('btn-generate-strip-now');
    const cameraStage = document.getElementById('camera-stage');
    const stripStage = document.getElementById('strip-stage');
    const photoStripCanvas = document.getElementById('photo-strip-canvas');

    localNickDisplay.textContent = nickname;

    // Room Manager
    let webrtc = null;

    async function initRoom() {
        if (!roomId) {
            // Prompt to create or join room
            const code = prompt('Enter LDR Room Code (or leave empty to create new room):', '');
            if (code && code.trim()) {
                roomId = code.trim();
            } else {
                // Auto-create room
                const resp = await fetch('/api/rooms/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'ldr', nickname: nickname })
                });
                const d = await resp.json();
                roomId = d.room_id;
                peerId = d.peer_id;
                isHost = true;
            }
        }

        // If not already registered peerId, join room
        if (!peerId) {
            const joinResp = await fetch(`/api/rooms/${roomId}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname: nickname })
            });
            const joinData = await joinResp.json();
            if (!joinResp.ok) {
                alert(joinData.error || 'Failed to join room');
                window.location.href = '/';
                return;
            }
            peerId = joinData.peer_id;
            isHost = false;
        }

        sessionStatusText.textContent = `Room: ${roomId}`;
        connectionDot.className = 'badge-dot';

        webrtc = new WebRTCRoomManager({
            roomId: roomId,
            peerId: peerId,
            nickname: nickname,
            mode: 'ldr',
            isHost: isHost,
            onPeerJoined: (remoteId, name) => {
                partnerName = name;
                remoteNickDisplay.textContent = name;
                remotePlaceholder.classList.add('is-hidden');
                sessionStatusText.textContent = `Connected with ${name} ❤️`;
                connectionDot.style.background = '#5CB85C';
                showToast(`${name} joined your private room! ❤️`, '🎉');
                SoundEffects.playSuccess();
            },
            onPeerLeft: (remoteId, name) => {
                remotePlaceholder.classList.remove('is-hidden');
                remotePlaceholderText.textContent = `${name} has left the room. Waiting for return...`;
                remoteNickDisplay.textContent = 'Partner Disconnected';
                sessionStatusText.textContent = 'Alone in room';
                connectionDot.style.background = '#D9534F';
                showToast(`${name} disconnected`, '⚠️');
            },
            onRemoteStream: (remoteId, stream, name) => {
                remoteVideo.srcObject = stream;
                remoteVideo.play().catch(e => {});
                remotePlaceholder.classList.add('is-hidden');
                partnerName = name || partnerName;
                remoteNickDisplay.textContent = partnerName;
                sessionStatusText.textContent = `Live with ${partnerName} ❤️`;
                connectionDot.style.background = '#5CB85C';
            },
            onConnectionState: (remoteId, state) => {
                if (state === 'connected') {
                    sessionStatusText.textContent = `Live with ${partnerName} ❤️`;
                    connectionDot.style.background = '#5CB85C';
                }
            },
            onCountdownStarted: (targetTime, duration, shotsCount, shotIndex) => {
                runSynchronizedCountdown(targetTime, duration, shotsCount, shotIndex);
            },
            onRemoteFrameReceived: (remoteId, base64Img, shotIndex) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    state.pendingShot.remote = canvas;
                    checkBothPhotosReceived();
                };
                img.src = base64Img;
            },
            onRetakeRequested: (remoteId, shotIndex) => {
                showToast(`${partnerName} requested to retake this shot! 📸`, '🔄');
                state.pendingShot = { local: null, remote: null };
                reviewPanel.classList.add('is-hidden');
            },
            onPhotoAccepted: (remoteId, shotIndex) => {
                showToast(`${partnerName} loved the photo! ♡`, '✨');
            },
            onError: (err) => {
                showToast(err.message || 'Camera error', '⚠️');
            }
        });

        // Start Media & Signaling
        try {
            await webrtc.startMedia(localVideo, 'user');
            localPlaceholder.classList.add('is-hidden');
        } catch (e) {
            localPlaceholder.innerHTML = '<p>Camera access denied or unavailable</p>';
        }

        webrtc.startSignaling();
    }

    // Countdown and capture
    function runSynchronizedCountdown(targetTime, duration, shotsCount, shotIndex) {
        state.isCountingDown = true;
        countdownOverlay.classList.remove('is-hidden');
        SoundEffects.playBeep(440, 'sine', 0.1);

        const timerInterval = setInterval(() => {
            const timeLeft = Math.ceil((targetTime - Date.now()) / 1000);
            if (timeLeft > 0) {
                countdownNumber.textContent = timeLeft;
                SoundEffects.playBeep(440, 'sine', 0.08);
            } else {
                clearInterval(timerInterval);
                countdownNumber.textContent = '📸';
                SoundEffects.playBeep(880, 'sine', 0.15);

                setTimeout(() => {
                    countdownOverlay.classList.add('is-hidden');
                    captureLocalFrame(shotIndex);
                    state.isCountingDown = false;
                }, 300);
            }
        }, 150);
    }

    function captureLocalFrame(shotIndex) {
        // Flash
        flashOverlay.classList.remove('flash-active');
        void flashOverlay.offsetWidth;
        flashOverlay.classList.add('flash-active');
        SoundEffects.playShutter();

        // Capture local frame onto canvas
        const canvas = document.createElement('canvas');
        canvas.width = localVideo.videoWidth || 1280;
        canvas.height = localVideo.videoHeight || 720;
        const ctx = canvas.getContext('2d');

        if (webrtc.isMirrored) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(localVideo, 0, 0);

        state.pendingShot.local = canvas;

        // Compress and send to partner
        const jpegData = canvas.toDataURL('image/jpeg', 0.82);
        webrtc.sendCapturedFrame(jpegData, shotIndex);

        // Show review panel
        reviewPanel.classList.remove('is-hidden');
        checkBothPhotosReceived();
    }

    function checkBothPhotosReceived() {
        if (state.pendingShot.local && state.pendingShot.remote) {
            showToast('Both photos captured! Look at your shots ♡', '✨');
        }
    }

    function keepCurrentShot() {
        if (!state.pendingShot.local) return;

        // Push local + remote pair
        state.capturedPairs.push({
            local: state.pendingShot.local,
            remote: state.pendingShot.remote || state.pendingShot.local
        });

        state.pendingShot = { local: null, remote: null };
        reviewPanel.classList.add('is-hidden');
        SoundEffects.playSuccess();
        updateThumbnails();

        if (state.capturedPairs.length >= state.targetShots) {
            showToast('All couple shots complete! Composing strip... ✨', '🎉');
            setTimeout(() => switchToStripStage(), 600);
        } else {
            showToast(`Shot ${state.capturedPairs.length} kept! Next pose ready. ♡`, '📸');
        }
    }

    function retakeCurrentShot() {
        state.pendingShot = { local: null, remote: null };
        reviewPanel.classList.add('is-hidden');
        webrtc.sendSignal('RETAKE_REQUEST', { shotIndex: state.capturedPairs.length });
        showToast('Shot cleared. Ready to retake!', '📸');
    }

    function updateThumbnails() {
        thumbnailsContainer.innerHTML = '';
        for (let i = 0; i < state.targetShots; i++) {
            const slot = document.createElement('div');
            slot.className = 'thumb-slot';
            if (state.capturedPairs[i]) {
                slot.classList.add('filled');
                const img = document.createElement('img');
                img.className = 'thumb-img';
                img.src = state.capturedPairs[i].local.toDataURL('image/jpeg', 0.7);
                slot.appendChild(img);
            } else {
                const num = document.createElement('span');
                num.className = 'thumb-placeholder-num';
                num.textContent = `${i + 1}`;
                slot.appendChild(num);
            }
            thumbnailsContainer.appendChild(slot);
        }

        btnGenerateStrip.disabled = (state.capturedPairs.length === 0);
    }

    function switchToStripStage() {
        cameraStage.classList.add('is-hidden');
        stripStage.classList.remove('is-hidden');
        renderCoupleStrip();
        Confetti.fire();
        SoundEffects.playSuccess();
        stripStage.scrollIntoView({ behavior: 'smooth' });
    }

    async function renderCoupleStrip() {
        // Flatten captured pairs into an alternating sequence of [local, remote, local, remote...]
        const photoList = [];
        for (const pair of state.capturedPairs) {
            photoList.push({ canvas: pair.local, isMirrored: false });
            if (pair.remote) {
                photoList.push({ canvas: pair.remote, isMirrored: false });
            }
        }

        const sessionTitle = document.getElementById('ldr-title-input').value.trim() || 'Little Memories ♡';
        const coupleNames = document.getElementById('ldr-names-input').value.trim() || `${nickname} & ${partnerName}`;
        const footerText = document.getElementById('ldr-footer-input').value.trim() || 'Distance means so little ♡';

        await PhotoStripGenerator.renderStrip(photoStripCanvas, {
            photos: photoList,
            layout: state.layout,
            filterId: state.activeFilter,
            filterIntensity: state.filterIntensity,
            bgColor: state.bgColor,
            spacing: state.spacing,
            sessionTitle: sessionTitle,
            nicknames: coupleNames,
            footerText: footerText,
            stickersEnabled: true,
            stickerSet: 'hearts'
        });
    }

    // Event Bindings
    document.getElementById('btn-trigger-capture').addEventListener('click', () => {
        if (!webrtc) return;
        webrtc.triggerSharedCountdown(state.countdownSeconds, state.targetShots, state.capturedPairs.length);
    });

    document.getElementById('btn-keep-shot').addEventListener('click', keepCurrentShot);
    document.getElementById('btn-retake-shot').addEventListener('click', retakeCurrentShot);

    document.getElementById('btn-toggle-mic').addEventListener('click', () => {
        const isMuted = webrtc.toggleAudio();
        document.getElementById('mic-label').textContent = isMuted ? 'Mic Muted' : 'Mic On';
        document.getElementById('mic-icon').textContent = isMuted ? '🔇' : '🎙️';
        showToast(isMuted ? 'Microphone Muted' : 'Microphone Live', isMuted ? '🔇' : '🎙️');
    });

    document.getElementById('btn-toggle-cam').addEventListener('click', () => {
        const isOff = webrtc.toggleVideo();
        document.getElementById('cam-label').textContent = isOff ? 'Cam Off' : 'Cam On';
        document.getElementById('cam-icon').textContent = isOff ? '🚫' : '📹';
        showToast(isOff ? 'Camera Disabled' : 'Camera Active', isOff ? '🚫' : '📹');
    });

    document.getElementById('btn-flip-camera').addEventListener('click', () => {
        webrtc.flipCamera(localVideo);
        showToast('Camera flipped!', '🔄');
    });

    document.getElementById('btn-toggle-mirror').addEventListener('click', () => {
        const isMirrored = webrtc.toggleMirror(localVideo);
        showToast(isMirrored ? 'Mirror view ON' : 'Mirror view OFF', '🪞');
    });

    document.getElementById('btn-toggle-ready').addEventListener('click', () => {
        state.isReady = !state.isReady;
        document.getElementById('ready-heart').textContent = state.isReady ? '❤️' : '🤍';
        document.getElementById('ready-label').textContent = state.isReady ? 'Ready! ♡' : "I'm Ready";
        webrtc.sendSignal('SET_READY', { is_ready: state.isReady });
        showToast(state.isReady ? 'You are Ready! ✨' : 'Unmarked ready', '♡');
    });

    document.getElementById('btn-copy-invite').addEventListener('click', () => {
        const inviteUrl = `${window.location.origin}/ldr/${roomId}`;
        navigator.clipboard.writeText(inviteUrl);
        copyBtnText.textContent = 'Copied! ❤️';
        setTimeout(() => copyBtnText.textContent = 'Copy Invite Link', 2500);
        showToast('Invite link copied! Send it to your partner. ♡', '📋');
    });

    document.getElementById('btn-copy-waiting-link')?.addEventListener('click', () => {
        const inviteUrl = `${window.location.origin}/ldr/${roomId}`;
        navigator.clipboard.writeText(inviteUrl);
        showToast('Invite link copied! Send it to your partner. ♡', '📋');
    });

    document.getElementById('btn-generate-strip-now').addEventListener('click', switchToStripStage);
    document.getElementById('btn-back-to-camera').addEventListener('click', () => {
        stripStage.classList.add('is-hidden');
        cameraStage.classList.remove('is-hidden');
    });

    document.getElementById('btn-download-strip').addEventListener('click', () => {
        const dateStr = new Date().toISOString().slice(0, 10);
        PhotoStripGenerator.downloadCanvasAsPng(photoStripCanvas, `little-memories-couple-${dateStr}.png`);
        showToast('Downloaded couple photo strip! ♡', '🎉');
    });

    // Filters and Customizer
    function initFiltersUI() {
        const grid = document.getElementById('filters-grid');
        grid.innerHTML = '';
        PhotoFilters.getFilterList().forEach(f => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `filter-item-btn ${f.id === state.activeFilter ? 'active' : ''}`;
            btn.innerHTML = `<span class="filter-preview-circle" style="filter: ${PhotoFilters.getCssFilter(f.id, 85)};">${f.icon}</span><span class="filter-title">${f.name}</span>`;
            btn.addEventListener('click', () => {
                state.activeFilter = f.id;
                document.querySelectorAll('.filter-item-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('active-filter-label').textContent = f.name;
                localVideo.style.filter = PhotoFilters.getCssFilter(f.id, state.filterIntensity);
                remoteVideo.style.filter = PhotoFilters.getCssFilter(f.id, state.filterIntensity);
                if (!stripStage.classList.contains('is-hidden')) renderCoupleStrip();
            });
            grid.appendChild(btn);
        });
    }

    document.getElementById('filter-intensity-slider').addEventListener('input', (e) => {
        state.filterIntensity = parseInt(e.target.value, 10);
        document.getElementById('intensity-val').textContent = `${state.filterIntensity}%`;
        localVideo.style.filter = PhotoFilters.getCssFilter(state.activeFilter, state.filterIntensity);
        remoteVideo.style.filter = PhotoFilters.getCssFilter(state.activeFilter, state.filterIntensity);
        if (!stripStage.classList.contains('is-hidden')) renderCoupleStrip();
    });

    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            state.bgColor = swatch.dataset.color;
            if (!stripStage.classList.contains('is-hidden')) renderCoupleStrip();
        });
    });

    document.querySelectorAll('.layout-opt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.layout-opt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.layout = btn.dataset.layout;
            if (!stripStage.classList.contains('is-hidden')) renderCoupleStrip();
        });
    });

    // Start
    initFiltersUI();
    updateThumbnails();
    await initRoom();
});
