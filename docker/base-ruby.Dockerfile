# syntax=docker/dockerfile:1
#? E1 — the RUBY stack base. Extends the agent base so the coding agent + editor run here, and adds Ruby +
#? Bundler so the user's app (Rails/Rack) builds/runs.
#?   docker build -f docker/base-ruby.Dockerfile --build-arg BASE_TAG=0.1.0 -t workspaces/base-ruby:0.1.0 .
ARG BASE_TAG=0.1.0
FROM workspaces/base:${BASE_TAG}
USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ruby-full build-essential libsqlite3-dev \
    && gem install bundler --no-document \
    && rm -rf /var/lib/apt/lists/*
LABEL org.workspaces.stack="ruby"
USER agent
