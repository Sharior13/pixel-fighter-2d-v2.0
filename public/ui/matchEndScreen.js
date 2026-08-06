import { socket, cleanupSocket } from "../core/socket.js";
import { titleScreenUI } from "./titleScreen.js";
import { audioManager } from "../core/audioManager.js";
import { debugLog, debugError } from "../core/debug.js";

class MatchEndScreen {
    constructor() {
        this.screenElement = null;
        this.isWaitingForRematch = false;
        this.matchData = null;
        this.isBot = false;
        // see scheduleBotLeave() - simulates a bot "leaving" some random
        // time after the results screen is already showing, never mid-match.
        this.botLeaveTimeout = null;
        this.createScreenElement();
    }

    createScreenElement() {
        // Create the match end screen HTML
        const screen = document.createElement('div');
        screen.id = 'match-end-screen';
        screen.innerHTML = `
            <div class="result-container">
                <div class="result-text"></div>
                <div class="result-subtext"></div>
                <div class="match-stats">
                    <div class="player-stats player1-stats">
                        <div class="player-label">YOU</div>
                        <div class="player-character"></div>
                        <div class="stat-row">
                            <span class="stat-label">Damage Dealt:</span>
                            <span class="stat-value damage-dealt">0</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Damage Taken:</span>
                            <span class="stat-value damage-taken">0</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Combo Count:</span>
                            <span class="stat-value combo-count">0</span>
                        </div>
                    </div>
                    <div class="player-stats player2-stats">
                        <div class="player-label">OPPONENT</div>
                        <div class="player-character"></div>
                        <div class="stat-row">
                            <span class="stat-label">Damage Dealt:</span>
                            <span class="stat-value damage-dealt">0</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Damage Taken:</span>
                            <span class="stat-value damage-taken">0</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Combo Count:</span>
                            <span class="stat-value combo-count">0</span>
                        </div>
                    </div>
                </div>
                <div class="match-end-buttons">
                    <button class="match-end-btn rematch-btn" id="rematch-btn">
                        Rematch
                    </button>
                    <button class="match-end-btn main-menu-btn" id="main-menu-btn">
                        Main Menu
                    </button>
                </div>
                <div class="waiting-text" style="display: none;">
                    Waiting for opponent...
                </div>
            </div>
        `;

        document.body.appendChild(screen);
        this.screenElement = screen;

        // Bind button events
        document.getElementById('rematch-btn').addEventListener('click', () => this.requestRematch());
        document.getElementById('main-menu-btn').addEventListener('click', () => this.returnToMenu());
    }

    show(matchData) {
        // A real (non-bot) opponent disconnecting right after the match already ended -
        // e.g. clicking "Main Menu" without requesting a rematch - can make the server
        // send a SECOND "matchEnd" here, treating that disconnect as a forfeit without
        // realizing the match was already decided. If we're already displaying a result
        // for this match, don't let that second event re-derive victory/defeat and
        // stomp the real outcome (this is what was flipping a real DEFEAT into a
        // VICTORY). Just treat it like any other "opponent left the results screen"
        // case instead - same handling the bot-leave path already uses.
        if (this.screenElement.classList.contains('show')) {
            debugLog('[MatchEndScreen] Ignoring duplicate matchEnd while a result is already showing - treating as opponent leaving');
            this.simulateOpponentLeft();
            return;
        }

        this.matchData = matchData;
        const { winner, localPlayer, opponent, reason, isBot } = matchData;

        debugLog('[MatchEndScreen] Showing results');
        debugLog('[MatchEndScreen] Winner:', winner);
        debugLog('[MatchEndScreen] Local player:', localPlayer);
        debugLog('[MatchEndScreen] Opponent:', opponent);

        const isVictory = winner === socket.id;

        // Set result text and styling
        const resultText = this.screenElement.querySelector('.result-text');
        const resultSubtext = this.screenElement.querySelector('.result-subtext');
        const resultContainer = this.screenElement.querySelector('.result-container');

        if (isVictory) {
            resultText.textContent = 'VICTORY';
            resultText.classList.add('victory');
            resultContainer.classList.add('victory');
        } else {
            resultText.textContent = 'DEFEAT';
            resultText.classList.add('defeat');
            resultContainer.classList.add('defeat');
        }

        if (resultSubtext) {
            resultSubtext.textContent = reason === 'opponent_disconnected' ? 'Opponent disconnected' : '';
        }

        // If the opponent already left, there's no one to rematch with - disable
        // the button so the player isn't left waiting on a request that can never
        // be accepted.
        this.opponentLeft = reason === 'opponent_disconnected';
        const rematchBtn = document.getElementById('rematch-btn');
        if (rematchBtn) {
            rematchBtn.disabled = this.opponentLeft;
            rematchBtn.textContent = this.opponentLeft ? 'Opponent Left' : 'Rematch';
        }

        // Fill in stats
        this.updatePlayerStats('.player1-stats', localPlayer, isVictory);
        this.updatePlayerStats('.player2-stats', opponent, !isVictory);

        // Match is over - hide any in-battle-only UI (rotate prompt, touch controls)
        document.body.classList.remove('in-battle');

        // Show the screen
        this.screenElement.classList.add('show');

        // Bot opponents have no real connection to drop (see botController.js -
        // it's just a client-side input generator, the server never sees an
        // actual "bot player" socket) so there's nothing to disconnect DURING
        // the fight. Instead, once results are already up, simulate the bot
        // player closing the tab/app shortly after seeing the outcome - same
        // as a human opponent might - purely for realism. Real disconnect
        // reasons (reason === 'opponent_disconnected', handled above) always
        // take priority and this is skipped in that case via the opponentLeft
        // check inside scheduleBotLeave().
        this.isBot = !!isBot;
        this.scheduleBotLeave();
    }

    // Random 1-10s after the results screen is shown, simulate the bot
    // opponent leaving (only for bot matches, and only if the match didn't
    // already end in a real disconnect). Cancelled automatically whenever
    // the screen is hidden (rematch accepted or returning to menu) - see hide().
    scheduleBotLeave() {
        this.clearBotLeaveTimeout();

        if (!this.isBot || this.opponentLeft) {
            return;
        }

        const delay = 1000 + Math.random() * 9000; // 1-10s, per requirements
        this.botLeaveTimeout = setTimeout(() => {
            this.botLeaveTimeout = null;
            this.simulateOpponentLeft();
        }, delay);
    }

    clearBotLeaveTimeout() {
        if (this.botLeaveTimeout) {
            clearTimeout(this.botLeaveTimeout);
            this.botLeaveTimeout = null;
        }
    }

    // Applies the same "opponent's gone" UI treatment show() uses for a real
    // reason === 'opponent_disconnected' match end, but triggered client-side
    // instead of at show()-time. Two callers: scheduleBotLeave() (bot opponents,
    // on a random delay) and show() itself (a real opponent's post-match
    // disconnect arriving as a stray second matchEnd - see the guard at the
    // top of show()).
    simulateOpponentLeft() {
        // Screen already dismissed (player left first, or a rematch already
        // kicked off) - nothing to update.
        if (!this.screenElement.classList.contains('show') || this.opponentLeft) {
            return;
        }

        this.opponentLeft = true;

        const resultSubtext = this.screenElement.querySelector('.result-subtext');
        if (resultSubtext) {
            resultSubtext.textContent = 'Opponent disconnected';
        }

        const rematchBtn = document.getElementById('rematch-btn');
        if (rematchBtn) {
            rematchBtn.disabled = true;
            rematchBtn.textContent = 'Opponent Left';
        }

        // If we'd already requested a rematch and were sitting in "Waiting for
        // opponent...", this is exactly the "they left before accepting" case -
        // reuse the same decline handling a real opponent leaving would trigger.
        if (this.isWaitingForRematch) {
            this.handleRematchDeclined();
        }
    }

    updatePlayerStats(selector, playerData, isWinner) {
        if (!playerData) {
            debugError('[MatchEndScreen] No player data provided for', selector);
            return;
        }

        const statsContainer = this.screenElement.querySelector(selector);

        if (isWinner) {
            statsContainer.classList.add('winner');
        } else {
            statsContainer.classList.add('loser');
        }

        // Display character name
        const characterName = playerData.character || 'Unknown';
        statsContainer.querySelector('.player-character').textContent = characterName.toUpperCase();
        
        // FIXED: Access stats from correct property structure
        // The server sends stats in various formats, try all possible locations
        const damageDealt = playerData.damageDealt || 
                           playerData.damage || 
                           (playerData.stats && playerData.stats.damageDealt) || 
                           0;
        
        const damageTaken = playerData.damageReceived || 
                           playerData.damageTaken || 
                           (playerData.stats && playerData.stats.damageReceived) || 
                           0;
        
        const comboCount = playerData.maxCombo || 
                          playerData.combo || 
                          (playerData.stats && playerData.stats.maxCombo) || 
                          0;

        debugLog(`[MatchEndScreen] ${selector} stats:`, {
            damageDealt,
            damageTaken,
            comboCount,
            rawData: playerData
        });

        statsContainer.querySelector('.damage-dealt').textContent = Math.round(damageDealt);
        statsContainer.querySelector('.damage-taken').textContent = Math.round(damageTaken);
        statsContainer.querySelector('.combo-count').textContent = comboCount;
    }

    requestRematch() {
        if (!socket || this.isWaitingForRematch || this.opponentLeft) {
            return;
        }

        const rematchBtn = document.getElementById('rematch-btn');
        const waitingText = this.screenElement.querySelector('.waiting-text');

        // Disable button and show waiting
        rematchBtn.disabled = true;
        waitingText.style.display = 'block';
        this.isWaitingForRematch = true;

        // Send rematch request to server
        socket.emit('rematchRequest');

        debugLog('[MatchEnd] Rematch requested');
    }

    returnToMenu() {
        // Send decline signal if waiting for rematch
        if (this.isWaitingForRematch && socket) {
            socket.emit('rematchDecline');
        }

        // Clean up and return to title screen
        this.hide();
        
        // Stop any playing music and ensure clean state
        audioManager.stopMusic(false); // Immediate stop, no fade
        
        // Clean up socket connection
        cleanupSocket();

        // Show title screen (which will start title music)
        titleScreenUI.showTitleScreen();
    }

    hide() {
        this.screenElement.classList.remove('show');
        this.isWaitingForRematch = false;
        this.isBot = false;
        this.clearBotLeaveTimeout();

        // Reset classes
        const resultText = this.screenElement.querySelector('.result-text');
        const resultContainer = this.screenElement.querySelector('.result-container');

        resultText.classList.remove('victory', 'defeat');
        resultContainer.classList.remove('victory', 'defeat');

        this.screenElement.querySelectorAll('.player-stats').forEach(stat => {
            stat.classList.remove('winner', 'loser');
        });

        // Reset buttons
        this.opponentLeft = false;
        const rematchBtn = document.getElementById('rematch-btn');
        if (rematchBtn) {
            rematchBtn.disabled = false;
            rematchBtn.textContent = 'Rematch';
        }
        this.screenElement.querySelector('.waiting-text').style.display = 'none';
    }

    handleRematchAccepted() {
        debugLog('[MatchEnd] Rematch accepted! Returning to character select...');
        this.hide();
    }

    handleRematchDeclined() {
        const waitingText = this.screenElement.querySelector('.waiting-text');
        waitingText.textContent = 'Opponent declined rematch';
        waitingText.style.color = '#FF4444';

        setTimeout(() => {
            this.returnToMenu();
        }, 2000);
    }
}

// Create singleton instance
const matchEndScreen = new MatchEndScreen();

export { matchEndScreen };