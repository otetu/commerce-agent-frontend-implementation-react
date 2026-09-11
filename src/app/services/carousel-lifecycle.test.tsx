import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import populated from '../../test/fixtures/a2ui/populated.json';
import empty from '../../test/fixtures/a2ui/empty-carousel.json';
import bundleEmpty from '../../test/fixtures/a2ui/no-match.json';
import { carousel, products, snapshot } from '../../test/a2ui-fixtures';
import { createStoreHarness, emptyPersisted } from '../../test/harness';
import type { AgUiEvent } from '../models';
import type { ConversationStore } from './conversation-store';
import { useStoreState } from '../store';
import { SurfaceOutlet } from '../components/SurfaceOutlet';

function Surfaces({ store }: { store: ConversationStore }) {
  const state = useStoreState(store);
  return (
    <>
      {state.surfaces.map((surface) => (
        <SurfaceOutlet key={surface.surfaceId} surface={surface} onQuickAction={() => {}} />
      ))}
    </>
  );
}

// JSON fixtures deliberately retain the wire shapes, separate from app typing.
const events = (fixture: unknown) => fixture as AgUiEvent[];

describe('carousel stream integration', () => {
  it('renders all 12 example products and replaces the placeholder state', () => {
    const h = createStoreHarness();
    h.store.submitPrompt('show products');
    render(<Surfaces store={h.store} />);
    for (const event of events(populated)) act(() => h.latest().next(event));
    expect(screen.getByText('12 results')).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(12);
    expect(screen.getByRole('heading', { name: 'Example Product 01' })).toBeVisible();
    expect(Object.keys(h.store.getState().surfaceState.surfacesById)).toEqual(['products-surface', 'next-actions-surface']);
  });

  it.each([
    { label: 'carousel', fixture: empty }, { label: 'bundle', fixture: bundleEmpty }
  ])('clears the $label activity and retains next actions', ({ fixture }) => {
    const h = createStoreHarness();
    h.store.submitPrompt('unavailable');
    const view = render(<Surfaces store={h.store} />);
    for (const event of events(fixture)) act(() => h.latest().next(event));
    expect(h.store.getState().surfaces.map((surface) => surface.componentType)).toEqual(['NextActionsBar']);
    expect(Object.keys(h.store.getState().surfaceState.surfacesById)).toEqual(['next-actions-surface']);
    expect(screen.queryByText('Product Carousel')).not.toBeInTheDocument();
    expect(view.container.querySelector('.loading-grid')).toBeNull();
    expect(screen.getByRole('button', { name: 'Browse products' })).toBeVisible();
    expect(h.store.persistenceSnapshot().surfaces).toEqual(h.store.getState().surfaces);
  });

  it('renders loading, then products, then no section as the same activity changes', () => {
    const h = createStoreHarness();
    h.store.submitPrompt('products');
    const view = render(<Surfaces store={h.store} />);
    act(() => h.latest().next(snapshot('a', [carousel('a', true)])));
    expect(view.container.querySelectorAll('.loading-card')).toHaveLength(4);
    act(() => h.latest().next(snapshot('a', [carousel('a'), products('a', ['p1'])])));
    expect(screen.getByRole('heading', { name: 'Product p1' })).toBeVisible();
    expect(view.container.querySelector('.loading-grid')).toBeNull();
    act(() => h.latest().next(snapshot('a', [carousel('a'), products('a', [])])));
    expect(view.container.querySelector('section')).toBeNull();
    act(() => h.latest().next(snapshot('a', [carousel('a'), products('a', ['p2'])])));
    expect(screen.getByRole('heading', { name: 'Product p2' })).toBeVisible();
  });

  it.each(['success', 'error', 'transport-error', 'cancel', 'interrupted'] as const)(
    'settles empty loading carousels on %s, preserving populated ones', (ending) => {
      const h = createStoreHarness();
      h.store.submitPrompt('products');
      const observer = h.latest();
      observer.next(snapshot('a', [carousel('empty', true), carousel('full', true), products('full', ['p1'])]));
      switch (ending) {
        case 'success': observer.next({ type: 'RUN_FINISHED' }); break;
        case 'error': observer.next({ type: 'RUN_ERROR', message: 'failed' }); break;
        case 'transport-error': observer.error(new Error('connection lost')); break;
        case 'cancel': h.store.cancelActiveRun(); break;
        case 'interrupted': observer.complete(); break;
      }
      expect(h.store.getState().surfaces).toMatchObject([{ surfaceId: 'full', isLoading: false }]);
      observer.next(snapshot('late', [carousel('late', true)]));
      expect(h.store.getState().surfaces.map((surface) => surface.surfaceId)).toEqual(['full']);
      expect(Object.values(h.store.getState().turnTelemetryByTurnId)[0].surfaces).toEqual([{ type: 'ProductCarousel', surfaceId: 'full' }]);
    }
  );

  it('keeps activities independent and clears transient state between turns and restoration', () => {
    const h = createStoreHarness();
    h.store.submitPrompt('first');
    h.latest().next(snapshot('a', [carousel('one'), products('one', ['p1'])]));
    h.latest().next(snapshot('b', [carousel('two'), products('two', ['p2'])]));
    h.latest().next(snapshot('a', []));
    expect(h.store.getState().surfaces.map((s) => s.surfaceId)).toEqual(['two']);
    h.latest().next({ type: 'RUN_FINISHED' });
    const saved = h.store.persistenceSnapshot();
    h.store.submitPrompt('second');
    expect(h.store.getState().surfaceState.activities).toEqual([]);
    h.latest().next(snapshot('b', [carousel('new'), products('new', ['p3'])], false));
    expect(h.store.getState().surfaces.map((s) => s.surfaceId)).toEqual(['new']);
    h.store.hydrate(emptyPersisted({ surfaces: saved.surfaces }));
    expect(h.store.getState().surfaceState.activities).toEqual([]);
    expect(h.store.getState().surfaces).toEqual(saved.surfaces);
  });
});
