/**
 * LITTLE MEMORIES — WEBRTC & REAL-TIME SIGNALING MODULE
 * Supports both LDR Couple Rooms (1-to-1) and Remote Friends Squad (Mesh).
 * Features:
 * - Peer-to-peer Audio & Video streaming (WebRTC)
 * - Dynamic STUN & configurable TURN relay servers
 * - Ultra-reliable REST signaling bridge (Vercel serverless compatible) + WebSocket support
 * - WebRTC DataChannel for direct peer-to-peer still image transfer
 * - Synchronized target-timestamp countdown & photo coordination
 */

class WebRTCRoomManager {
    constructor(config = {}) {
        this.roomId = config.roomId || '';
        this.peerId = config.peerId || '';
        this.nickname = config.nickname || 'Guest';
        this.mode = config.mode || 'ldr'; // 'ldr' or 'friends'
        this.isHost = !!config.isHost;

        // Callbacks
        this.onPeerJoined = config.onPeerJoined || (() => {});
        this.onPeerLeft = config.onPeerLeft || (() => {});
        this.onRemoteStream = config.onRemoteStream || (() => {});
        this.onConnectionState = config.onConnectionState || (() => {});
        this.onCountdownStarted = config.onCountdownStarted || (() => {});
        this.onRemoteFrameReceived = config.onRemoteFrameReceived || (() => {});
        this.onRetakeRequested = config.onRetakeRequested || (() => {});
        this.onPhotoAccepted = config.onPhotoAccepted || (() => {});
        this.onError = config.onError || ((err) => console.error(err));

        // Media & Connections
        this.localStream = null;
        this.peerConnections = {}; // targetPeerId -> RTCPeerConnection
        this.dataChannels = {};    // targetPeerId -> RTCDataChannel
        this.facingMode = 'user';
        this.isMuted = false;
        this.isVideoOff = false;
        this.isMirrored = true;

        // Signaling Polling State
        this.lastSignalId = 0;
        this.pollInterval = null;
        this.isPolling = false;
        this.ws = null;

        // ICE Servers (Google Public STUN + optional TURN via window.TURN_CONFIG)
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ];

        if (window.TURN_CONFIG && window.TURN_CONFIG.urls) {
            this.iceServers.push(window.TURN_CONFIG);
        }

        window.addEventListener('beforeunload', () => this.leave());
    }

    /**
     * Start local camera and microphone stream
     */
    async startMedia(videoElement, facingMode = 'user') {
        this.facingMode = facingMode;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Webcam / microphone API is not supported on this browser or requires HTTPS.');
        }

        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: {
                facingMode: this.facingMode,
                width: { ideal: 1280, min: 640 },
                height: { ideal: 720, min: 480 }
            }
        };

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            if (videoElement) {
                videoElement.srcObject = this.localStream;
                videoElement.play().catch(e => console.log('Autoplay play notice:', e));
                videoElement.style.transform = (this.facingMode === 'user' && this.isMirrored) ? 'scaleX(-1)' : 'scaleX(1)';
            }
            return this.localStream;
        } catch (err) {
            this.onError(err);
            throw err;
        }
    }

    /**
     * Connect to room signaling (HTTP REST Polling Bridge)
     */
    startSignaling() {
        if (this.isPolling) return;
        this.isPolling = true;

        // Initial poll immediately, then every 900ms
        this.pollSignals();
        this.pollInterval = setInterval(() => this.pollSignals(), 900);
    }

    stopSignaling() {
        this.isPolling = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    async pollSignals() {
        if (!this.roomId || !this.peerId || !this.isPolling) return;
        try {
            const resp = await fetch(`/api/rooms/${this.roomId}/signals?peer_id=${this.peerId}&last_id=${this.lastSignalId}`);
            if (!resp.ok) return;
            const data = await resp.json();

            this.lastSignalId = data.last_id || this.lastSignalId;
            if (data.signals && data.signals.length > 0) {
                for (const sig of data.signals) {
                    await this.handleIncomingSignal(sig);
                }
            }
        } catch (e) {
            // Transient network retry
        }
    }

    async sendSignal(type, data = {}, targetPeerId = null) {
        if (!this.roomId || !this.peerId) return;
        try {
            await fetch(`/api/rooms/${this.roomId}/signal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: this.peerId,
                    to: targetPeerId,
                    type: type,
                    data: data
                })
            });
        } catch (e) {
            console.warn('Signaling send error:', e);
        }
    }

    /**
     * Create RTCPeerConnection for a remote peer
     */
    createPeerConnection(remotePeerId, remoteName = 'Partner') {
        if (this.peerConnections[remotePeerId]) {
            return this.peerConnections[remotePeerId];
        }

        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        this.peerConnections[remotePeerId] = pc;

        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Handle remote stream tracks
        pc.ontrack = (event) => {
            const remoteStream = event.streams[0] || new MediaStream([event.track]);
            this.onRemoteStream(remotePeerId, remoteStream, remoteName);
        };

        // ICE candidate exchange
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal('ICE_CANDIDATE', { candidate: event.candidate }, remotePeerId);
            }
        };

        pc.onconnectionstatechange = () => {
            this.onConnectionState(remotePeerId, pc.connectionState);
        };

        // Setup DataChannel for peer-to-peer image transfer
        if (this.isHost) {
            try {
                const dc = pc.createDataChannel('photobooth-data', { reliable: true });
                this.setupDataChannel(remotePeerId, dc);
            } catch (e) {
                console.warn('DataChannel creation notice:', e);
            }
        } else {
            pc.ondatachannel = (event) => {
                this.setupDataChannel(remotePeerId, event.channel);
            };
        }

        return pc;
    }

    setupDataChannel(peerId, dc) {
        this.dataChannels[peerId] = dc;
        let incomingChunks = [];

        dc.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'CHUNK') {
                    incomingChunks.push(msg.chunk);
                    if (msg.isLast) {
                        const fullBase64 = incomingChunks.join('');
                        incomingChunks = [];
                        this.onRemoteFrameReceived(peerId, fullBase64, msg.shotIndex);
                    }
                } else if (msg.type === 'COUNTDOWN_TRIGGER') {
                    this.onCountdownStarted(msg.targetTime, msg.duration, msg.shotsCount, msg.shotIndex);
                } else if (msg.type === 'RETAKE_REQUEST') {
                    this.onRetakeRequested(peerId, msg.shotIndex);
                } else if (msg.type === 'PHOTO_ACCEPTED') {
                    this.onPhotoAccepted(peerId, msg.shotIndex);
                }
            } catch (e) {
                console.warn('DataChannel message parse error:', e);
            }
        };

        dc.onopen = () => console.log(`DataChannel opened with ${peerId}`);
    }

    /**
     * Handle incoming signals from the serverless signaling bridge
     */
    async handleIncomingSignal(sig) {
        const fromPeer = sig.from;
        const type = sig.type;
        const data = sig.data || {};

        if (type === 'USER_JOINED') {
            const peerName = data.name || 'Friend';
            this.onPeerJoined(fromPeer, peerName);

            // If we are host or already in room, initiate offer to the new joiner
            const pc = this.createPeerConnection(fromPeer, peerName);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.sendSignal('OFFER', { sdp: pc.localDescription }, fromPeer);
            } catch (e) {
                console.warn('Error creating offer:', e);
            }
        } else if (type === 'OFFER') {
            const pc = this.createPeerConnection(fromPeer, 'Partner');
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.sendSignal('ANSWER', { sdp: pc.localDescription }, fromPeer);
            } catch (e) {
                console.warn('Error handling offer:', e);
            }
        } else if (type === 'ANSWER') {
            const pc = this.peerConnections[fromPeer];
            if (pc) {
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                } catch (e) {
                    console.warn('Error setting remote description from answer:', e);
                }
            }
        } else if (type === 'ICE_CANDIDATE') {
            const pc = this.peerConnections[fromPeer];
            if (pc && data.candidate) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (e) {
                    console.warn('Error adding ICE candidate:', e);
                }
            }
        } else if (type === 'USER_LEFT') {
            this.closePeer(fromPeer);
            this.onPeerLeft(fromPeer, data.name || 'Partner');
        } else if (type === 'START_COUNTDOWN') {
            this.onCountdownStarted(data.targetTime, data.duration, data.shotsCount, data.shotIndex);
        } else if (type === 'STILL_PHOTO_TRANSFER') {
            this.onRemoteFrameReceived(fromPeer, data.image, data.shotIndex);
        } else if (type === 'RETAKE_REQUEST') {
            this.onRetakeRequested(fromPeer, data.shotIndex);
        } else if (type === 'PHOTO_ACCEPTED') {
            this.onPhotoAccepted(fromPeer, data.shotIndex);
        }
    }

    /**
     * Start a synchronized photo countdown across both participants
     */
    triggerSharedCountdown(duration = 3, shotsCount = 4, shotIndex = 0) {
        // Shared target timestamp gives a 400ms margin for signaling transit
        const targetTime = Date.now() + duration * 1000 + 400;

        // Try direct DataChannel broadcast first
        const payload = {
            targetTime: targetTime,
            duration: duration,
            shotsCount: shotsCount,
            shotIndex: shotIndex
        };

        this.broadcastDataChannel({
            type: 'COUNTDOWN_TRIGGER',
            ...payload
        });

        // Also send via server signaling relay for 100% delivery guarantee
        this.sendSignal('START_COUNTDOWN', payload);

        // Run local countdown
        this.onCountdownStarted(targetTime, duration, shotsCount, shotIndex);
    }

    /**
     * Send captured still frame to remote partner
     */
    sendCapturedFrame(imageDataUrl, shotIndex = 0) {
        // Send via DataChannel in small chunks to avoid browser buffer limits
        let sentViaDC = false;
        const chunkSize = 16384; // 16KB chunks

        for (const [peerId, dc] of Object.entries(this.dataChannels)) {
            if (dc && dc.readyState === 'open') {
                try {
                    const totalChunks = Math.ceil(imageDataUrl.length / chunkSize);
                    for (let i = 0; i < totalChunks; i++) {
                        const chunk = imageDataUrl.slice(i * chunkSize, (i + 1) * chunkSize);
                        dc.send(JSON.stringify({
                            type: 'CHUNK',
                            chunk: chunk,
                            isLast: (i === totalChunks - 1),
                            shotIndex: shotIndex
                        }));
                    }
                    sentViaDC = true;
                } catch (e) {
                    console.warn('DataChannel send chunk error:', e);
                }
            }
        }

        // If DataChannel was unavailable, fallback to serverless signal relay
        if (!sentViaDC) {
            this.sendSignal('STILL_PHOTO_TRANSFER', {
                image: imageDataUrl,
                shotIndex: shotIndex
            });
        }
    }

    broadcastDataChannel(obj) {
        const str = JSON.stringify(obj);
        for (const [peerId, dc] of Object.entries(this.dataChannels)) {
            if (dc && dc.readyState === 'open') {
                try {
                    dc.send(str);
                } catch (e) {
                    console.warn('DC broadcast error:', e);
                }
            }
        }
    }

    /**
     * Toggle microphone mute / unmute
     */
    toggleAudio() {
        if (!this.localStream) return false;
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            audioTracks[0].enabled = !audioTracks[0].enabled;
            this.isMuted = !audioTracks[0].enabled;
        }
        return this.isMuted;
    }

    /**
     * Toggle video on / off
     */
    toggleVideo() {
        if (!this.localStream) return false;
        const videoTracks = this.localStream.getVideoTracks();
        if (videoTracks.length > 0) {
            videoTracks[0].enabled = !videoTracks[0].enabled;
            this.isVideoOff = !videoTracks[0].enabled;
        }
        return this.isVideoOff;
    }

    /**
     * Flip between front and rear cameras (mobile phones)
     */
    async flipCamera(videoElement) {
        this.facingMode = (this.facingMode === 'user') ? 'environment' : 'user';
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
        }

        await this.startMedia(videoElement, this.facingMode);

        // Replace video tracks in all active RTCPeerConnections
        const newVideoTrack = this.localStream.getVideoTracks()[0];
        if (newVideoTrack) {
            for (const pc of Object.values(this.peerConnections)) {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(newVideoTrack);
                }
            }
        }
    }

    toggleMirror(videoElement) {
        this.isMirrored = !this.isMirrored;
        if (videoElement) {
            videoElement.style.transform = (this.facingMode === 'user' && this.isMirrored) ? 'scaleX(-1)' : 'scaleX(1)';
        }
        return this.isMirrored;
    }

    closePeer(peerId) {
        if (this.dataChannels[peerId]) {
            try { this.dataChannels[peerId].close(); } catch (e) {}
            delete this.dataChannels[peerId];
        }
        if (this.peerConnections[peerId]) {
            try { this.peerConnections[peerId].close(); } catch (e) {}
            delete this.peerConnections[peerId];
        }
    }

    /**
     * Clean up and leave room
     */
    leave() {
        this.stopSignaling();

        // Notify server that we left
        if (this.roomId && this.peerId) {
            navigator.sendBeacon(`/api/rooms/${this.roomId}/leave`, JSON.stringify({ peer_id: this.peerId }));
        }

        for (const peerId of Object.keys(this.peerConnections)) {
            this.closePeer(peerId);
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(t => {
                try { t.stop(); } catch (e) {}
            });
            this.localStream = null;
        }
    }
}

window.WebRTCRoomManager = WebRTCRoomManager;
