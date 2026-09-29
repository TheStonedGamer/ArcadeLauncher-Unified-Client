# Local release builder for ArcadeLauncher-Unified-Client.
# Linux bundles (deb/rpm/AppImage) build natively; the Windows NSIS installer is
# cross-compiled with cargo-xwin (MSVC CRT/SDK fetched by xwin) + makensis.
FROM rust:1-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
        libayatana-appindicator3-dev librsvg2-dev lld llvm clang xdg-utils cmake \
        libasound2-dev libudev-dev nsis rpm fuse libfuse2 squashfs-tools \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-pc-windows-msvc \
    && cargo install --locked cargo-xwin
# AppImage tooling runs without FUSE inside containers.
ENV APPIMAGE_EXTRACT_AND_RUN=1
WORKDIR /work
