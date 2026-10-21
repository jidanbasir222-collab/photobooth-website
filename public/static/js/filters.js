/**
 * OUR LITTLE BOOTH — FILTERS MODULE
 * Provides 8 authentic retro and aesthetic filters with real-time intensity control.
 * Applies seamlessly to live video preview and final exported Canvas image.
 */

const PhotoFilters = (function () {
    // 8 required filter definitions
    const FILTERS = {
        original: {
            id: 'original',
            name: 'Original',
            icon: '🌿',
            description: 'Natural authentic look',
            getCss: (intensity) => 'none',
            applyCanvas: (ctx, width, height, intensity) => {
                // No modification
            }
        },
        vintage: {
            id: 'vintage',
            name: 'Vintage',
            icon: '🎞️',
            description: 'Warm, faded 90s film look',
            getCss: (intensity) => {
                const factor = intensity / 100;
                const sepia = (35 * factor).toFixed(1);
                const contrast = (100 + 15 * factor).toFixed(1);
                const brightness = (100 + 5 * factor).toFixed(1);
                const saturate = (100 - 15 * factor).toFixed(1);
                return `sepia(${sepia}%) contrast(${contrast}%) brightness(${brightness}%) saturate(${saturate}%)`;
            },
            applyCanvas: (ctx, width, height, intensity) => {
                const factor = intensity / 100;
                // Warm vintage overlay tint
                ctx.save();
                ctx.globalAlpha = 0.12 * factor;
                ctx.fillStyle = '#E8A87C';
                ctx.fillRect(0, 0, width, height);
                // Subtle vignette
                const gradient = ctx.createRadialGradient(width / 2, height / 2, width * 0.35, width / 2, height / 2, width * 0.75);
                gradient.addColorStop(0, 'rgba(0,0,0,0)');
                gradient.addColorStop(1, `rgba(40,25,20,${0.25 * factor})`);
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            }
        },
        black_and_white: {
            id: 'black_and_white',
            name: 'B & W',
            icon: '🖤',
            description: 'Classic monochrome silver screen',
            getCss: (intensity) => {
                const factor = intensity / 100;
                const gray = (100 * factor).toFixed(1);
                const contrast = (100 + 25 * factor).toFixed(1);
                return `grayscale(${gray}%) contrast(${contrast}%)`;
            },
            applyCanvas: (ctx, width, height, intensity) => {
                // Fine contrast boost
                const factor = intensity / 100;
                ctx.save();
                ctx.globalAlpha = 0.05 * factor;
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            }
        },
        warm_film: {
            id: 'warm_film',
            name: 'Warm Film',
            icon: '🌅',
            description: 'Golden hour amber glow',
            getCss: (intensity) => {
                const factor = intensity / 100;
                const sepia = (20 * factor).toFixed(1);
                const saturate = (100 + 20 * factor).toFixed(1);
                const brightness = (100 + 8 * factor).toFixed(1);
                return `sepia(${sepia}%) saturate(${saturate}%) brightness(${brightness}%)`;
            },
            applyCanvas: (ctx, width, height, intensity) => {
                const factor = intensity / 100;
                ctx.save();
                ctx.globalAlpha = 0.14 * factor;
                ctx.fillStyle = '#FFB067';
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            }
        },
        soft_pink: {
            id: 'soft_pink',
            name: 'Soft Pink',
            icon: '🌸',
            description: 'Dreamy pastel blush aesthetic',
            getCss: (intensity) => {
                const factor = intensity / 100;
                const brightness = (100 + 6 * factor).toFixed(1);
                const contrast = (100 - 5 * factor).toFixed(1);
                const saturate = (100 + 10 * factor).toFixed(1);
                return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)`;
            },
            applyCanvas: (ctx, width, height, intensity) => {
                const factor = intensity / 100;
                ctx.save();
                ctx.globalAlpha = 0.16 * factor;
                ctx.fillStyle = '#F5B0BC';
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            }
        },
        sepia: {
            id: 'sepia',
            name: 'Sepia',
            icon: '📜',
            description: 'Antique Victorian scrapbook brown',
            getCss: (intensity) => {
                const factor = intensity / 100;
                const sepia = (85 * factor).toFixed(1);
                const contrast = (100 + 10 * factor).toFixed(1);
                return `sepia(${sepia}%) contrast(${contrast}%)`;
            },
            applyCanvas: (ctx, width, height, intensity) => {
                const factor = intensity / 100;
                ctx.save();
                ctx.globalAlpha = 0.15 * factor;
                ctx.fillStyle = '#704214';
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            }
        },
        cool_tone: {
            id: 'cool_tone',
            name: 'Cool Tone',
            icon: '❄️',
            description: 'Nostalgic cyan / blue chill tint',
            getCss: (intensity) => {
                const factor = intensity / 100;
                const hue = (-15 * factor).toFixed(1);
                const contrast = (100 + 10 * factor).toFixed(1);
                return `hue-rotate(${hue}deg) contrast(${contrast}%)`;
            },
            applyCanvas: (ctx, width, height, intensity) => {
                const factor = intensity / 100;
                ctx.save();
                ctx.globalAlpha = 0.12 * factor;
                ctx.fillStyle = '#6BA4B8';
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            }
        },
        high_contrast: {
            id: 'high_contrast',
            name: 'High Pop',
            icon: '💥',
            description: 'Punchy saturated vivid contrast',
            getCss: (intensity) => {
                const factor = intensity / 100;
                const contrast = (100 + 45 * factor).toFixed(1);
                const saturate = (100 + 25 * factor).toFixed(1);
                return `contrast(${contrast}%) saturate(${saturate}%)`;
            },
            applyCanvas: (ctx, width, height, intensity) => {
                const factor = intensity / 100;
                ctx.save();
                // Subtle vignette for high pop punch
                const gradient = ctx.createRadialGradient(width / 2, height / 2, width * 0.4, width / 2, height / 2, width * 0.7);
                gradient.addColorStop(0, 'rgba(0,0,0,0)');
                gradient.addColorStop(1, `rgba(0,0,0,${0.2 * factor})`);
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, width, height);
                ctx.restore();
            }
        }
    };

    /**
     * Get CSS filter string for a given filter ID and intensity percentage (0-100)
     */
    function getCssFilter(filterId, intensity = 85) {
        const filter = FILTERS[filterId] || FILTERS.original;
        return filter.getCss(intensity);
    }

    /**
     * Apply filter onto an HTML Canvas context.
     * Uses both ctx.filter (where supported) and artistic canvas overlay passes for reliable export.
     */
    function applyToCanvas(ctx, imageSource, dx, dy, dWidth, dHeight, filterId, intensity = 85, isMirrored = false) {
        ctx.save();

        // 1. Position and flip if mirrored
        if (isMirrored) {
            ctx.translate(dx + dWidth, dy);
            ctx.scale(-1, 1);
            dx = 0;
            dy = 0;
        }

        // 2. Set Canvas context filter
        const cssFilter = getCssFilter(filterId, intensity);
        if (ctx.filter !== undefined && cssFilter !== 'none') {
            try {
                ctx.filter = cssFilter;
            } catch (e) {
                console.warn('Canvas filter string unsupported:', e);
            }
        }

        // 3. Draw the underlying image source
        ctx.drawImage(imageSource, dx, dy, dWidth, dHeight);

        // Reset filter for secondary composite overlays
        if (ctx.filter !== undefined) {
            ctx.filter = 'none';
        }

        // 4. Secondary artistic canvas overlay (vignettes, tone tints)
        const filter = FILTERS[filterId] || FILTERS.original;
        if (filter.applyCanvas) {
            filter.applyCanvas(ctx, dWidth, dHeight, intensity);
        }

        ctx.restore();
    }

    /**
     * Return list of all available filters for UI building
     */
    function getFilterList() {
        return Object.values(FILTERS);
    }

    return {
        FILTERS,
        getCssFilter,
        applyToCanvas,
        getFilterList
    };
})();

// Export globally for browser
window.PhotoFilters = PhotoFilters;
