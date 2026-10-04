import React from 'react';
import { useMall } from '../context/MallContext';
import { getBuyerProfile, saveBuyerProfile, mallClient } from '../services/mallClient';
import { normalizeMallPhone } from '../shared/mallPhone';
import type { MallDeliveryZone } from '../shared/mallDelivery';

export type RecognizedCustomer = { firstName: string; address?: string };

export function useBuyerForm() {
  const [mode, setMode] = React.useState<'guest' | 'saved'>('guest');
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [deliveryZone, setDeliveryZone] = React.useState<MallDeliveryZone>('pickup');
  const [pay, setPay] = React.useState<'pay_on_pickup' | 'bank_transfer'>('pay_on_pickup');
  const [save, setSave] = React.useState(false);
  // Non-null once the server confirms this phone belongs to a known customer.
  const [recognized, setRecognized] = React.useState<RecognizedCustomer | null>(null);
  const lookupRef = React.useRef(0);
  React.useEffect(() => {
    const b = getBuyerProfile();
    if (b && (b.name || b.phone)) { setName(b.name); setPhone(b.phone); setEmail(b.email || ''); setAddress(b.address); setMode('saved'); }
  }, []);

  /**
   * Phone-first recognition. Only fires for a number the shared normalizer
   * accepts; a miss, a malformed number or a network failure all leave the form
   * exactly as a guest checkout would be. Pre-fills name/address ONLY where the
   * buyer has not already typed something, and never overwrites a saved profile
   * with a server hint that is emptier.
   */
  const lookupCustomer = React.useCallback(async (candidate: string) => {
    if (!normalizeMallPhone(candidate)) { setRecognized(null); return; }
    const seq = ++lookupRef.current;
    try {
      const hint = await mallClient.customerLookup(candidate.trim());
      // Ignore a stale response if the buyer kept editing the phone field.
      if (seq !== lookupRef.current || !hint?.known) { if (!hint?.known) setRecognized(null); return; }
      setRecognized({ firstName: hint.firstName || '', address: hint.address });
      if (hint.firstName) setName((current) => (current.trim() ? current : hint.firstName!));
      if (hint.address) setAddress((current) => (current.trim() ? current : hint.address!));
    } catch {
      if (seq === lookupRef.current) setRecognized(null);
    }
  }, []);

  /** Clears the greeting and drops the pre-filled hint fields (keeps typed input). */
  const clearRecognition = React.useCallback(() => setRecognized(null), []);

  return { mode, setMode, name, setName, phone, setPhone, email, setEmail, address, setAddress, deliveryZone, setDeliveryZone, pay, setPay, save, setSave, recognized, lookupCustomer, clearRecognition };
}

export const MALL_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateBuyer(name: string, phone: string, email = ''): string {
  if (!name.trim()) return 'Please enter your name.';
  if (phone.replace(/\D/g, '').length < 7) return 'Enter a valid phone number.';
  if (email.trim() && !MALL_EMAIL_PATTERN.test(email.trim())) return 'Enter a valid email address.';
  return '';
}

export function persistBuyer(mode: string, save: boolean, name: string, phone: string, address: string, email = '') {
  if (mode === 'saved' || save) saveBuyerProfile({ name: name.trim(), phone: phone.trim(), address: address.trim(), email: email.trim().toLowerCase() });
}

export function useCheckoutSubmit() {
  const { cart, checkout } = useMall();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  return { cart, checkout, busy, setBusy, err, setErr };
}
