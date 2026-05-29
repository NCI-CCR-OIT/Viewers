const PT_VIEWPORT_IDS = new Set(['ptAXIAL', 'ptSAGITTAL', 'ptCORONAL']);
const COLORBAR_DEFAULT_RETRY_DELAYS = [0, 100, 500, 1000];

function getColorbarOptions(customizationService) {
  const colorbarProperties = customizationService.getCustomization('cornerstone.colorbar');

  if (!colorbarProperties) {
    return {};
  }

  const {
    width,
    colorbarTickPosition,
    colorbarContainerPosition,
    colorbarInitialColormap,
    colormaps,
  } = colorbarProperties;

  return {
    width,
    colormaps,
    position: colorbarContainerPosition,
    activeColormapName: colorbarInitialColormap || 'Grayscale',
    ticks: {
      position: colorbarTickPosition,
    },
  };
}

function getPTDisplaySetInstanceUID({ cornerstoneViewportService, displaySetService, viewportId }) {
  const viewportData = cornerstoneViewportService.getViewportInfo(viewportId)?.getViewportData();
  const displaySetInstanceUIDs =
    viewportData?.data?.map(({ displaySetInstanceUID }) => displaySetInstanceUID) || [];

  return displaySetInstanceUIDs.find(displaySetInstanceUID => {
    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    return displaySet?.Modality === 'PT';
  });
}

function setSecondRowPTColorbarDefaults({ servicesManager }) {
  const { cornerstoneViewportService, customizationService, displaySetService, colorbarService } =
    servicesManager.services;

  const colorbarDefaultTimeouts = [];
  const applySecondRowPTColorbars = () => {
    PT_VIEWPORT_IDS.forEach(viewportId => {
      const ptDisplaySetInstanceUID = getPTDisplaySetInstanceUID({
        cornerstoneViewportService,
        displaySetService,
        viewportId,
      });

      if (!ptDisplaySetInstanceUID || colorbarService.hasColorbar(viewportId)) {
        return;
      }

      colorbarService.addColorbar(viewportId, [ptDisplaySetInstanceUID], {
        ...getColorbarOptions(customizationService),
        activeColormapName: 'Grayscale',
      });
    });
  };

  const scheduleSecondRowPTColorbars = () => {
    COLORBAR_DEFAULT_RETRY_DELAYS.forEach(delay => {
      const timeoutId = window.setTimeout(applySecondRowPTColorbars, delay);
      colorbarDefaultTimeouts.push(timeoutId);
    });
  };

  const { unsubscribe } = cornerstoneViewportService.subscribe(
    cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
    scheduleSecondRowPTColorbars
  );

  return () => {
    unsubscribe();
    colorbarDefaultTimeouts.forEach(clearTimeout);
  };
}

export default function mibAirCustomConfig({ servicesManager }) {
  return [setSecondRowPTColorbarDefaults({ servicesManager })];
}
