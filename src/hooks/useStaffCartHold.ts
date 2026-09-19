import { useEffect, useMemo } from 'react';
import type { ButtonHTMLAttributes } from 'react';

export const STAFF_CART_HOLD_MS = 3000;
const MOVE_TOLERANCE = 10;

// Kept independent of the DOM so timing and cancellation can be tested.
export function createStaffCartHold(openStaff: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointer: { id: number; x: number; y: number } | undefined;
  let suppressClick = false;
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const cancel = () => {
    if (pointer) suppressClick = true;
    clearTimer();
    pointer = undefined;
  };
  return {
    start(id: number, x: number, y: number, button: number, primary: boolean) {
      cancel();
      if (button !== 0 || !primary) return;
      suppressClick = false;
      pointer = { id, x, y };
      timer = setTimeout(() => {
        timer = undefined;
        suppressClick = true;
        openStaff();
      }, STAFF_CART_HOLD_MS);
    },
    move(id: number, x: number, y: number) {
      if (pointer?.id === id && Math.hypot(x - pointer.x, y - pointer.y) > MOVE_TOLERANCE) cancel();
    },
    end(id: number) {
      if (pointer?.id !== id) return;
      clearTimer();
      pointer = undefined;
    },
    cancel,
    isActive: () => pointer !== undefined,
    shouldSuppressClick: () => suppressClick,
  };
}

export function useStaffCartHold(openCart: () => void, openStaff: () => void): ButtonHTMLAttributes<HTMLButtonElement> {
  const hold = useMemo(() => createStaffCartHold(openStaff), [openStaff]);
  useEffect(() => {
    const cancel = () => hold.cancel();
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      hold.cancel();
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [hold]);
  return {
    onPointerDown: event => hold.start(event.pointerId, event.clientX, event.clientY, event.button, event.isPrimary),
    onPointerMove: event => hold.move(event.pointerId, event.clientX, event.clientY),
    onPointerUp: event => hold.end(event.pointerId),
    onPointerLeave: () => hold.cancel(),
    onPointerCancel: () => hold.cancel(),
    onLostPointerCapture: () => hold.cancel(),
    onBlur: () => hold.cancel(),
    onContextMenu: event => { if (hold.isActive()) event.preventDefault(); },
    onClick: event => {
      // Keyboard and assistive-technology activation must still open the cart.
      if (event.detail !== 0 && hold.shouldSuppressClick()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      openCart();
    },
    style: { touchAction: 'pan-y', userSelect: 'none', WebkitTouchCallout: 'none' },
  };
}