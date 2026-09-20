import type { MallDeliveryZone } from '../shared/mallDelivery';

export type MallProduct = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  unit: string;
  /** Canonical selling price from D1, in kobo. */
  price: number;
  retailPriceKobo?: number;
  /** Quantity from canonical completed sales in D1. Catalog/search rows report 0; product detail returns the real count. */
  sold: number;
  stock: number;
  image: string;
  images?: string[];
  available: boolean;
  createdAt?: string;
  /** Merchandising flags supplied by the server. */
  featured?: boolean;
  promoActive?: boolean;
};

export type MallCartItem = {
  productId: string;
  name: string;
  unit: string;
  price: number;
  qty: number;
  stock: number;
  image: string;
  available: boolean;
};

export type MallCart = {
  items: MallCartItem[];
  subtotalKobo: number;
  cartId: string;
};

export type MallOrderItem = {
  productId: string;
  name: string;
  unit: string;
  price: number;
  qty: number;
};

export type MallOrder = {
  orderNo: string;
  status: string;
  items: MallOrderItem[];
  subtotalKobo: number;
  deliveryFeeKobo?: number;
  totalKobo?: number;
  deliveryZone?: MallDeliveryZone;
  deliveryLabel?: string;
  quoteRequired?: boolean;
  customerName?: string;
  paidKobo?: number;
  amountDueKobo?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentReference?: string;
  createdAt?: string;
};

export type MallCheckoutBody = {
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryZone?: MallDeliveryZone;
  note?: string;
  paymentMethod?: 'pay_on_pickup' | 'bank_transfer';
};

export type MallBuyerProfile = {
  name: string;
  phone: string;
  address: string;
  savedAt: string;
};

export type MallOrderLookup = {
  paymentStatus?: string;
  updatedAt?: string;
  orderNo: string;
  status: string;
  totalKobo: number;
  createdAt: string;
  itemCount: number;
};

export type MallHealth = {
  ok: boolean;
  routes: string[];
};

export type MallCategory = {
  name: string;
  count: number;
};

export type MallProductsResponse = {
  search?: { query: string; approximate: boolean };
  products: MallProduct[];
  categories: (string | MallCategory)[];
  /** Brand facets for the current search/category scope (full set, not just this page). */
  brands?: MallCategory[];
  total: number;
  limit: number;
  offset: number;
  sort?: string;
};


export type MallApiError = {
  error: string;
};
