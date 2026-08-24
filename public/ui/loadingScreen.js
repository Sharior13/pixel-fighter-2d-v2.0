// Same pattern as pingDisplay.js/statusBanner.js: this class no longer
// touches the DOM. It keeps track of "what should the loading screen
// currently show" as plain state, and hands that to whoever's subscribed
// (see public/src/components/LoadingScreen.jsx). socket.js and
// campaignUI.js call the exact same methods (show/setProgress/
// setWaitingForOpponent/hide) as before - only what happens inside them
// changed.
class LoadingScreenUI {
    constructor() {
        this.state = {
            visible: false,
            local: null,
            opponent: null,
            statusText: 'Loading assets...',
            progressPercent: 0,
        };
        this.subscribers = new Set();
    }

    subscribe(callback) {
        this.subscribers.add(callback);
        callback(this.state);
        return () => this.subscribers.delete(callback);
    }

    setState(partial) {
        this.state = { ...this.state, ...partial };
        this.subscribers.forEach((callback) => callback(this.state));
    }

    show(players, localSocketId) {
        const local = players.find(p => p.socketId === localSocketId) || null;
        const opponent = players.find(p => p.socketId !== localSocketId) || null;

        this.setState({
            visible: true,
            local,
            opponent,
            statusText: 'Loading assets...',
            progressPercent: 0,
        });
    }

    setProgress(loaded, total) {
        if (total > 0) {
            this.setState({ progressPercent: Math.min(100, Math.round((loaded / total) * 100)) });
        }
    }

    setWaitingForOpponent() {
        this.setState({ statusText: 'Waiting for opponent...' });
    }

    hide() {
        this.setState({ visible: false });
    }
}

const loadingScreenUI = new LoadingScreenUI();

export { loadingScreenUI };
