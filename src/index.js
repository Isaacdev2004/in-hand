import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/app.css';
import InHand from './in-hand-v5';
import { initCapacitor } from './native/capacitorBridge';
import { installWindowStorage } from './lib/localStorage';

installWindowStorage();
initCapacitor();

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("In Hand render crash", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", padding: 28, fontFamily: "system-ui, sans-serif", background: "#0f1419", color: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>In Hand hit a snag</div>
          <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 20, wordBreak: "break-word" }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ background: "#3A7BD5", border: "none", borderRadius: 12, padding: "12px 18px", color: "#fff", fontWeight: 700 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AppErrorBoundary>
    <InHand />
  </AppErrorBoundary>
);
