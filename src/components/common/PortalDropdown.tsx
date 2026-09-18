import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Dropdown menus must stack above every overlay in the app: plain modals use
 * z-50 and AccessibleOverlay portals at z-[9999].
 */
export const PORTAL_DROPDOWN_Z = 10000;

const GAP_PX = 6;
const MIN_HEIGHT_PX = 96;

export type PortalAnchorRect = { left: number; top: number; width: number; height: number };

/**
 * Pure placement math (covered by scripts/frontend-smoke.test.ts): the menu
 * prefers opening below the anchor, flips above it when the space below is
 * smaller than the desired height and the space above is larger, and never
 * extends past the viewport edge.
 */
export function computeMenuStyle(
  anchor: PortalAnchorRect,
  viewport: { width: number; height: number },
  desiredHeight: number,
): React.CSSProperties {
  const spaceBelow = Math.max(0, viewport.height - anchor.top - anchor.height - GAP_PX);
  const spaceAbove = Math.max(0, anchor.top - GAP_PX);
  const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const maxHeight = Math.max(MIN_HEIGHT_PX, Math.min(desiredHeight, openAbove ? spaceAbove : spaceBelow));
  const left = Math.max(0, Math.min(anchor.left, viewport.width - anchor.width));
  return {
    position: 'fixed',
    left,
    width: Math.min(anchor.width, viewport.width),
    maxHeight,
    overflowY: 'auto',
    zIndex: PORTAL_DROPDOWN_Z,
    ...(openAbove
      ? { bottom: viewport.height - anchor.top + GAP_PX }
      : { top: anchor.top + anchor.height + GAP_PX }),
  };
}

const STYLE_KEYS = ['position', 'left', 'width', 'maxHeight', 'top', 'bottom'] as const;
function sameStyle(a: React.CSSProperties, b: React.CSSProperties): boolean {
  return STYLE_KEYS.every((key) => a[key] === b[key]);
}

interface PortalDropdownProps {
  /** Element the menu is anchored to (input, field wrapper, picker root…). */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  children: React.ReactNode;
  /** Surface styling only — placement, height cap and stacking are handled here. */
  className?: string;
  /** Height the menu wants; it flips above the anchor when this does not fit below. */
  desiredHeight?: number;
  /** Receives the portal node so parents can exclude menus from outside-click handling. */
  portalRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Renders dropdown menus through a portal fixed to the viewport instead of an
 * `absolute top-full` element. Menus anchored inside a modal's
 * `overflow-y-auto` scroll container are clipped by it, which pushed the
 * category predictor and product-search results into the back of their modals.
 */
export const PortalDropdown: React.FC<PortalDropdownProps> = ({
  anchorRef,
  open,
  children,
  className = '',
  desiredHeight = 192,
  portalRef,
}) => {
  const [style, setStyle] = React.useState<React.CSSProperties>(() => ({ display: 'none' }));

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      // Hidden anchor (e.g. desktop-only nav after a viewport resize): hide the menu.
      if (rect.width === 0 && rect.height === 0) { setStyle({ display: 'none' }); return; }
      const next = computeMenuStyle(rect, { width: window.innerWidth, height: window.innerHeight }, desiredHeight);
      setStyle((prev) => (sameStyle(prev, next) ? prev : next));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, desiredHeight, open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={(node) => {
        if (portalRef) portalRef.current = node;
      }}
      style={style}
      className={className}
    >
      {children}
    </div>,
    document.body,
  );
};