# syntax=docker/dockerfile:1
#? E1 — the DOTNET stack base. Extends the agent base so the coding agent + editor run here, and adds the .NET
#? SDK (via the official install script, arch-agnostic) so the user's app (dotnet webapi) builds/runs.
#?   docker build -f docker/base-dotnet.Dockerfile --build-arg BASE_TAG=0.1.0 -t workspaces/base-dotnet:0.1.0 .
ARG BASE_TAG=0.1.0
FROM workspaces/base:${BASE_TAG}
USER root
ENV DEBIAN_FRONTEND=noninteractive DOTNET_ROOT=/usr/share/dotnet PATH=/usr/share/dotnet:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev \
    && curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
    && bash /tmp/dotnet-install.sh --channel LTS --install-dir /usr/share/dotnet \
    && rm -f /tmp/dotnet-install.sh && rm -rf /var/lib/apt/lists/*
LABEL org.workspaces.stack="dotnet"
USER agent
