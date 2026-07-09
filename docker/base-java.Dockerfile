# syntax=docker/dockerfile:1
#? S1 — the JAVA stack base. Extends the agent base + a JDK + Maven + Gradle wrapper support. Build:
#?   docker build -f docker/base-java.Dockerfile --build-arg BASE_TAG=0.1.0 -t workspaces/base-java:0.1.0 .
ARG BASE_TAG=0.1.0
FROM workspaces/base:${BASE_TAG}
USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends default-jdk maven \
    && rm -rf /var/lib/apt/lists/*
LABEL org.workspaces.stack="java"
USER agent
