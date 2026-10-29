# MIB-AIR fork: customizations and fixes on top of upstream OHIF

> **Read this before changing code.** This is the NCI CCR MIB-AIR fork of
> [OHIF/Viewers](https://github.com/OHIF/Viewers). It differs from upstream in deployment, data
> source and auth, the TMTV hanging protocol, and several bug fixes. Any change that widens the
> fork delta must update this file in the same commit.

## 1. Baseline

| Item | Value |
|---|---|
| Main branch | `mib-air-release` (feature branches merge via PR) |
| Upstream base | **`v3.13.13`** (merged 2026-10-27). Earlier: `v3.13.10` and `v3.12.18` (2026-09-24). |
| Remotes | `origin` = `NCI-CCR-OIT/Viewers`, `upstream` = `OHIF/Viewers`. `gh` defaults to upstream, so pass `--repo NCI-CCR-OIT/Viewers`. |
| Package manager | **pnpm 12.8.1** (`packageManager` in `package.json`); `Dockerfile-MIB-AIR` must pin the same version. |

Live delta: `git diff --stat v3.13.13` (fetch upstream tags first).

### Merging a newer upstream release

1. `git fetch upstream tag vX.Y.Z --no-tags`; on a branch off `mib-air-release`, `git merge --no-commit --no-ff vX.Y.Z`.
2. Use section 7 as the conflict checklist. Keep every change in sections 3–6 unless upstream fixes the same problem (then note it here).
3. `pnpm-lock.yaml` always conflicts (fork removes Cypress): `git checkout --theirs pnpm-lock.yaml`, then `pnpm install --no-frozen-lockfile`.
4. If `packageManager` changed, update the pin in `Dockerfile-MIB-AIR`.
5. Re-test the section 6 fixes (section 8), update section 1, commit only after review.

## 2. Rules for changes

1. **Prefer extensions and modes over `platform/`.** Don't add platform edits beyond those in section 4 unless there's no other route.
2. **Don't drop fork changes in upstream merges.** Re-check sections 3–6 afterwards.
3. **Clinical data:** no real-looking patient identifiers in code, tests, fixtures or logs. Never log tokens.
4. **No secrets in the repo.** TLS material comes from AWS SSM; the GCP token arrives as a cookie.
5. **No AI attribution** in commits or PRs.
6. **No commit, push or deploy without the maintainer's approval.**
7. **Test TMTV changes in a running viewer** (section 8). Most fork bugs were timing/resize issues visible only at runtime.

## 3. Deployment and CI

| File | What it does |
|---|---|
| `Dockerfile-MIB-AIR` | `node:24-slim` + pnpm builds `@ohif/app` (`build:dev`, `APP_CONFIG=config/default.js`); `nginx:stable-alpine` + aws-cli serves `platform/app/dist`. |
| `.docker/Viewer-v3.x/default.conf` | nginx on 443 with TLS, HSTS, COOP/COEP/CORP and **`Cache-Control: no-cache`** (bundle names don't change between releases, so browsers otherwise keep the old release). Replaces upstream's `default.conf.template`. |
| `.docker/Viewer-v3.x/entrypoint.sh` | Swaps the DICOM store URL in `app-config.js` for `$APP_GCP_URL` (per environment), pulls TLS files from SSM (`$APP_CERT`, `$APP_CERT_KEY`, `$APP_CERT_CHAIN`, `$APP_DHPARAM`), starts nginx. Its `$APP_URL_PREFIX` substitution currently matches nothing. |
| `.github/workflows/build.yml` | Builds and pushes to ECR `mib-air-ohif-viewer`. Tags: `mib-air-release` → `latest`; other branches → normalized name (`fix/tmtv` → `fix-tmtv`); `mib-air-release-*` also → `next`, `dev`. Reserved: `latest`, `next`, `dev`, `test`, `stage`. |
| `.github/workflows/deploy.yml` | Manual deploy to ECS `mib-air-ohif` (`dev`/`test`/`stage`/`production`). |
| `package.json`, `pnpm-lock.yaml` | Cypress removed. |
| `postcss.config.js` | `autoprefixer: false` (release/3.12 value). |

## 4. Data source and authentication

- `platform/app/public/config/default.js` (deployed config): `dicomweb` → **GCP Healthcare DICOM store** (URL swapped per environment), `dicomUploadEnabled`, fuzzy matching, WADO-RS thumbnails. Also enables `dicomwebproxy`, `dicomjson`, `dicomlocal` with no origin allowlist — a **known security gap**, don't copy it. `genericViewports` removed, so the legacy viewport backend is used.
- `config/google.js`: same store, OAuth removed. `config/kheops.js`: older shape, unused.
- `platform/app/package.json`: `dev:viewer` runs `default.js` on **port 3002**.

**GCP token via cookie.** The host page sets `gcp-jwt-token`; `App.tsx` (`getGcpToken`) copies it to `localStorage` before init, and every DICOMweb request sends `Authorization: Bearer <token>`. The token expires after 1h and the MIB-AIR UI reissues the cookie every 10 minutes, so `App.tsx` also re-copies it every 60s and whenever the tab becomes visible or focused; without that, an open viewer stops loading images 1h after it was opened:

| File | Edit |
|---|---|
| `platform/app/src/App.tsx` | `getGcpToken()` at load, every 60s and on focus/visibility; `routerBasename: '.'` |
| `platform/core/src/DICOMWeb/getAuthorizationHeader.ts` | Bearer header from localStorage |
| `platform/core/src/services/UserAuthenticationService/UserAuthenticationService.ts` | `_getAuthorizationHeader` returns it |
| `extensions/default/src/DicomWebDataSource/index.ts` | QIDO and WADO clients |
| `extensions/cornerstone/src/initWADOImageLoader.js` | Image-loader XHRs |

The token is in `localStorage`, so any XSS can steal it — be careful with third-party code and HTML rendering.

## 5. TMTV mode

- `extensions/tmtv/src/utils/hpViewports.ts`: PET-row viewports sync W/L via **`ptRowWLSync`** (MIP stays on `ptWLSync`); PET starts at **W 8 / L 4**; fusion colormap **`red_hot`**; fusion opacity ramp is deliberately not a scalar (see comment).
- `modes/tmtv/src/utils/mibAirCustomConfig.ts` (from `onModeEnter`): Grayscale colorbar on the three PET-row viewports; retries on `VIEWPORT_DATA_CHANGED` because viewports mount asynchronously.

## 6. Bug fixes

Causes are listed so nobody "simplifies" a fix away.

### 6.1 Maximize/restore keeps viewport state
`d600433c4d` (2026-10-05), follow-up in 6.3.
- **`CornerstoneViewportService.setVolumesForViewport`:** protocol display-set options (VOI, colormap, invert) were applied on a `setTimeout` *after* the stored presentation, reverting every remounted viewport. Stored LUT values now override protocol defaults.
- **`LegacyViewportBackend.setPositionPresentation`:** fusion viewports drop `sliceIndex` and use the focal point. Their slice index is in PET space while the reference volume is CT, so it jumped when slice counts differ.
- **`extensions/default/src/utils/restoreViewportPresentation.ts`** (from `toggleOneUp`):
  - The maximized viewport is never unmounted; peers remount with pre-maximize state.
  - On restore it's detached from synchronizers until every peer emits `VIEWPORT_DATA_CHANGED`, then re-attached with its original roles and re-emits camera and W/L.
  - Cornerstone services are read at call time (the default extension's commands module is created first).
  - Don't re-apply presentations captured on the one-up canvas (pan is in canvas pixels). Never call `setViewPresentation` with a partial object (it clears the display area).

### 6.2 Segmentation Export/Download keeps lesions in TMTV
`648b829b7f` (PR #13).
- **Cause:** v3.13.10 moved Download into "Store Segmentation", whose command removed the segmentation and loaded the stored object. TMTV can't display RTSTRUCT/SEG, so the viewport went blank and lesions were lost.
- **Fix:** `storeSegmentationCommand` (`extensions/cornerstone/src/commandsModule.ts`) skips remove-and-swap after Download or when the stored display set is missing/`unsupported`, finding it by SOPInstanceUID. The seg extension tags the dataset with a non-enumerable destination (`utils/segmentationStoreDestination.ts`).
- `calculateTMTV` returns early when no segmentation remains (Undo after deleting the last one crashed).
- **Open:** repeated saves create new series; Download says "saved successfully"; a failed STOW leaves a local RTSTRUCT series.

### 6.3 Sagittal/coronal keep settings after maximize/restore
2026-10-27 (`0363cb0260` + review follow-up). Two regressions from 6.1:
- **W/L jumped to 0–255.** Restore re-applied the whole LUT including the labelmap (`voiRange` 0–255); cornerstone's `voiSyncCallback` treats a labelmap viewport as fusion and falls back to the image volume. *Fix:* re-emit only `{ voiRange }` for the viewport's own display-set volumes. Don't filter by `representationUID` — cornerstone merges same-dimension labelmaps into the image actor.
- **Zoomed ~1.33× per round trip.** `ContextPoolRenderingEngine._resizeVTKViewports` skips `resetCameraForResize` when a frame is pending, leaving `initialCamera`/`getZoom()` fitted to the old canvas. *Fix:* keep zoom relative to the fit:
  - **Restore:** re-fit (`resetCameraForResize`, then `setCamera(previous)`) before reading relative zoom; re-apply once the engine has the restored size (wait for `IMAGE_RENDERED` with matching `sWidth`).
  - **Maximize:** `keepZoomAcrossLayoutChange` does the same for the new canvas.
  - Re-fits run detached from synchronizers; pending waits cancel on a new toggle. Only viewports with a camera fit (legacy volume/stack) are touched. The restore must never throw before `setLayout`, or the viewer is stuck in one-up.

## 7. Upstream files the fork edits (conflict hotspots)

| File | Section |
|---|---|
| `extensions/cornerstone/src/commandsModule.ts`, `utils/index.ts` | 6.2 |
| `extensions/cornerstone/src/services/ViewportService/CornerstoneViewportService.ts`, `backends/LegacyViewportBackend.ts` | 6.1 |
| `extensions/cornerstone/src/initWADOImageLoader.js`, `extensions/default/src/DicomWebDataSource/index.ts` | 4 |
| `extensions/cornerstone-dicom-seg/src/commandsModule.ts`, `extensions/tmtv/src/commandsModule.ts` | 6.2 |
| `extensions/default/src/commandsModule.ts` | 6.1, 6.3 |
| `extensions/tmtv/src/utils/hpViewports.ts`, `modes/tmtv/src/index.ts` | 5 |
| `platform/app/src/App.tsx`, `platform/core/src/DICOMWeb/getAuthorizationHeader.ts`, `UserAuthenticationService.ts` | 4 |
| `platform/app/public/config/{default,google,kheops}.js` | 4 |
| `.docker/Viewer-v3.x/entrypoint.sh`, `package.json`, `platform/app/package.json`, `pnpm-lock.yaml`, `postcss.config.js` | 3, 4 |
| `AGENTS.md` | pointer to this file |

Fork-only: `Dockerfile-MIB-AIR`, `.docker/Viewer-v3.x/default.conf`, `.github/workflows/{build,deploy}.yml`, `segmentationStoreDestination.ts`, `restoreViewportPresentation.ts`, `mibAirCustomConfig.ts`, this file.

## 8. Reproducing TMTV issues locally

The deployed config needs GCP sign-in; use the public OHIF demo data through the dev-server proxy instead.

1. Create an **untracked** `platform/app/public/config/local_repro.js`: `default.js` with `dicomweb` at `http://localhost:<port>/demo-dicomweb` and the static-WADO options from `config/dev.js`. Add it to `.git/info/exclude`.
2. Run on a port other than 3000/3002:
   ```bash
   APP_CONFIG=config/local_repro.js OHIF_PORT=3010 OHIF_OPEN=false PROXY_TARGET=/demo-dicomweb PROXY_DOMAIN=https://d14fa38qiwhyfd.cloudfront.net PROXY_PATH_REWRITE_FROM=/demo-dicomweb PROXY_PATH_REWRITE_TO=/dicomweb pnpm --filter @ohif/app run dev
   ```
3. Open `http://localhost:3010/tmtv?StudyInstanceUIDs=<uid>`:
   - `1.2.840.113619.2.290.3.3767434740.226.1600859119.501` — phantom, 47 slices, equal CT/PET counts (doesn't exercise 6.1's fusion path).
   - `1.3.6.1.4.1.14519.5.2.1.3098.5025.285242291560760827564488897577` — whole body, CT 172 / PET 213 (PET not SUV-scaled). Scroll axial, maximize/restore a sagittal viewport: with 6.1 the axial slice stays; without it, CT jumps ~12–23 slices per cycle.
4. Globals: `window.services`, `window.commandsManager`, `window.cornerstone`, `window.cornerstoneTools`. `toggleOneUp` maximizes the *active* viewport.
5. Resizes only run in a **visible** page (`document.visibilityState`). Compare `focalPoint`, `parallelScale` and per-volume `voiRange`, at landscape window sizes.
