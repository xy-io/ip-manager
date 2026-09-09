// ============================================================
//  Shared helpers
//
//  Extracted so the lazily-loaded modals can import them without pulling the
//  whole application module back into the initial bundle — importing from
//  IPAddressManager.jsx would defeat the code split entirely.
// ============================================================

import { useRef, useEffect } from 'react';

let xlsxPromise = null;

export const loadXLSX = () => {
  if (!xlsxPromise) xlsxPromise = import('xlsx');
  return xlsxPromise;
};

export const APP_VERSION = 'v2.15.1';

// Default network configuration (overridden by Settings modal / localStorage)


// ── Modal stack ─────────────────────────────────────────────────────────────
// Escape is handled on `document` in the capture phase, so with two modals
// open every handler fires — in mount order. Network Watch opens the edit form
// on top of itself, and without this the *underlying* view would close while
// the form stayed up.
//
// A tiny stack fixes it: only the most recently opened modal responds. Kept as
// plain functions rather than hidden inside the hook so the ordering can be
// tested without a DOM.
const modalStack = [];
let modalToken = 0;

export function pushModal() {
  modalToken += 1;
  modalStack.push(modalToken);
  return modalToken;
}

export function popModal(token) {
  const i = modalStack.lastIndexOf(token);
  if (i !== -1) modalStack.splice(i, 1);
}

export function isTopModal(token) {
  return modalStack.length > 0 && modalStack[modalStack.length - 1] === token;
}

/** Test seam: forget every registered modal. */
export function resetModalStack() {
  modalStack.length = 0;
}

export function useModalA11y(onClose) {
  const containerRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const node = containerRef.current;
    // Focus the container itself rather than the first control — landing on a
    // destructive button would be worse than landing nowhere.
    if (node) node.focus({ preventScroll: true });

    const SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const token = pushModal();

    const onKeyDown = (e) => {
      // Only the topmost modal reacts, or Escape closes whatever opened first.
      if (!isTopModal(token)) return;
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const focusable = Array.from(node.querySelectorAll(SELECTOR))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      popModal(token);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [onClose]);

  return containerRef;
}

export const DEFAULT_NETWORK_CONFIG = {
  id: 'net-1',
  networkName: "Home Network",
  subnet: "192.168.0",
  dhcpEnabled: true,
  dhcpStart: 1,
  dhcpEnd: 170,
  staticStart: 171,
  staticEnd: 254,
  fixedInDHCP: [6, 50],
};

// Load saved config from localStorage, falling back to defaults (kept for migration)

export const ipOrdinal = (ip, subnet) => {
  const p = ip.split('.');
  return subnetOctetCount(subnet) === 2
    ? (parseInt(p[2]) || 0) * 256 + (parseInt(p[3]) || 0)
    : parseInt(p[3]) || 0;
};

// Convert a stored range value ("170" or "1.170") to a comparable ordinal

export const rangeOrdinal = (val, subnet) => {
  const parts = String(val).split('.');
  return subnetOctetCount(subnet) === 2 && parts.length === 2
    ? (parseInt(parts[0]) || 0) * 256 + (parseInt(parts[1]) || 0)
    : parseInt(parts[parts.length - 1]) || 0;
};

// The host-portion suffix for display (".170" for /24, ".1.170" for /16)

export const subnetOctetCount = (subnet) => subnet.split('.').length;

// Convert a full IP to a host-portion ordinal for numeric comparison/sorting

export const isInDHCPRange = (ip, config = DEFAULT_NETWORK_CONFIG) => {
  if (config.dhcpEnabled === false) return false;
  const ord = ipOrdinal(ip, config.subnet);
  return ord >= rangeOrdinal(config.dhcpStart, config.subnet) &&
         ord <= rangeOrdinal(config.dhcpEnd, config.subnet);
};

export function parseCIDR(raw) {
  const input = raw.trim();
  // Accept "192.168.1.0/24" or shorthand "192.168.1/24"
  const m = input.match(/^(\d{1,3}(?:\.\d{1,3}){0,3})\/(\d{1,2})$/);
  if (!m) return null;
  const prefix = parseInt(m[2], 10);
  if (prefix < 0 || prefix > 32) return null;

  // Expand short notation: "192.168.1" → "192.168.1.0"
  const parts = m[1].split('.').map(Number);
  while (parts.length < 4) parts.push(0);
  if (parts.some(p => p < 0 || p > 255)) return null;

  const ipInt   = (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
  const mask    = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const bcast   = (network | (~mask >>> 0)) >>> 0;

  const toIP = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const toBin = n => n.toString(2).padStart(8, '0');
  const totalHosts = Math.pow(2, 32 - prefix);
  const usable     = prefix >= 31 ? totalHosts : Math.max(0, totalHosts - 2);
  const first      = prefix >= 31 ? network : network + 1;
  const last       = prefix >= 31 ? bcast   : bcast   - 1;

  return {
    cidr:       `${toIP(network)}/${prefix}`,
    network:    toIP(network),
    broadcast:  toIP(bcast),
    firstUsable: toIP(first),
    lastUsable:  toIP(last),
    subnetMask:  toIP(mask),
    wildcardMask: toIP((~mask) >>> 0),
    prefix,
    totalHosts,
    usableHosts: usable,
    nextNetwork: toIP((bcast + 1) >>> 0),
    binary: parts.map((_, i) => toBin((network >>> (24 - i * 8)) & 255)).join('.') + `/${prefix}`,
    ipClass: prefix <= 8 ? 'A' : prefix <= 16 ? 'B' : prefix <= 24 ? 'C' : prefix <= 30 ? 'D' : 'Host',
  };
}
