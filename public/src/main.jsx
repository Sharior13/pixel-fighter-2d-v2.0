// This is React's entry point - the one new script tag added to index.html
// (see the <script type="module" src="./src/main.jsx"> at the bottom).
//
// createRoot(...).render(...) is React's way of saying "take over this DOM
// node and let React manage everything inside it." Right now that DOM node
// is #react-root, which is empty and sits alongside the existing UI - React
// isn't rendering anything visible yet, it's just proving it can start.
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

const container = document.getElementById('react-root');
createRoot(container).render(<App />);
