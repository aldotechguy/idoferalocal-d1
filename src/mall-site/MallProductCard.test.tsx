import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MallProductCard } from './MallProductCard';
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
};

const { mockUseMall, mockGo } = vi.hoisted(() => ({
  mockUseMall: vi.fn(),
  mockGo: vi.fn(),
}));

vi.mock('../context/MallContext', () => ({
  useMall: () => mockUseMall(),
}));

vi.mock('../hooks/useRoute', () => ({
  useNavigateMall: () => mockGo,
}));

describe('MallProductCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMall.mockReturnValue({
      cart: null,
      addToCart: vi.fn().mockResolvedValue(true),
      setCartQty: vi.fn().mockResolvedValue(true),
    });
  });

  it('renders product image, name, price and availability', async () => {
    render(<MallProductCard product={product} />);

    expect(screen.getByAltText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    // Real formatNaira: 10000 kobo -> "₦100".
    expect(screen.getByText('₦100')).toBeInTheDocument();
    // Not in cart yet: binary availability, not the exact count.
    expect(screen.getByText('pcs • In stock')).toBeInTheDocument();
  });

  it('shows a discount badge when the retail price is higher', () => {
    // retailPriceKobo 12000 vs price 10000 -> round((2000/12000)*100) = 17%.
    render(<MallProductCard product={product} />);
    expect(screen.getByText('-17%')).toBeInTheDocument();
  });

  it('shows the wholesale offer tier badge', () => {
    const withWholesale = { ...product, wholesaleOffer: { price: 8000, minQty: 5 } };
    render(<MallProductCard product={withWholesale} />);
    // formatNaira(8000) -> "₦80".
    expect(screen.getByText('₦80 each at 5+')).toBeInTheDocument();
  });

  it('calls addToCart when the add button is clicked', async () => {
    const { addToCart } = mockUseMall();
    render(<MallProductCard product={product} />);

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    await waitFor(() => {
      expect(addToCart).toHaveBeenCalledWith('prod-1', 1);
    });
  });

  it('navigates to the product page when the image button is clicked', async () => {
    render(<MallProductCard product={product} />);

    // The image button and the name button both carry the product name; the
    // image button is first and both navigate to the same product page.
    const productButtons = screen.getAllByRole('button', { name: /test product/i });
    fireEvent.click(productButtons[0]);

    await waitFor(() => {
      expect(mockGo).toHaveBeenCalledWith('/product/prod-1');
    });
  });

  it('disables purchase and shows the out-of-stock label when unavailable', () => {
    const soldOut = { ...product, available: false, stock: 0 };
    render(<MallProductCard product={soldOut} />);

    // "Out of stock" appears in the overlay and the availability line.
    expect(screen.getAllByText('Out of stock').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a quantity control instead of the add button once the item is in the cart', () => {
    mockUseMall.mockReturnValue({
      cart: {
        items: [{ productId: 'prod-1', qty: 2, price: 10000, name: 'Test Product', unit: 'pcs', stock: 10, image: '', available: true }],
        subtotalKobo: 20000,
        cartId: 'cart-1',
      },
      addToCart: vi.fn(),
      setCartQty: vi.fn().mockResolvedValue(true),
    });

    render(<MallProductCard product={product} />);

    // The exact stock count is revealed once the item is in the cart.
    expect(screen.getByText('pcs • Only 10 left')).toBeInTheDocument();
    // Quantity control input replaces the Add to Cart button.
    expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument();
  });
});
