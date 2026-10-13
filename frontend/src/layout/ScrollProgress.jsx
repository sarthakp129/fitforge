import React from 'react';

/**
 * 3px reading-progress bar pinned above the top bar.
 * The animation itself is pure CSS (animation-timeline: scroll(root)) in
 * scroll.css; this component only renders the element, and hides it entirely
 * on browsers without scroll-driven animations (they never scale it).
 */
export default function ScrollProgress() {
  return <div className="scroll-progress" aria-hidden="true" />;
}
