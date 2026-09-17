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
  /** Quantity from canonical completed sales in D1. */
  sold: number;
  stock: number;
  image: string;
  images?: string[];
  available: boolean;
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
  customerName?: string;
  paidKobo?: number;
  createdAt?: string;
};

export type MallCheckoutBody = {
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  note?: string;
  paymentMethod?: 'pay_on_pickup' | 'bank_transfer';
  deliveryFeeNaira?: number;
  paidKobo?: number;
};

export type MallBuyerProfile = {
  name: string;
  phone: string;
  address: string;
  savedAt: string;
};

export type MallOrderLookup = {
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
  products: MallProduct[];
  categories: (string | MallCategory)[];
  total: number;
  limit: number;
  offset: number;
};


export type MallApiError = {
  error: string;
};
