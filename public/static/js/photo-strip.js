/**
 * OUR LITTLE BOOTH — PHOTO STRIP GENERATOR
 * High-resolution HTML5 Canvas rendering for photo strips.
 * Handles layouts (Vertical 3, Vertical 4, 2x2 Grid, Polaroid), filters,
 * custom colors, film borders, typography, date stamps, and decorative stickers.
 */

const PhotoStripGenerator = (function () {
    /**
     * Draw an image with "object-fit: cover" into a target canvas rectangle
     */
    function drawImageCover(ctx, img, targetX, targetY, targetWidth, targetHeight, radius = 0) {
        ctx.save();

        // Optional rounded clip
        if (radius > 0) {
            ctx.beginPath();
            ctx.roundRect(targetX, targetY, targetWidth, targetHeight, radius);
            ctx.clip();
        }

        const imgWidth = img.width || img.videoWidth;
        const imgHeight = img.height || img.videoHeight;
        const imgAspect = imgWidth / imgHeight;
        const targetAspect = targetWidth / targetHeight;

        let renderWidth, renderHeight, offsetX, offsetY;

        if (imgAspect > targetAspect) {
            renderHeight = targetHeight;
            renderWidth = targetHeight * imgAspect;
            offsetX = targetX - (renderWidth - targetWidth) / 2;
            offsetY = targetY;
        } else {
            renderWidth = targetWidth;
            renderHeight = targetWidth / imgAspect;
            offsetX = targetX;
            offsetY = targetY - (renderHeight - targetHeight) / 2;
        }

        ctx.drawImage(img, offsetX, offsetY, renderWidth, renderHeight);
        ctx.restore();
    }

    /**
     * Draw decorative washi tape on canvas
     */
    function drawWashiTape(ctx, x, y, width, height, angle = -2, color = 'rgba(245, 217, 220, 0.85)') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((angle * Math.PI) / 180);

        ctx.fillStyle = color;
        ctx.fillRect(-width / 2, -height / 2, width, height);

        // Striped pattern on tape
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 4;
        const step = 14;
        for (let i = -width; i < width * 2; i += step) {
            ctx.beginPath();
            ctx.moveTo(i - width / 2, -height / 2);
            ctx.lineTo(i - width / 2 + height, height / 2);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Draw film sprocket holes along both vertical edges
     */
    function drawSprockets(ctx, totalHeight, isDarkBg = false) {
        ctx.save();
        const holeWidth = 20;
        const holeHeight = 32;
        const holeRadius = 6;
        const marginX = 26;
        const spacing = 70;

        ctx.fillStyle = isDarkBg ? 'rgba(255, 255, 255, 0.45)' : 'rgba(74, 51, 43, 0.45)';

        for (let y = 60; y < totalHeight - 60; y += spacing) {
            // Left sprocket
            ctx.beginPath();
            ctx.roundRect(marginX, y, holeWidth, holeHeight, holeRadius);
            ctx.fill();

            // Right sprocket
            ctx.beginPath();
            ctx.roundRect(ctx.canvas.width - marginX - holeWidth, y, holeWidth, holeHeight, holeRadius);
            ctx.fill();
        }
        ctx.restore();
    }

    /**
     * Draw cute stickers and doodles
     */
    function drawStickers(ctx, stickerSet, layout, photosLength, width, height, isDarkBg) {
        if (!stickerSet || stickerSet === 'none') return;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const stickerPalette = {
            hearts: ['❤️', '💖', '💕', '🥰', '♡'],
            stars: ['⭐', '🌟', '✨', '✦', '✧'],
            flowers: ['🌸', '🌼', '🌷', '🌺', '✿'],
            smiles: ['😊', '😝', '✌️', '👑', '🎉'],
            all: ['❤️', '⭐', '🌸', '✨', '🥰', '✌️', '♡']
        };

        const list = stickerPalette[stickerSet] || stickerPalette.all;

        // Draw tasteful corner and divider stickers
        if (layout.startsWith('vertical')) {
            // Top sticker
            ctx.font = '48px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(list[0], width * 0.82, 100);

            // Mid accent
            ctx.font = '40px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(list[1 % list.length], width * 0.16, height * 0.48);

            // Bottom doodle
            ctx.font = '46px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(list[2 % list.length], width * 0.85, height * 0.86);

            // Sparkle near title
            ctx.font = '36px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(list[3 % list.length], width * 0.18, 120);
        } else if (layout === 'grid-2x2') {
            // Center intersection badge
            ctx.font = '60px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(list[0], width / 2, height * 0.46);

            // Corners
            ctx.font = '44px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(list[1 % list.length], 90, 90);
            ctx.fillText(list[2 % list.length], width - 90, 90);
        } else if (layout === 'polaroid-single') {
            // Bottom corner of polaroid
            ctx.font = '54px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(list[0], width - 110, height - 120);
            ctx.font = '40px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.fillText(list[1 % list.length], 110, height - 120);
        }

        ctx.restore();
    }

    /**
     * Master render function that outputs the complete photo strip onto any canvas
     */
    async function renderStrip(canvas, config) {
        const {
            photos = [], // Array of captured frame objects: { canvas, isMirrored }
            layout = 'vertical-4', // 'vertical-3', 'vertical-4', 'grid-2x2', 'polaroid-single'
            filterId = 'vintage',
            filterIntensity = 85,
            bgColor = '#FFF8EF',
            spacing = 30,
            hasSprockets = true,
            hasRoundedCorners = true,
            hasWashiTape = true,
            hasDateStamp = true,
            sessionTitle = 'our little booth ♡',
            nicknames = 'Ahmad & Sis',
            footerText = 'our little memories ♡',
            stickersEnabled = true,
            stickerSet = 'hearts',
            targetDate = null
        } = config;

        const isDarkBg = (bgColor === '#1E1A18');
        const textColor = isDarkBg ? '#F5D9DC' : '#4A332B';
        const textMutedColor = isDarkBg ? 'rgba(245, 217, 220, 0.7)' : 'rgba(74, 51, 43, 0.65)';
        const cardFrameColor = isDarkBg ? '#2B2421' : '#FFFFFF';

        // Set dimensions based on layout
        let canvasWidth = 1200;
        let canvasHeight = 3600;

        if (layout === 'vertical-3') {
            canvasWidth = 1200;
            canvasHeight = 2800;
        } else if (layout === 'vertical-4') {
            canvasWidth = 1200;
            canvasHeight = 3600;
        } else if (layout === 'grid-2x2') {
            canvasWidth = 1600;
            canvasHeight = 1750;
        } else if (layout === 'polaroid-single') {
            canvasWidth = 1200;
            canvasHeight = 1500;
        }

        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');

        // 1. Draw solid background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // 2. Subtle background paper texture
        ctx.save();
        ctx.fillStyle = isDarkBg ? 'rgba(255, 255, 255, 0.03)' : 'rgba(116, 86, 74, 0.03)';
        for (let i = 0; i < canvasWidth; i += 32) {
            for (let j = 0; j < canvasHeight; j += 32) {
                if ((i + j) % 64 === 0) {
                    ctx.fillRect(i, j, 3, 3);
                }
            }
        }
        ctx.restore();

        // 3. Film sprocket holes
        if (hasSprockets && layout.startsWith('vertical')) {
            drawSprockets(ctx, canvasHeight, isDarkBg);
        }

        // 4. Header Bar / Title
        const headerTop = layout === 'grid-2x2' ? 70 : 80;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = textColor;
        ctx.font = 'bold 52px "Playfair Display", Georgia, serif';
        ctx.fillText(sessionTitle || 'our little booth ♡', canvasWidth / 2, headerTop + 50);

        // Nicknames & date subtitle
        ctx.font = '600 32px "Caveat", cursive, sans-serif';
        ctx.fillStyle = textMutedColor;
        const dateStr = targetDate || new Date().toISOString().slice(0, 10).replace(/-/g, '.');
        let subtitleText = nicknames ? `${nicknames}` : '';
        if (hasDateStamp) {
            subtitleText += subtitleText ? ` • ${dateStr}` : dateStr;
        }
        ctx.fillText(subtitleText, canvasWidth / 2, headerTop + 95);
        ctx.restore();

        // 5. Draw Photos in Selected Layout
        const photoCornerRadius = hasRoundedCorners ? 18 : 0;
        const padX = hasSprockets && layout.startsWith('vertical') ? 95 : 75;
        const startY = headerTop + 145;

        if (layout === 'vertical-4' || layout === 'vertical-3') {
            const count = layout === 'vertical-3' ? 3 : 4;
            const availableHeight = canvasHeight - startY - 260; // leaving room for footer
            const singleSlotHeight = (availableHeight - (count - 1) * spacing) / count;
            const slotWidth = canvasWidth - padX * 2;

            for (let i = 0; i < count; i++) {
                const y = startY + i * (singleSlotHeight + spacing);

                // Draw photo card frame backing
                ctx.save();
                ctx.fillStyle = cardFrameColor;
                ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
                ctx.shadowBlur = 16;
                ctx.shadowOffsetY = 6;
                ctx.beginPath();
                ctx.roundRect(padX, y, slotWidth, singleSlotHeight, photoCornerRadius);
                ctx.fill();
                ctx.restore();

                // Inner photo padding
                const innerPad = 14;
                const photoX = padX + innerPad;
                const photoY = y + innerPad;
                const photoW = slotWidth - innerPad * 2;
                const photoH = singleSlotHeight - innerPad * 2;

                if (photos[i]) {
                    // Create temporary canvas to apply filter
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = photoW;
                    tempCanvas.height = photoH;
                    const tempCtx = tempCanvas.getContext('2d');

                    // Draw source image cover onto temp canvas
                    drawImageCover(tempCtx, photos[i].canvas, 0, 0, photoW, photoH, 0);

                    // Apply filter and mirror
                    PhotoFilters.applyToCanvas(
                        ctx,
                        tempCanvas,
                        photoX,
                        photoY,
                        photoW,
                        photoH,
                        filterId,
                        filterIntensity,
                        photos[i].isMirrored
                    );
                } else {
                    // Empty placeholder
                    ctx.fillStyle = isDarkBg ? '#382D28' : '#FAF3E0';
                    ctx.beginPath();
                    ctx.roundRect(photoX, photoY, photoW, photoH, photoCornerRadius);
                    ctx.fill();
                    ctx.font = '36px "Plus Jakarta Sans", sans-serif';
                    ctx.fillStyle = textMutedColor;
                    ctx.textAlign = 'center';
                    ctx.fillText(`Photo ${i + 1}`, photoX + photoW / 2, photoY + photoH / 2);
                }
            }
        } else if (layout === 'grid-2x2') {
            // 2 rows by 2 columns
            const gridPadX = 80;
            const availableW = canvasWidth - gridPadX * 2 - spacing;
            const cellW = availableW / 2;
            const cellH = cellW * 0.78;

            for (let i = 0; i < 4; i++) {
                const col = i % 2;
                const row = Math.floor(i / 2);
                const x = gridPadX + col * (cellW + spacing);
                const y = startY + row * (cellH + spacing);

                // Frame
                ctx.save();
                ctx.fillStyle = cardFrameColor;
                ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
                ctx.shadowBlur = 14;
                ctx.shadowOffsetY = 4;
                ctx.beginPath();
                ctx.roundRect(x, y, cellW, cellH, photoCornerRadius);
                ctx.fill();
                ctx.restore();

                const innerPad = 12;
                const px = x + innerPad;
                const py = y + innerPad;
                const pw = cellW - innerPad * 2;
                const ph = cellH - innerPad * 2;

                if (photos[i]) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = pw;
                    tempCanvas.height = ph;
                    const tempCtx = tempCanvas.getContext('2d');
                    drawImageCover(tempCtx, photos[i].canvas, 0, 0, pw, ph, 0);

                    PhotoFilters.applyToCanvas(
                        ctx,
                        tempCanvas,
                        px,
                        py,
                        pw,
                        ph,
                        filterId,
                        filterIntensity,
                        photos[i].isMirrored
                    );
                } else {
                    ctx.fillStyle = isDarkBg ? '#382D28' : '#FAF3E0';
                    ctx.beginPath();
                    ctx.roundRect(px, py, pw, ph, photoCornerRadius);
                    ctx.fill();
                    ctx.font = '36px "Plus Jakarta Sans", sans-serif';
                    ctx.fillStyle = textMutedColor;
                    ctx.textAlign = 'center';
                    ctx.fillText(`Photo ${i + 1}`, px + pw / 2, py + ph / 2);
                }
            }
        } else if (layout === 'polaroid-single') {
            // Big classic Polaroid photo frame
            const frameW = canvasWidth - padX * 2;
            const frameH = canvasHeight - startY - 200;
            const x = padX;
            const y = startY;

            ctx.save();
            ctx.fillStyle = cardFrameColor;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
            ctx.shadowBlur = 20;
            ctx.shadowOffsetY = 8;
            ctx.beginPath();
            ctx.roundRect(x, y, frameW, frameH, photoCornerRadius);
            ctx.fill();
            ctx.restore();

            const borderSide = 24;
            const borderTop = 24;
            const borderBottom = 160; // Extra Polaroid chin for caption
            const pw = frameW - borderSide * 2;
            const ph = frameH - borderTop - borderBottom;
            const px = x + borderSide;
            const py = y + borderTop;

            if (photos[0]) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = pw;
                tempCanvas.height = ph;
                const tempCtx = tempCanvas.getContext('2d');
                drawImageCover(tempCtx, photos[0].canvas, 0, 0, pw, ph, 0);

                PhotoFilters.applyToCanvas(
                    ctx,
                    tempCanvas,
                    px,
                    py,
                    pw,
                    ph,
                    filterId,
                    filterIntensity,
                    photos[0].isMirrored
                );
            }

            // Polaroid handwritten caption at the bottom chin
            ctx.font = '600 48px "Caveat", cursive, sans-serif';
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.fillText(nicknames || 'A Little Memory ♡', canvasWidth / 2, y + frameH - 70);
        }

        // 6. Cute Top Washi Tape
        if (hasWashiTape) {
            drawWashiTape(ctx, canvasWidth / 2, 45, 240, 48, -2, isDarkBg ? 'rgba(232, 180, 184, 0.65)' : 'rgba(245, 217, 220, 0.85)');
        }

        // 7. Decorative Stickers
        if (stickersEnabled) {
            drawStickers(ctx, stickerSet, layout, photos.length, canvasWidth, canvasHeight, isDarkBg);
        }

        // 8. Footer Section
        const footerY = canvasHeight - 110;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 36px "Playfair Display", Georgia, serif';
        ctx.fillStyle = textColor;
        ctx.fillText(footerText || 'our little memories ♡', canvasWidth / 2, footerY);

        ctx.font = '500 24px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = textMutedColor;
        ctx.fillText('our-little-booth • made with love ♡', canvasWidth / 2, footerY + 45);
        ctx.restore();

        return canvas;
    }

    /**
     * Download canvas content as a high-resolution PNG image
     */
    function downloadCanvasAsPng(canvas, filename = 'our-little-booth.png') {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Canvas toBlob failed'));
                    return;
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                resolve({ filename, blob });
            }, 'image/png', 1.0);
        });
    }

    /**
     * Download an individual photo canvas as PNG
     */
    function downloadSinglePhoto(photoObj, filterId, intensity, index = 1) {
        const outCanvas = document.createElement('canvas');
        outCanvas.width = photoObj.canvas.width;
        outCanvas.height = photoObj.canvas.height;
        const ctx = outCanvas.getContext('2d');

        PhotoFilters.applyToCanvas(
            ctx,
            photoObj.canvas,
            0,
            0,
            outCanvas.width,
            outCanvas.height,
            filterId,
            intensity,
            photoObj.isMirrored
        );

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `our-little-photo-${index}-${dateStr}.png`;
        return downloadCanvasAsPng(outCanvas, filename);
    }

    return {
        renderStrip,
        downloadCanvasAsPng,
        downloadSinglePhoto
    };
})();

window.PhotoStripGenerator = PhotoStripGenerator;
