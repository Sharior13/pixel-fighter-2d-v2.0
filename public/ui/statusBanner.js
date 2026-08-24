// Small reusable centered banner for brief status messages (match found, opponent
// disconnected, etc). Deliberately generic/single-instance rather than one-off markup
// per message, since both use cases are "show text for a bit, then go away".
//
// Same pattern as pingDisplay.js: this file owns *when* the banner should show
// and what it should say, and hands that off as plain state to whoever's
// subscribed (see public/src/components/StatusBanner.jsx). It doesn't touch
// the DOM directly anymore, and doesn't know React is the one listening.
let bannerState = {
    visible: false,
    text: '',
    variant: 'info',
};

const subscribers = new Set();
let hideTimeout = null;

const setBannerState = (partial) => {
    bannerState = { ...bannerState, ...partial };
    subscribers.forEach((callback) => callback(bannerState));
};

const subscribeBannerState = (callback) => {
    subscribers.add(callback);
    callback(bannerState);
    return () => subscribers.delete(callback);
};

// variant: 'info' (match found, neutral) | 'error' (opponent disconnected, etc)
// duration: ms before auto-hiding, or 0 to leave it up until hideStatusBanner() is called
const showStatusBanner = (text, { duration = 1200, variant = 'info' } = {}) => {
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }

    setBannerState({ visible: true, text, variant });

    if (duration > 0) {
        hideTimeout = setTimeout(() => {
            setBannerState({ visible: false });
            hideTimeout = null;
        }, duration);
    }
};

const hideStatusBanner = () => {
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
    setBannerState({ visible: false });
};

export { showStatusBanner, hideStatusBanner, subscribeBannerState };
