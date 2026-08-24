import PingDisplay from './components/PingDisplay.jsx';
import StatusBanner from './components/StatusBanner.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';

// The root React component. Every screen this migration converts gets
// rendered from somewhere inside here.
//
// A "component" is just a function that returns what should appear on
// screen, written in JSX (HTML-like syntax mixed into JavaScript).
//
// Each of these decides its own visibility internally (see their own
// files), so it's safe to always render all of them here; nothing shows
// up until the existing vanilla-JS logic that drives each one says it
// should.
export default function App() {
    return (
        <>
            <PingDisplay />
            <StatusBanner />
            <LoadingScreen />
        </>
    );
}
