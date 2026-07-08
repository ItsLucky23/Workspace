# syntax=docker/dockerfile:1
#? S1 — the PYTHON stack base. Extends the agent base (node + pinned claude CLI + node-pty + openvscode +
#? pty-agent + DB clients + git/gh) so the coding agent + editor run here, and adds the Python toolchain so the
#? user's app builds/runs in Python. BUILD CONTEXT = repo root:
#?   docker build -f docker/base-python.Dockerfile --build-arg BASE_TAG=0.1.0 -t workspaces/base-python:0.1.0 .
ARG BASE_TAG=0.1.0
FROM workspaces/base:${BASE_TAG}
USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-full python3-pip python3-venv pipx \
    && rm -rf /var/lib/apt/lists/*
LABEL org.workspaces.stack="python"
USER agent
