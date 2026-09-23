#!/usr/bin/env python3
"""Correct the container lines in the published v0.2.0 release notes.

v0.2.0's notes name `ghcr.io/drewc611/all-dash:0.2.0` and `:latest`. Neither
tag exists. The image build was cancelled at 29 minutes 41 seconds by the
timeout that exists so a wedged build cannot hold a finished release hostage,
and the release published thirteen seconds later with all eight installers and
no image. The notes were written before the run finished, which is the actual
mistake: describing a build nobody had watched succeed.

A release page telling people to pull a tag that 404s is worth fixing rather
than explaining, and editing a published release needs a credential that only
exists inside Actions.

Idempotent by construction: each replacement fires only while its exact text is
still present, and the script exits without a request when nothing matches.
"""

import json
import os
import sys
import urllib.error
import urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "drewc611/The-All-Dash")
TOKEN = os.environ["GH_TOKEN"]
TAG = "v0.2.0"

REPLACEMENTS = [
    (
        "- **Container.** `ghcr.io/drewc611/all-dash:latest`, for amd64 and arm64.",
        "- **Container.** Not published for this version — see the note below.\n"
        "  Use `ghcr.io/drewc611/all-dash:latest`, which points at v0.2.1.",
    ),
    (
        "Container: `ghcr.io/drewc611/all-dash:0.2.0`",
        "Container: **not published for this version.** "
        "`ghcr.io/drewc611/all-dash:0.2.0` does not exist and neither did "
        "`:latest` when these notes were written. The image build was cancelled "
        "at 29m41s by the job timeout and this release published thirteen "
        "seconds later, with every installer above and no image. Fixed in "
        "v0.2.1, where the same build takes 21 seconds: use `:latest` or "
        "`:0.2.1`. The eight installers on this page are unaffected.",
    ),
]


def api(method, path, payload=None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "tidy-workflow",
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


try:
    release = api("GET", f"/releases/tags/{TAG}")
except urllib.error.HTTPError as e:
    if e.code == 404:
        print(f"{TAG}: no release, nothing to correct")
        sys.exit(0)
    raise

body = release["body"] or ""
changed = 0
for old, new in REPLACEMENTS:
    if old in body:
        body = body.replace(old, new, 1)
        changed += 1

if not changed:
    print(f"{TAG}: already corrected, no request made")
    sys.exit(0)

api("PATCH", f"/releases/{release['id']}", {"body": body})
print(f"{TAG}: corrected {changed} container reference(s)")
