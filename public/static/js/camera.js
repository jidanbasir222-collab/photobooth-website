/**
 * OUR LITTLE BOOTH — CAMERA MANAGER
 * Handles MediaDevices getUserMedia, device enumeration, front/rear camera flip,
 * mirror modes, error states, and fallback simulation.
 */

class CameraManager {
    constructor(videoElement, options = {}) {
        this.video = videoElement;
        this.options = Object.assign({
            onStreamReady: null,
            onError: null,
            onDeviceChange: null
        }, options);

        this.currentStream = null;
        this.devices = [];
        this.selectedDeviceId = null;
        this.facingMode = 'user'; // 'user' (front) or 'environment' (back)
        this.isMirrored = true;
        this.isActive = false;
        this.isMockMode = false;
        this.mockCanvas = null;
        this.mockAnimationId = null;

        // Bind unload handler to guarantee camera tracks are stopped
        window.addEventListener('beforeunload', () => this.stop());
    }

    /**
     * Check if mediaDevices API is supported by the current browser environment
     */
    isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    /**
     * Request camera permission and start video stream
     */
    async start(deviceId = null, facingMode = null) {
        if (facingMode) this.facingMode = facingMode;
        if (deviceId) this.selectedDeviceId = deviceId;

        this.stop(); // Clean any existing tracks first
        this.isMockMode = false;

        if (!this.isSupported()) {
            const err = new Error('Camera API is not supported by your browser. Please use Chrome, Safari, Firefox, or Edge on localhost / HTTPS.');
            err.name = 'NotSupportedError';
            if (this.options.onError) this.options.onError(err);
            throw err;
        }

        const constraints = {
            audio: false,
            video: {
                width: { ideal: 1920, min: 640 },
                height: { ideal: 1080, min: 480 }
            }
        };

        if (this.selectedDeviceId) {
            constraints.video.deviceId = { exact: this.selectedDeviceId };
        } else if (this.facingMode) {
            constraints.video.facingMode = this.facingMode;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.currentStream = stream;
            this.video.srcObject = stream;
            
            // Wait for video metadata to load and play
            await new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.video.play()
                        .then(() => resolve())
                        .catch(err => {
                            console.warn('Autoplay prevented, retrying:', err);
                            resolve();
                        });
                };
            });

            this.isActive = true;
            this.applyMirrorStyle();

            // Refresh available camera list after permission is granted
            await this.refreshDevices();

            if (this.options.onStreamReady) {
                this.options.onStreamReady(stream);
            }

            return stream;
        } catch (error) {
            this.isActive = false;
            console.error('getUserMedia error:', error);
            if (this.options.onError) {
                this.options.onError(error);
            }
            throw error;
        }
    }

    /**
     * Stop all active video tracks
     */
    stop() {
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => {
                try {
                    track.stop();
                } catch (e) {
                    console.warn('Error stopping track:', e);
                }
            });
            this.currentStream = null;
        }

        if (this.video) {
            this.video.srcObject = null;
        }

        if (this.mockAnimationId) {
            cancelAnimationFrame(this.mockAnimationId);
            this.mockAnimationId = null;
        }

        this.isActive = false;
    }

    /**
     * Refresh the list of video input devices
     */
    async refreshDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            return [];
        }

        try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            this.devices = allDevices.filter(d => d.kind === 'videoinput');
            
            if (this.options.onDeviceChange) {
                this.options.onDeviceChange(this.devices, this.selectedDeviceId);
            }
            return this.devices;
        } catch (e) {
            console.warn('Could not enumerate devices:', e);
            return [];
        }
    }

    /**
     * Toggle front / rear facing mode on devices with multiple cameras
     */
    async flipCamera() {
        this.facingMode = (this.facingMode === 'user') ? 'environment' : 'user';
        this.selectedDeviceId = null; // Clear exact device ID to allow facingMode switch
        
        // Front camera defaults to mirrored; rear camera defaults to unmirrored
        this.isMirrored = (this.facingMode === 'user');
        
        if (this.isActive && !this.isMockMode) {
            return await this.start(null, this.facingMode);
        } else if (this.isMockMode) {
            this.applyMirrorStyle();
        }
    }

    /**
     * Select a specific camera device ID
     */
    async switchCameraDevice(deviceId) {
        if (!deviceId || deviceId === this.selectedDeviceId) return;
        this.selectedDeviceId = deviceId;
        if (this.isActive && !this.isMockMode) {
            return await this.start(deviceId);
        }
    }

    /**
     * Toggle horizontal mirror view
     */
    toggleMirror() {
        this.isMirrored = !this.isMirrored;
        this.applyMirrorStyle();
        return this.isMirrored;
    }

    /**
     * Apply or remove mirror CSS transform on the video element
     */
    applyMirrorStyle() {
        if (!this.video) return;
        if (this.isMirrored) {
            this.video.classList.remove('unmirrored');
        } else {
            this.video.classList.add('unmirrored');
        }
    }

    /**
     * Capture the current video frame to an off-screen HTML Canvas and return it
     */
    captureFrame() {
        if (!this.isActive && !this.isMockMode) {
            throw new Error('Camera is not active');
        }

        const canvas = document.createElement('canvas');
        let width = this.video.videoWidth || 1280;
        let height = this.video.videoHeight || 960;

        // If in mock canvas mode, match mock dimensions
        if (this.isMockMode && this.mockCanvas) {
            width = this.mockCanvas.width;
            height = this.mockCanvas.height;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (this.isMockMode && this.mockCanvas) {
            ctx.drawImage(this.mockCanvas, 0, 0, width, height);
        } else {
            ctx.drawImage(this.video, 0, 0, width, height);
        }

        return {
            canvas: canvas,
            width: width,
            height: height,
            isMirrored: this.isMirrored,
            timestamp: Date.now()
        };
    }

    /**
     * Start virtual mock camera mode (useful for testing or devices without webcams)
     */
    startMockMode(customImageSource = null) {
        this.stop();
        this.isMockMode = true;
        this.isActive = true;

        const width = 1280;
        const height = 960;

        if (!this.mockCanvas) {
            this.mockCanvas = document.createElement('canvas');
        }
        this.mockCanvas.width = width;
        this.mockCanvas.height = height;
        const ctx = this.mockCanvas.getContext('2d');

        let tick = 0;
        const poses = ['✌️', '😝', '😎', '🥳', '🌸', '✨'];

        const drawLoop = () => {
            tick++;
            // Draw cute pastel background
            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, '#FFE8D6');
            grad.addColorStop(1, '#FFCAD4');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            if (customImageSource) {
                // Draw uploaded image centered and cover
                const scale = Math.max(width / customImageSource.width, height / customImageSource.height);
                const sw = customImageSource.width * scale;
                const sh = customImageSource.height * scale;
                const sx = (width - sw) / 2;
                const sy = (height - sh) / 2;
                ctx.drawImage(customImageSource, sx, sy, sw, sh);
            } else {
                // Draw animated cute sibling avatars for demo mode
                const bobY = Math.sin(tick * 0.05) * 15;
                const tilt = Math.sin(tick * 0.03) * 0.05;

                ctx.save();
                ctx.translate(width / 2, height / 2 + bobY);
                ctx.rotate(tilt);

                // Backdrop card
                ctx.fillStyle = '#FFFFFF';
                ctx.shadowColor = 'rgba(74, 51, 43, 0.15)';
                ctx.shadowBlur = 24;
                ctx.beginPath();
                ctx.roundRect(-300, -200, 600, 400, 24);
                ctx.fill();
                ctx.shadowBlur = 0;

                // Sibling Avatars
                ctx.font = '110px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('👧🏻', -120, -10);
                ctx.fillText('👦🏻', 120, -10);

                // Animated heart between them
                const heartScale = 1 + Math.sin(tick * 0.1) * 0.2;
                ctx.save();
                ctx.scale(heartScale, heartScale);
                ctx.font = '50px sans-serif';
                ctx.fillText('💖', 0, -30);
                ctx.restore();

                // Current pose badge
                const poseIndex = Math.floor((tick / 90) % poses.length);
                ctx.font = '40px sans-serif';
                ctx.fillText(poses[poseIndex], 0, 70);

                // Subtitle
                ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
                ctx.fillStyle = '#74564A';
                ctx.fillText('Virtual Sibling Poses • Ready for Snap! ♡', 0, 130);

                ctx.restore();
            }

            // Route canvas stream to video element
            this.mockAnimationId = requestAnimationFrame(drawLoop);
        };

        drawLoop();

        try {
            const stream = this.mockCanvas.captureStream(30);
            this.video.srcObject = stream;
            this.video.play().catch(e => console.log('Mock play notice:', e));
            this.applyMirrorStyle();

            if (this.options.onStreamReady) {
                this.options.onStreamReady(stream);
            }
        } catch (e) {
            console.warn('captureStream error in mock:', e);
        }
    }
}

window.CameraManager = CameraManager;
