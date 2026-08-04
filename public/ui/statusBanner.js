// Small reusable centered banner for brief status messages (match found, opponent
// disconnected, etc). Deliberately generic/single-instance rather than one-off markup
// per message, since both use cases are "show text for a bit, then go away".
let bannerEl = null;
let hideTimeout = null;

const getBannerEl = () => {
    if (!bannerEl) {
        bannerEl = document.getElementById('status-banner');
    }
    return bannerEl;
};

// variant: 'info' (match found, neutral) | 'error' (opponent disconnected, etc)
// duration: ms before auto-hiding, or 0 to leave it up until hideStatusBanner() is called
const showStatusBanner = (text, { duration = 1200, variant = 'info' } = {}) => {
    const el = getBannerEl();
    if (!el) return;

    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }

    el.textContent = text;
    el.className = `status-banner-visible status-banner-${variant}`;

    if (duration > 0) {
        hideTimeout = setTimeout(() => {
            el.classList.remove('status-banner-visible');
            hideTimeout = null;
        }, duration);
    }
};

const hideStatusBanner = () => {
    const el = getBannerEl();
    if (!el) return;

    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
    el.classList.remove('status-banner-visible');
};

export { showStatusBanner, hideStatusBanner };
