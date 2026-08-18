import PingDisplay from './components/PingDisplay.jsx';

// The root React component. Every screen this migration converts gets
// rendered from somewhere inside here.
//
// A "component" is just a function that returns what should appear on
// screen, written in JSX (HTML-like syntax mixed into JavaScript).
//
// PingDisplay is the first converted piece (Phase 3) - it decides its own
// visibility internally (see PingDisplay.jsx), so it's safe to always
// render it here; nothing shows up until pingDisplay.js's existing
// startPingMonitor()/stopPingMonitor() logic says it should.
export default function App() {
    return <PingDisplay />;
}
