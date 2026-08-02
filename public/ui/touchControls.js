const KEY_CODES = {
    'w': 'KeyW',
    'a': 'KeyA',
    's': 'KeyS',
    'd': 'KeyD',
    'v': 'KeyV',
    'Shift': 'ShiftLeft',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight'
};

const isTouchDevice = () => {
    return ('ontouchstart' in window) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
        window.matchMedia('(pointer: coarse)').matches;
};

class TouchControls {
    constructor() {
        this.container = document.getElementById('touch-controls');
        if (!this.container) {
            return;
        }

        this.enabled = isTouchDevice();
        this.activePointers = new Map(); // pointerId -> button element

        if (this.enabled) {
            this.bindButtons();
            this.observeBattleState();
            // reflect current state immediately in case battle is already active
            this.syncVisibility();
        }
    }

    bindButtons() {
        const buttons = this.container.querySelectorAll('[data-key]');
        buttons.forEach((btn) => {
            const key = btn.dataset.key;
            const code = KEY_CODES[key] || key;

            const press = (e) => {
                e.preventDefault();
                if (this.activePointers.has(e.pointerId)) return;
                this.activePointers.set(e.pointerId, btn);
                btn.classList.add('pressed');
                window.dispatchEvent(new KeyboardEvent('keydown', {
                    key, code, bubbles: true, cancelable: true
                }));
            };

            const release = (e) => {
                if (!this.activePointers.has(e.pointerId)) return;
                this.activePointers.delete(e.pointerId);
                btn.classList.remove('pressed');
                window.dispatchEvent(new KeyboardEvent('keyup', {
                    key, code, bubbles: true, cancelable: true
                }));
            };

            btn.addEventListener('pointerdown', press);
            btn.addEventListener('pointerup', release);
            btn.addEventListener('pointercancel', release);
            btn.addEventListener('pointerleave', release);
            // avoid the browser turning taps into scroll/zoom gestures
            btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
        });
    }

    // battleUI.js toggles document.body.classList('in-battle') on show()/hide();
    // mirror that onto the touch layer so controls only appear during a match.
    observeBattleState() {
        const observer = new MutationObserver(() => this.syncVisibility());
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    syncVisibility() {
        const inBattle = document.body.classList.contains('in-battle');
        this.container.classList.toggle('hidden', !inBattle);
    }
}

// Initialize once the DOM for this page is ready (module scripts run after parsing).
const touchControls = new TouchControls();

export { touchControls };