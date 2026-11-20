#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""The init's encrypted root (initramfs/init: charger_boot, crypt_open,
crypt_unlock and their call in boot_arch; docs/SECURITY-PLAN.md §5.2),
run in the real shell with a stand-in PIN pad, cryptsetup and paths in a
temporary directory. Nothing is opened, mounted or written outside it.

Checks: a plain userdata never reaches the unlock; a LUKS one is opened and
the boot goes on with /dev/mapper/root and leaves the session's marker; the
pad is started again when it stops, not after "no display"; ten idle
minutes power off; a charging boot waits dark, stops the USB safety net and
restarts on Power; the
hold marker keeps the boot in the initramfs once, with the root unmounted.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
source = (repo / "initramfs/init").read_text()


def function(name):
    start = source.index(f"\n{name}() {{") + 1
    return source[start:source.index("\n}\n", start) + 3]


body = "".join(function(f) for f in ("charger_boot", "crypt_open", "crypt_unlock", "boot_arch"))
failures = 0


def ok(cond, what):
    global failures
    print(("ok - " if cond else "not ok - ") + what)
    if not cond:
        failures += 1


def run(name, luks=True, pad="", bootconfig="", hold=False, timeout=10):
    """pad: the stand-in pad's body; it sees $T, $LOG and its arguments."""
    with tempfile.TemporaryDirectory() as t:
        T = Path(t)
        (T / "block/sda48").mkdir(parents=True)
        (T / "block/sda48/uevent").write_text("PARTNAME=userdata\n")
        (T / "block/sda48/ro").write_text("0\n")
        (T / "cmdline").write_text("rdinit=/init\n")
        (T / "bootconfig").write_text(bootconfig)
        (T / "crypt").write_text("")
        (T / "run").mkdir()
        root = T / "root"
        (root / "usr/lib/systemd").mkdir(parents=True)
        (root / "usr/lib/systemd/systemd").touch(mode=0o755)
        if hold:
            (root / ".omamobile-hold").touch()
        fake = T / "omamobile-pinpad"
        fake.write_text(f"#!/bin/sh\necho \"pad $*\" >> \"$LOG\"\n{pad}\n")
        fake.chmod(0o755)
        script = body
        for old, new in (("/sys/block/sda", T / "block"), ("/proc/cmdline", T / "cmdline"),
                         ("/proc/bootconfig", T / "bootconfig"), ("/etc/omamobile-crypt", T / "crypt"),
                         ("/run/omamobile", T / "run/omamobile"), ("/newroot", root),
                         ("[ -b /dev/mapper/root ]", f"[ -e {T}/mapper-root ]"),
                         ("--done /dev/mapper/root", f"--done {T}/mapper-root"),
                         ("/usr/local/bin/omamobile-pinpad", fake), ("/dev/kmsg", "/dev/null"),
                         ("/splash.bgra.gz", T / "nosplash"), ("/sys/block/dm-*", T / "nodm-*"),
                         ("/dev/tty0", "/dev/null")):
            script = script.replace(old, str(new))
        stop = "  kill -9 -1 2>/dev/null"
        assert script.count(stop) == 1
        script = script.replace(stop, '  echo "switch $dev" >> "$LOG"; return 42')
        spies = f"""
say() {{ echo "say $*" >> "$LOG"; }}
omamobile-pinpad() {{ {fake} "$@"; }}
cryptsetup() {{ echo "cryptsetup $*" >> "$LOG"; [ "$1" = isLuks ] && return {0 if luks else 1}; return 0; }}
dumpe2fs() {{ echo 'Filesystem volume name: omamobile-root'; }}
e2fsck() {{ echo "fsck $*" >> "$LOG"; return 0; }}
grow_root() {{ echo "grow $*" >> "$LOG"; }}
mount() {{ echo "mount $*" >> "$LOG"; return 0; }}
umount() {{ echo "umount $*" >> "$LOG"; }}
sync() {{ :; }}
sleep() {{ command sleep 0.05; }}
ufs_ro_pass() {{ :; }}
ufs_unguarded() {{ :; }}
"""
        f = T / "run.sh"
        f.write_text(spies + script + 'boot_arch; echo "status $?" >> "$LOG"\n')
        shell = json.loads(os.environ.get("OMAMOBILE_BOOT_ARCH_TEST_SHELL", '["/bin/sh"]'))
        env = {**os.environ, "LOG": str(T / "log"), "T": str(T)}
        p = subprocess.run(shell + [str(f)], env=env, capture_output=True, text=True, timeout=timeout)
        log = (T / "log").read_text().splitlines() if (T / "log").exists() else []
        files = {n: (T / "run" / n).exists() for n in ("omamobile/disk-unlocked", "omamobile-held")}
        files["hold-left"] = (root / ".omamobile-hold").exists()
        files["net-stopped"] = (T / "run/omamobile-pinpad").exists()
        return log, files, p


# A plain root: no cryptsetup open, no pad, the partition itself mounted
log, files, _ = run("plain", luks=False)
ok(not any(line.startswith("pad") for line in log) and "switch /dev/sda48" in log,
   "a plain userdata boots as before, with no PIN pad")
ok(not files["omamobile/disk-unlocked"], "a plain boot leaves no disk-unlocked marker")

# The pad opens it
log, files, _ = run("unlock", pad='case "$1" in --marker) touch "$T/mapper-root"; exit 0;; esac')
ok("switch /dev/mapper/root" in log, "an encrypted userdata boots from /dev/mapper/root once the pad opened it")
ok(any("mount -t ext4" in line and "/dev/mapper/root" in line for line in log), "it mounts the volume inside")
padline = next(line for line in log if line.startswith("pad --marker"))
ok("-- cryptsetup open /dev/sda48 root --key-file=-" in padline, "the pad runs cryptsetup open on userdata with the key on stdin")
ok(files["omamobile/disk-unlocked"], "the session's marker is written (D3)")

# The pad stops twice, then opens it; "no display" is not retried
log, files, _ = run("retry", pad='n=$(grep -c "^pad --marker" "$LOG"); [ "$n" -ge 3 ] && touch "$T/mapper-root"; exit 1')
ok(sum(line.startswith("pad --marker") for line in log) == 3 and "switch /dev/mapper/root" in log,
   "a pad that stops is started again")
log, files, _ = run("nodisplay", pad='[ -e "$T/ssh" ] || { touch "$T/ssh"; (command sleep 0.5; touch "$T/mapper-root") & }; exit 5')
ok(sum(line.startswith("pad --marker") for line in log) == 1 and "switch /dev/mapper/root" in log,
   "no display: the pad is not started again, and an SSH unlock goes on")

# Ten idle minutes
log, files, _ = run("idle", pad='case "$1" in --power-off) touch "$T/mapper-root";; --marker) exit 3;; esac')
ok("pad --power-off" in log, "the pad's idle exit powers the phone off")

# A charging boot
charger = 'androidboot.mode = "charger"\n'
log, files, _ = run("charger", bootconfig=charger,
                    pad='case "$1" in --charger) exit 10;; --restart) touch "$T/mapper-root";; esac')
ok(log.index("pad --charger") < log.index("pad --restart") and not any(line.startswith("pad --marker") for line in log),
   "a charging boot waits dark and restarts when Power is held, with no PIN pad")
ok(files["net-stopped"], "the charging wait stops the USB safety net (a wall charger is no host)")
log, files, _ = run("charger-out", bootconfig=charger,
                    pad='case "$1" in --charger) exit 11;; --power-off) touch "$T/mapper-root";; esac')
ok("pad --power-off" in log, "a charging boot powers off when the cable is out")

# Held for encryption
log, files, _ = run("hold", pad='case "$1" in --marker) touch "$T/mapper-root"; exit 0;; esac', hold=True)
ok("status 1" in log and not any(line.startswith("switch") for line in log),
   "the hold marker keeps the boot in the initramfs")
ok(any(line.startswith("umount") for line in log) and "cryptsetup close root" in log,
   "held: the root is unmounted and the volume closed")
ok(not files["hold-left"] and files["omamobile-held"], "the hold is once: its marker is gone, the held state recorded")

raise SystemExit(1 if failures else 0)
