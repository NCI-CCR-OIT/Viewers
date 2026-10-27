type SyncViewport = { viewportId: string; renderingEngineId: string };

type Synchronizer = {
  getSourceViewports: () => SyncViewport[];
  getTargetViewports: () => SyncViewport[];
  addSource: (viewport: SyncViewport) => void;
  addTarget: (viewport: SyncViewport) => void;
  remove: (viewport: SyncViewport) => void;
};

type VoiRange = { lower: number; upper: number };

type CornerstoneViewportLike = {
  getCamera: () => unknown;
  setCamera: (camera: unknown) => void;
  getZoom?: () => number;
  setZoom?: (zoom: number) => void;
  resetCameraForResize?: () => void;
  getActors?: () => { referencedId?: string; representationUID?: string }[];
  getProperties?: (volumeId?: string) => { voiRange?: VoiRange } | undefined;
  setProperties?: (properties: { voiRange: VoiRange }, volumeId?: string) => void;
  render: () => void;
  element?: HTMLElement;
  canvas?: HTMLCanvasElement;
  sWidth?: number;
  sHeight?: number;
};

type CornerstoneViewportServiceLike = {
  EVENTS: { VIEWPORT_DATA_CHANGED: string };
  getCornerstoneViewport: (viewportId: string) => CornerstoneViewportLike | null | undefined;
  subscribe: (
    eventName: string,
    callback: (event: { viewportId: string }) => void
  ) => { unsubscribe: () => void };
};

type RestoreViewportPresentationOptions = {
  cornerstoneViewportService?: CornerstoneViewportServiceLike;
  syncGroupService?: { getSynchronizersForViewport: (viewportId: string) => Synchronizer[] };
  // The maximized viewport; it stays mounted while the layout is restored.
  viewportId: string;
  // The viewports that are remounted by the restore.
  peerViewportIds: string[];
  onRestored?: () => void;
  timeoutMs?: number;
};

const IMAGE_RENDERED_EVENT = 'CORNERSTONE_IMAGE_RENDERED';
// The grid resize runs shortly after the layout change; stop waiting for it after this long.
const RESIZE_WAIT_MS = 3000;

// Whether the rendering engine has picked up the canvas's displayed size. It sets
// sWidth/sHeight on resize even when it defers the rest of the resize.
const hasEngineSize = ({ canvas, sWidth, sHeight }: CornerstoneViewportLike) => {
  if (!canvas || sWidth === undefined || sHeight === undefined) {
    return true;
  }
  const devicePixelRatio = window.devicePixelRatio || 1;
  return (
    sWidth === Math.round(canvas.clientWidth * devicePixelRatio) &&
    sHeight === Math.round(canvas.clientHeight * devicePixelRatio)
  );
};

// Re-fits the zoom baseline to the canvas the way the engine's resize does, keeping the world
// camera. The engine skips this for a canvas it resized while a frame was pending, which leaves
// zoom measured against the previous canvas size.
const refitToCanvas = (viewport: CornerstoneViewportLike) => {
  const camera = viewport.getCamera();
  viewport.resetCameraForResize?.();
  viewport.setCamera(camera);
};

// Ends the restore that is still waiting for its peers, if any.
let finishPending = () => {};

/**
 * Keeps what the user did in the maximized viewport when the layout is restored: it is
 * detached from its synchronizers while the peers remount with older state, then re-syncs them.
 */
export default function restoreViewportPresentation({
  cornerstoneViewportService: viewportService,
  syncGroupService,
  viewportId,
  peerViewportIds,
  onRestored,
  timeoutMs = 10000,
}: RestoreViewportPresentationOptions): void {
  finishPending();

  const maximizedViewport = viewportService?.getCornerstoneViewport(viewportId);
  if (!peerViewportIds.length || !syncGroupService || !maximizedViewport) {
    return;
  }

  // Detached, the remounting peers cannot push their stored camera/VOI onto this viewport.
  const isThisViewport = (viewport: SyncViewport) => viewport.viewportId === viewportId;
  const memberships = syncGroupService
    .getSynchronizersForViewport(viewportId)
    .map(synchronizer => ({
      synchronizer,
      source: synchronizer.getSourceViewports().find(isThisViewport),
      target: synchronizer.getTargetViewports().find(isThisViewport),
    }));
  const detach = () =>
    memberships.forEach(({ synchronizer, source, target }) =>
      synchronizer.remove(source ?? target)
    );
  const attach = () =>
    memberships.forEach(({ synchronizer, source, target }) => {
      source && synchronizer.addSource(source);
      target && synchronizer.addTarget(target);
    });
  detach();

  // Zoom relative to the fit, read while the canvas is still one-up sized. Restoring the raw
  // camera instead would zoom sagittal/coronal views, whose fit depends on the canvas shape.
  refitToCanvas(maximizedViewport);
  const zoom = maximizedViewport.getZoom?.();

  const applyZoom = (viewport: CornerstoneViewportLike) => {
    refitToCanvas(viewport);
    viewport.setZoom?.(zoom);
  };

  // Applies the zoom once the engine has the restored canvas size, then re-syncs the peers.
  const applyZoomAfterResize = (viewport: CornerstoneViewportLike) => {
    const { element, canvas } = viewport;
    const { clientWidth, clientHeight } = canvas;
    const onRendered = () => {
      if (!hasEngineSize(viewport)) {
        return;
      }
      stopWaiting();
      // After the resize that triggered this render has finished.
      setTimeout(() => {
        const isSameCanvas =
          canvas.clientWidth === clientWidth && canvas.clientHeight === clientHeight;
        if (viewportService.getCornerstoneViewport(viewportId) !== viewport || !isSameCanvas) {
          return;
        }
        detach();
        applyZoom(viewport);
        attach();
        viewport.setCamera(viewport.getCamera());
        viewport.render();
      }, 0);
    };
    const stopWaiting = () => {
      clearTimeout(resizeTimer);
      element.removeEventListener(IMAGE_RENDERED_EVENT, onRendered);
    };
    const resizeTimer = setTimeout(stopWaiting, RESIZE_WAIT_MS);
    element.addEventListener(IMAGE_RENDERED_EVENT, onRendered);
  };

  const pendingViewportIds = new Set(peerViewportIds);
  let timer = setTimeout(() => finishPending(), timeoutMs);

  const finish = () => {
    unsubscribe();
    clearTimeout(timer);
    finishPending = () => {};
    if (viewportService.getCornerstoneViewport(viewportId)) {
      attach();
    }
  };

  const { unsubscribe } = viewportService.subscribe(
    viewportService.EVENTS.VIEWPORT_DATA_CHANGED,
    ({ viewportId: loadedViewportId }) => {
      pendingViewportIds.delete(loadedViewportId);
      if (pendingViewportIds.size) {
        return;
      }

      unsubscribe();
      clearTimeout(timer);
      // One task later, after the display set options each peer applies on its own timeout.
      timer = setTimeout(() => {
        const viewport = viewportService.getCornerstoneViewport(viewportId);
        const waitForResize = Boolean(
          zoom && viewport?.element && viewport.canvas && !hasEngineSize(viewport)
        );
        if (zoom && viewport && !waitForResize) {
          applyZoom(viewport);
        }

        finish();
        if (!viewport) {
          return;
        }
        // Setting its own camera and image VOIs again emits the events the synchronizers listen
        // for, which brings the peers to this viewport's state.
        viewport.setCamera(viewport.getCamera());
        // Skip segmentation actors: their VOI event would make the VOI synchronizers apply the
        // labelmap's 0-255 range to the peers' image volumes.
        viewport
          .getActors?.()
          .filter(({ referencedId, representationUID }) => referencedId && !representationUID)
          .forEach(({ referencedId }) => {
            const voiRange = viewport.getProperties?.(referencedId)?.voiRange;
            if (voiRange) {
              viewport.setProperties?.({ voiRange }, referencedId);
            }
          });
        viewport.render();
        if (waitForResize) {
          applyZoomAfterResize(viewport);
        }
        onRestored?.();
      }, 0);
    }
  );

  finishPending = finish;
}
