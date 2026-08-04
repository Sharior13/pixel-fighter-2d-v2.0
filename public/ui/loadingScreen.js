import { ASSET_BASE_URL } from "../core/config.js";

class LoadingScreenUI {
    constructor() {
        this.el = document.getElementById('loading-screen');
    }

    show(players, localSocketId) {
        if (!this.el) return;

        const local = players.find(p => p.socketId === localSocketId);
        const opponent = players.find(p => p.socketId !== localSocketId);

        this.el.innerHTML = `
            <div class="loading-content">
                <div class="loading-matchup">
                    ${this.renderCard(local)}
                    <span class="loading-vs">VS</span>
                    ${this.renderCard(opponent)}
                </div>
                <div class="loading-spinner"></div>
                <div class="loading-status" id="loading-status-text">Loading assets...</div>
                <div class="loading-progress-track">
                    <div class="loading-progress-fill" id="loading-progress-fill" style="width: 0%"></div>
                </div>
            </div>
        `;

        this.el.classList.remove('hidden');
    }

    renderCard(player) {
        if (!player || !player.character) {
            return `<div class="loading-player-card"><span class="silhouette">?</span></div>`;
        }

        const charId = player.character.toLowerCase();
        return `
            <div class="loading-player-card">
                <img src="${ASSET_BASE_URL}/characters/${charId}/${charId}-icon.png" alt="${player.character}">
                <span>${player.character.toUpperCase()}</span>
            </div>
        `;
    }

    setProgress(loaded, total) {
        if (!this.el) return;
        const fill = document.getElementById('loading-progress-fill');
        if (fill && total > 0) {
            fill.style.width = `${Math.min(100, Math.round((loaded / total) * 100))}%`;
        }
    }

    setWaitingForOpponent() {
        if (!this.el) return;
        const status = document.getElementById('loading-status-text');
        if (status) {
            status.textContent = 'Waiting for opponent...';
        }
    }

    hide() {
        if (!this.el) return;
        this.el.classList.add('hidden');
        this.el.innerHTML = '';
    }
}

const loadingScreenUI = new LoadingScreenUI();

export { loadingScreenUI };
