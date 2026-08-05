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
