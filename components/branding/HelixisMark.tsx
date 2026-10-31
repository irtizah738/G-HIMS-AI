import type { SVGProps } from 'react';

/**
 * Original Helixis mark, shared across the app shell and authentication pages.
 * Display-only; it does not affect tenant context or authorization.
 * Mirrors the geometric mark used by the isolated investor demo.
 */
export function HelixisMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d="M10 5C10 17 38 15 38 24S10 31 10 43"
        stroke="#48CAE4"
        strokeWidth="5"
        strokeLinecap="square"
      />
      <path
        d="M38 5C38 17 10 15 10 24S38 31 38 43"
        stroke="#00F5D4"
        strokeWidth="5"
        strokeLinecap="square"
      />
      <path
        d="M14 13H34M14 35H34"
        stroke="#F8F9FA"
        strokeWidth="2"
        strokeLinecap="square"
        opacity="0.85"
      />
    </svg>
  );
}
