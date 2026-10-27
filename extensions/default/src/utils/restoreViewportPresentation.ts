type SyncViewport = { viewportId: string; renderingEngineId: string };

type Synchronizer = {
  getSourceViewports: () => SyncViewport[];
  getTargetViewports: () => SyncViewport[];
  addSource: (viewport: SyncViewport) => void;
  addTarget: (viewport: SyncViewport) => void;
  remove: (viewport: SyncViewport) => void;
};

type SyncGroupServiceLike = {
  getSynchronizersForViewport: (viewportId: string) => Synchronizer[];
};

type VoiRange = { lower: number; upper: number };

type CornerstoneViewportLike = {
  getCamera?: () => unknown;
  setCamera?: (camera: unknown) => void;
  getZoom?: () => number;
  setZoom?: (zoom: number) => void;
  resetCameraForResize?: () => void;
  getActors?: () => { referencedId?: string }[];
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
  getViewportInfo?: (viewportId: string) =>
    | {
        getViewportData?: () =>
          | { data?: { volumeId?: string; volume?: { volumeId?: string } }[] }
          | undefined;
      }
    | undefined;
  subscribe: (
    eventName: string,
    callback: (event: { viewportId: string }) => void
  ) => { unsubscribe: () => void };
};

type RestoreViewportPresentationOptions = {
  cornerstoneViewportService?: CornerstoneViewportServiceLike;
  syncGroupService?: SyncGroupServiceLike;
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

// Ends the restore that is still waiting for its peers, if any.
let finishPending = () => {};
// Stops a zoom re-apply that is still waiting for a resize, if any.
let cancelZoomWait = () => {};

// Only legacy volume and stack viewports have a camera fit that can be measured and restored.
const canKeepZoom = (viewport?: CornerstoneViewportLike | null) =>
  Boolean(viewport?.element && viewport.canvas) &&
  typeof viewport.getCamera === 'function' &&
  typeof viewport.setCamera === 'function' &&
  typeof viewport.resetCameraForResize === 'function' &&
  typeof viewport.getZoom === 'function' &&
  typeof viewport.setZoom === 'function';

const getClientSize = (canvas: HTMLCanvasElement) => `${canvas.clientWidth}x${canvas.clientHeight}`;

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
  viewport.resetCameraForResize();
  viewport.setCamera(camera);
};

// Zoom relative to the fit, which stays meaningful when the canvas changes shape. The raw camera
// does not: sagittal/coronal fits depend on the canvas aspect ratio.
const readFitZoom = (viewport: CornerstoneViewportLike) => {
  refitToCanvas(viewport);
  return viewport.getZoom();
};

const applyFitZoom = (viewport: CornerstoneViewportLike, zoom: number) => {
  refitToCanvas(viewport);
  viewport.setZoom(zoom);
};

// Detaches the viewport from its synchronizers and re-attaches it with its original roles.
const getSyncMembership = (syncGroupService: SyncGroupServiceLike, viewportId: string) => {
  const isThisViewport = (viewport: SyncViewport) => viewport.viewportId === viewportId;
  const memberships = syncGroupService
    .getSynchronizersForViewport(viewportId)
    .map(synchronizer => ({
      synchronizer,
      source: synchronizer.getSourceViewports().find(isThisViewport),
      target: synchronizer.getTargetViewports().find(isThisViewport),
    }));
  return {
    detach: () =>
      memberships.forEach(({ synchronizer, source, target }) =>
        synchronizer.remove(source ?? target)
      ),
    attach: () =>
      memberships.forEach(({ synchronizer, source, target }) => {
        source && synchronizer.addSource(source);
        target && synchronizer.addTarget(target);
      }),
  };
};

// Runs onResized once the engine has resized the canvas. With fromSize, also waits for the canvas
// to leave that size (the layout change has not reached the DOM yet).
const whenEngineResized = (
  viewport: CornerstoneViewportLike,
  fromSize: string | undefined,
  onResized: () => void
) => {
  cancelZoomWait();
  const { element, canvas } = viewport;
  const stopWaiting = () => {
    clearTimeout(timer);
    element.removeEventListener(IMAGE_RENDERED_EVENT, onRendered);
    cancelZoomWait = () => {};
  };
  const onRendered = () => {
    const size = getClientSize(canvas);
    if (size === fromSize || !hasEngineSize(viewport)) {
      return;
    }
    stopWaiting();
    // After the resize that triggered this render has finished, if the canvas has not moved on.
    setTimeout(() => getClientSize(canvas) === size && onResized(), 0);
  };
  const timer = setTimeout(stopWaiting, RESIZE_WAIT_MS);
  element.addEventListener(IMAGE_RENDERED_EVENT, onRendered);
  cancelZoomWait = stopWaiting;
};

// The volumes of the viewport's own display sets. Segmentation labelmaps are excluded: their VOI
// event would make the VOI synchronizers apply the labelmap's 0-255 range to peers' images.
// Labelmaps merged into an image actor keep the image's volume id, so they are still included.
const getImageVolumeIds = (
  viewportService: CornerstoneViewportServiceLike,
  viewportId: string,
  viewport: CornerstoneViewportLike
) => {
  const actorIds = new Set(viewport.getActors?.().map(({ referencedId }) => referencedId) ?? []);
  const data = viewportService.getViewportInfo?.(viewportId)?.getViewportData?.()?.data ?? [];
  return data
    .map(({ volumeId, volume }) => volumeId ?? volume?.volumeId)
    .filter(volumeId => volumeId && actorIds.has(volumeId));
};

/**
 * Keeps a viewport's zoom relative to its fit across a layout change that resizes its canvas
 * (maximize, or a restore with no peers to re-sync). When the engine defers the resize, the
 * canvas would otherwise keep the previous size's world camera. Call before the layout change.
 */
export function keepZoomAcrossLayoutChange({
  cornerstoneViewportService: viewportService,
  syncGroupService,
  viewportId,
}: Pick<
  RestoreViewportPresentationOptions,
  'cornerstoneViewportService' | 'syncGroupService' | 'viewportId'
>): void {
  cancelZoomWait();
  const viewport = viewportService?.getCornerstoneViewport(viewportId);
  if (!canKeepZoom(viewport)) {
    return;
  }

  try {
    // Detached, the re-fit's interim camera does not reach the peers.
    const sync = syncGroupService && getSyncMembership(syncGroupService, viewportId);
    sync?.detach();
    let zoom: number;
    try {
      zoom = readFitZoom(viewport);
    } finally {
      sync?.attach();
    }

    whenEngineResized(viewport, getClientSize(viewport.canvas), () => {
      if (viewportService.getCornerstoneViewport(viewportId) === viewport) {
        applyFitZoom(viewport, zoom);
        viewport.render();
      }
    });
  } catch (error) {
    console.warn('Unable to keep the viewport zoom across the layout change', error);
  }
}

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
  cancelZoomWait();

  const maximizedViewport = viewportService?.getCornerstoneViewport(viewportId);
  if (!maximizedViewport) {
    return;
  }
  if (!peerViewportIds.length || !syncGroupService) {
    // No peers remount, so only the zoom needs keeping.
    keepZoomAcrossLayoutChange({ cornerstoneViewportService: viewportService, viewportId });
    return;
  }

  // Detached, the remounting peers cannot push their stored camera/VOI onto this viewport.
  const sync = getSyncMembership(syncGroupService, viewportId);
  sync.detach();

  // Read while the canvas is still one-up sized.
  let zoom: number | undefined;
  if (canKeepZoom(maximizedViewport)) {
    try {
      zoom = readFitZoom(maximizedViewport);
    } catch (error) {
      console.warn('Unable to read the zoom of the maximized viewport', error);
    }
  }

  // Sets the viewport's own camera and image VOIs again; the events re-sync the peers.
  const reemitState = (viewport: CornerstoneViewportLike) => {
    if (typeof viewport.getCamera === 'function') {
      viewport.setCamera(viewport.getCamera());
    }
    getImageVolumeIds(viewportService, viewportId, viewport).forEach(volumeId => {
      const voiRange = viewport.getProperties?.(volumeId)?.voiRange;
      if (voiRange) {
        viewport.setProperties?.({ voiRange }, volumeId);
      }
    });
    viewport.render();
  };

  const pendingViewportIds = new Set(peerViewportIds);
  let timer = setTimeout(() => finishPending(), timeoutMs);

  const finish = () => {
    unsubscribe();
    clearTimeout(timer);
    finishPending = () => {};
    if (viewportService.getCornerstoneViewport(viewportId)) {
      sync.attach();
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
        const waitForResize = Boolean(zoom && viewport && !hasEngineSize(viewport));
        try {
          if (zoom && viewport && !waitForResize) {
            applyFitZoom(viewport, zoom);
          }
        } catch (error) {
          console.warn('Unable to restore the zoom of the maximized viewport', error);
        } finally {
          finish();
        }

        if (!viewport) {
          return;
        }
        reemitState(viewport);

        if (waitForResize) {
          // The engine has not resized this canvas yet; apply the zoom once it has.
          whenEngineResized(viewport, undefined, () => {
            if (viewportService.getCornerstoneViewport(viewportId) !== viewport) {
              return;
            }
            sync.detach();
            try {
              applyFitZoom(viewport, zoom);
            } finally {
              sync.attach();
            }
            reemitState(viewport);
          });
        }
        onRestored?.();
      }, 0);
    }
  );

  finishPending = finish;
}
