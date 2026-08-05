import { debugLog, debugWarn } from "./debug.js";

// Desktop only: ask once per browser session (sessionStorage, not
// localStorage) - if the player already dismissed it since opening the tab,
// don't nag them again just because they returned to the main menu. Mobile/
// tablet does NOT use this - see setupMandatoryGate() below, which instead
// stays live for the whole session and re-shows any time the requirement
// stops being met (e.g. rotating back to portrait), since there's no such
// thing as "already handled it" when the device can just rotate back.
const SESSION_FLAG = "fsGateShown";

// Same "does this device primarily use a mouse" check the CSS already uses
// elsewhere (see #touch-controls / #rotate-overlay's own media queries) -
// touch devices (phones AND tablets, regardless of screen size) report
// pointer:coarse/no hover, so this is a more reliable split than a width
// breakpoint alone.
const isDesktopDevice = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const isLandscape = () => window.matchMedia("(orientation: landscape)").matches;

const isFullscreenActive = () =>
    !!(document.fullscreenElement || document.webkitFullscreenElement);

// iPhone Safari (unlike iPadOS) doesn't support the Fullscreen API for
// ordinary page content at all - only for <video>. If we required it
// unconditionally on every touch device, players on that specific
// combination would get stuck behind a mandatory gate they can never
// satisfy. Detect support up front so that case can fall back to just
// requiring landscape instead.
const fullscreenSupported = () =>
    !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

const requestFullscreen = async () => {
    const el = document.documentElement;
    try {
        if (el.requestFullscreen) {
            await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) { // Safari/iPadOS
            await el.webkitRequestFullscreen();
        }
    } catch (err) {
        debugWarn("[FullscreenGate] requestFullscreen failed:", err);
    }
};

// Desktop/laptop: classic one-time-per-session dismissible disclaimer. Once
// closed (X or the full screen button), it's gone for the rest of the tab's
// life - there's no orientation to "go back" on for a mouse-driven device.
const setupDismissibleGate = (gate, { closeBtn, actionBtn }) => {
    if (sessionStorage.getItem(SESSION_FLAG)) {
        return;
    }

    const dismiss = () => {
        gate.classList.remove("visible");
        sessionStorage.setItem(SESSION_FLAG, "1");
    };

    if (closeBtn) {
        closeBtn.addEventListener("click", dismiss);
    }

    if (actionBtn) {
        actionBtn.addEventListener("click", async () => {
            await requestFullscreen();
            dismiss();
        });
    }

    gate.classList.add("visible");
    debugLog("[FullscreenGate] shown (desktop, dismissible)");
};

// Mobile/tablet: stays active for the entire session rather than firing
// once. Re-evaluates on every fullscreen/orientation change and shows or
// hides the gate to match current reality - so rotating back to portrait
// (or backing out of full screen) brings the warning + button straight back,
// instead of it only ever appearing the first time.
const setupMandatoryGate = (gate, { actionBtn, rotateIcon, rotateMsg, message }) => {
    gate.classList.add("mandatory");
    if (rotateIcon) rotateIcon.classList.remove("hidden");

    const canRequestFullscreen = fullscreenSupported();

    if (message) {
        message.textContent = canRequestFullscreen
            ? "Full screen is required to play on this device."
            : "This device doesn't support full screen - please make sure landscape mode is enabled to continue.";
    }
    if (actionBtn && !canRequestFullscreen) {
        // Nothing to request - the button just re-checks orientation.
        actionBtn.textContent = "Continue";
    }

    const orientationMedia = window.matchMedia("(orientation: landscape)");
    const conditionsMet = () =>
        (!canRequestFullscreen || isFullscreenActive()) && isLandscape();

    let wasVisible = null; // force the first refresh() to actually log/apply
    let wasFsActive = null; // same, but for the message/button visibility

    // Unlike the desktop dismissible gate, this one stays live during battle
    // too - just like #rotate-overlay, which is always shown for portrait
    // mobile regardless of what screen the player is on. If the player exits
    // full screen or rotates back to portrait mid-fight, the warning should
    // come straight back rather than staying hidden until they return to a
    // menu.
    const refresh = () => {
        if (rotateMsg) {
            rotateMsg.classList.toggle("hidden", isLandscape());
        }

        // On devices that support fullscreen, the disclaimer message and
        // button track LIVE fullscreen state rather than being permanently
        // dismissed the first time full screen is granted - if the player
        // later exits full screen (swipes it away, the OS kicks them out,
        // etc.) the message + button come straight back so they can
        // re-enter it.
        if (canRequestFullscreen) {
            const fsActive = isFullscreenActive();
            if (fsActive !== wasFsActive) {
                wasFsActive = fsActive;
                if (message) message.classList.toggle("hidden", fsActive);
                if (actionBtn) actionBtn.classList.toggle("hidden", fsActive);
                debugLog(`[FullscreenGate] full screen ${fsActive ? "granted - disclaimer/button hidden" : "exited - disclaimer/button restored"}`);
            }
        }

        const shouldShow = !conditionsMet();

        if (shouldShow === wasVisible) {
            return;
        }
        wasVisible = shouldShow;

        gate.classList.toggle("visible", shouldShow);
        debugLog(`[FullscreenGate] mobile gate ${shouldShow ? "shown" : "cleared"}`);
    };

    document.addEventListener("fullscreenchange", refresh);
    document.addEventListener("webkitfullscreenchange", refresh);
    orientationMedia.addEventListener?.("change", refresh);
    window.addEventListener("resize", refresh); // belt-and-suspenders: not every browser fires the above reliably on rotate

    if (actionBtn) {
        actionBtn.addEventListener("click", async () => {
            if (canRequestFullscreen) {
                await requestFullscreen();
            }
            refresh();
        });
    }

    refresh(); // reflect current state immediately (e.g. tablet already in landscape)
};

// Call once, on page load (see titleScreen.js). No-op if the markup isn't
// present for some reason.
const initFullscreenGate = () => {
    const gate = document.getElementById("fullscreen-gate");
    if (!gate) {
        return;
    }

    const elements = {
        closeBtn: document.getElementById("fullscreen-gate-close"),
        actionBtn: document.getElementById("fullscreen-gate-btn"),
        rotateIcon: document.getElementById("fullscreen-gate-rotate-icon"),
        rotateMsg: document.getElementById("fullscreen-gate-rotate-message"),
        message: document.getElementById("fullscreen-gate-message"),
    };

    if (isDesktopDevice()) {
        setupDismissibleGate(gate, elements);
    } else {
        setupMandatoryGate(gate, elements);
    }
};

export { initFullscreenGate };