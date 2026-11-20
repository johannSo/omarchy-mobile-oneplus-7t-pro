<!-- SPDX-License-Identifier: MIT -->
# Security plan: an encrypted disk, unlocked with your PIN at boot

Status (2026-11-19): **E1, E2 and E4 are built and tested on the laptop
(§6.1); nothing has run on a phone, and no image or partition has changed.**
The next step is E3, the runbook's read-only steps and the new initramfs on a
plain root (§8), each with the owner's yes. Today the root file system on
`userdata` is plain ext4: anyone who has the phone can read it from fastboot
without the lock-screen PIN. This plan puts the root in LUKS2 and adds a
touch PIN pad to the initramfs, so the phone asks for the owner's PIN once at
power-on and then starts Omarchy. It covers new installs and encrypting a
phone that already runs Omarchy Mobile, keeping its data.

This version replaces the plan of 2026-11-01, which also designed a locked
bootloader with our own AVB key. That part is left out here and will get a
plan of its own; the earlier text is in git (`git show 0cd165a:docs/SECURITY-PLAN.md`).
Other plans that cite "SECURITY-PLAN S3, S6, S7, D2, §5.3 or §5.4" mean that
earlier version.

Facts are marked **[V]** (verified in this repository or on a phone), **[D]**
(public documentation, cited in §10) or **[I]** (inferred, to be checked on
hardware). The design is device-neutral; §5.8 lists what differs on the Pixel
7 Pro (`cheetah`, the reference phone) and the OnePlus 7T Pro (`hotdog`).

## Contents

1. [What the owner gets](#1-what-the-owner-gets)
2. [What it protects, and what it doesn't](#2-what-it-protects-and-what-it-doesnt)
3. [What exists today](#3-what-exists-today)
4. [Facts](#4-facts)
5. [Design](#5-design)
6. [Phases](#6-phases)
7. [Decisions](#7-decisions)
8. [Runbook](#8-runbook)
9. [Risks](#9-risks)
10. [Sources](#10-sources)

## 1. What the owner gets

**At power-on:**

1. The boot logo, as today.
2. A full-screen PIN pad in the theme's colours: "Enter PIN", a row of dots,
   the digits 0-9, delete and OK. Touch works; the volume keys and Power work
   too, for a screen whose touch isn't up.
3. OK. "Unlocking…" for about two seconds (the key derivation, §4.2).
4. The boot continues as today and Omarchy comes up **without a second
   PIN**: the boot PIN already proved the owner is there, as an Omarchy
   laptop does with its disk password (D3). From then on the lock screen
   works as it does now.

A wrong PIN shakes the dots and says so. After five wrong PINs each try
waits a little longer, shown on screen.

**At install:** nothing new to learn. `tools/install-phone` already asks
"Password or PIN (unlocks the phone, and for sudo)"; on an encrypted install
the same PIN also unlocks the disk (D2). The installer then shows a
**recovery key** once (48 digits in eight groups of six) for the owner to
keep in a password manager. It opens the disk if the PIN is forgotten, typed
on the same PIN pad.

**Day to day:** `omamobile-pin` changes the PIN for the lock screen, sudo and
the disk together. For development, `tools/phone-unlock` on the laptop types
the PIN over USB SSH after a `push`, so the developer doesn't need to tap
the phone after every test boot.

## 2. What it protects, and what it doesn't

**It protects:**

- **A phone that is lost or stolen while off, or after it restarts.** The
  root file system is ciphertext. Reading `userdata` from fastboot, from a
  RAM-booted kernel or from the storage chip gives nothing without the PIN or
  the recovery key.
- **A phone sent for repair or sold**, once its keyslots are erased
  (`cryptsetup erase`): the data is unreadable without a full wipe.

**It doesn't protect:**

- **A phone that is on.** The key is in RAM from unlock to power-off,
  through suspend. The lock screen, ufw and key-only SSH protect a running
  phone, as today.
- **Someone who gets the phone, changes it and gives it back** ("evil maid").
  The bootloader stays unlocked, so they can flash an initramfs that records
  the PIN. Only a locked bootloader with our own key stops that (the
  separate verified-boot plan).
- **A determined offline attack on a short PIN.** No hardware throttles the
  guesses (§4.3): an attacker who copies `userdata` can guess on their own
  machines. Argon2id makes each guess cost about a gigabyte of memory and a
  second or two, which stops a casual thief with a 6-digit PIN, but not
  someone with time and hardware. Longer PINs help a lot; a passphrase
  stops it (§4.3, D1).
- **Integrity.** XTS gives confidentiality, not integrity: changed
  ciphertext decrypts to garbage, undetected (§4.4).

**What it costs (worth saying plainly):**

- **Before the PIN, the phone does nothing.** No calls, texts or alarms
  until the PIN is entered. A phone that restarts at night (a crash, a
  watchdog, an update) misses its alarm until someone unlocks it. Android
  avoids this with a separate, early-unlocked storage area; we have none.
- **Fingerprint can't unlock the disk.** It works afterwards, at the lock
  screen.
- **Agents and scripts can't finish a reboot alone.** Every boot waits for
  the human's PIN, at the phone or through `tools/phone-unlock`.
- **A forgotten PIN and a lost recovery key mean the data is gone.**

## 3. What exists today

Checked on `main` at `4b31273` (2026-11-19), before E1. **[V]**

- **The root image is plain ext4.** `rootfs/build-inside:312` makes it with
  `mkfs.ext4 -q -L omamobile-root -m 1 -d`. `tools/install-phone` writes it
  with `fastboot flash userdata` after `debugfs` has put `firstboot.conf`
  into a local copy; on hotdog, `device/hotdog/prepare-userdata` does the
  same and a human flashes it. No fstab names the root: the initramfs mounts
  it.
- **The initramfs mounts `userdata` directly.** `boot_arch` in
  `initramfs/init` finds the partition by `PARTNAME=userdata`, waits up to
  300 s for it, optionally checks the `omamobile-root` label, runs `e2fsck`,
  grows the file system (`grow_root`), mounts ext4 and calls `switch_root`.
  If anything fails it stays in the initramfs with SSH and a shell.
- **The initramfs has no cryptsetup.** `bin/omamobile initramfs` fetches
  Alpine 3.24's `dropbear`, `kexec-tools`, `e2fsprogs` and `e2fsprogs-extra`
  (and `i2c-tools` where a descriptor asks), and packs `initramfs.cpio.lz4`.
  It can also pack a device's modules (`INITRAMFS_MODULES`, loaded in order
  by `load_modules`).
- **The kernel can't do dm-crypt.** In hotdog's current build
  (`out-hotdog-sensors`): `CONFIG_DM_CRYPT` not set, `CONFIG_BLK_DEV_DM=m`,
  `CONFIG_CRYPTO_XTS=m`, `CONFIG_CRYPTO_USER_API_SKCIPHER` and `_HASH` not
  set, `CONFIG_CRYPTO_AES_ARM64_CE_BLK=y`. `CONFIG_BLK_INLINE_ENCRYPTION`
  (in `kernel/configs/omamobile.config`) is there only for the UFS host
  driver; nothing uses inline encryption.
- **The installer already asks for the PIN.** `tools/install-phone:1081`
  asks "Password or PIN (unlocks the phone, and for sudo)" twice, records
  `CREDENTIAL=pin` when it is all digits, and keeps only its sha512-crypt
  hash in `firstboot.conf`.
- **The session logs in by itself and then locks** (SDDM autologin, then
  Omarchy's lock-on-start; `omamobile-firstboot` step 8).
- **The phone says it has no encrypted disk:** `omamobile-setup-user` hides
  Omarchy's *Style > Unlock* menu for that reason.

## 4. Facts

### 4.1 LUKS2 and cryptsetup

- cryptsetup's defaults (Arch's build) **[V]**: LUKS2, `aes-xts-plain64`
  with a 512-bit key, Argon2id, 2000 ms, up to 1 GiB, 4 threads.
- The LUKS2 header with its keyslot area takes 16 MiB at the start of the
  device by default. **[D]** (cryptsetup-luksFormat(8))
- A keyslot's Argon2id cost is benchmarked **on the machine that makes it**.
  A keyslot made on the laptop and opened on the phone takes as long as the
  laptop took times the speed difference. So keyslots are made on the phone,
  in the initramfs: the same CPU, at the same clock state, as every later
  unlock. **[D]**, **[I]** for the clock state.
- `--key-file=-` reads every byte from stdin, a trailing newline included,
  while the interactive prompt strips it. Every tool here passes the PIN
  with no newline (`printf '%s'`), so a PIN set by a tool also works when
  typed at an interactive `cryptsetup open`. **[D]**, and **[V]** with the
  initramfs's own aarch64 cryptsetup 2.8.6 under qemu: the PIN opens a LUKS2
  file (exit 0), the PIN plus a newline doesn't (exit 2, "No key available
  with this passphrase").
- LUKS2 can store open flags in the header (`--persistent`), such as
  `--allow-discards` and `--perf-no_read_workqueue`/`--perf-no_write_workqueue`
  (the last two help latency on fast flash). **[D]**

### 4.2 The phones' CPUs

- Both phones have the ARMv8 Crypto Extensions, and AES-XTS runs on them
  (`CRYPTO_AES_ARM64_CE_BLK=y`) **[V]**, expected well above UFS speed
  **[I]** (R3 measures it).
- Argon2id at 1 GiB and 4 threads, about 2 s in the initramfs, is the
  starting point (D5). Both phones have 8 GB of RAM or more **[I]**.

### 4.3 No hardware-backed key: the PIN is the key

Android binds the disk key to the TEE and a security chip that limit wrong
guesses. We don't use them: those interfaces are the vendors', and binding a
key to them is later research (E9). **The PIN alone is the key material**,
stretched by Argon2id.

Rough order of magnitude **[I]**, for an attacker who has copied `userdata`
and tests about 50 guesses a second (1 GiB each, so a machine with 64 GiB of
fast memory):

| Secret | Guesses | Time to try them all |
| --- | --- | --- |
| 6-digit PIN | 10^6 | about 6 hours |
| 8-digit PIN | 10^8 | about 3 weeks |
| 10-digit PIN | 10^10 | about 6 years |
| 4 random words (7776-word list) | 3.7 × 10^15 | far beyond reach |

Throttling on the PIN pad (§5.3) only slows someone tapping at the screen;
it does nothing against a copy of the partition. The installer shows this
table in one line and suggests 8 digits or more (D1).

### 4.4 Integrity

dm-crypt with XTS has no authentication. LUKS2 can add dm-integrity
(`--integrity`), at a cost in space, write speed and a full initial wipe.
Not in this plan.

### 4.5 Display and input in the initramfs

- **Display:** the initramfs draws on `/dev/fb0` today (the splash is
  `zcat /splash.bgra.gz > /dev/fb0`, raw BGRA at the descriptor's
  `PANEL_SIZE`) **[V]**. On cheetah fb0 is ABL's framebuffer through
  simplefb, kept refreshing by the `SIMPLEFB_TRIG_CON` write; hotdog has no
  splash yet and shows the init's lines on the console **[V]**
  (`device.conf`), so fb0 exists there too. Its geometry and format under
  hotdog's built-in `DRM_MSM` are **[I]** (R2).
- **Touch:** cheetah's touchscreen driver is built in
  (`CONFIG_TOUCHSCREEN_SYNAPTICS_TCM_SPI=y`) **[V]**. Hotdog's is a module
  (`CONFIG_TOUCHSCREEN_S6SY761=m`) **[V]**, so the initramfs has no touch on
  hotdog until it is built in or packed through `INITRAMFS_MODULES` (§5.8).
- **Keys:** `CONFIG_KEYBOARD_GPIO=y` and `CONFIG_INPUT_EVDEV=y` on both;
  hotdog's power key is `CONFIG_INPUT_PM8941_PWRKEY=y` **[V]**.
- **No keyboard and no Plymouth in the initramfs**, so the PIN pad is our
  own program (§5.3).

### 4.6 Things in the initramfs that assume a short stay

- **The USB safety net** (`/etc/omamobile-usb-recovery`): with no USB host
  configured within 45 s, it waits 20 s more and crashes the phone so ABL
  falls back to slot A **[V]**. Hotdog turns this off
  (`USB_HOST_PANIC=0`); cheetah has it. A PIN pad that waits for a person
  with no cable plugged in would trip it, so the pad must stop it (§5.2).
- **Watchdogs:** cheetah's `s3c2410_wdt` is built in, with
  `CONFIG_WATCHDOG_HANDLE_BOOT_ENABLED=y`, so the kernel feeds a running
  watchdog until userspace opens it **[V]**. Hotdog's `qcom-wdt` is a module
  **[V]**; the initramfs has stayed up for long debugging sessions there
  **[I]**. T2 waits ten minutes at the pad on both.
- **Charging boots:** a Pixel that is off and gets a charger is started with
  `androidboot.mode = "charger"`, and today the root's
  `omamobile-charger-mode` (device-cheetah) turns the panel off and waits
  **[V]**. With an encrypted root, the root can't start without the PIN, so
  the initramfs must handle that boot itself (§5.2). On cheetah the charger
  driver is a module (`CONFIG_CHARGER_MAX77759=m`) **[V]**; whether the
  charger keeps charging under ABL's settings with no driver loaded is
  **[I]** (R4). Hotdog's bootloader behaviour on a charger is **[I]**.

### 4.7 Size budget

- **The initramfs has room on both phones.** The earlier version of this
  section put cheetah's initramfs in its 8 MiB `init_boot`; that was wrong.
  `bin/omamobile images` packs an empty ramdisk into `init_boot` and our
  initramfs into **`vendor_kernel_boot`, a 64 MiB partition** **[V]**
  (`cmd_images`; BRINGUP-M1's partition table). Hotdog's sits in its boot
  image.
- So the initramfs takes **Alpine's own signed `cryptsetup` package**, as it
  takes dropbear and e2fsprogs, and no custom static build: `libcrypto` is
  already in Alpine's minirootfs, and the package adds `libcryptsetup`,
  `libdevmapper`, `json-c`, `popt`, `libblkid` and `libuuid`. Measured for
  hotdog: `initramfs.cpio.lz4` grew from 6.7 MB to 7.5 MB with cryptsetup,
  GNU tar, the PIN pad and its glyphs **[V]** (2026-11-19, a scratch build).
- AF_ALG (`CONFIG_CRYPTO_USER_API_HASH`, `_SKCIPHER`) is still in the kernel
  options: cryptsetup uses it for the LUKS2 keyslot area and its cipher
  checks, without a temporary device-mapper table **[D]**.

## 5. Design

### 5.1 On the disk

```
userdata  ── LUKS2 (label omamobile-crypt, 16 MiB header)
             keyslot 0: the owner's PIN       (Argon2id, made on the phone)
             keyslot 1: the recovery key      (Argon2id, made on the phone)
             flags: allow-discards, no read/write workqueue (persistent)
   └─ /dev/mapper/root ── ext4, label omamobile-root (as today)
```

- One partition, one volume, no LVM. The file system inside is what the
  phone has today, so everything above the initramfs is unchanged.
- **Discards on** (D6): TRIM keeps UFS fast and wears it less. It shows which
  blocks are free, not what's in them.
- **The recovery key** is 48 random digits in eight groups of six (159
  bits), so the PIN pad takes it as it is (it takes up to 64 digits) and no
  keyboard is needed. Made on the laptop (`secrets.randbelow`), shown once,
  confirmed by its last group, and never written to a file by our tools
  (on the phone it passes through a file in `/run`, RAM, for `luksAddKey`,
  removed at once).

### 5.2 Booting (`initramfs/init`)

The change sits in one place: `boot_arch`, between finding `userdata` and
the existing label check.

1. **Find `userdata`, as today.**
2. **`cryptsetup isLuks`?** No: the plain ext4 path, unchanged. A phone that
   isn't encrypted boots exactly as today, so the new initramfs can go on
   every phone before anyone encrypts anything.
3. **Charging boot?** If `/proc/bootconfig` (or the command line) says
   `androidboot.mode = "charger"`: no PIN pad. The screen goes dark, and the
   initramfs waits as `omamobile-charger-mode` does: Power held for a second
   restarts into a normal boot; the cable out for five seconds powers off
   (D8). The wait stops the USB safety net: a wall charger is no USB host.
4. **Unlock.** Two ways race; the first to open the volume wins and the
   other stops:
   - the **PIN pad** on the screen (§5.3);
   - **`omamobile-unlock` over SSH**, in development initramfs builds, which
     already accept the developer's key: it reads the PIN on stdin.
     `tools/phone-unlock` on the laptop calls it.
   Both run `cryptsetup open --allow-discards … userdata root
   --key-file=-` with the PIN on a pipe.
5. **While waiting:** the pad writes `/run/omamobile-pinpad`, and the USB
   safety net exits when it sees it (cheetah). After 60 s with no input the
   pad blanks the screen (backlight to 0 if the initramfs has one, **[I]**;
   otherwise a black frame), and a touch or key brings it back. After 10
   minutes with no input the phone powers off (the reboot syscall's
   `POWER_OFF`, not busybox `poweroff`: AGENTS §4 says busybox `reboot`
   hangs).
6. **Opened:** `dev=/dev/mapper/root`, and the existing path runs on it:
   the label check, `e2fsck`, `grow_root`, the mount, the guard's last pass
   and `switch_root`. `/dev/mapper/root` is not an `sd*` device, so the
   storage guard doesn't touch it, and `userdata` stays the only writable
   partition, as today.
7. **The marker for the session:** once the volume is open, the init writes
   `/run/omamobile/disk-unlocked` (`/run` moves into the new root), and
   `omamobile-lock-on-start` skips the lock once for that boot (D3, §5.5).
8. **Shutdown:** nothing new. systemd unmounts the root's tree as far as it
   can; the mapping stays open until power-off, as on any LUKS root that
   an initramfs opened.

What stays the same: `omamobile.initramfs` on the command line still holds
in the initramfs (no unlock); the NFS root still works; RAM boots unlock the
same way.

Two things are new for every phone, encrypted or not:

- **The init says what it can do:** `/run/omamobile/initramfs-features`
  holds `crypt hold`. `omamobile-encrypt-hold` refuses on a boot whose
  initramfs lacks it, since that initramfs would ignore the hold and a later
  one would hold by surprise.
- **A held boot can go on:** PID 1 no longer only keeps a shell on tty1; it
  also waits for `/run/omamobile-continue` and then runs the root's boot
  again (`boot_root`), even with `omamobile.initramfs` on the command line.
  `tools/phone-encrypt` uses it to hand over once it is done; a human can
  too (`touch /run/omamobile-continue` over SSH).

### 5.3 The PIN pad (`omamobile-pinpad`)

A small C program in a new `initramfs/pinpad/`, statically linked against
musl (as the initramfs's other helpers are built from the Alpine sysroot
`bin/omamobile` already makes), with no library beyond libc.

- **Drawing:** it lays the pad out from fb0's own geometry
  (`FBIOGET_VSCREENINFO`, `FBIOGET_FSCREENINFO`, stride and channel offsets
  included; 16, 24 or 32 bits per pixel), so no picture has to match the
  panel: round keys in the theme's colours, antialiased, the PIN's dots, a
  title and one message line. Text comes from glyphs that
  `initramfs/pinpad/mkfont` renders at build time with ImageMagick at the
  panel's width (`PINPAD_FONT`, default the build machine's sans), only the
  characters the pad prints, 300 KB for 1440 px; without them the pad draws
  its built-in capitals. Any other framebuffer (no fb0, another visual)
  exits 5 and leaves the SSH unlock.
- **Touch:** multi-touch protocol B (and A, and single-touch `ABS_X/Y`)
  from every evdev device with positions, looked for again every 2 s, so a
  touch driver that loads late still counts; a key fires on release inside
  its cell. Coordinates scale from the device's `ABS` ranges to the
  framebuffer. `PINPAD_TOUCH_SWAP=x|y|xy` mirrors a panel; it becomes a
  descriptor key if R2 finds one mirrored.
- **Keys:** Volume Up and Down move a highlight across the keys; Power
  presses it. This is the fallback for a phone whose touch isn't up in the
  initramfs.
- **The PIN in memory:** one fixed buffer, `mlock`ed, wiped after use; it
  goes to `cryptsetup`'s stdin through a pipe and nowhere else: no log, no
  file, no kmsg. At most 64 digits.
- **Wrong PIN:** `cryptsetup` exits 2. The pad shows "Wrong PIN" and clears.
  From the sixth wrong PIN each try waits longer (5, 10, 20, 40 s, up to
  5 minutes), shown on screen. The count lives in RAM, so a restart resets
  it: this is for someone at the screen, not for an offline attack (§4.3).
  No wipe after N tries (D4).
- **Digits only in the first version.** A passphrase (letters) is unlocked
  over SSH until the pad gets a letter layout (E7, D7).
- **No stdio formatting:** musl's `printf` needs 128-bit float helpers
  that a plain clang has no library for on aarch64, so the pad has a small
  formatter of its own and links no stdio (289 KB static).
- **Tests on the laptop** (`tests/pinpad.py`): the program runs against a
  framebuffer in a file and scripted evdev input (`PINPAD_FB`,
  `PINPAD_INPUT`, tests only), with a fake `cryptsetup` that accepts one
  PIN. They check the exact bytes that reach the command, that the trace,
  stdout and the screen never hold the PIN, delete, the volume keys and
  Power alone, the back-off, the unlock from elsewhere, blanking (the waking
  tap presses nothing) and the idle power-off, the safety-net marker, no
  display, both fonts, and the charging boot's two exits.

### 5.4 Encrypting a phone: `tools/phone-encrypt`

One laptop tool for both cases. It talks to the phone's initramfs over USB
SSH (`root@172.16.42.1`, development initramfs), so it works on every phone
whose initramfs has the new init, without fastboot.

**Getting into the initramfs with the root not mounted.** Running Linux,
`omamobile-encrypt-hold` (in the device-neutral package that carries
`omamobile-pin`) writes `/.omamobile-hold`. On the next boot the init mounts
the root as usual, sees the marker, deletes it, unmounts and stays in the
initramfs with "held for encryption" on the screen. (A RAM boot with
`omamobile.initramfs` on the command line does the same, where a device has
RAM boots.) The reboot itself is the human's call, as always.

**`tools/phone-encrypt --keep BACKUP_DIR`: encrypt a phone and keep
everything on it.**

1. **Checks:** the phone answers in the initramfs; the init supports
   encryption (`/etc/omamobile-crypt`); `userdata` is plain ext4 labelled
   `omamobile-root`; a clean `e2fsck -f`; the battery is above 50 % or a
   charger is in; `BACKUP_DIR` has room for the used space plus 10 %.
2. **Backup, read-only:** the root mounted read-only; the initramfs's GNU
   tar (Alpine's 1.35, which the restore needs anyway) writes a POSIX
   archive in name order (`--format=posix --sort=name --xattrs
   --xattrs-include=* --acls --numeric-owner --sparse --one-file-system`,
   pax headers named without a PID, no atime or ctime), so file
   capabilities, ACLs, hard links and sparse files come across. The stream
   goes over SSH into `BACKUP_DIR/root.tar.zst`, compressed on the laptop.
3. **Verify:** a second read-only pass on the phone gives the stream's
   SHA-256, and the laptop compares it with the stream it received and
   with the file it wrote, and the archive's entry count with the phone's
   `find`. Any difference: stop, nothing written. One catch, found on the
   laptop: GNU tar names a sparse file's header `GNUSparseFile.<pid>/…`,
   with its own PID, and no option changes that, so two reads never match
   byte for byte. `omamobile-tarnorm` (C, in the initramfs) and the tool's
   Python twin replace that number before hashing; the archive itself is
   kept as tar wrote it. **[V]** with the aarch64 tar under qemu: two reads,
   and a restore read back, give one digest; T3 checks it on the phone.
4. **The owner confirms:** the tool prints what it will erase and asks the
   owner to type the codename and `erase`. This is the one irreversible
   step: `userdata` is overwritten.
5. **The PIN:** asked on the laptop twice (D2: the same as the lock-screen
   PIN). All digits, at least 6; under 8 the tool shows §4.3's line and asks
   again whether to keep it.
6. **Format on the phone:** `cryptsetup luksFormat --type luks2 --label
   omamobile-crypt --pbkdf argon2id --pbkdf-memory 1048576
   --pbkdf-parallel 4 --pbkdf-force-iterations 4 --key-file=-` (a fixed cost:
   see D5), then `luksAddKey` for
   the recovery key (made on the laptop, shown once, the owner types back
   its last group to confirm they kept it), then `cryptsetup open` with the
   persistent flags of §5.1.
7. **Restore:** `mkfs.ext4 -L omamobile-root -m 1` on `/dev/mapper/root`,
   mounted; the archive streams back into the same GNU tar (busybox tar
   keeps no xattrs); then the new root is read back the same way, and its
   digest must be the backup's.
8. **Header backup:** `cryptsetup luksHeaderBackup` to `BACKUP_DIR`. Note:
   it holds the keyslots as they are now, so it opens with the PIN of
   today even after the PIN changes.
9. **Continue the boot:** unmount, close, and hand over to the init's
   normal path, which now finds LUKS and shows the pad. The owner types the
   PIN on the phone: the first real unlock.
10. **Afterwards:** the backup holds the whole unencrypted system (password
    hashes, Wi-Fi keys, SSH keys, messages). The tool says so and asks the
    owner to delete it once the phone has run well for a few days, or to
    keep it only on an encrypted laptop disk.

**`tools/phone-encrypt --fresh USERDATA.img`: a new install.** It takes the
root image already prepared for this phone (`tools/install-phone`'s copy or
`device/hotdog/prepare-userdata`'s `OUT.img`, raw or `.zst`), so
`firstboot.conf` and root's `authorized_keys` are in it already. The PIN is
checked against the image's `PASSWORD_HASH` (D2), then steps 1, 4, 6 and 9
as above, and instead of the restore: the image streams, gzip-compressed for
the link (busybox has `gunzip`), into `/dev/mapper/root` with plain `dd` (no
`conv=sparse`: a skipped block reads back as noise, not zeros, under
dm-crypt), with its SHA-256 checked on both ends. The first boot grows the
file system to the whole volume (`grow_root`) and `omamobile-firstboot`
runs as today. (E6 folds this into `install-phone --encrypt`.)

**What never changes:** the tool writes `userdata` only, and only from the
initramfs, through the existing storage guard. It flashes nothing and writes
no other partition.

### 5.5 Living with it

- **`omamobile-pin`** (on the phone, `sudo`, package `omamobile-crypt`):
  asks for the old PIN and the new one twice, then changes, in this order,
  the disk keyslot (`cryptsetup luksChangeKey` on keyslot 0, which keeps the
  old keyslot until the new one is written), checks that the new one opens
  it, and only then the user's password (`chpasswd`). If the disk step
  fails, the password isn't changed. Plain `passwd` still works, but leaves
  the disk PIN as it was; the tool's help and the package's README say so
  (D2).
- **`omamobile-pin --recovery-key`** makes a new recovery key (keyslot 1),
  shown once.
- **The lock after boot:** `omamobile-lock-on-start` (omamobile-shell
  0.2.137, which `hypr/phone.lua` now runs at login) skips the lock for the
  first login of a boot whose disk was unlocked at the PIN pad (§5.2 step
  7), so the owner types the PIN once per power-on. A second login in the
  same boot locks; the lock still comes on with the screen off and on idle,
  as now.
- **Development:** `bin/omamobile push` ends in a reboot that now waits for
  the PIN. `tools/phone-unlock` waits for the initramfs's SSH and asks for
  the PIN on the laptop's terminal (or runs `OMAMOBILE_DISK_PIN_CMD`, such
  as a password-manager command, if the developer sets it). The PIN is never
  stored by our tools, and agents never ask for, read or type it (§6 E8
  adds this to AGENTS.md).
- **Back to plain ext4:** a `--fresh` install without encryption
  (`tools/install-phone` as today), or `tools/phone-encrypt --decrypt
  BACKUP_DIR`, the reverse of `--keep`.
- **Selling or giving the phone away:** `cryptsetup erase` destroys every
  keyslot at once; the data is gone without a full wipe. `--keep`'s
  backup and header backup must be deleted too.

### 5.6 Kernel

In `kernel/configs/omamobile.config`, so every phone gets them (done; they
resolve with hotdog's fragment on top, checked with `olddefconfig`):

```
# Disk encryption (docs/SECURITY-PLAN.md): the root is opened in the initramfs,
# which carries no modules on most phones, so all of it is built in
CONFIG_BLK_DEV_DM=y
CONFIG_DM_CRYPT=y
CONFIG_CRYPTO_XTS=y
CONFIG_CRYPTO_USER_API_HASH=y
CONFIG_CRYPTO_USER_API_SKCIPHER=y
```

`CONFIG_CRYPTO_AES_ARM64_CE_BLK=y` is already set. `BLK_DEV_DM` goes from
module to built in, which changes nothing for users of device-mapper on the
root (none today). Nothing else needs to change for a phone that doesn't
encrypt.

### 5.7 Initramfs

Done in `bin/omamobile initramfs`, for every device:

- Alpine's `cryptsetup` and GNU `tar` from the signed index (§4.7; the build
  stops if either is missing);
- `omamobile-pinpad` and `omamobile-tarnorm`, static against Alpine's musl
  like `reboot-to` (the musl sysroot gains Alpine's `linux-headers` for
  fbdev and evdev);
- `omamobile-unlock`, `/etc/omamobile-crypt` (the marker `phone-encrypt`
  checks) and the pad's glyphs in `/usr/share/omamobile-pinpad/`.

The glyphs come from the build machine's font, as the splash comes from its
theme, so two machines give the same initramfs only with the same
`PINPAD_FONT` file. No size check was added: the room is there (§4.7), and
mkbootimg and avbtool already stop on an image that doesn't fit.

### 5.8 Per device

| | cheetah (Pixel 7 Pro) | hotdog (OnePlus 7T Pro) |
| --- | --- | --- |
| Where the initramfs lives | `vendor_kernel_boot_b`, 64 MiB (§4.7) | inside `boot_a`'s boot image |
| How a new initramfs gets on | `bin/omamobile push` | RAM boot first (`fastboot boot`, which spends no tries), then a human `fastboot flash boot_a`, which clears slot A's successful mark; re-marking is a GPT write (`device/hotdog/slot-a-mark`) that needs the owner's yes |
| Touch in the initramfs | built in **[V]** | `s6sy761` is a module, now in `INITRAMFS_MODULES` (its I2C, pins and rail are built in **[V]**, and it loads no firmware **[V]**); so every hotdog initramfs needs `omamobile modules` from the same build first. It also drives the proximity input in calls, now from the initramfs on |
| Display | simplefb fb0 with `SIMPLEFB_TRIG_CON` **[V]** | fb0 under `DRM_MSM`, geometry **[I]** (R2) |
| USB safety net | on: the pad must stop it | off (`USB_HOST_PANIC=0`) |
| Charging boot | `androidboot.mode=charger` **[V]**; charging without the driver **[I]** | **[I]** (R4) |
| Root install today | `tools/install-phone` | `device/hotdog/prepare-userdata`, flashed by hand |

The new init boots an unencrypted phone exactly as today, so on each device
the order is: the new initramfs first, booted and checked on the plain root;
then the encryption.

## 6. Phases

Offline work first, then the gated runbook (§8). Effort is a guess for one
developer.

| Phase | What | Risk | Effort |
| --- | --- | --- | --- |
| **E0** | This plan; the decisions (§7) | none | done when decided |
| **E1** (built, §6.1) | Kernel options (§5.6); cryptsetup, `tar`, the pad's glyphs in `bin/omamobile initramfs`; the init's unlock path, charging-boot wait and safety-net stop; `omamobile-unlock`; hotdog's `INITRAMFS_MODULES` | none offline | 1 week |
| **E2** (built, §6.1) | `omamobile-pinpad` and `tests/pinpad.py` (§5.3) | none offline | 1 week |
| **E3** | On a phone, nothing encrypted: R1-R4, then T1-T3 (the pad against a LUKS file in RAM, `userdata` untouched) | low to medium (new boot image) | 2 days attended |
| **E4** (built, §6.1) | `tools/phone-encrypt` (`--keep`, `--fresh`, `--decrypt`), `tools/phone-unlock`, `omamobile-encrypt-hold`, `omamobile-pin`, the lock-on-start skip; tests against a fake SSH phone with disk images in files | none offline | 1 week |
| **E5** | Encrypt the first phone (M1-M4) | **high**: `userdata` is overwritten; the backup is the way back | 1 day attended |
| **E6** | `tools/install-phone --encrypt` and `prepare-userdata`'s equivalent: a new install goes straight to `--fresh` | medium | 3-5 days |
| **E7** | A letter layout on the pad for passphrases | low | 3-5 days |
| **E8** | Documentation: INSTALL, CONTRIBUTING, AGENTS (§1: never ask for, store or type the disk PIN; reboots of an encrypted phone wait for the human), the *Style > Unlock* menu back if it fits | none | 1 day |
| **E9** (later) | Research: a hardware-backed disk key (TEE throttling), dm-integrity, inline encryption, unlocking alarms and calls before the PIN | none until a plan | - |

E1-E5 give an encrypted phone; E6-E8 make it the install's choice.

### 6.1 Built on 2026-11-19 (E1, E2, E4)

Nothing below has run on a phone; nothing was committed.

| Piece | Where | Tests |
| --- | --- | --- |
| Kernel options | `kernel/configs/omamobile.config` | `olddefconfig` with hotdog's fragment |
| The init's unlock, charging wait, safety-net stop, hold, continue, features file | `initramfs/init` | `tests/crypt-unlock.py` (15), and the existing init tests |
| The SSH unlock and T2's self-test | `initramfs/omamobile-unlock` | through `tests/phone-encrypt` |
| The PIN pad | `initramfs/pinpad/pinpad.c`, `mkfont` | `tests/pinpad.py` (31); the aarch64 build opened a real LUKS2 file under qemu |
| The tar digest | `initramfs/tarnorm/tarnorm.c` | against the Python twin and the aarch64 tar under qemu |
| The initramfs | `bin/omamobile initramfs` | a scratch hotdog build (7.5 MB); the existing initramfs tests |
| Hotdog's touch in the initramfs | `device/hotdog/device.conf` | - |
| Encrypt, decrypt, back up, restore | `tools/phone-encrypt` | `tests/phone-encrypt` (22, a stand-in phone with the real tar) |
| The laptop unlock | `tools/phone-unlock` | `tests/phone-encrypt` |
| `omamobile-pin`, `omamobile-encrypt-hold` | `packages/omamobile-crypt` 0.1.0 (built by `tools/build-packages`, not in the root image yet: E6) | its `test/all` (8, a real LUKS2 file) |
| The lock skip | `omamobile-shell` 0.2.137 | `test/lock-on-start.sh` |

Decisions taken as recommended, so the code had something to follow: D1
(digits, at least 6, a warning under 8), D2, D3, D4 (no wipe), D5, D6, D7
(digits first), D8 (the dark wait) and D10 (always a recovery key). Each is
one place in the code if the maintainer decides otherwise.

## 7. Decisions

Each with a recommendation. The owner of the test phone decides D9; the
maintainer decides the rest before code lands upstream.

- **D1. PIN rules.** Digits, at least 6, with §4.3's warning under 8
  (recommended); or at least 8; or a passphrase by default.
- **D2. One PIN for the disk, the lock screen and sudo.** Yes, with
  `omamobile-pin` to change them together (recommended); or a separate disk
  PIN.
- **D3. No lock right after boot.** Skip lock-on-start when the disk was
  unlocked at this boot (recommended: one PIN per power-on); or keep it (two
  PINs per power-on).
- **D4. Wipe after N wrong PINs.** No (recommended: a wipe can't be undone,
  and it doesn't stop an offline attack anyway).
- **D5. Argon2id cost.** 1 GiB, 4 threads, 2 s measured in the initramfs
  (recommended); more memory slows offline guessing more than more time
  does, at the cost of a slower unlock. **Changed 2026-11-19 (T2):** a
  fixed cost, 1 GiB, 4 threads, 4 iterations (`--pbkdf-force-iterations
  4`), about 2 s on hotdog, not `--iter-time 2000`: cryptsetup measures the
  phone at format time and cuts the memory when it runs slow then, and a
  console stalled by the RAM boot's display errors gave 64 MiB. Both
  keyslots are checked with `luksDump` after formatting (`luks_strong` in
  `tools/phone-encrypt`); `omamobile-pin` uses the same cost.
- **D6. Discards.** On (recommended), or off.
- **D7. Passphrases on the pad.** Digits only first, letters in E7
  (recommended); or both from the start.
- **D8. Charging boots.** A dark wait in the initramfs as
  `omamobile-charger-mode` does (recommended, if R4 shows the phone charges);
  or the PIN pad, which then boots the whole phone on a charger.
- **D9. First phone.** Hotdog, the owner's phone, through a RAM boot first,
  with `--keep` and a verified backup; or cheetah first, as the reference
  phone. **Decided 2026-11-19:** hotdog first. It is a test phone and its
  root holds nothing to keep, so it gets `--fresh` with a new root image and
  no backup; R1 is moot for it.
- **D10. Recovery key.** Always made (recommended); or offered.

## 8. Runbook

Read-only steps first. Each step: commands, **Expect**, **Pass**, **Stop**,
**Rollback**, risk. **Every boot, flash and write here is the human's call,
asked for each time** (AGENTS §1). Steps that light or blank the screen are
announced first. On cheetah, stop the modem before any `push` or
`reboot-to` (AGENTS §2).

### R: read-only

- **R1. How much to back up** (running phone, none). `tools/phone-ssh 'df
  -B1 --output=used,size / ; findmnt -no SOURCE,FSTYPE /'`, and `df -h` of
  the laptop's backup directory. **Expect:** the root on `userdata`, ext4.
  **Pass:** the laptop has the used space plus 10 % free. **Stop:** not
  enough room. **Rollback:** none needed.
  **Result, hotdog, 2026-11-19** (`7.3.0-rc6-omamobile-push1`): the root is
  `userdata` (`sda22`, 216 GiB), ext4, 30.8 GiB used; the laptop's `/home`
  has 155 GiB free. **Pass**, even before zstd.
- **R2. What the initramfs sees** (one hold boot with the current image, low:
  nothing written). Over SSH in the initramfs: `cat /proc/bus/input/devices;
  cat /sys/class/graphics/fb0/{virtual_size,bits_per_pixel,stride}`; then
  a few touches with `hexdump -C /dev/input/eventN | head`. **Expect:**
  cheetah: the touchscreen and `gpio-keys`; hotdog: the keys only (touch is
  a module), and fb0's geometry. **Pass:** recorded here. **Stop:** no fb0:
  the pad needs a display path first. **Rollback:** a normal reboot.
  **Partial result, hotdog, 2026-11-19**, read from the running root, with
  no boot (the running initramfs predates the hold, so a hold boot needs
  T1's image first): fb0 is `msmdrmfb`, 1440x3120, 32 bpp, stride 5760, the
  layout the pad draws; the power key (`pm8941-pwrkey`), the volume keys
  (`gpio-keys`) and `DRM_MSM` are built in, the touchscreen (`s6sy761`) is
  a module, as `INITRAMFS_MODULES` assumes; `pm8150b-charger` is the power
  supply the charging wait reads. `dm_crypt` is not in this kernel yet
  (E1's config). Still open: whether fb0 exists that early in the
  initramfs, before the root's userspace, and the touch events there.
- **R3. Crypto speed** (after E1's image is built, a RAM boot or `push`,
  low). `cryptsetup benchmark` in the initramfs. **Expect:** aes-xts several
  hundred MB/s or more; an Argon2id figure for 1 GiB. **Pass:** recorded.
  **Stop:** Argon2id at 1 GiB takes far over 2 s or fails for memory (D5).
  **Rollback:** the previous image. (The size is no longer a question:
  §4.7.)
- **R4. Charging boot** (phone off, then a charger, low). Watch what starts;
  on cheetah, in the root's `omamobile-charger-mode` journal, read
  `/sys/class/power_supply/*/status` with and without the charger driver
  loaded. **Expect:** cheetah starts with `androidboot.mode=charger`.
  **Pass:** whether the battery charges with no charger driver is recorded
  (D8). **Stop:** none. **Rollback:** none.

### T: the new initramfs, nothing encrypted (E3)

- **T1. Plain boot with the new initramfs** (medium: a new boot image).
  Build: hotdog runs `omamobile modules` before `omamobile initramfs` now
  (`INITRAMFS_MODULES`). cheetah: `bin/omamobile push`; hotdog: `fastboot
  boot` of the new image. Also check that `/run/omamobile/initramfs-features`
  reads `crypt hold`, and on hotdog that touch works in the session as
  before (the driver now loads in the initramfs).
  **Expect:** the phone boots its plain root as before. **Pass:**
  `tools/phone-smoke` as before; `ls /run/omamobile/disk-unlocked` absent.
  **Stop:** any difference in boot. **Rollback:** the previous image (cheetah
  `push`; hotdog a power cycle, since a RAM boot left `boot_a` as it was).
  **Built for hotdog, 2026-11-19, not booted yet:** `boot_a`'s tree
  (`omamobile-hotdog-sensors`, `g7539ca3e06f6`) and its config with only
  the options of §4.7 added, as release `7.3.0-rc6-omamobile-crypt1-
  g7539ca3e06f6`, so the flashed kernel's modules stay as they are; the
  overlays and quiet command line of the flashed image (the overlaid DTB is
  byte-identical to it); initramfs 7.5 MiB with the pad, `cryptsetup`,
  GNU tar and `s6sy761.ko`. Steps, each the owner's yes: the modules
  (`bin/omamobile modules-push`, a new folder in `/usr/lib/modules`), a
  reboot to fastboot, `fastboot boot` of the image.
  **Run, hotdog, 2026-11-19** (modules pushed first): the full image did
  not come up; the phone was back on `boot_a` about 15 s after `fastboot
  boot`, with no pstore record (the screen was not watched). Two cross-check
  RAM boots, repacked from the two images (repacking `boot_a`'s image gives
  it back byte for byte): the new kernel with the old initramfs came up
  (`crypt1`, initramfs SSH at 33 s); the old kernel with the new initramfs
  came up (SSH at 12 s, `initramfs-features` = `crypt hold`, cryptsetup
  2.8.6 runs). Both wedged after the handover to the root (SSH refused, slow
  ping, no journal on disk), as earlier hotdog RAM boots from the fastboot
  screen did; each needed a cold start. Not settled: whether the full image
  is refused (it is the largest, 53.0 MB against 52.8 MB that came up) or
  the first try failed by chance.
  R2, from these boots: from flash, fb0 is simpledrm's (the bootloader's
  framebuffer) and then `msm`'s, both inside the initramfs; in the RAM boot
  there was no fb0 about 9 s in. So the pad has a display on a boot from
  flash; in a RAM boot from the fastboot screen it may have none (rc 5,
  unlock over SSH).
  **T1 passes, 2026-11-19, second try of the full image:** a control RAM
  boot of `boot_a`'s own image wedged after the handover the same way
  (the owner saw `[dpu error]enc34 frame done timeout` repeating), so the
  wedges are the hotdog's RAM-boot display problem, not this work. The
  full image then came up: `crypt1`, `crypt hold`, the root by 13 s,
  `/dev/mapper/control` and `xts(aes)` present, no `disk-unlocked`, the
  touchscreen loaded in the initramfs (its range 0-1439 by 0-3119) and
  working in the session (owner), `tools/phone-smoke` with every required
  check as before (its slot-B line has always failed on hotdog, and its 12
  wcd934x "has no paths" lines are in the boots from flash too). The first
  try's fall back to `boot_a` was chance.
- **T2. The pad against a scratch volume** (low: `userdata` not opened).
  Held in the initramfs (`omamobile.initramfs`), over SSH: `omamobile-unlock
  --selftest`, which makes a 64 MiB LUKS2 file in `/run` with the test PIN
  `135790` and runs the pad against it. **Expect:** the pad on screen; a
  wrong PIN shows "Wrong PIN"; the sixth wrong PIN waits; `135790` opens it
  in about 2 s; the volume keys and Power work alone; after 60 s the screen
  blanks and a touch wakes it; on cheetah, no USB cable: the safety net
  doesn't fire. Then leave it 10 minutes. **Pass:** all of it, and the
  phone powers off at 10 minutes with no reset before that. **Stop:** a
  reset, a crash, or touch in the wrong place. **Rollback:** a reboot.
  **Run, hotdog, 2026-11-19** (RAM boot with `omamobile.initramfs`). First
  image: the pad drew and took touch, but the kernel's `[dpu error]enc35
  frame done timeout` lines were printed over it, and those console writes
  stalled the phone: the self-test volume's Argon2id came out at 64 MiB
  (cryptsetup's 2 s target), and `cryptsetup benchmark` gave 940 MiB once
  `/proc/sys/kernel/printk` was 1. A wrong PIN was refused and `135790`
  accepted. Two fixes: the pad sets the console to `KD_GRAPHICS` while it
  is up (`PINPAD_TTY`, test in `tests/pinpad.py`), and the key cost is fixed
  (D5). Second image (`boot-t2-hold-2.img`): no display errors that boot,
  the pad clean, the volume at 1 GiB / 4 iterations, a wrong PIN refused
  and `135790` accepted in about 2 s (owner). R3 from the same boots:
  aes-xts 512-bit 1357 MiB/s encrypt, 1419 MiB/s decrypt. **T2 passes**
  for the PIN path; the back-off, blanking and the 10-minute power-off
  were not run on the phone (`tests/pinpad.py` covers them).
- **T3. The backup's digest is stable** (read-only, low). Held for
  encryption, `tools/phone-encrypt --keep BACKUP_DIR --backup-only`.
  **Expect:** two passes, one digest. **Pass:** the laptop's checks of
  §5.4 step 3 pass. **Stop:** the digests differ: the backup can't be
  trusted; stop E5. **Rollback:** delete the backup.

### M: encrypting the first phone (E5)

Before M2, on hotdog: the new image flashed to `boot_a` after T1 passed from
a RAM boot, and slot A re-marked, each with the owner's yes, so the phone
boots the new init on its own.

- **M1. Fresh backup** (read-only, low). As T3, on the day. **Pass:** as T3.
  **Stop:** as T3.
- **M2. Encrypt** (**high**: `userdata` is overwritten). Battery above 50 %
  or on a charger. `tools/phone-encrypt --keep BACKUP_DIR`; the owner types
  the codename, `erase`, the PIN twice and the recovery key's last group.
  **Expect:** format, restore, count and byte check, header backup, then the
  pad on the phone. **Pass:** the owner's PIN unlocks; Omarchy comes up
  without a second PIN; `lsblk -f` shows `crypto_LUKS` on `userdata` and
  ext4 on `/dev/mapper/root`; `cryptsetup luksDump /dev/<userdata>` shows two
  keyslots, Argon2id, and the persistent flags. **Stop:** any step reports
  an error: leave the phone in the initramfs, change nothing more.
  **Rollback:** `tools/phone-encrypt --restore-plain BACKUP_DIR` (mkfs.ext4
  on `userdata` and the archive back), then a normal boot.
  **Run, hotdog, 2026-11-19** (owner: a test phone, "do whatever"). M1 and
  T3 ran inside M2's `--keep` (the tool's own two reads). Before: `boot_a`
  flashed with the T2-fixed image (`473f9f45…`; the previous `boot_a` read
  back equal to `boot-prox-g7539ca3e06f6-2026-11-18.img`, the rollback),
  which cleared slot A's successful mark (tries 7); `omamobile-crypt` 0.1.0
  installed. Found on the way:
  - The phone's clock was the RTC's 1970: pacman refused every signature,
    and in the held initramfs tar warned about every file's time stamp.
    Set from the laptop; `phone-encrypt` now does that itself and passes
    `--warning=no-timestamp` to the restore.
  - With the cable in, hotdog switches itself on after a power-off
    (`androidboot.startupmode=dc_charger`, `androidboot.mode=normal`); the
    first hold was spent on that boot. So `charger_boot` (which looks for
    `androidboot.mode=charger`) never fires on hotdog: D8 is open for it.
  - Every warm restart today (from fastboot, or after a RAM boot) wedged the
    display; a power-off and a start by the charger or by Power never did.
  Copy 13.7 GB compressed in about 18 min, then erase, format, restore
  (about 8 MB/s) and the read-back check passed; the PIN pad unlocked;
  Omarchy came up. **One failure: the cameras.** Both CCIs failed at
  6871 s with "deferred probe timeout, ignoring dependency" and -110: the
  boot had waited in the initramfs for hours (hold, restore, PIN), so the
  default 10 s deferred-probe timeout fired long before the root's modules
  provided the CCIs' suppliers, and a failed probe is not retried. No boot
  from a plain root had any device pending at the timeout. A reprobe
  (`echo ac4a000.cci > /sys/bus/platform/drivers_probe`, likewise
  `ac4b000.cci`) brought all four cameras back. Fix: `deferred_probe_timeout=-1`
  on hotdog's command line (device.conf), since any boot that waits at the
  pad longer than the timeout would lose them. Image built
  (`36d64c6b…`), not flashed yet. Cheetah: check its boots for devices
  pending at the timeout before adding the same.
- **M3. A day of use** (low). Calls, texts, Wi-Fi, the modem, cameras,
  sensors, suspend, a `push`/`tools/phone-unlock` round trip (cheetah) or a
  RAM boot (hotdog). **Pass:** `tools/phone-smoke` as before encryption.
  **Stop:** a subsystem that worked before fails. **Rollback:** as M2.
- **M4. The edges** (low). Five reboots unlocked at the pad; one with the
  recovery key; one over SSH with `tools/phone-unlock`; a charging boot as
  D8 decided; `omamobile-pin` to a new PIN and back. **Pass:** all.
  **Stop:** any PIN or key that should work doesn't: unlock with the other
  one and stop. **Rollback:** as M2.

## 9. Risks

- **Losing the data during `--keep`.** The format erases the only copy on
  the phone. Mitigations: a verified backup before the format (T3, M1), the
  owner's typed confirmation, the restore checked against the backup, and
  `--restore-plain` as a tested way back (tests in E4 on disk images).
- **A phone that can't be unlocked:** a pad bug, no touch, a wrong display
  path. Mitigations: the volume keys and Power; the SSH unlock in
  development builds; T2 before any real volume exists; the recovery key.
- **The backup's digest check depends on `omamobile-tarnorm`** matching what
  GNU tar writes. Mitigations: it changes only the name and prefix fields of
  headers and their checksum, the laptop's twin is tested against it, and T3
  runs it on the phone before anything is erased.
- **The USB safety net or a watchdog resetting the phone at the pad.**
  Mitigations: the pad stops the net; T2 waits 10 minutes without a cable.
- **A charging boot that can't charge** without the root. Mitigation: R4
  before D8; the pad as the fallback.
- **The disk PIN and the lock PIN drifting apart** after a plain `passwd`.
  Mitigation: `omamobile-pin`, and the notes that say so.
- **A weak PIN.** Mitigation: §4.3's numbers shown at install, the push
  toward 8 digits, and E7's passphrases.
- **The unencrypted backup on the laptop.** Mitigation: the tool says what
  it holds and asks for it to be deleted.
- **Alarms and calls wait for the PIN** after an unattended restart (§2).
  No mitigation in this plan; E9.

## 10. Sources

- cryptsetup, *cryptsetup-luksFormat(8)* and *cryptsetup-open(8)* (header
  size, PBKDF options, key-file handling, persistent flags).
  <https://man7.org/linux/man-pages/man8/cryptsetup-luksFormat.8.html>,
  <https://man7.org/linux/man-pages/man8/cryptsetup-open.8.html>
- cryptsetup, the project's repository (the release in Alpine 3.24's
  `cryptsetup` 2.8.6 package, which the initramfs carries).
  <https://gitlab.com/cryptsetup/cryptsetup>
- Linux, `Documentation/admin-guide/device-mapper/dm-crypt.rst` (open
  flags, `no_read_workqueue`, `allow_discards`).
- GNU tar, *GNU tar manual*, "Storing sparse files" and "Controlling
  extended header keywords" (`--pax-option`, the `GNUSparseFile` name).
  <https://www.gnu.org/software/tar/manual/>
- Our own: `initramfs/init` (`boot_arch`, `grow_root`, the USB safety net),
  `bin/omamobile` (`initramfs`, `images`, `INITRAMFS_MODULES`, the splash),
  `tools/install-phone` (the PIN question), `rootfs/build-inside`,
  `device/hotdog/prepare-userdata`, `device/{cheetah,hotdog}/device.conf`,
  `packages/omamobile-device-cheetah/bin/omamobile-charger-mode`,
  `kernel/configs/omamobile.config`, and the kernel configuration of
  `out-hotdog-sensors` (2026-11-18).
