import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MallBrowseGrid, fetchSearch, fetchCategory } from './MallBrowseGrid';
import type { MallProduct } from '../types/mall';

const products: MallProduct[] = [
  {
    id: 'prod-1',
    name: 'Test Product 1',
    description: 'Description 1',
    category: 'Category A',
    brand: 'Brand X',
    unit: 'pcs',
    price: 10000,
    retailPriceKobo: 12000,
    sold: 50,
    stock: 10,
    image: 'https://example.com/img1.jpg',
    images: ['https://example.com/img1.jpg'],
    available: true,
    featured: false,
    promoActive: false,
  },
  {
    id: 'prod-2',
    name: 'Test Product 2',
    description: 'Description 2',
    category: 'Category B',
    brand: 'Brand Y',
    unit: 'pcs',
    price: 20000,
    retailPriceKobo: 25000,
    sold: 30,
    stock: 5,
    image: 'https://example.com/img2.jpg',
    images: ['https://example.com/img2.jpg'],
    available: true,
    featured: true,
    promoActive: true,
  },
];

const baseResponse = {
  products,
  brands: [
    { name: 'Brand X', count: 1 },
    { name: 'Brand Y', count: 1 },
  ],
  total: 2,
  limit: 10,
  offset: 0,
};

const { mockMallClient, mockUseMall } = vi.hoisted(() => ({
  mockMallClient: {
    products: vi.fn(),
  },
  mockUseMall: vi.fn(),
}));

vi.mock('../services/mallClient', () => ({
  mallClient: mockMallClient,
  setMallStaleListener: vi.fn(),
  hasMallPrice: (price: number) => Number.isSafeInteger(price) && price > 0,
  mallAvailabilityLabel: (stock: number) => (stock > 0 ? 'In stock' : 'Out of stock'),
  mallUnavailableLabel: (p: { stock: number; price: number }) =>
    p.stock <= 0 ? 'Out of stock' : p.price > 0 ? 'Unavailable' : 'Price unavailable',
}));

vi.mock('../context/MallContext', () => ({
  useMall: () => mockUseMall(),
}));

describe('MallBrowseGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMallClient.products.mockResolvedValue(baseResponse);
    // Cards (rendered per row) read `cart` to show quantity controls.
    mockUseMall.mockReturnValue({
      cart: null,
      addToCart: vi.fn().mockResolvedValue(true),
      setCartQty: vi.fn().mockResolvedValue(true),
    });
  });

  it('renders product grid with product names and prices', async () => {
    render(<MallBrowseGrid title="Test" fetchKey="test" fetchFn={fetchSearch('')} />);

    await waitFor(() => {
      expect(screen.getByText('Test Product 1')).toBeInTheDocument();
      expect(screen.getByText('Test Product 2')).toBeInTheDocument();
      expect(screen.getByText('₦100')).toBeInTheDocument();
      expect(screen.getByText('₦200')).toBeInTheDocument();
    });
  });

  it('shows the "Showing N of M products" status', async () => {
    render(<MallBrowseGrid title="Test" fetchKey="test" fetchFn={fetchSearch('')} />);

    await waitFor(() => {
      expect(screen.getByText('Showing 2 of 2 products')).toBeInTheDocument();
    });
  });

  it('shows the error state and retry button when fetch fails', async () => {
    mockMallClient.products.mockRejectedValue(new Error('Network error'));

    render(<MallBrowseGrid title="Test" fetchKey="test" fetchFn={fetchSearch('')} />);

    await waitFor(() => {
      expect(screen.getByText('Products could not be loaded')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
  });

  it('shows the empty state when no products are returned', async () => {
    mockMallClient.products.mockResolvedValue({ ...baseResponse, products: [], total: 0 });

    render(<MallBrowseGrid title="Test" fetchKey="test" fetchFn={fetchSearch('')} emptyTitle="No matches" />);

    await waitFor(() => {
      expect(screen.getByText('No matches')).toBeInTheDocument();
    });
  });

  it('renders sort and brand filters', async () => {
    render(<MallBrowseGrid title="Test" fetchKey="test" fetchFn={fetchSearch('')} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /sort/i })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /brand/i })).toBeInTheDocument();
    });
  });

  it('passes the category param through the fetcher', async () => {
    render(<MallBrowseGrid title="Test" fetchKey="test" fetchFn={fetchCategory('Category A')} />);

    await waitFor(() => {
      expect(mockMallClient.products).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Category A', limit: 10, offset: 0, sort: 'relevance' })
      );
    });
  });

  it('re-fetches with the selected sort when it changes', async () => {
    render(<MallBrowseGrid title="Test" fetchKey="test" fetchFn={fetchSearch('')} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /sort/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'price_asc' } });

    await waitFor(() => {
      expect(mockMallClient.products).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'price_asc' })
      );
    });
  });
});
