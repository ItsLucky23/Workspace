# I1 (demo-video) — the `workspaces/capture` image: Playwright + chromium (bundled) + ffmpeg, plus the capture
# driver script. A one-shot container: `node /capture/captureScript.mjs --url <baseUrl> --out /out/<name>.mp4
# --scenario <json>` navigates the scenario against the app and records the session to the mounted /out.
#
# Build: docker build -f docker/base-capture.Dockerfile -t workspaces/capture:latest .
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /capture
COPY server/container/capture/captureScript.mjs /capture/captureScript.mjs
# Playwright is preinstalled in the base image; the script imports it from the global install.
ENV NODE_PATH=/ms-playwright-agent/node_modules:/usr/lib/node_modules
ENTRYPOINT []
