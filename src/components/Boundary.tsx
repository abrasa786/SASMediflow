"use client";

import { Component, type ReactNode } from "react";

/** One section failing must never take the whole page down: it shows a small notice with a retry and the rest of the page keeps working. */
export default class Boundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("section failed:", e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">{this.props.label ?? "This section"} could not load.</p>
        <p className="mt-1">The rest of the page works. Try again.</p>
        <button type="button" onClick={() => this.setState({ failed: false })} className="mt-3 px-4 py-2 rounded-xl border border-amber-300 font-semibold hover:bg-amber-100">Try again</button>
      </div>
    );
  }
}
