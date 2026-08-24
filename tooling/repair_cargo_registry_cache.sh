#!/bin/sh
# Drop half-extracted crates from the shared Cargo home before the build.
#
# The Tachyon runner restores CARGO_HOME from a shared cache generation. A
# generation can carry a registry source directory whose files were pruned
# while its `.cargo-ok` marker survived. Cargo trusts the marker, skips
# unpacking, and aborts before compiling with:
#
#   error: failed to download `adler2 v2.0.1`
#   Caused by: failed to read `.../registry/src/<id>/adler2-2.0.1/Cargo.toml`
#
# Removing the incomplete entry — and its archive, which we cannot verify —
# puts the crate back into a state Cargo heals by downloading it again.
#
# Git dependencies are cached separately and rot the same way, with a checkout
# directory left holding nothing but its own marker:
#
#   error: failed to get `field-sdk` as a dependency of package `courseboard`
#   Caused by: Could not find Cargo.toml in `.../git/checkouts/field-sdk-<id>/<rev>`
#
# So this repairs both caches. The file keeps its name because the deploy
# manifest calls it by that name.
set -eu

cargo_home="${CARGO_HOME:-$HOME/.cargo}"
sources="$cargo_home/registry/src"
archives="$cargo_home/registry/cache"

if [ ! -d "$sources" ]; then
  echo "No Cargo registry source cache at $sources; nothing to repair"
  exit 0
fi

repaired=0
for source_dir in "$sources"/*/*; do
  [ -d "$source_dir" ] || continue
  if [ -f "$source_dir/.cargo-ok" ] && [ -f "$source_dir/Cargo.toml" ]; then
    continue
  fi

  registry_id=$(basename "$(dirname "$source_dir")")
  crate=$(basename "$source_dir")
  rm -rf "$source_dir"
  rm -f "$archives/$registry_id/$crate.crate"
  repaired=$((repaired + 1))
  echo "Removed incomplete Cargo registry entry $registry_id/$crate"
done

echo "Repaired $repaired incomplete Cargo registry cache entries"

# --- Git dependency checkouts ---------------------------------------------
#
# A checkout is judged broken only when its marker is missing or when the
# directory holds nothing but dotfiles. Checking for a top-level `Cargo.toml`
# would be wrong: a git dependency may legitimately live in a subdirectory of
# the repository it is cloned from, and every build would then throw away a
# perfectly good checkout.
checkouts="$cargo_home/git/checkouts"
bare_repos="$cargo_home/git/db"

if [ ! -d "$checkouts" ]; then
  echo "No Cargo git checkout cache at $checkouts; nothing more to repair"
  exit 0
fi

git_repaired=0
for checkout_dir in "$checkouts"/*/*; do
  [ -d "$checkout_dir" ] || continue

  if [ -f "$checkout_dir/.cargo-ok" ] && [ -n "$(ls "$checkout_dir" 2>/dev/null)" ]; then
    continue
  fi

  source_name=$(basename "$(dirname "$checkout_dir")")
  revision=$(basename "$checkout_dir")
  rm -rf "$checkout_dir"
  # The bare clone goes too: it is the likeliest reason the checkout came out
  # empty, and Cargo re-clones it without help.
  rm -rf "$bare_repos/$source_name"
  git_repaired=$((git_repaired + 1))
  echo "Removed incomplete Cargo git checkout $source_name/$revision"
done

echo "Repaired $git_repaired incomplete Cargo git checkout cache entries"
