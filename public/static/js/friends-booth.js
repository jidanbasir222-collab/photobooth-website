/**
 * LITTLE MEMORIES — REMOTE FRIENDS PHOTOBOOTH CONTROLLER
 * Coordinates multi-participant squad room (up to 4 friends),
 * video grid, synchronized group countdown, frame collection, and squad strip export.
 */

document.addEventListener('DOMContentLoaded', async () => {
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

    function showToast(message, icon = '✨') {
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

    const urlParams = new URLSearchParams(window.location.search);
    let roomId = window.INITIAL_ROOM_ID || urlParams.get('room') || window.location.pathname.split('/').pop();
    if (roomId === 'remote' || roomId === 'friends') roomId = '';

    let peerId = urlParams.get('peer_id') || '';
    let nickname = urlParams.get('name') || localStorage.getItem('friends_nickname') || 'Friend';
    let isHost = !!urlParams.get('peer_id');

    const state = {
        targetShots: 4,
        countdownSeconds: 3,
        activeFilter: 'vintage',
        filterIntensity: 85,
        layout: 'vertical-4',
        bgColor: '#FFF8EF',
        capturedRounds: [], // array of arrays of canvases
        pendingRoundFrames: {}, // peerId -> canvas
        remotePeers: {} // peerId -> name
    };

    const localVideo = document.getElementById('local-video');
    const localNickDisplay = document.getElementById('local-nickname-display');
    const sessionStatusText = document.getElementById('session-status-text');
    const connectionDot = document.getElementById('connection-dot');
    const copyBtnText = document.getElementById('copy-btn-text');
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownNumber = document.getElementById('countdown-number');
    const flashOverlay = document.getElementById('camera-flash');
    const remoteFeedsContainer = document.getElementById('remote-feeds-container');
    const reviewPanel = document.getElementById('review-action-panel');
    const thumbnailsContainer = document.getElementById('thumbnails-container');
    const btnGenerateStrip = document.getElementById('btn-generate-strip-now');
    const cameraStage = document.getElementById('camera-stage');
    const stripStage = document.getElementById('strip-stage');
    const photoStripCanvas = document.getElementById('photo-strip-canvas');

    localNickDisplay.textContent = `${nickname} (You)`;

    let webrtc = null;

    async function initRoom() {
        if (!roomId) {
            const code = prompt('Enter Friends Squad Room Code:', '');
            if (code && code.trim()) {
                roomId = code.trim();
            } else {
                const resp = await fetch('/api/rooms/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'friends', nickname: nickname })
                });
                const d = await resp.json();
                roomId = d.room_id;
                peerId = d.peer_id;
                isHost = true;
            }
        }

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

        sessionStatusText.textContent = `Squad Room: ${roomId}`;
        connectionDot.className = 'badge-dot';

        webrtc = new WebRTCRoomManager({
            roomId: roomId,
            peerId: peerId,
            nickname: nickname,
            mode: 'friends',
            isHost: isHost,
            onPeerJoined: (remoteId, name) => {
                state.remotePeers[remoteId] = name;
                addRemoteFeedBox(remoteId, name);
                showToast(`${name} joined the squad! ✨`, '🎉');
                SoundEffects.playSuccess();
            },
            onPeerLeft: (remoteId, name) => {
                removeRemoteFeedBox(remoteId);
                delete state.remotePeers[remoteId];
                showToast(`${name} left the room`, '👋');
            },
            onRemoteStream: (remoteId, stream, name) => {
                let box = document.getElementById(`feed-box-${remoteId}`);
                if (!box) {
                    addRemoteFeedBox(remoteId, name);
                    box = document.getElementById(`feed-box-${remoteId}`);
                }
                const v = box.querySelector('video');
                if (v) {
                    v.srcObject = stream;
                    v.play().catch(e => {});
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

                    state.pendingRoundFrames[remoteId] = canvas;
                    showToast(`Photo received from ${state.remotePeers[remoteId] || 'Friend'}!`, '📸');
                };
                img.src = base64Img;
            },
            onError: (err) => showToast(err.message || 'Media error', '⚠️')
        });

        try {
            await webrtc.startMedia(localVideo, 'user');
        } catch (e) {
            showToast('Camera error: check browser permissions', '⚠️');
        }

        webrtc.startSignaling();
    }

    function addRemoteFeedBox(peerId, name) {
        if (document.getElementById(`feed-box-${peerId}`)) return;
        const box = document.createElement('div');
        box.className = 'video-feed-box';
        box.id = `feed-box-${peerId}`;
        box.innerHTML = `
            <div class="feed-name-tag">
                <span class="feed-dot active"></span>
                <span>${name}</span>
            </div>
            <video autoplay playsinline></video>
        `;
        remoteFeedsContainer.appendChild(box);
    }

    function removeRemoteFeedBox(peerId) {
        const box = document.getElementById(`feed-box-${peerId}`);
        if (box) box.remove();
    }

    function runSynchronizedCountdown(targetTime, duration, shotsCount, shotIndex) {
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
                    captureSquadFrame(shotIndex);
                }, 300);
            }
        }, 150);
    }

    function captureSquadFrame(shotIndex) {
        flashOverlay.classList.remove('flash-active');
        void flashOverlay.offsetWidth;
        flashOverlay.classList.add('flash-active');
        SoundEffects.playShutter();

        const canvas = document.createElement('canvas');
        canvas.width = localVideo.videoWidth || 1280;
        canvas.height = localVideo.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (webrtc.isMirrored) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(localVideo, 0, 0);

        state.pendingRoundFrames[peerId] = canvas;

        const jpeg = canvas.toDataURL('image/jpeg', 0.82);
        webrtc.sendCapturedFrame(jpeg, shotIndex);

        reviewPanel.classList.remove('is-hidden');
    }

    function keepShot() {
        const frames = Object.values(state.pendingRoundFrames);
        if (frames.length > 0) {
            state.capturedRounds.push(frames);
        }
        state.pendingRoundFrames = {};
        reviewPanel.classList.add('is-hidden');
        SoundEffects.playSuccess();
        updateThumbnails();

        if (state.capturedRounds.length >= state.targetShots) {
            showToast('All shots captured! Generating squad strip... ✨', '🎉');
            setTimeout(() => switchToStripStage(), 600);
        }
    }

    function retakeShot() {
        state.pendingRoundFrames = {};
        reviewPanel.classList.add('is-hidden');
        webrtc.sendSignal('RETAKE_REQUEST', { shotIndex: state.capturedRounds.length });
        showToast('Shot cleared. Ready to retake!', '📸');
    }

    function updateThumbnails() {
        thumbnailsContainer.innerHTML = '';
        for (let i = 0; i < state.targetShots; i++) {
            const slot = document.createElement('div');
            slot.className = 'thumb-slot';
            if (state.capturedRounds[i] && state.capturedRounds[i][0]) {
                slot.classList.add('filled');
                const img = document.createElement('img');
                img.className = 'thumb-img';
                img.src = state.capturedRounds[i][0].toDataURL('image/jpeg', 0.7);
                slot.appendChild(img);
            } else {
                const num = document.createElement('span');
                num.className = 'thumb-placeholder-num';
                num.textContent = `${i + 1}`;
                slot.appendChild(num);
            }
            thumbnailsContainer.appendChild(slot);
        }
        btnGenerateStrip.disabled = (state.capturedRounds.length === 0);
    }

    function switchToStripStage() {
        cameraStage.classList.add('is-hidden');
        stripStage.classList.remove('is-hidden');
        renderSquadStrip();
        stripStage.scrollIntoView({ behavior: 'smooth' });
    }

    async function renderSquadStrip() {
        const photoList = [];
        for (const round of state.capturedRounds) {
            for (const cv of round) {
                photoList.push({ canvas: cv, isMirrored: false });
            }
        }

        const title = document.getElementById('friends-title-input').value.trim() || 'Little Memories Squad ✨';
        const footer = document.getElementById('friends-footer-input').value.trim() || 'Friends forever ♡';

        await PhotoStripGenerator.renderStrip(photoStripCanvas, {
            photos: photoList,
            layout: state.layout,
            filterId: state.activeFilter,
            filterIntensity: state.filterIntensity,
            bgColor: state.bgColor,
            sessionTitle: title,
            nicknames: 'Squad Goals',
            footerText: footer,
            stickersEnabled: true,
            stickerSet: 'stars'
        });
    }

    // Bindings
    document.getElementById('btn-trigger-capture').addEventListener('click', () => {
        if (!webrtc) return;
        webrtc.triggerSharedCountdown(state.countdownSeconds, state.targetShots, state.capturedRounds.length);
    });

    document.getElementById('btn-keep-shot').addEventListener('click', keepShot);
    document.getElementById('btn-retake-shot').addEventListener('click', retakeShot);

    document.getElementById('btn-toggle-mic').addEventListener('click', () => {
        const isMuted = webrtc.toggleAudio();
        document.getElementById('mic-label').textContent = isMuted ? 'Mic Muted' : 'Mic On';
        document.getElementById('mic-icon').textContent = isMuted ? '🔇' : '🎙️';
    });

    document.getElementById('btn-toggle-cam').addEventListener('click', () => {
        const isOff = webrtc.toggleVideo();
        document.getElementById('cam-label').textContent = isOff ? 'Cam Off' : 'Cam On';
        document.getElementById('cam-icon').textContent = isOff ? '🚫' : '📹';
    });

    document.getElementById('btn-flip-camera').addEventListener('click', () => {
        webrtc.flipCamera(localVideo);
    });

    document.getElementById('btn-toggle-mirror').addEventListener('click', () => {
        webrtc.toggleMirror(localVideo);
    });

    document.getElementById('btn-copy-invite').addEventListener('click', () => {
        const inviteUrl = `${window.location.origin}/friends/remote/${roomId}`;
        navigator.clipboard.writeText(inviteUrl);
        copyBtnText.textContent = 'Copied! ✨';
        setTimeout(() => copyBtnText.textContent = 'Copy Squad Link', 2500);
        showToast('Squad invite link copied! Send it to your friends. ✨', '📋');
    });

    document.getElementById('btn-generate-strip-now').addEventListener('click', switchToStripStage);
    document.getElementById('btn-back-to-camera').addEventListener('click', () => {
        stripStage.classList.add('is-hidden');
        cameraStage.classList.remove('is-hidden');
    });

    document.getElementById('btn-download-strip').addEventListener('click', () => {
        PhotoStripGenerator.downloadCanvasAsPng(photoStripCanvas, `little-memories-squad.png`);
        showToast('Downloaded squad photo strip! ✨', '🎉');
    });

    // Filters
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
            if (!stripStage.classList.contains('is-hidden')) renderSquadStrip();
        });
        grid.appendChild(btn);
    });

    await initRoom();
});
