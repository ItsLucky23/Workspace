# syntax=docker/dockerfile:1
#? E1 — the PHP stack base. Extends the agent base (node + claude CLI + node-pty + openvscode + pty-agent + DB
#? clients + git/gh) so the coding agent + editor run here, and adds PHP + Composer so the user's app builds/runs.
#? BUILD CONTEXT = repo root:
#?   docker build -f docker/base-php.Dockerfile --build-arg BASE_TAG=0.1.0 -t workspaces/base-php:0.1.0 .
ARG BASE_TAG=0.1.0
FROM workspaces/base:${BASE_TAG}
USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      php-cli php-common php-mbstring php-xml php-curl php-sqlite3 php-mysql unzip \
    && curl -fsSL https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \
    && rm -rf /var/lib/apt/lists/*
LABEL org.workspaces.stack="php"
USER agent
