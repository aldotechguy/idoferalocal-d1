import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MallProductPage } from './MallProductPage';
import type { MallProduct } from '../types/mall';

const product: MallProduct = {
  id: 'prod-1',
  name: 'Test Product',
  description: 'Test description',
  category: 'Category A',
  brand: 'Brand X',
  unit: 'pcs',
  price: 10000,
  retailPriceKobo: 12000,
  sold: 50,
  stock: 10,
  image: 'https://example.com/img.jpg',
  images: ['https://example.com/img.jpg'],
  available: true,
  featured: false,
  promoActive: false,
  wholesaleOffer: { price: 8000, minQty: 5 },
};

const productsResponse = { products: [product], categories: ['Category A'], total: 1, limit: 24, offset: 0 };

const { mockMallClient, mockUseMall, mockGo, mockToast } = vi.hoisted(() => ({
  mockMallClient: { product: vi.fn(), products: vi.fn() },
  mockUseMall: vi.fn(),
  mockGo: vi.fn(),
  mockToast: { showToast: vi.fn() },
}));

vi.mock('../services/mallClient', () => ({
  mallClient: mockMallClient,
}));

vi.mock('../context/MallContext', () => ({
  useMall: () => mockUseMall(),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => mockToast,
}));

vi.mock('../hooks/useRoute', () => ({
  useNavigateMall: () => mockGo,
}));

describe('MallProductPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMallClient.product.mockResolvedValue({ product });
    mockMallClient.products.mockResolvedValue(productsResponse);
    mockUseMall.mockReturnValue({
      products: productsResponse,
      cart: null,
      addToCart: vi.fn().mockResolvedValue(true),
      refreshProducts: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('renders product name, description and price', async () => {
    render(<MallProductPage id="prod-1" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product', level: 1 })).toBeInTheDocument();
      expect(screen.getByText('Test description')).toBeInTheDocument();
      expect(screen.getByText('₦100')).toBeInTheDocument();
    });
  });

  it('shows the wholesale offer invitation', async () => {
    render(<MallProductPage id="prod-1" />);

    await waitFor(() => {
      // formatNaira(8000) -> "₦80"; save = round((1 - 8000/10000)*100) = 20%.
      expect(screen.getByText('Buy 5+ at ₦80 each — save 20%')).toBeInTheDocument();
    });
  });

  it('shows availability for the detail page (binary, not the exact count)', async () => {
    render(<MallProductPage id="prod-1" />);

    await waitFor(() => {
      expect(screen.getByText('In stock')).toBeInTheDocument();
    });
  });

  it('shows the "Add to Cart" button for a purchasable product', async () => {
    render(<MallProductPage id="prod-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeEnabled();
    });
  });

  it('calls addToCart with the product id and current quantity', async () => {
    const { addToCart } = mockUseMall();
    render(<MallProductPage id="prod-1" />);

    const addButton = await screen.findByRole('button', { name: /add to cart/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(addToCart).toHaveBeenCalledWith('prod-1', 1);
    });
  });

  it('disables the add button and shows the out-of-stock label when unavailable', async () => {
    mockMallClient.product.mockResolvedValue({ product: { ...product, available: false, stock: 0 } });
    render(<MallProductPage id="prod-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /out of stock/i })).toBeDisabled();
    });
  });

  it('falls back to a placeholder description when none is provided', async () => {
    mockMallClient.product.mockResolvedValue({ product: { ...product, description: '' } });
    render(<MallProductPage id="prod-1" />);

    await waitFor(() => {
      expect(screen.getByText('Product description has not been provided yet.')).toBeInTheDocument();
    });
  });

  it('shows the product-not-found state when the API returns nothing', async () => {
    mockMallClient.product.mockResolvedValue({ product: null });
    render(<MallProductPage id="prod-1" />);

    await waitFor(() => {
      expect(screen.getByText('Product not found')).toBeInTheDocument();
    });
  });
});
