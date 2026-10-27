# MIB-AIR fork: customizations and fixes on top of upstream OHIF

> **Read this before changing any code in this repository.** This repository is the NCI CCR
> MIB-AIR fork of [OHIF/Viewers](https://github.com/OHIF/Viewers). It differs from upstream in
> deployment, data source and authentication, the TMTV hanging protocol, and several bug fixes.
> Upstream docs and AGENTS.md describe stock OHIF; this file describes what is different here and
> why. Keep it current: any change that makes the fork differ further from upstream must update
> this file in the same commit.

## 1. Baseline

| Item | Value |
|---|---|
| Main branch | `mib-air-release` (feature branches merge into it via PR) |
| Upstream base | Tag **`v3.13.13`** (merged 2026-10-27). Earlier merges: `v3.13.10` (2026-09-24, `103960bffe`); `v3.12.18` the same day (`0af5b26940`), so a few release/3.12 security patches are also in history. |
| Remotes | `origin` = `NCI-CCR-OIT/Viewers` (public fork), `upstream` = `OHIF/Viewers`. `gh` defaults to upstream here, so always pass `--repo NCI-CCR-OIT/Viewers`. |
| Package manager | **pnpm 12.8.1** (`packageManager` in `package.json`, required since upstream 3.13.11). `Dockerfile-MIB-AIR` must pin the same version. |
| Size of the fork delta | 32 files differ from `v3.13.13` (≈ +1,000 / −940 lines, mostly deployment, config and the lockfile's Cypress removal). Viewer code: 19 files, ≈ +490 / −30 lines. |

To see the live delta: `git diff --stat v3.13.13` (fetch upstream tags first).

### Merging a newer upstream release

1. `git fetch upstream tag vX.Y.Z --no-tags`, then on a branch off `mib-air-release` run `git merge --no-commit --no-ff vX.Y.Z`.
2. Resolve conflicts with section 7 as the checklist. Keep every fork change in sections 3–6 unless the upstream release fixes the same problem; if it does, record that here.
3. `pnpm-lock.yaml` always conflicts, because the fork removes Cypress. Take upstream's lockfile (`git checkout --theirs pnpm-lock.yaml`) and regenerate it with `pnpm install --no-frozen-lockfile`.
4. If upstream changes `packageManager`, update the pnpm pin in `Dockerfile-MIB-AIR`.
5. Rebuild and re-test the TMTV fixes in section 6 (section 8), update section 1 of this file, and commit only after review.

## 2. Rules for changes

1. **Prefer extensions and modes over platform code.** Five small edits in `platform/` exist
   (section 4). Do not add more unless there is no extension or mode route.
2. **Do not drop fork changes during upstream merges.** After any merge, re-check every item in
   sections 3–6 against this file. The files in section 7 are the likely conflict points.
3. **Data is clinical.** Never put real-looking patient identifiers in code, tests, fixtures or
   logs. Never log tokens.
4. **No secrets in the repo.** TLS material comes from AWS SSM at container start (section 3).
   The GCP access token arrives as a cookie at runtime (section 4).
5. **Commits and PRs carry no AI attribution** (no `Co-Authored-By` AI trailers, no
   "Generated with" footers).
6. **Do not commit, push or deploy without the maintainer's explicit approval.**
7. **Test TMTV changes in a running viewer** (section 8), not only by reading code. Most fork
   bugs were timing and resize interactions that only show at runtime.

## 3. Deployment and CI (fork-only files)

| File | What it does |
|---|---|
| `Dockerfile-MIB-AIR` | Two-stage build: `node:24-slim` + **pnpm 12.8.1** (keep in step with `packageManager`) builds `@ohif/app` with `build:dev` (`NODE_ENV=development`) and `APP_CONFIG=config/default.js`; `nginx:stable-alpine` with aws-cli serves `platform/app/dist`. Env defaults: `APP_GCP_URL=''`, `APP_URL_PREFIX='airstudies-dev'`. |
| `.docker/Viewer-v3.x/default.conf` | nginx on 443 with TLS (wildcard ccr.cancer.gov cert), HSTS, COOP/COEP/CORP headers, and **`Cache-Control: no-cache`**. Bundle names (`app.js`, `extensions_*.js`) do not change between releases, so without it browsers kept running the previous release after a deploy. Replaces upstream's `default.conf.template` (deleted). |
| `.docker/Viewer-v3.x/entrypoint.sh` | Rewritten. Replaces the dev DICOM store URL in `app-config.js` with `$APP_GCP_URL` (this is how each environment gets its own store), pulls TLS cert, key, chain and dhparam from AWS SSM (`$APP_CERT`, `$APP_CERT_KEY`, `$APP_CERT_CHAIN`, `$APP_DHPARAM`), then starts nginx. Its `airstudies-dev` → `$APP_URL_PREFIX` substitution in `app.bundle.*.js` currently matches nothing (no such file name or string in the build); verify before relying on it. |
| `.github/workflows/build.yml` | Builds `Dockerfile-MIB-AIR` on every push and on PRs into `mib-air-release*`, then pushes to ECR `mib-air-ohif-viewer`. Tags: `mib-air-release` → `latest`. Other branches → the normalized branch name (`fix/tmtv` → `fix-tmtv`). `mib-air-release-*` branches additionally get `next` and `dev`. Branches may not map to the reserved names `latest`, `next`, `dev`, `test` or `stage`. |
| `.github/workflows/deploy.yml` | Manual (`workflow_dispatch`) deploy to ECS service `mib-air-ohif` for `dev`, `test`, `stage` or `production`: retags the chosen image and forces a new deployment. |
| `package.json`, `pnpm-lock.yaml` | Cypress dependencies removed; lockfile trimmed to match. |
| `postcss.config.js` | `postcss-preset-env` with `autoprefixer: false` (the release/3.12 value). |

## 4. Data source and authentication

**Config files**
- `platform/app/public/config/default.js` (the deployed config):
  - Data source `dicomweb` points at the **GCP Healthcare DICOM store** for MIB-AIR dev (`entrypoint.sh` swaps the URL per environment). `qidoSupportsIncludeField: true`, `supportsFuzzyMatching: true`, `dicomUploadEnabled: true`, WADO-RS thumbnails.
  - Also enables `dicomwebproxy`, `dicomjson` and `dicomlocal`. Upstream's secure default disables these, and no `dangerouslyAllowedOriginsForAuthenticatedEnvironments` allowlist is set. Treat that as a known security gap, not a pattern to copy.
  - `investigationalUseDialog: { option: 'never' }`, `maxNumRequests.thumbnail: 75`, multi-monitor layouts `split` and `2`. Upstream's `genericViewports` block is removed, so the legacy viewport backend is used.
- `config/google.js`: same GCP store; Google OAuth `configurationAPI` removed.
- `config/kheops.js`: replaced with an older config shape. It is not used by the MIB-AIR deployment.
- `platform/app/package.json`: `dev:viewer` runs `default.js` on **port 3002**.

**Authentication: GCP token via cookie (platform edits)**

The hosting page sets a `gcp-jwt-token` cookie. `platform/app/src/App.tsx` (`getGcpToken`) copies it into `localStorage` before `appInit`. Every DICOMweb request then sends `Authorization: Bearer <token>` from four places:

| File | Edit |
|---|---|
| `platform/app/src/App.tsx` | `getGcpToken()` before init; `routerBasename: '.'` |
| `platform/core/src/DICOMWeb/getAuthorizationHeader.ts` | Always sets the Bearer header from localStorage |
| `platform/core/src/services/UserAuthenticationService/UserAuthenticationService.ts` | `_getAuthorizationHeader` returns the Bearer header |
| `extensions/default/src/DicomWebDataSource/index.ts` | Sets the header on the QIDO and WADO clients |
| `extensions/cornerstone/src/initWADOImageLoader.js` | Sets the header on image-loader XHRs |

The token is readable from `localStorage`, so any XSS can steal it. Keep this in mind when adding third-party code or HTML rendering. `WorkList.tsx` and the ui-next `Table/index.ts` differ only by a trailing blank line.

## 5. TMTV mode customizations

- `extensions/tmtv/src/utils/hpViewports.ts`:
  - PET viewports in the PET row sync window/level through **`ptRowWLSync`**, so the MIP (`ptWLSync`) no longer follows the row.
  - PET and fusion-PET start at a **fixed W 8 / L 4** instead of upstream's `getPTVOIRange`.
  - The fusion PET colormap is **`red_hot`** instead of `hsv`.
  - The fusion opacity ramp is deliberately not a scalar; see the comment in the file.
- `modes/tmtv/src/utils/mibAirCustomConfig.ts` (registered in `modes/tmtv/src/index.ts` `onModeEnter`): adds a Grayscale **colorbar to the three PET-row viewports by default**. It re-tries on `VIEWPORT_DATA_CHANGED` because the viewports mount asynchronously.

## 6. Bug fixes the fork carries

Each fix lists its cause, so nobody "simplifies" it back.

### 6.1 Maximize/restore (double-click one-up) keeps viewport state
Commits `aa88ee9fce` (2026-09-24, superseded), `d600433c4d` (2026-10-05), plus the 2026-10-27 follow-up (6.3).
- **`CornerstoneViewportService.setVolumesForViewport`:** hanging-protocol display-set options (VOI, colormap, invert) are applied on a `setTimeout` *after* the stored presentation is restored. Without the fix every remounted viewport reverted to the protocol window, and the VOI sync spread that everywhere. Now the stored LUT values are merged over the protocol defaults.
- **`LegacyViewportBackend.setPositionPresentation`:** for multi-volume (fusion) viewports, `sliceIndex` is dropped and the camera focal point is used. A fusion viewport reports its slice index in the PET index space while its reference volume is the CT, so re-applying the index jumped the slice whenever CT and PET slice counts differ.
- **`extensions/default/src/utils/restoreViewportPresentation.ts`** (called from `toggleOneUp` in `extensions/default/src/commandsModule.ts`):
  - The maximized viewport is never unmounted; the other viewports remount with their pre-maximize state.
  - On restore, the maximized viewport is detached from its synchronizers until every peer has emitted `VIEWPORT_DATA_CHANGED`. It is then re-attached with its original source/target roles and re-emits its camera and window/level, so the peers adopt what the user did while maximized.
  - The cornerstone services are read at call time, because the default extension's commands module is created before the cornerstone extension registers them.
  - Do not re-apply view presentations captured on the one-up canvas: pan is in canvas pixels and was tripled per round trip.
  - Never call `setViewPresentation` with a partial object; it clears the display area.

### 6.2 Segmentation Export/Download keeps the lesions in TMTV
Commit `648b829b7f` (2026-10-13, PR #13).
- **Cause:** v3.13.10 moved Download into the "Store Segmentation" dialog. `storeSegmentationCommand` then removed the edited segmentation and loaded the stored object into the active viewport. TMTV has no RTSTRUCT/SEG viewport handler, so the viewport went blank and the lesions were lost.
- **Fix:** `storeSegmentationCommand` (`extensions/cornerstone/src/commandsModule.ts`) skips remove-and-swap after **Download**, or when the stored display set is missing or `unsupported`. It finds that display set by SOPInstanceUID. The seg extension tags the returned dataset with a non-enumerable destination (`extensions/cornerstone/src/utils/segmentationStoreDestination.ts`, exported via the cornerstone `utils`).
- **`calculateTMTV`** (`extensions/tmtv/src/commandsModule.ts`) returns early when no segmentation remains. Undo after deleting the last segmentation used to crash the TMTV route.
- The nginx `Cache-Control: no-cache` header (section 3) was added in the same PR so users actually receive fixes.
- **Known open follow-ups:** repeated TMTV saves each create a new series; Download still shows "saved successfully"; a failed STOW still leaves a local RTSTRUCT series.

### 6.3 Columns 2 and 3 (sagittal/coronal) keep their settings after maximize/restore
2026-10-27, commit `0363cb0260` plus a follow-up from code review. Two regressions came from 6.1:
- **Window/level jumped to 0–255.**
  - *Cause:* with a segmentation present, restore re-applied the maximized viewport's *whole* LUT, including the labelmap actor (`voiRange` 0–255). cornerstone's `voiSyncCallback` treats a viewport with a labelmap as fusion and calls `setProperties(range, labelmapVolumeId)`. That id is not one of the target's volumes, so the call falls back to the image volume. PET in sagittal/coronal and every fusion overlay (or CT, if a CT viewport was maximized) became 0–255.
  - *Fix:* re-emit only `{ voiRange }`, and only for the viewport's own display-set volumes (`getViewportData().data` intersected with its actors).
  - Do not filter by `representationUID`. For volume labelmaps with matching dimensions (always the case in the MIP), cornerstone merges the labelmap into the image actor, which then carries a `representationUID` but keeps the image volume id.
- **Sagittal/coronal column zoomed in about 1.33× per round trip.**
  - *Cause:* the one-up world camera was re-broadcast. cornerstone's `ContextPoolRenderingEngine._resizeVTKViewports` returns early when an animation frame is pending: it updates `sWidth`/`sHeight` but skips `resetCameraForResize`. `initialCamera` and `getZoom()` then stay fitted to the previous canvas, and the next render resizes the canvas, so later resizes skip the viewport. Axial is square, so it was unaffected.
  - *Fix:* keep zoom relative to the fit in both directions.
    - **Restore:** re-fit the maximized viewport (`resetCameraForResize`, then `setCamera(previous)`, as the engine does) before reading its relative zoom. Re-apply it once the engine has the restored size, waiting for `IMAGE_RENDERED` with matching `sWidth` if needed.
    - **Maximize:** `keepZoomAcrossLayoutChange` (called from `toggleOneUp`, and on a restore with no peers to re-sync) does the same for the new canvas, because the deferred resize can hit on maximize too, for example while volumes are still streaming.
    - Re-fits run detached from the synchronizers. A pending wait is cancelled when a new maximize or restore starts.
  - The zoom logic only runs on viewports that have a camera fit (legacy volume and stack). "Next"/generic, video and ECG viewports skip it. The restore must never throw before `toggleOneUp` calls `setLayout`, or the viewer stays stuck in one-up.

## 7. Upstream files the fork edits (merge-conflict hotspots)

| File | Section | Fork delta |
|---|---|---|
| `extensions/cornerstone/src/commandsModule.ts` | 6.2 | +44 / −10 |
| `extensions/cornerstone/src/services/ViewportService/CornerstoneViewportService.ts` | 6.1 | +6 / −1 |
| `extensions/cornerstone/src/services/ViewportService/backends/LegacyViewportBackend.ts` | 6.1 | +11 / −1 |
| `extensions/cornerstone/src/utils/index.ts` | 6.2 | +2 |
| `extensions/cornerstone/src/initWADOImageLoader.js` | 4 | +3 |
| `extensions/cornerstone-dicom-seg/src/commandsModule.ts` | 6.2 | +5 |
| `extensions/default/src/commandsModule.ts` | 6.1, 6.3 | +27 |
| `extensions/default/src/DicomWebDataSource/index.ts` | 4 | +3 |
| `extensions/tmtv/src/commandsModule.ts` | 6.2 | +8 |
| `extensions/tmtv/src/utils/hpViewports.ts` | 5 | +18 / −12 |
| `modes/tmtv/src/index.ts` | 5 | +2 |
| `platform/app/src/App.tsx` | 4 | +24 / −5 |
| `platform/core/src/DICOMWeb/getAuthorizationHeader.ts` | 4 | +1 / −1 |
| `platform/core/src/services/UserAuthenticationService/UserAuthenticationService.ts` | 4 | +8 / −1 |
| `platform/app/public/config/default.js`, `google.js`, `kheops.js` | 4 | config |
| `.docker/Viewer-v3.x/entrypoint.sh`, `package.json`, `platform/app/package.json`, `pnpm-lock.yaml`, `postcss.config.js` | 3, 4 | build |
| `AGENTS.md` | — | pointer to this file |

Fork-only files (no upstream counterpart): `Dockerfile-MIB-AIR`, `.docker/Viewer-v3.x/default.conf`, `.github/workflows/{build,deploy}.yml`, `extensions/cornerstone/src/utils/segmentationStoreDestination.ts`, `extensions/default/src/utils/restoreViewportPresentation.ts`, `modes/tmtv/src/utils/mibAirCustomConfig.ts`, this file.

## 8. Reproducing TMTV issues locally

The deployed config needs a GCP sign-in. For autonomous testing, use the public OHIF demo PET/CT study through the dev-server proxy:

1. Create an **untracked** `platform/app/public/config/local_repro.js`: a copy of `default.js` whose `dicomweb` source uses `http://localhost:<port>/demo-dicomweb` and the static-WADO options from `config/dev.js`. Add it to `.git/info/exclude`. Never commit it.
2. Start the app on a **port other than 3000** (3000 and 3002 are used for normal development), for example:
   ```bash
   APP_CONFIG=config/local_repro.js OHIF_PORT=3010 OHIF_OPEN=false PROXY_TARGET=/demo-dicomweb PROXY_DOMAIN=https://d14fa38qiwhyfd.cloudfront.net PROXY_PATH_REWRITE_FROM=/demo-dicomweb PROXY_PATH_REWRITE_TO=/dicomweb pnpm --filter @ohif/app run dev
   ```
3. Open `http://localhost:3010/tmtv?StudyInstanceUIDs=1.2.840.113619.2.290.3.3767434740.226.1600859119.501`.
   This is a phantom study with 47 axial slices; CT and PET slice counts are equal, so it does not exercise fix 6.1's fusion slice path.
4. Runtime globals: `window.services`, `window.commandsManager`, `window.cornerstone`, `window.cornerstoneTools`. `toggleOneUp` maximizes the *active* viewport (`viewportGridService.setActiveViewportId` first).
5. Resize-dependent behavior only runs in a **visible** page. Check `document.visibilityState`; a background tab or hidden pane skips resizes and invalidates the test. Compare world camera values (`focalPoint`, `parallelScale`) and per-volume `voiRange`, and use landscape window sizes like the readers' screens.
