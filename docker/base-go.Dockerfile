# syntax=docker/dockerfile:1
#? S1 — the GO stack base. Extends the agent base + a pinned Go toolchain (from the official tarball; apt's Go
#? lags). Build: docker build -f docker/base-go.Dockerfile --build-arg BASE_TAG=0.1.0 -t workspaces/base-go:0.1.0 .
ARG BASE_TAG=0.1.0
FROM workspaces/base:${BASE_TAG}
USER root
ENV DEBIAN_FRONTEND=noninteractive
ARG GO_VERSION=1.23.4
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz \
    && tar -C /usr/local -xzf /tmp/go.tgz \
    && rm -f /tmp/go.tgz
ENV PATH=/usr/local/go/bin:/home/agent/go/bin:$PATH
ENV GOPATH=/home/agent/go
LABEL org.workspaces.stack="go"
USER agent
