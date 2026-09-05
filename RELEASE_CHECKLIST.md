# Release checklist / 发布前检查清单

This repository is intentionally not published by the preparation workflow. Review every item before creating or pushing a GitHub repository.

本次准备流程不会创建或推送 GitHub 仓库。正式公开前请逐项审查。

## Repository identity

- [x] Place the repository in the clearly named directory `pi-trace-viewer`.
- [ ] Keep the package name as `pi-trace-viewer` in `package.json`.
- [ ] Confirm the repository description does not include private machine paths.
- [ ] Choose and add a repository license before making the GitHub repository public.

## Files to keep

- [ ] `src/`
- [ ] `web/`
- [ ] `test/`
- [ ] `docs/images/`
- [ ] `package.json` and `package-lock.json`
- [ ] `README.md`, `README.zh-CN.md`, `README.en.md`

## Files not to publish

- [ ] Local Pi session exports (`pi-session-*.html`)
- [ ] `.pi-traces/` directories and JSONL traces
- [ ] `.playwright-cli/`
- [ ] Logs, credentials, API keys, and screenshots containing private conversations

These patterns are already present in `.gitignore`, but inspect `git status` before the first commit.

## Verification

```bash
npm install
npm run check
npm audit --omit=dev
```

- [ ] Run a one-session smoke test with `pi -e /path/to/pi-trace-viewer`.
- [ ] Verify the viewer binds only to `127.0.0.1`.
- [ ] Verify a trace sidecar appears under `<session-directory>/.pi-traces/`.
- [ ] Verify Pi's native session JSONL is unchanged by the extension.
- [ ] Review all screenshots and replace any private content before publishing.

## Publish only after review

The preparation workflow has not run `git init`, `git remote add`, `git push`, or any GitHub publishing command.
