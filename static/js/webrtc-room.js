/**
 * LITTLE MEMORIES — WEBRTC & REAL-TIME SIGNALING MODULE
 * Fully hardened for cross-device, cross-network LDR Photobooth connections.
 * 
 * Features:
 * - Robust STUN & OpenRelay TURN configuration for Carrier-Grade NAT / Mobile 4G/5G
 * - Asynchronous ICE candidate queueing (before & after remote description)
 * - Perfect negotiation pattern & offer collision resolution
 * - Persistent MediaStream per peer with track deduplication
 * - Mobile-friendly adaptive getUserMedia constraints
 * - Real-time connection diagnostics and verbose developer logging
 */

class WebRTCRoomManager {
    constructor(config = {}) {
        this.roomId = config.roomId || '';
        this.peerId = config.peerId || '';
        this.nickname = config.nickname || 'Guest';
        this.mode = config.mode || 'ldr'; // 'ldr' or 'friends'
        this.isHost = !!config.isHost;
        this.isPolite = !this.isHost; // Polite peer pattern (guest is polite, host is impolite)

        // Callbacks
        this.onPeerJoined = config.onPeerJoined || (() => {});
        this.onPeerLeft = config.onPeerLeft || (() => {});
        this.onRemoteStream = config.onRemoteStream || (() => {});
        this.onConnectionState = config.onConnectionState || (() => {});
        this.onCountdownStarted = config.onCountdownStarted || (() => {});
        this.onRemoteFrameReceived = config.onRemoteFrameReceived || (() => {});
        this.onRetakeRequested = config.onRetakeRequested || (() => {});
        this.onPhotoAccepted = config.onPhotoAccepted || (() => {});
        this.onDiagnosticsUpdate = config.onDiagnosticsUpdate || (() => {});
        this.onError = config.onError || ((err) => console.error('[WebRTC Error]', err));

        // Media & Connections
        this.localStream = null;
        this.peerConnections = {};  // remotePeerId -> RTCPeerConnection
        this.remoteStreams = {};    // remotePeerId -> MediaStream
        this.iceQueues = {};        // remotePeerId -> [RTCIceCandidateInit]
        this.dataChannels = {};     // remotePeerId -> RTCDataChannel
        this.makingOffer = {};      // remotePeerId -> boolean
        this.currentParticipants = {}; // remotePeerId -> participant object
        this.facingMode = 'user';
        this.isMuted = false;
        this.isVideoOff = false;
        this.isMirrored = true;

        // Signaling Polling State (Adaptive Serverless Bridge)
        this.lastSignalId = 0;
        this.pollInterval = null;
        this.isPolling = false;
        this.pollIntervalMs = 700; // Snappy 700ms polling for quick handshakes

        // Multi-provider STUN + OpenRelay TURN for mobile NAT traversal
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.services.mozilla.com' },
            {
                urls: [
                    'turn:openrelay.metered.ca:80',
                    'turn:openrelay.metered.ca:443',
                    'turn:openrelay.metered.ca:443?transport=tcp'
                ],
                username: 'openrelay',
                credential: 'openrelay'
            }
        ];

        if (window.TURN_CONFIG && window.TURN_CONFIG.urls) {
            this.iceServers.unshift(window.TURN_CONFIG);
        }

        window.addEventListener('beforeunload', () => this.leave());
    }

    /**
     * Start local camera and microphone stream with adaptive mobile fallback
     */
    async startMedia(videoElement, facingMode = 'user') {
        this.facingMode = facingMode;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const err = new Error('Camera/Microphone API is not available. Please ensure HTTPS or localhost.');
            this.onError(err);
            throw err;
        }

        // Adaptive constraints that work across desktop Chrome, Android Chrome, and iOS Safari
        const constraintTiers = [
            // Tier 1: Ideal HD with audio enhancements
            {
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: { facingMode: { ideal: this.facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }
            },
            // Tier 2: Standard resolution with facing mode
            {
                audio: true,
                video: { facingMode: { ideal: this.facingMode }, width: { ideal: 640 }, height: { ideal: 480 } }
            },
            // Tier 3: Permissive fallback
            {
                audio: true,
                video: true
            }
        ];

        let stream = null;
        let lastErr = null;

        for (const constraints of constraintTiers) {
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                console.log('[WebRTC] Acquired local media stream with constraints:', constraints);
                break;
            } catch (err) {
                lastErr = err;
                console.warn('[WebRTC] Tier constraints failed, attempting fallback...', err.name);
            }
        }

        if (!stream) {
            this.onError(lastErr);
            throw lastErr;
        }

        this.localStream = stream;

        // Attach to local preview video element
        if (videoElement) {
            videoElement.srcObject = this.localStream;
            videoElement.muted = true;
            videoElement.playsInline = true;
            videoElement.setAttribute('playsinline', '');
            videoElement.setAttribute('webkit-playsinline', '');

            videoElement.play().catch(e => {
                console.warn('[WebRTC] Local video play notice:', e);
            });

            this.updateVideoTransform(videoElement);
        }

        // Add local tracks to any already created peer connections
        Object.keys(this.peerConnections).forEach(remotePeerId => {
            const pc = this.peerConnections[remotePeerId];
            this.ensureTracksAdded(pc);
        });

        this.notifyDiagnostics();
        return this.localStream;
    }

    updateVideoTransform(videoElement) {
        if (!videoElement) return;
        videoElement.style.transform = (this.facingMode === 'user' && this.isMirrored) ? 'scaleX(-1)' : 'scaleX(1)';
    }

    /**
     * Add local stream tracks to a peer connection without duplicates
     */
    ensureTracksAdded(pc) {
        if (!pc || !this.localStream) return;
        const currentSenders = pc.getSenders();
        const currentTrackIds = currentSenders.map(s => s.track ? s.track.id : null).filter(Boolean);

        this.localStream.getTracks().forEach(track => {
            if (!currentTrackIds.includes(track.id)) {
                try {
                    pc.addTrack(track, this.localStream);
                    console.log(`[WebRTC] Added local track (${track.kind}: ${track.id}) to peer connection.`);
                } catch (e) {
                    console.warn('[WebRTC] Error adding local track:', e);
                }
            }
        });
    }

    /**
     * Start the real-time serverless REST signaling bridge
     */
    startSignaling() {
        if (this.isPolling) return;
        this.isPolling = true;
        console.log(`[WebRTC Signaling] Started polling for room ${this.roomId} (peer: ${this.peerId})`);

        this.pollSignals();
        this.pollInterval = setInterval(() => this.pollSignals(), this.pollIntervalMs);
    }

    stopSignaling() {
        this.isPolling = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        console.log('[WebRTC Signaling] Polling stopped.');
    }

    async pollSignals() {
        if (!this.roomId || !this.peerId || !this.isPolling) return;
        try {
            const resp = await fetch(`/api/rooms/${this.roomId}/signals?peer_id=${this.peerId}&name=${encodeURIComponent(this.nickname)}&last_id=${this.lastSignalId}`);
            if (!resp.ok) {
                if (resp.status === 404 || resp.status === 403) {
                    console.warn(`[WebRTC Signaling] Room or peer status warning (${resp.status})`);
                }
                return;
            }
            const data = await resp.json();

            // Authoritative participant synchronization
            if (data.participants) {
                this.syncParticipants(data.participants);
            }

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

    /**
     * Authoritative participant list synchronization
     * Guarantees partner detection even if ephemeral signals are delayed or dropped
     */
    syncParticipants(participantsList = []) {
        if (!Array.isArray(participantsList)) return;
        const currentIds = new Set();

        participantsList.forEach(p => {
            if (p.id === this.peerId) return;
            currentIds.add(p.id);

            if (!this.currentParticipants[p.id]) {
                this.currentParticipants[p.id] = p;
                console.log(`[WebRTC Sync] Detected partner from participant list: ${p.name} (${p.id})`);
                this.onPeerJoined(p.id, p.name);

                // If host, initiate connection offer if not already connected
                if (this.isHost && !this.peerConnections[p.id]) {
                    const pc = this.createPeerConnection(p.id, p.name);
                    this.ensureTracksAdded(pc);
                    this.initiateOffer(p.id, pc);
                }
            }
        });

        // Detect participants who have left
        Object.keys(this.currentParticipants).forEach(id => {
            if (!currentIds.has(id)) {
                const p = this.currentParticipants[id];
                console.log(`[WebRTC Sync] Partner left room (absent from list): ${p.name} (${id})`);
                delete this.currentParticipants[id];
                this.closePeer(id);
                this.onPeerLeft(id, p.name);
            }
        });
    }

    async initiateOffer(remotePeerId, pc) {
        if (this.makingOffer[remotePeerId]) return;
        try {
            this.makingOffer[remotePeerId] = true;
            console.log(`[WebRTC] Initiating SDP Offer for ${remotePeerId}...`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log(`[WebRTC] LocalDescription (Offer) set, sending to ${remotePeerId}...`);
            this.sendSignal('OFFER', { sdp: pc.localDescription }, remotePeerId);
        } catch (e) {
            console.error('[WebRTC] Error initiating offer:', e);
        } finally {
            this.makingOffer[remotePeerId] = false;
        }
    }

    async sendSignal(type, data = {}, targetPeerId = null) {
        if (!this.roomId || !this.peerId) return;
        try {
            console.log(`[WebRTC Signaling] Sending signal "${type}" to:`, targetPeerId || 'broadcast');
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
            console.warn('[WebRTC Signaling] Send error:', e);
        }
    }

    /**
     * Create or retrieve RTCPeerConnection for a remote peer
     */
    createPeerConnection(remotePeerId, remoteName = 'Partner') {
        if (this.peerConnections[remotePeerId]) {
            return this.peerConnections[remotePeerId];
        }

        console.log(`[WebRTC] Creating RTCPeerConnection for ${remoteName} (${remotePeerId})`);
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        this.peerConnections[remotePeerId] = pc;
        this.remoteStreams[remotePeerId] = new MediaStream();
        this.iceQueues[remotePeerId] = [];
        this.makingOffer[remotePeerId] = false;

        // Add local media tracks if available
        this.ensureTracksAdded(pc);

        // Handle remote stream tracks
        pc.ontrack = (event) => {
            console.log(`[WebRTC] ontrack triggered for ${remotePeerId}: ${event.track.kind} (${event.track.id})`);
            const rStream = this.remoteStreams[remotePeerId];

            if (!rStream.getTracks().some(t => t.id === event.track.id)) {
                rStream.addTrack(event.track);
            }

            // Track state listeners
            event.track.onmute = () => {
                console.log(`[WebRTC] Remote track muted: ${event.track.kind}`);
                this.notifyDiagnostics();
            };
            event.track.onunmute = () => {
                console.log(`[WebRTC] Remote track unmuted: ${event.track.kind}`);
                this.notifyDiagnostics();
            };

            this.onRemoteStream(remotePeerId, rStream, remoteName);
            this.notifyDiagnostics();
        };

        // ICE candidate generation
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`[WebRTC] Generated ICE candidate for ${remotePeerId}:`, event.candidate.type || 'relay/srflx');
                this.sendSignal('ICE_CANDIDATE', { candidate: event.candidate }, remotePeerId);
            }
        };

        // Connection state monitoring
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            console.log(`[WebRTC] Connection state changed for ${remotePeerId}: ${state}`);
            this.onConnectionState(remotePeerId, state);

            if (state === 'connected') {
                console.log(`[WebRTC] 🎉 Successfully established P2P connection with ${remoteName}!`);
            } else if (state === 'failed') {
                console.warn(`[WebRTC] Connection failed with ${remoteName}. Attempting ICE restart...`);
                this.restartIce(remotePeerId);
            }
            this.notifyDiagnostics();
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`[WebRTC] ICE state changed for ${remotePeerId}: ${pc.iceConnectionState}`);
            this.notifyDiagnostics();
        };

        pc.onsignalingstatechange = () => {
            console.log(`[WebRTC] Signaling state for ${remotePeerId}: ${pc.signalingState}`);
            this.notifyDiagnostics();
        };

        pc.onicegatheringstatechange = () => {
            console.log(`[WebRTC] ICE gathering state: ${pc.iceGatheringState}`);
            this.notifyDiagnostics();
        };

        // DataChannel setup for peer-to-peer raw photo transfer
        if (this.isHost) {
            try {
                console.log(`[WebRTC] Creating DataChannel "photobooth-data" for ${remotePeerId}`);
                const dc = pc.createDataChannel('photobooth-data', { ordered: true });
                this.setupDataChannel(remotePeerId, dc);
            } catch (e) {
                console.warn('[WebRTC] DataChannel creation error:', e);
            }
        } else {
            pc.ondatachannel = (event) => {
                console.log(`[WebRTC] Received DataChannel "${event.channel.label}" from host.`);
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
                        console.log(`[WebRTC DataChannel] Full frame received (${fullBase64.length} chars) from ${peerId}`);
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
                console.warn('[WebRTC DataChannel] Message parse error:', e);
            }
        };

        dc.onopen = () => {
            console.log(`[WebRTC DataChannel] DataChannel OPEN with ${peerId}`);
            this.notifyDiagnostics();
        };

        dc.onclose = () => {
            console.log(`[WebRTC DataChannel] DataChannel closed with ${peerId}`);
            this.notifyDiagnostics();
        };
    }

    /**
     * Drain queued ICE candidates once remote description is set
     */
    async drainIceQueue(peerId, pc) {
        const queue = this.iceQueues[peerId] || [];
        if (queue.length === 0) return;

        console.log(`[WebRTC] Draining ${queue.length} queued ICE candidate(s) for ${peerId}...`);
        while (queue.length > 0) {
            const candidateInit = queue.shift();
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
                console.log(`[WebRTC] Successfully added queued ICE candidate for ${peerId}`);
            } catch (e) {
                console.warn(`[WebRTC] Error adding queued candidate for ${peerId}:`, e);
            }
        }
    }

    /**
     * Handle incoming signals from the REST signaling bridge
     */
    async handleIncomingSignal(sig) {
        const fromPeer = sig.from;
        const type = sig.type;
        const data = sig.data || {};

        if (fromPeer === this.peerId) return;

        switch (type) {
            case 'USER_JOINED': {
                const peerName = data.name || 'Partner';
                console.log(`[WebRTC Signaling] User joined: ${peerName} (${fromPeer})`);
                this.onPeerJoined(fromPeer, peerName);

                // Host initiates the offer upon user joining
                if (this.isHost) {
                    const pc = this.createPeerConnection(fromPeer, peerName);
                    this.ensureTracksAdded(pc);

                    try {
                        this.makingOffer[fromPeer] = true;
                        console.log(`[WebRTC] Creating SDP Offer for ${fromPeer}...`);
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        console.log(`[WebRTC] LocalDescription (Offer) set, sending to ${fromPeer}...`);
                        this.sendSignal('OFFER', { sdp: pc.localDescription }, fromPeer);
                    } catch (e) {
                        console.error('[WebRTC] Error creating offer:', e);
                    } finally {
                        this.makingOffer[fromPeer] = false;
                    }
                }
                break;
            }

            case 'OFFER': {
                console.log(`[WebRTC Signaling] Received OFFER from ${fromPeer}`);
                const pc = this.createPeerConnection(fromPeer, 'Partner');
                this.ensureTracksAdded(pc);

                // Perfect negotiation: Handle collision
                const readyForOffer = !this.makingOffer[fromPeer] && (pc.signalingState === 'stable' || pc.signalingState === 'have-local-offer');
                const offerCollision = !readyForOffer;

                if (offerCollision) {
                    if (!this.isPolite) {
                        console.warn(`[WebRTC] Impolite peer ignoring offer collision from ${fromPeer}`);
                        return;
                    }
                    console.log(`[WebRTC] Polite peer rolling back local offer to accept offer from ${fromPeer}`);
                    try {
                        await pc.setLocalDescription({ type: 'rollback' });
                    } catch (e) {
                        console.warn('[WebRTC] Rollback error:', e);
                    }
                }

                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    console.log(`[WebRTC] RemoteDescription (Offer) set for ${fromPeer}`);

                    // Drain any ICE candidates received before the offer was set
                    await this.drainIceQueue(fromPeer, pc);

                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    console.log(`[WebRTC] Created and set LocalDescription (Answer), sending to ${fromPeer}`);
                    this.sendSignal('ANSWER', { sdp: pc.localDescription }, fromPeer);
                } catch (e) {
                    console.error('[WebRTC] Error handling offer:', e);
                }
                break;
            }

            case 'ANSWER': {
                console.log(`[WebRTC Signaling] Received ANSWER from ${fromPeer}`);
                const pc = this.peerConnections[fromPeer];
                if (pc) {
                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        console.log(`[WebRTC] RemoteDescription (Answer) set for ${fromPeer}`);

                        // Drain any ICE candidates received while waiting for answer
                        await this.drainIceQueue(fromPeer, pc);
                    } catch (e) {
                        console.error('[WebRTC] Error setting remote description from answer:', e);
                    }
                }
                break;
            }

            case 'ICE_CANDIDATE': {
                const pc = this.peerConnections[fromPeer];
                if (!data.candidate) break;

                if (!pc || !pc.remoteDescription) {
                    // Queue candidate until remote description is applied
                    if (!this.iceQueues[fromPeer]) this.iceQueues[fromPeer] = [];
                    this.iceQueues[fromPeer].push(data.candidate);
                    console.log(`[WebRTC] Queued ICE candidate from ${fromPeer} (remote description not ready yet)`);
                } else {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                        console.log(`[WebRTC] Direct ICE candidate added from ${fromPeer}`);
                    } catch (e) {
                        console.warn('[WebRTC] Error adding ICE candidate:', e);
                    }
                }
                break;
            }

            case 'USER_LEFT': {
                console.log(`[WebRTC Signaling] User left: ${fromPeer}`);
                this.closePeer(fromPeer);
                this.onPeerLeft(fromPeer, data.name || 'Partner');
                break;
            }

            case 'START_COUNTDOWN': {
                this.onCountdownStarted(data.targetTime, data.duration, data.shotsCount, data.shotIndex);
                break;
            }

            case 'STILL_PHOTO_TRANSFER': {
                this.onRemoteFrameReceived(fromPeer, data.image, data.shotIndex);
                break;
            }

            case 'RETAKE_REQUEST': {
                this.onRetakeRequested(fromPeer, data.shotIndex);
                break;
            }

            case 'PHOTO_ACCEPTED': {
                this.onPhotoAccepted(fromPeer, data.shotIndex);
                break;
            }

            default:
                break;
        }

        this.notifyDiagnostics();
    }

    /**
     * Restart ICE connection if state drops or fails
     */
    async restartIce(peerId) {
        const pc = this.peerConnections[peerId];
        if (!pc || !this.isHost) return;

        try {
            console.log(`[WebRTC] Triggering ICE restart for ${peerId}...`);
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            this.sendSignal('OFFER', { sdp: pc.localDescription }, peerId);
        } catch (e) {
            console.warn('[WebRTC] ICE restart failed:', e);
        }
    }

    /**
     * Synchronized countdown coordination
     */
    triggerSharedCountdown(duration = 3, shotsCount = 4, shotIndex = 0) {
        const targetTime = Date.now() + (duration * 1000) + 400;

        // Try direct DataChannel for minimum latency
        let sentViaDc = false;
        Object.keys(this.dataChannels).forEach(pId => {
            const dc = this.dataChannels[pId];
            if (dc && dc.readyState === 'open') {
                try {
                    dc.send(JSON.stringify({
                        type: 'COUNTDOWN_TRIGGER',
                        targetTime: targetTime,
                        duration: duration,
                        shotsCount: shotsCount,
                        shotIndex: shotIndex
                    }));
                    sentViaDc = true;
                } catch (e) {}
            }
        });

        // Always also broadcast via signaling bridge as reliable fallback
        this.sendSignal('START_COUNTDOWN', {
            targetTime: targetTime,
            duration: duration,
            shotsCount: shotsCount,
            shotIndex: shotIndex
        });

        // Trigger local countdown
        this.onCountdownStarted(targetTime, duration, shotsCount, shotIndex);
    }

    /**
     * Transfer still captured photo over chunked DataChannel with HTTP fallback
     */
    sendCapturedFrame(base64Data, shotIndex = 0) {
        const CHUNK_SIZE = 16384; // 16KB safe chunk size
        let sentDirect = false;

        Object.keys(this.dataChannels).forEach(pId => {
            const dc = this.dataChannels[pId];
            if (dc && dc.readyState === 'open') {
                try {
                    const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
                    for (let i = 0; i < totalChunks; i++) {
                        const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                        dc.send(JSON.stringify({
                            type: 'CHUNK',
                            chunk: chunk,
                            index: i,
                            isLast: (i === totalChunks - 1),
                            shotIndex: shotIndex
                        }));
                    }
                    sentDirect = true;
                    console.log(`[WebRTC DataChannel] Sent frame (${totalChunks} chunks) to ${pId}`);
                } catch (e) {
                    console.warn('[WebRTC DataChannel] Send failed, falling back to REST:', e);
                }
            }
        });

        if (!sentDirect) {
            this.sendSignal('STILL_PHOTO_TRANSFER', {
                image: base64Data,
                shotIndex: shotIndex
            });
        }
    }

    /**
     * Media Controls (Mic, Cam, Flip, Mirror)
     */
    toggleAudio() {
        if (!this.localStream) return false;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
        console.log(`[WebRTC] Audio track enabled: ${!this.isMuted}`);
        this.notifyDiagnostics();
        return this.isMuted;
    }

    toggleVideo() {
        if (!this.localStream) return false;
        this.isVideoOff = !this.isVideoOff;
        this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isVideoOff);
        console.log(`[WebRTC] Video track enabled: ${!this.isVideoOff}`);
        this.notifyDiagnostics();
        return this.isVideoOff;
    }

    async flipCamera(videoElement) {
        this.facingMode = (this.facingMode === 'user') ? 'environment' : 'user';
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
        }
        await this.startMedia(videoElement, this.facingMode);

        // Replace track on existing peer connections
        const newVideoTrack = this.localStream.getVideoTracks()[0];
        if (newVideoTrack) {
            Object.values(this.peerConnections).forEach(pc => {
                const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    videoSender.replaceTrack(newVideoTrack);
                }
            });
        }
        return this.facingMode;
    }

    toggleMirror(videoElement) {
        this.isMirrored = !this.isMirrored;
        this.updateVideoTransform(videoElement);
        return this.isMirrored;
    }

    closePeer(remotePeerId) {
        if (this.dataChannels[remotePeerId]) {
            try { this.dataChannels[remotePeerId].close(); } catch (e) {}
            delete this.dataChannels[remotePeerId];
        }
        if (this.peerConnections[remotePeerId]) {
            try { this.peerConnections[remotePeerId].close(); } catch (e) {}
            delete this.peerConnections[remotePeerId];
        }
        if (this.remoteStreams[remotePeerId]) {
            delete this.remoteStreams[remotePeerId];
        }
        delete this.iceQueues[remotePeerId];
        delete this.makingOffer[remotePeerId];
        this.notifyDiagnostics();
    }

    leave() {
        this.stopSignaling();
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
        }
        Object.keys(this.peerConnections).forEach(id => this.closePeer(id));

        if (this.roomId && this.peerId) {
            try {
                navigator.sendBeacon(`/api/rooms/${this.roomId}/leave`, JSON.stringify({ peer_id: this.peerId }));
            } catch (e) {}
        }
    }

    /**
     * Retrieve live diagnostic metrics
     */
    getDiagnostics() {
        const localVideoTrack = this.localStream?.getVideoTracks()[0];
        const localAudioTrack = this.localStream?.getAudioTracks()[0];

        const peersInfo = Object.keys(this.peerConnections).map(remoteId => {
            const pc = this.peerConnections[remoteId];
            const rStream = this.remoteStreams[remoteId];
            const rVideoTrack = rStream?.getVideoTracks()[0];
            const rAudioTrack = rStream?.getAudioTracks()[0];
            const dc = this.dataChannels[remoteId];

            return {
                remoteId: remoteId,
                connectionState: pc.connectionState || 'new',
                iceConnectionState: pc.iceConnectionState || 'new',
                iceGatheringState: pc.iceGatheringState || 'new',
                signalingState: pc.signalingState || 'stable',
                dataChannelState: dc ? dc.readyState : 'none',
                receivedAudioTracks: rStream?.getAudioTracks().length || 0,
                receivedVideoTracks: rStream?.getVideoTracks().length || 0,
                remoteVideoTrackState: rVideoTrack ? rVideoTrack.readyState : 'none',
                remoteAudioTrackState: rAudioTrack ? rAudioTrack.readyState : 'none',
                remoteVideoTrackMuted: rVideoTrack ? rVideoTrack.muted : false,
                queuedIceCount: (this.iceQueues[remoteId] || []).length
            };
        });

        return {
            roomId: this.roomId,
            peerId: this.peerId,
            nickname: this.nickname,
            mode: this.mode,
            isHost: this.isHost,
            localStreamActive: !!this.localStream && this.localStream.active,
            localVideoTrackState: localVideoTrack ? localVideoTrack.readyState : 'none',
            localAudioTrackState: localAudioTrack ? localAudioTrack.readyState : 'none',
            peers: peersInfo
        };
    }

    notifyDiagnostics() {
        try {
            this.onDiagnosticsUpdate(this.getDiagnostics());
        } catch (e) {}
    }
}

window.WebRTCRoomManager = WebRTCRoomManager;
