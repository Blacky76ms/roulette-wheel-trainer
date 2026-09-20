#!/usr/bin/env sh
# Release: test, build, commit dist, publish it to the gh-pages branch (the fixed Pages URL).
set -e
node --test
node scripts/build.mjs
git add -A dist
git diff --cached --quiet || git commit -m "chore: build dist"
git push origin main
git subtree push --prefix dist origin gh-pages
