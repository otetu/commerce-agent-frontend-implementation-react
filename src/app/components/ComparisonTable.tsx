import { Fragment } from 'react';
import { formatPrice } from '../formatting';
import type { ComparisonTableSurface } from '../models';

type ComparisonTableProps = {
  surface: ComparisonTableSurface;
};

const SKELETON_COLUMNS = Array.from({ length: 3 }, (_, index) => index);
const SKELETON_ROWS = Array.from({ length: 4 }, (_, index) => index);

export function ComparisonTable({ surface }: ComparisonTableProps) {
  const gridColumns = `minmax(120px, auto) repeat(${surface.products.length}, minmax(220px, 1fr))`;
  const showSkeleton = surface.isLoading || surface.products.length === 0;

  return (
    <section className="surface">
      <header className="surface-header stacked">
        <p className="surface-kicker">Comparison Table</p>
        <h3>{surface.heading}</h3>
      </header>

      {showSkeleton ? (
        <ComparisonTableSkeleton />
      ) : (
        <div
          className="comparison-table-viewport"
          role="region"
          aria-label={surface.heading || 'Product comparison'}
          tabIndex={0}
        >
          <div className="comparison-grid" style={{ gridTemplateColumns: gridColumns }}>
            <div className="comparison-cell comparison-corner"></div>
            {surface.products.map((product) => (
              <div key={product.ec_product_id} className="comparison-cell comparison-head">
                {product.ec_image && (
                  <img
                    className="comparison-image"
                    src={product.ec_image}
                    alt={product.ec_name}
                    loading="lazy"
                    decoding="async"
                  />
                )}
                <span className="comparison-brand">{product.ec_brand}</span>
                <strong>{product.ec_name}</strong>
              </div>
            ))}

            {surface.attributes.map((attribute) => (
              <Fragment key={attribute}>
                <div className="comparison-cell comparison-label">{formatLabel(attribute)}</div>
                {surface.products.map((product) => (
                  <div key={product.ec_product_id} className="comparison-cell">
                    {product[attribute] || '—'}
                  </div>
                ))}
              </Fragment>
            ))}

            <div className="comparison-cell comparison-label">Price</div>
            {surface.products.map((product) => (
              <div key={product.ec_product_id} className="comparison-cell comparison-price">
                {formatPrice(product.ec_promo_price ?? product.ec_price)}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ComparisonTableSkeleton() {
  return (
    <div className="comparison-table-viewport" aria-busy="true" role="status">
      <span className="visually-hidden">Building comparison</span>
      <div className="comparison-grid comparison-skeleton-grid" aria-hidden="true">
        <div className="comparison-cell comparison-corner"></div>
        {SKELETON_COLUMNS.map((column) => (
          <div key={column} className="comparison-cell comparison-head comparison-skeleton-head">
            <span className="comparison-skeleton-image"></span>
            <span className="comparison-skeleton-line comparison-skeleton-line-short"></span>
            <span className="comparison-skeleton-line comparison-skeleton-line-title"></span>
          </div>
        ))}

        {SKELETON_ROWS.map((row) => (
          <Fragment key={row}>
            <div className="comparison-cell comparison-label comparison-skeleton-label">
              <span className="comparison-skeleton-line"></span>
            </div>
            {SKELETON_COLUMNS.map((column) => (
              <div key={column} className="comparison-cell comparison-skeleton-cell">
                <span className="comparison-skeleton-line"></span>
                {row < 3 && (
                  <span className="comparison-skeleton-line comparison-skeleton-line-secondary"></span>
                )}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ');
}
