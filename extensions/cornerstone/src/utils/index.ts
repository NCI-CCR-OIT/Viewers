import { handleSegmentChange } from './segmentUtils';
import { isReferenceViewable } from './isReferenceViewable';
import {
  setupSegmentationDataModifiedHandler,
  setupSegmentationModifiedHandler,
} from './segmentationHandlers';
import promptHydrationDialog, {
  HydrationDialogProps,
  HydrationCallback,
  HydrationSRResult,
} from './promptHydrationDialog';
import { getCenterExtent } from './getCenterExtent';
import { createSegmentationForViewport } from './createSegmentationForViewport';
import { setSegmentationStoreDestination } from './segmentationStoreDestination';

const utils = {
  handleSegmentChange,
  isReferenceViewable,
  setupSegmentationDataModifiedHandler,
  setupSegmentationModifiedHandler,
  promptHydrationDialog,
  getCenterExtent,
  createSegmentationForViewport,
  setSegmentationStoreDestination,
};

export type { HydrationDialogProps, HydrationCallback, HydrationSRResult };

export default utils;
