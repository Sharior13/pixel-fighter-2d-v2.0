import { useEffect, useState } from 'react';
import { subscribeBannerState } from '../../ui/statusBanner.js';

// Replaces the old #status-banner div and its direct DOM manipulation.
// Same markup shape, same CSS classes - statusBanner.js still owns *when*
// to show/hide and for how long (showStatusBanner()/hideStatusBanner() are
// unchanged from socket.js's point of view), this component just renders
// whatever state it publishes.
export default function StatusBanner() {
    const [bannerState, setBannerState] = useState(null);

    useEffect(() => {
        const unsubscribe = subscribeBannerState(setBannerState);
        return unsubscribe;
    }, []);

    if (!bannerState) return null;

    // Matches the original's exact class behavior: the variant class stays
    // in place even while hidden (only "-visible" toggles), since the next
    // showStatusBanner() call always sets both together anyway.
    const classNames = [`status-banner-${bannerState.variant}`];
    if (bannerState.visible) classNames.push('status-banner-visible');

    return (
        <div id="status-banner" className={classNames.join(' ')}>
            {bannerState.text}
        </div>
    );
}
