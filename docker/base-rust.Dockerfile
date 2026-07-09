# syntax=docker/dockerfile:1
#? S1 — the RUST stack base. Extends the agent base + rustup (installed into the agent's home so cargo runs as the
#? non-root agent). Build: docker build -f docker/base-rust.Dockerfile --build-arg BASE_TAG=0.1.0 -t workspaces/base-rust:0.1.0 .
ARG BASE_TAG=0.1.0
FROM workspaces/base:${BASE_TAG}
USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends gcc pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
USER agent
ENV RUSTUP_HOME=/home/agent/.rustup CARGO_HOME=/home/agent/.cargo PATH=/home/agent/.cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain stable
LABEL org.workspaces.stack="rust"
