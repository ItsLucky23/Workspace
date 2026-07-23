FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
# package-lock.json is produced by the repository-pinned npm 11 toolchain; Node 22 images still ship npm 10.
RUN npm install --global npm@11.6.1 \
  && npm ci --ignore-scripts
COPY services/compose-runner/tsconfig.json services/compose-runner/tsconfig.json
COPY services/compose-runner/src services/compose-runner/src
RUN ./node_modules/.bin/tsc -p services/compose-runner/tsconfig.json

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssh-client tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 runner \
  && useradd --uid 10001 --gid 10001 --create-home runner \
  && mkdir -p /opt/workspaces-compose-runner /var/lib/workspaces-compose-runner \
  && chown -R runner:runner /var/lib/workspaces-compose-runner
COPY --from=build /build/services/compose-runner/dist /opt/workspaces-compose-runner
USER 10001:10001
WORKDIR /var/lib/workspaces-compose-runner
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/workspaces-compose-runner/controller.js"]
