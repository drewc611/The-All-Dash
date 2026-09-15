# syntax=docker/dockerfile:1.7
# The browser app, behind a static server.
#
# There is no backend in this image and no server-side anything: the app keeps
# every byte in localStorage and IndexedDB on the device. This serves files.
# That is also why it is the smallest useful thing that can - nginx would be
# three times the size for features this has no use for.
#
#   docker build -t alldash .
#   docker run --rm -p 8080:8080 alldash
# --platform=$BUILDPLATFORM pins this stage to whatever machine is doing the
# building, rather than to the architecture being built for. It matters because
# this stage runs `npm ci` and vite, and its entire output is /app/dist: HTML,
# CSS, JavaScript and images, none of it architecture-specific. Without the
# pin, a linux/arm64 build re-runs all of Node under QEMU to produce the same
# bytes - which took 83 seconds once, twenty-five minutes on another day, and
# then more than thirty on v0.2.0, where it hit the job timeout and that
# release shipped its installers with no container image at all.
#
# Only the runner stage below is per-architecture now, and all it does is copy
# files into a busybox image.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY vite.config.js index.html ./
COPY public ./public
COPY src ./src
# The version stamped into the bundle decides the release channel the app
# reports and which feature flags are on, so it has to come from the real
# package.json rather than a default.
RUN npm run build

FROM busybox:1.37-musl AS runner
# An unprivileged id that exists in the image without needing adduser.
RUN mkdir -p /srv/app
COPY --from=build --chown=65532:65532 /app/dist /srv/app
# A single-page app serves index.html for any path it does not have a file for,
# and busybox httpd does that with an error page rather than a rewrite rule.
COPY --from=build --chown=65532:65532 /app/dist/index.html /srv/app/index.html
WORKDIR /srv/app
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=2s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/index.html || exit 1
# -f foreground, -p port, -h document root. No directory listing: every path
# that is not a file falls through to the SPA entry point.
CMD ["httpd", "-f", "-v", "-p", "8080", "-h", "/srv/app"]
