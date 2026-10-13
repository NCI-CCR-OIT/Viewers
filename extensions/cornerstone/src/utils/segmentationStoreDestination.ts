/**
 * Records where a stored segmentation went, so the command that started the
 * store can decide what to do with the segmentation being edited.
 *
 * The value is the data source name from the store dialog, or 'download' when
 * the user chose Download. It is kept as a non-enumerable property on the
 * naturalized dataset so it never becomes a DICOM attribute if the dataset is
 * written again.
 */
const STORE_DESTINATION_PROPERTY = 'ohifStoreDestination';

export const DOWNLOAD_STORE_DESTINATION = 'download';

export function setSegmentationStoreDestination(
  naturalizedDataset: Record<string, unknown>,
  destination: string | null | undefined
): void {
  Object.defineProperty(naturalizedDataset, STORE_DESTINATION_PROPERTY, {
    value: destination,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

export function getSegmentationStoreDestination(
  naturalizedDataset: Record<string, unknown> | null | undefined
): string | null | undefined {
  return naturalizedDataset?.[STORE_DESTINATION_PROPERTY] as string | null | undefined;
}
