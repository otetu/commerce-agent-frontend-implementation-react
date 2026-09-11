import type { A2UIOperation, ActivitySnapshotEvent } from '../app/models';

export const carousel = (surfaceId: string, isLoading = false): A2UIOperation => ({
  surfaceUpdate: {
    surfaceId,
    components: [{ id: `root-${surfaceId}`, component: {
      ProductCarousel: { heading: { literalString: surfaceId }, isLoading }
    } }]
  }
});

export const comparison = (surfaceId: string, isLoading?: boolean): A2UIOperation => ({
  surfaceUpdate: {
    surfaceId,
    components: [{ id: `root-${surfaceId}`, component: {
      ComparisonTable: {
        heading: { literalString: surfaceId },
        attributes: ['description'],
        ...(isLoading === undefined ? {} : { isLoading })
      }
    } }]
  }
});

export const products = (surfaceId: string, ids: string[]): A2UIOperation => ({
  dataModelUpdate: {
    surfaceId,
    contents: [{ key: 'items', valueMap: ids.map((id) => ({ valueMap: [
      { key: 'ec_product_id', valueString: id },
      { key: 'ec_name', valueString: `Product ${id}` }
    ] })) }]
  }
});

export const snapshot = (
  messageId: string | undefined,
  operations: A2UIOperation[],
  replace?: boolean
): ActivitySnapshotEvent => ({
  type: 'ACTIVITY_SNAPSHOT', activityType: 'a2ui-surface', messageId,
  content: { operations }, ...(replace === undefined ? {} : { replace })
});
