import React from 'react';
import { useMall } from '../context/MallContext';
import { getBuyerProfile, saveBuyerProfile } from '../services/mallClient';

export function useBuyerForm() {
  const [mode, setMode] = React.useState<'guest' | 'saved'>('guest');
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [pay, setPay] = React.useState<'pay_on_pickup' | 'bank_transfer'>('pay_on_pickup');
  const [save, setSave] = React.useState(true);
  React.useEffect(() => {
    const b = getBuyerProfile();
    if (b && (b.name || b.phone)) { setName(b.name); setPhone(b.phone); setAddress(b.address); setMode('saved'); }
  }, []);
  return { mode, setMode, name, setName, phone, setPhone, address, setAddress, pay, setPay, save, setSave };
}

export function validateBuyer(name: string, phone: string): string {
  if (!name.trim()) return 'Please enter your name.';
  if (phone.replace(/\D/g, '').length < 7) return 'Enter a valid phone number.';
  return '';
}

export function persistBuyer(mode: string, save: boolean, name: string, phone: string, address: string) {
  if (mode === 'saved' || save) saveBuyerProfile({ name: name.trim(), phone: phone.trim(), address: address.trim() });
}

export function useCheckoutSubmit() {
  const { cart, checkout } = useMall();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  return { cart, checkout, busy, setBusy, err, setErr };
}
