# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libsqlite3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY bin ./bin
COPY migrations ./migrations
COPY src ./src

RUN cargo build --release --locked

FROM node:22-bookworm AS ui_builder

WORKDIR /app/desktop

COPY desktop/package.json desktop/package-lock.json ./
# native-ui itself is resolved from the pinned Git revision in package.json.
RUN npm install --no-audit --no-fund

COPY desktop/index.html desktop/tsconfig.json desktop/tsconfig.node.json desktop/vite.config.ts ./
COPY desktop/postcss.config.cjs desktop/tailwind.config.ts ./
COPY desktop/src ./src
COPY desktop/public ./public

# The Rust image keeps only the public payment route. Operator routes navigate
# to the separately deployed React/Vite Cloud App.
RUN VITE_BASE_PATH=/ui/ \
    VITE_COURSEBOARD_OPERATOR_WEB_URL=https://courseboard.txcloud.app \
    npm run build

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN useradd --system --uid 10001 --create-home --home-dir /app appuser \
    && mkdir -p /app/data \
    && chown -R appuser:appuser /app

COPY --from=builder /app/target/release/courseboard /app/bin/courseboard
COPY --from=ui_builder /app/desktop/dist /app/ui

ENV BIND_ADDR=0.0.0.0:8080
ENV DATABASE_URL=sqlite:///app/data/courseboard.db

EXPOSE 8080

USER appuser

CMD ["/app/bin/courseboard"]
