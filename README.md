# NJORD panels for DeepSeek Harness

Docker, Treadmill, Knowledge and an Archify composer action, installed as an external Cordis client plugin. Git panels, repository management, Monaco and sidebar mirroring are not included.

The panels use the Host APIs from `@persike/dsh-project-tools`. They register their own generated Remote contribution, dictionaries, styles and public UI slots. Unloading the plugin removes those contributions.

## Install

Install `github:DevViking-Persike/dsh-njord` through the Harness plugin manager for the complete profile. To compose manually, install `github:DevViking-Persike/dsh-project-tools` and its Treadmill dependency before this bundle. Disable any built-in `ui-docker`, `ui-treadmill`, `ui-knowledge` and Archify contributions from the Persike fork; two copies must not register the same slot IDs or Remote namespaces.

The published Git repository includes `lib/`; installation runs no build script. This release targets the Persike Harness SDK `0.1.6-alpha.2`. Compatibility with later upstream versions is not established.

## Features

- Docker container and image inspection, logs, lifecycle controls and confirmations for removal.
- Treadmill stages, cursor, configurable gates and stage enablement; Red Team and Deploy remain enabled unless changed in the stage table.
- Knowledge sources and Treadmill assets, with workspace-restricted file reads.
- Archify submits a normal, logged skill request to the selected conversation. The host must supply the Archify skill.

Knowledge file access does not install a code editor. The `editor` Remote namespace is retained for compatibility with the file readers. The backend's language-server inventory currently requires the Persike `describeProviders()` API.

## Develop and verify

Run `npm install --ignore-scripts`, `npm run build`, and `npm test`. The build emits a client module-loader factory, keeps React and UI primitives external, and owns CSS through the plugin lifetime.

To type-check the source against the SDK’s public built declarations, run `DSH_SDK_ROOT=/path/to/deepseek-harness npm run typecheck:sdk` after building that checkout. This check uses package exports, without aliases to SDK source.

The extracted behavior suites use Harness source test support. With a compatible checkout and its development dependencies installed, run `DSH_SDK_ROOT=/path/to/deepseek-harness npm run test:sdk`. The test runner creates only ignored dependency links and a local Vitest configuration. Browser verification must use the actual installed plugin; the package tests cover artifact loading and disposal, not visual appearance.

Original source attribution is in [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
