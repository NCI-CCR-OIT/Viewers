window.config = {
  routerBasename: '/',
  enableGoogleCloudAdapter: false,
  // below flag is for performance reasons, but it might not work for all servers
  omitQuotationForMultipartRequest: true,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  strictZSpacingForVolumeViewport: true,
  // whiteLabelling: {},
  extensions: [],
  modes: [],
  showStudyList: true,
  // filterQueryParam: false,
  dataSources: [
    {
      friendlyName: 'dcmjs DICOMWeb Server',
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        name: 'GCP',
        wadoUriRoot:
          'https://healthcare.googleapis.com/v1/projects/nih-nci-ccr-mib-air-dev-2a0b/locations/us/datasets/mib-air-dicom-dataset-dev/dicomStores/mib-air-dicom-datastore-dev/dicomWeb',
        qidoRoot:
          'https://healthcare.googleapis.com/v1/projects/nih-nci-ccr-mib-air-dev-2a0b/locations/us/datasets/mib-air-dicom-dataset-dev/dicomStores/mib-air-dicom-datastore-dev/dicomWeb',
        wadoRoot:
          'https://healthcare.googleapis.com/v1/projects/nih-nci-ccr-mib-air-dev-2a0b/locations/us/datasets/mib-air-dicom-dataset-dev/dicomStores/mib-air-dicom-datastore-dev/dicomWeb',
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: false,
      },
    },
    {
      friendlyName: 'dicom json',
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        name: 'json',
      },
    },
    {
      friendlyName: 'dicom local',
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {},
    },
  ],
  defaultDataSourceName: 'dicomweb',
};
