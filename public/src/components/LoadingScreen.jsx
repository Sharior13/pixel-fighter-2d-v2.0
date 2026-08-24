import { useEffect, useState } from 'react';
import { loadingScreenUI } from '../../ui/loadingScreen.js';
import { ASSET_BASE_URL } from '../../core/config.js';

// Renders one player's card in the "VS" matchup - character icon + name,
// or a silhouette placeholder if we don't know who they are yet (matches
// the original renderCard()'s fallback exactly).
function PlayerCard({ player }) {
    if (!player || !player.character) {
        return (
            <div className="loading-player-card">
                <span className="silhouette">?</span>
            </div>
        );
    }

    const charId = player.character.toLowerCase();
    return (
        <div className="loading-player-card">
            <img src={`${ASSET_BASE_URL}/characters/${charId}/${charId}-icon.png`} alt={player.character} />
            <span>{player.character.toUpperCase()}</span>
        </div>
    );
}

// Replaces the old #loading-screen div, which used to have its entire
// contents rebuilt via innerHTML every time show() was called.
// loadingScreenUI (loadingScreen.js) still owns exactly when this should
// appear and what it should say - socket.js and campaignUI.js keep calling
// loadingScreenUI.show()/.setProgress()/.setWaitingForOpponent()/.hide()
// with zero changes on their end.
export default function LoadingScreen() {
    const [state, setState] = useState(null);

    useEffect(() => {
        const unsubscribe = loadingScreenUI.subscribe(setState);
        return unsubscribe;
    }, []);

    if (!state || !state.visible) return null;

    return (
        <div id="loading-screen">
            <div className="loading-content">
                <div className="loading-matchup">
                    <PlayerCard player={state.local} />
                    <span className="loading-vs">VS</span>
                    <PlayerCard player={state.opponent} />
                </div>
                <div className="loading-spinner"></div>
                <div className="loading-status">{state.statusText}</div>
                <div className="loading-progress-track">
                    <div className="loading-progress-fill" style={{ width: `${state.progressPercent}%` }}></div>
                </div>
            </div>
        </div>
    );
}
