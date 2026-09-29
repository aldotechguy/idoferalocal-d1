import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../context/ToastContext';
import { mallClient, setMallStaleListener, type MallProductsResponse, type MallCart, type MallOrder, type MallCheckoutBody } from '../services/mallClient';

type MallViewMode = 'catalog' | 'cart' | 'checkout' | 'receipt';

interface MallContextValue {
  products: MallProductsResponse | null;
  cart: MallCart | null;
  order: MallOrder | null;
  loading: boolean;
  view: MallViewMode;
  setView: (v: MallViewMode) => void;
  refreshProducts: (params?: { q?: string; category?: string; limit?: number; offset?: number }) => Promise<void>;
  refreshCart: () => Promise<void>;
  addToCart: (productId: string, qty: number) => Promise<boolean>;
  setCartQty: (productId: string, qty: number) => Promise<boolean>;
  removeFromCart: (productId: string) => Promise<boolean>;
  checkout: (body: MallCheckoutBody) => Promise<boolean>;
  newSession: () => void;
  error: string | null;
  clearError: () => void;
  /** True when the products on screen came from the offline cache. */
  stale: boolean;
}

const MallContext = createContext<MallContextValue | undefined>(undefined);
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export const MallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useToast();
  const [products, setProducts] = useState<MallProductsResponse | null>(null);
  const [cart, setCart] = useState<MallCart | null>(null);
  const [order, setOrder] = useState<MallOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<MallViewMode>('catalog');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const clearError = useCallback(() => setError(null), []);

  /**
   * Catalog read. The caller's `limit` always wins: the homepage's own grid asks
   * for a 10-row page, and the previous unconditional `limit: 60` default made
   * every boot fetch (and cache) six times the rows the shopper would ever see.
   */
  const refreshProducts = useCallback(async (params?: { q?: string; category?: string; limit?: number; offset?: number }) => {
    try {
      const data = await mallClient.products({ limit: 24, offset: 0, ...(params || {}) });
      setProducts(data);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
      toast.showToast({ title: 'Catalog failed', message: messageOf(err), type: 'error' });
    }
  }, [toast]);

  const refreshCart = useCallback(async () => {
    try {
      const data = await mallClient.cart();
      setCart(data);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
      toast.showToast({ title: 'Cart failed', message: messageOf(err), type: 'error' });
    }
  }, [toast]);

  const addToCart = useCallback(async (productId: string, qty: number): Promise<boolean> => {
    try {
      const data = await mallClient.addToCart(productId, qty);
      setCart(data);
      toast.showToast({ title: 'Added to cart', message: `${qty} × added`, type: 'success' });
      return true;
    } catch (err) {
      setError(messageOf(err));
      toast.showToast({ title: 'Add failed', message: messageOf(err), type: 'error' });
      return false;
    }
  }, [toast]);

  const setCartQty = useCallback(async (productId: string, qty: number): Promise<boolean> => {
    try {
      const data = await mallClient.setCartQty(productId, qty);
      setCart(data);
      setError(null);
      return true;
    } catch (err) {
      setError(messageOf(err));
      toast.showToast({ title: 'Quantity failed', message: messageOf(err), type: 'error' });
      return false;
    }
  }, [toast]);

  const removeFromCart = useCallback(async (productId: string): Promise<boolean> => {
    return setCartQty(productId, 0);
  }, [setCartQty]);

  const checkout = useCallback(async (body: MallCheckoutBody): Promise<boolean> => {
    try {
      const data = await mallClient.checkout(body);
      setOrder(data);
      setCart(null);
      setView('receipt');
      toast.showToast({ title: 'Order placed', message: data.orderNo, type: 'success' });
      return true;
    } catch (err) {
      setError(messageOf(err));
      toast.showToast({ title: 'Checkout failed', message: messageOf(err), type: 'error' });
      return false;
    }
  }, [toast]);

  const newSession = useCallback(() => {
    mallClient.resetSession();
    setCart(null);
    setOrder(null);
    setView('catalog');
    toast.showToast({ title: 'New session', message: 'Cart reset', type: 'info' });
  }, [toast]);

  // Reconnect must actually refresh, not just flip the banner. The reads are
  // network-first, so a successful one also clears `stale` on its own and the
  // "showing saved products" notice disappears without any extra bookkeeping.
  // The ref guard keeps a flapping connection from starting a request storm.
  const reconnectingRef = React.useRef(false);
  React.useEffect(() => {
    const handleOnline = () => {
      if (reconnectingRef.current) return;
      reconnectingRef.current = true;
      void Promise.all([refreshProducts(), refreshCart()])
        .catch(() => { /* the banner keeps telling the truth */ })
        .finally(() => { reconnectingRef.current = false; });
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refreshProducts, refreshCart]);

  // The client reports whether a read fell back to the offline cache, so the
  // banner can say "saved products" instead of a false "you are offline".
  React.useEffect(() => {
    setMallStaleListener(setStale);
    return () => setMallStaleListener(null);
  }, []);

  /**
   * Boot: the catalog is the only request that gates first paint, so it runs
   * alone. The cart and the rail payload are deliberately NOT in this promise --
   * they fill in behind the shell, so a slow link shows the storefront chrome and
   * product grid instead of an empty spinner waiting on three round-trips.
   */
  useEffect(() => {
    let active = true;
    mallClient.ensureSession();
    setLoading(true);
    refreshProducts()
      .then(() => { if (active) setLoading(false); })
      .catch(() => { if (active) setLoading(false); });
    // Cart and home rails hydrate after first paint; neither blocks the UI and
    // both are served from the cache when the network is unavailable.
    void refreshCart().catch(() => { /* the banner reports offline; keep the cached cart */ });
    return () => { active = false; };
  }, [refreshProducts, refreshCart]);

  // Stable context value: it used to be rebuilt on every provider render, so
  // every Mall consumer re-rendered whenever anything in the tree re-rendered.
  const value = useMemo<MallContextValue>(() => ({
    products, cart, order, loading, view, setView,
    refreshProducts, refreshCart, addToCart, setCartQty, removeFromCart,
    checkout, newSession, error, clearError, stale,
  }), [products, cart, order, loading, view, refreshProducts, refreshCart, addToCart, setCartQty, removeFromCart, checkout, newSession, error, clearError, stale]);

  return (
    <MallContext.Provider
      value={value}
    >
      {children}
    </MallContext.Provider>
  );
};

export const useMall = (): MallContextValue => {
  const context = useContext(MallContext);
  if (!context) {
    throw new Error('useMall must be used within <MallProvider>');
  }
  return context;
};
