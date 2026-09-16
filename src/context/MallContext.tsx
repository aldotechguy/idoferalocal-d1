import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import { mallClient, type MallHealth, type MallProductsResponse, type MallCart, type MallOrder, type MallCheckoutBody } from '../services/mallClient';

type MallViewMode = 'catalog' | 'cart' | 'checkout' | 'receipt';

interface MallContextValue {
  health: MallHealth | null;
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
}

const MallContext = createContext<MallContextValue | undefined>(undefined);

export const MallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useToast();
  const [health, setHealth] = useState<MallHealth | null>(null);
  const [products, setProducts] = useState<MallProductsResponse | null>(null);
  const [cart, setCart] = useState<MallCart | null>(null);
  const [order, setOrder] = useState<MallOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<MallViewMode>('catalog');
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refreshProducts = useCallback(async (params?: { q?: string; category?: string; limit?: number; offset?: number }) => {
    try {
      const data = await mallClient.products({ limit: 60, offset: 0, ...(params || {}) });
      setProducts(data);
      setError(null);
    } catch (err) {
      setError(String(err));
      toast.showToast({ title: 'Catalog failed', message: String(err), type: 'error' });
    }
  }, [toast]);

  const refreshCart = useCallback(async () => {
    try {
      const data = await mallClient.cart();
      setCart(data);
      setError(null);
    } catch (err) {
      setError(String(err));
      toast.showToast({ title: 'Cart failed', message: String(err), type: 'error' });
    }
  }, [toast]);

  const addToCart = useCallback(async (productId: string, qty: number): Promise<boolean> => {
    try {
      const data = await mallClient.addToCart(productId, qty);
      setCart(data);
      toast.showToast({ title: 'Added to cart', message: `${qty} × added`, type: 'success' });
      return true;
    } catch (err) {
      setError(String(err));
      toast.showToast({ title: 'Add failed', message: String(err), type: 'error' });
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
      setError(String(err));
      toast.showToast({ title: 'Quantity failed', message: String(err), type: 'error' });
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
      setError(String(err));
      toast.showToast({ title: 'Checkout failed', message: String(err), type: 'error' });
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

  useEffect(() => {
    mallClient.ensureSession();
    setLoading(true);
    Promise.all([mallClient.health(), refreshProducts(), refreshCart()])
      .then(([healthData]) => {
        setHealth(healthData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <MallContext.Provider
      value={{
        health,
        products,
        cart,
        order,
        loading,
        view,
        setView,
        refreshProducts,
        refreshCart,
        addToCart,
        setCartQty,
        removeFromCart,
        checkout,
        newSession,
        error,
        clearError,
      }}
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
