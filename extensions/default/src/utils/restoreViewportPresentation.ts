const IMAGE_RENDERED_EVENT = 'CORNERSTONE_IMAGE_RENDERED';

type RestoreViewportPresentationOptions = {
  cornerstoneViewportService: any;
  viewportId: string;
  presentation: any;
  onRestored?: () => void;
};

/**
 * Reapplies a captured Cornerstone presentation after the restored viewport has rendered.
 */
export default function restoreViewportPresentation({
  cornerstoneViewportService,
  viewportId,
  presentation,
  onRestored,
}: RestoreViewportPresentationOptions): boolean {
  if (!presentation) {
    return false;
  }

  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const element = viewport?.element;

  if (!element) {
    return false;
  }

  const imageRenderedHandler = () => {
    element.removeEventListener(IMAGE_RENDERED_EVENT, imageRenderedHandler);
    cornerstoneViewportService.setPresentations(viewportId, presentation);
    cornerstoneViewportService.getCornerstoneViewport(viewportId)?.render();
    onRestored?.();
  };

  element.addEventListener(IMAGE_RENDERED_EVENT, imageRenderedHandler);
  return true;
}
