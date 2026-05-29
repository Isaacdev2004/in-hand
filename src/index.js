import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/app.css';
import InHand from './in-hand-v5';
import { initCapacitor } from './native/capacitorBridge';

initCapacitor();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<InHand />);
