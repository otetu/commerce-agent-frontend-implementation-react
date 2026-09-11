import { describe, expect, it } from 'vitest';
import { carousel, comparison, products, snapshot } from '../test/a2ui-fixtures';
import { getMockScenario } from './mock-catalog';
import type { ActivitySnapshotEvent } from './models';
import {
  applyActivitySnapshot,
  createEmptySurfaceState,
  getRenderableSurfaces,
  settleSurfaceState
} from './a2ui-parser';

function replay(...events: ActivitySnapshotEvent[]) {
  return events.reduce(
    (state, event) => applyActivitySnapshot(state, event.content, event),
    createEmptySurfaceState()
  );
}
const ids = (state: ReturnType<typeof replay>) =>
  getRenderableSurfaces(state).map((surface) => surface.surfaceId);

describe('A2UI activity lifecycle', () => {
  it('renders populated product identities and retains a settled empty binding without rendering it', () => {
    const state = replay(snapshot('a', [carousel('full'), products('full', ['p1', 'p2']), carousel('empty'), products('empty', [])]));
    expect(ids(state)).toEqual(['full']);
    expect(state.surfacesById.full).toMatchObject({ products: [{ ec_product_id: 'p1' }, { ec_product_id: 'p2' }] });
    expect(state.surfacesById.empty).toMatchObject({ products: [], isLoading: false });
  });

  it('replaces loading with products even when the surface ID changes', () => {
    const loading = snapshot('a', [carousel('skeleton-a', true)]);
    expect(ids(replay(loading))).toEqual(['skeleton-a']);
    const state = replay(loading, snapshot('a', [carousel('full'), products('full', ['p1'])]));
    expect(ids(state)).toEqual(['full']);
    expect(state.surfacesById['skeleton-a']).toBeUndefined();
  });

  it('keeps comparison metadata loading until its product data arrives', () => {
    let state = replay(snapshot('a', [comparison('compare')]));
    expect(state.surfacesById.compare).toMatchObject({
      componentType: 'ComparisonTable',
      products: [],
      isLoading: true
    });
    expect(ids(state)).toEqual(['compare']);

    state = applyActivitySnapshot(
      state,
      snapshot('a', [comparison('compare'), products('compare', ['p1', 'p2'])]).content,
      { messageId: 'a' }
    );
    expect(state.surfacesById.compare).toMatchObject({ isLoading: false });
    expect(state.surfacesById.compare).toHaveProperty('products.length', 2);
  });

  it('removes an empty comparison when the run settles', () => {
    const state = settleSurfaceState(replay(snapshot('a', [comparison('compare', true)])));
    expect(state.surfacesById.compare).toMatchObject({ isLoading: false, products: [] });
    expect(ids(state)).toEqual([]);
  });

  it.each([{ operations: [] }, { operations: [carousel('a'), products('a', [])] }])('clears loading on empty final snapshot %#', ({ operations }) => {
    const state = replay(snapshot('message', [carousel('a', true)]), snapshot('message', operations));
    expect(ids(state)).toEqual([]);
  });

  it('updates, empties and repopulates the same surface without duplicates or changing its order', () => {
    const initial = snapshot('a', [carousel('a'), products('a', ['old'])]);
    const other = snapshot('b', [carousel('b'), products('b', ['other'])]);
    let state = replay(initial, other);
    const send = (event: ActivitySnapshotEvent) => {
      state = applyActivitySnapshot(state, event.content, event);
    };
    send(snapshot('a', [carousel('a'), products('a', ['new'])]));
    expect(ids(state)).toEqual(['a', 'b']);
    expect(state.surfacesById.a).toMatchObject({ products: [{ ec_product_id: 'new' }] });
    send(snapshot('a', []));
    expect(ids(state)).toEqual(['b']);
    send(initial);
    expect(ids(state)).toEqual(['a', 'b']);
  });

  it('keeps concurrent carousel skeletons independent, including a shared skeleton surface ID', () => {
    let state = replay(snapshot('a', [carousel('skeleton-shared', true)]), snapshot('b', [carousel('skeleton-shared', true)]));
    const final = snapshot('a', [carousel('full'), products('full', ['p1'])]);
    state = applyActivitySnapshot(state, final.content, final);
    expect(ids(state)).toEqual(['skeleton-shared', 'full']);
    const clear = snapshot('b', []);
    state = applyActivitySnapshot(state, clear.content, clear);
    expect(ids(state)).toEqual(['full']);
  });

  it('keeps multiple carousels in one activity and removes only omitted surfaces on replacement', () => {
    const state = replay(
      snapshot('a', [carousel('one'), products('one', ['1']), carousel('two'), products('two', ['2'])]),
      snapshot('a', [carousel('two'), products('two', ['updated'])])
    );
    expect(ids(state)).toEqual(['two']);
    expect(state.surfacesById.one).toBeUndefined();
  });

  it('ignores replace:false for existing activities, even previously cleared ones', () => {
    const first = snapshot('a', [carousel('a'), products('a', ['first'])], false);
    let state = replay(first);
    const ignored = snapshot('a', [], false);
    expect(applyActivitySnapshot(state, ignored.content, ignored)).toBe(state);
    state = replay(first, snapshot('a', []), first);
    expect(ids(state)).toEqual([]);
  });

  it('preserves data-before-component ordering across independent snapshots and legacy batches', () => {
    for (const messageId of ['data', undefined]) {
      const state = replay(snapshot(messageId, [products('a', ['p1'])]), snapshot(messageId ? 'component' : undefined, [carousel('a')]));
      expect(state.surfacesById.a).toMatchObject({ products: [{ ec_product_id: 'p1' }] });
    }
  });

  it('uses latest accepted updates for a shared surface without retaining superseded product lists', () => {
    const state = replay(
      snapshot('a', [carousel('shared'), products('shared', ['first'])]),
      snapshot('b', [products('shared', ['second'])]),
      snapshot('a', [carousel('shared'), products('shared', ['latest'])])
    );
    expect(state.surfacesById.shared).toMatchObject({ products: [{ ec_product_id: 'latest' }] });
  });

  it('deletes a surface and its product data in operation order, allowing clean recreation', () => {
    const state = replay(snapshot(undefined, [
      carousel('a'), products('a', ['old']),
      { deleteSurface: { surfaceId: 'a' } }, carousel('a'),
      carousel('b'), products('b', ['kept'])
    ]));
    expect(ids(state)).toEqual(['b']);
    expect(state.surfacesById.a).toMatchObject({ products: [] });
  });

  it('keeps a replacement in the placeholder slot when its surface ID changes', () => {
    const state = replay(
      snapshot('a', [carousel('skeleton-a', true)]),
      snapshot('b', [carousel('b'), products('b', ['b'])]),
      snapshot('a', [carousel('final-a'), products('final-a', ['a'])])
    );
    expect(ids(state)).toEqual(['final-a', 'b']);
  });

  it.each(['cameras', 'compare cameras', 'bundle kit'])('preserves the %s mock scenario', (prompt) => {
    const scenario = getMockScenario(prompt);
    const state = replay(...scenario.activitySnapshots.map((activity) => snapshot(activity.messageId, activity.operations)));
    const surfaces = getRenderableSurfaces(state);
    expect(surfaces.length).toBeGreaterThan(1);
    expect(surfaces.some((surface) => 'isLoading' in surface && surface.isLoading)).toBe(false);
    expect(surfaces.find((surface) => surface.componentType === 'NextActionsBar')).toMatchObject({ actions: expect.any(Array) });
  });

  it('settles loading and rejects late snapshots while retaining populated products', () => {
    const state = settleSurfaceState(replay(snapshot('a', [carousel('empty', true), carousel('full', true), products('full', ['p1'])])));
    expect(ids(state)).toEqual(['full']);
    expect(state.surfacesById.full).toMatchObject({ isLoading: false });
    const late = snapshot('late', [carousel('late', true)]);
    expect(applyActivitySnapshot(state, late.content, late)).toBe(state);
  });
});
