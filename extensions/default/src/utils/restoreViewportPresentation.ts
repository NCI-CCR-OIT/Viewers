type SyncViewport = { viewportId: string; renderingEngineId: string };

type Synchronizer = {
  getSourceViewports: () => SyncViewport[];
  getTargetViewports: () => SyncViewport[];
  addSource: (viewport: SyncViewport) => void;
  addTarget: (viewport: SyncViewport) => void;
  remove: (viewport: SyncViewport) => void;
};

type CornerstoneViewportLike = {
  getCamera: () => unknown;
  setCamera: (camera: unknown) => void;
  render: () => void;
};

type CornerstoneViewportServiceLike = {
  EVENTS: { VIEWPORT_DATA_CHANGED: string };
  getCornerstoneViewport: (viewportId: string) => CornerstoneViewportLike | null | undefined;
  getPresentations: (viewportId: string) => { lutPresentation?: unknown };
  setPresentations: (viewportId: string, presentations: { lutPresentation?: unknown }) => void;
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

  if (
    !peerViewportIds.length ||
    !syncGroupService ||
    !viewportService?.getCornerstoneViewport(viewportId)
  ) {
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
  memberships.forEach(({ synchronizer, source, target }) => synchronizer.remove(source ?? target));

  const pendingViewportIds = new Set(peerViewportIds);
  let timer = setTimeout(() => finishPending(), timeoutMs);

  const finish = () => {
    unsubscribe();
    clearTimeout(timer);
    finishPending = () => {};
    if (viewportService.getCornerstoneViewport(viewportId)) {
      memberships.forEach(({ synchronizer, source, target }) => {
        source && synchronizer.addSource(source);
        target && synchronizer.addTarget(target);
      });
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
        finish();

        const viewport = viewportService.getCornerstoneViewport(viewportId);
        if (!viewport) {
          return;
        }
        // Setting its own camera and LUT again emits the events the synchronizers listen
        // for, which brings the peers to this viewport's state.
        viewport.setCamera(viewport.getCamera());
        const { lutPresentation } = viewportService.getPresentations(viewportId);
        viewportService.setPresentations(viewportId, { lutPresentation });
        viewport.render();
        onRestored?.();
      }, 0);
    }
  );

  finishPending = finish;
}
