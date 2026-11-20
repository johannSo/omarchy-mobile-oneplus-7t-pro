#!/bin/bash
# SPDX-License-Identifier: MIT
# omamobile-lock-on-start against stand-ins for Omarchy's toggle, shell and
# lock: no PIN, no lock; a plain phone locks at every login; an encrypted
# phone whose disk was unlocked at this boot skips the lock once, then locks
# at the next login of the same boot, and skips again after the next boot.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
fail() { printf 'not ok - %s\n' "$1" >&2; exit 1; }
pass() { printf 'ok - %s\n' "$1"; }
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/home" "$t/run/omamobile"
printf '#!/bin/sh\n[ -e "$T/toggle" ]\n' > "$t/bin/omarchy-toggle-enabled"
printf '#!/bin/sh\nexit 0\n' > "$t/bin/omarchy-shell"
printf '#!/bin/sh\necho lock >> "$T/locks"\n' > "$t/bin/omarchy-system-lock"
chmod +x "$t/bin"/*
login() { T=$t HOME=$t/home PATH=$t/bin:$PATH OMAMOBILE_RUN=$t/run OMAMOBILE_BOOT_ID=$1 bin/omamobile-lock-on-start; }
locks() { cat "$t/locks" 2>/dev/null | wc -l; }

login boot1
(( $(locks) == 0 )) || fail "no PIN set: no lock"
touch "$t/toggle"
login boot1
(( $(locks) == 1 )) || fail "a plain phone locks after login"
pass "no PIN: no lock; a plain phone locks at login"

: > "$t/run/omamobile/disk-unlocked"
login boot2
(( $(locks) == 1 )) || fail "the first login after the PIN pad isn't locked"
login boot2
(( $(locks) == 2 )) || fail "a second login in the same boot locks"
login boot3
(( $(locks) == 2 )) || fail "the next boot's first login skips again"
pass "an encrypted phone skips the lock once per boot after its PIN pad"
