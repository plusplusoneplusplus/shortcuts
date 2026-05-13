import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './react/App';

const root = document.getElementById('app-root');
if (root) {
    createRoot(root).render(<App />);
}
