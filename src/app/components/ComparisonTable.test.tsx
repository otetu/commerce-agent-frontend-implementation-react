import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ComparisonTableSurface, ProductRecord } from '../models';
import { ComparisonTable } from './ComparisonTable';

const product = (id: string, price: number): ProductRecord => ({
  ec_product_id: id,
  ec_name: `Product ${id}`,
  ec_brand: 'Example',
  ec_price: price,
  ec_image: '',
  clickUri: '#',
  description: `Description ${id}`
});

const surface = (overrides: Partial<ComparisonTableSurface>): ComparisonTableSurface => ({
  surfaceId: 'comparison',
  componentType: 'ComparisonTable',
  heading: 'Product comparison',
  attributes: ['description'],
  products: [],
  isLoading: false,
  ...overrides
});

describe('ComparisonTable', () => {
  it('renders a neutral structured skeleton without exposing the Price row', () => {
    const view = render(<ComparisonTable surface={surface({ isLoading: true })} />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Building comparison')).toHaveClass('visually-hidden');
    expect(screen.queryByText('Price')).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('.comparison-skeleton-head')).toHaveLength(3);
    expect(view.container.querySelectorAll('.comparison-skeleton-cell')).toHaveLength(12);
  });

  it('uses the skeleton defensively when no products are available', () => {
    render(<ComparisonTable surface={surface({ isLoading: false })} />);

    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.queryByText('Price')).not.toBeInTheDocument();
  });

  it('replaces the skeleton with aligned product attributes and prices', () => {
    const view = render(
      <ComparisonTable
        surface={surface({ products: [product('one', 143), product('two', 362)] })}
      />
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Price')).toBeVisible();
    expect(screen.getByText('Product one')).toBeVisible();
    expect(screen.getByText('$143')).toBeVisible();
    expect(screen.getByText('$362')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Product comparison' })).toHaveAttribute(
      'tabindex',
      '0'
    );
    expect(view.container.querySelector('.comparison-grid')).toHaveStyle({
      gridTemplateColumns: 'minmax(120px, auto) repeat(2, minmax(220px, 1fr))'
    });
  });
});
