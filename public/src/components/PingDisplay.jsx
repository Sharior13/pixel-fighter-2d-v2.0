import { useEffect, useState } from 'react';
import { subscribePingState } from '../../ui/pingDisplay.js';

// The first real React screen/component in this migration. It replaces the
// old #ping-display div and the DOM code that used to update it directly -
// same markup shape, same CSS classes, same visual result, new technology
// underneath.
//
// useState: gives this component a value ("state") that React remembers
// between renders. Calling the setter function (setPingState below) changes
// the value AND tells React "this component's output may have changed, run
// it again." That's the whole mechanism - no manual DOM updates needed
// anymore, React handles turning the new state into the new markup.
//
// useEffect: runs some code when the component first appears, and lets you
// clean that code up when the component disappears. Here, the "code to run"
// is "start listening to pingDisplay.js's state", and the "cleanup" is
// "stop listening" - subscribePingState() (see pingDisplay.js) returns an
// unsubscribe function for exactly this purpose. The empty array `[]` at
// the end is the "dependency array" - it tells React "only run this setup
// once, when the component first appears, not on every render."
export default function PingDisplay() {
    const [pingState, setPingState] = useState(null);

    useEffect(() => {
        const unsubscribe = subscribePingState(setPingState);
        return unsubscribe;
    }, []);

    if (!pingState) return null;

    const classNames = [pingState.colorClass];
    if (!pingState.visible) classNames.push('hidden');

    return (
        <div id="ping-display" className={classNames.join(' ')}>
            {pingState.text}
        </div>
    );
}
