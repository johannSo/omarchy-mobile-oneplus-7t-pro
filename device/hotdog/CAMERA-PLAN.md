<!-- SPDX-License-Identifier: MIT -->
# Camera plan (hotdog / SM8150): four cameras, the pop-up and the torch

**Status (2026-11-05): theoretical. Written and build-checked on the laptop;
nothing has run on the phone, and nothing may until the owner approves each
step below.** Kernel branch `omamobile-hotdog-camera` (worktree
`~/omamobile-kernel/wt-hotdog-camera`, output
`~/omamobile-kernel/out-hotdog-camera`) on top of `omamobile-hotdog-fingerprint`
@ `41a6c1235` (the kernel `boot_a` came from). The main camera's C-PHY
support is on `omamobile-hotdog-cphy` (worktree `wt-hotdog-cphy`) on top of
it. Overlays [`torch`](overlays/torch.dtso), [`camera`](overlays/camera.dtso),
[`camera-main`](overlays/camera-main.dtso), [`popup`](overlays/popup.dtso).
Pop-up tool in `packages/omamobile-device-hotdog` 0.1.5; sensor helpers in
`packages/libcamera` 0.7.2-4.23; tables tool
[`tools/hotdog-camera-tables`](../../tools/hotdog-camera-tables).

**Goal.** The rear flash works as the shell's torch; the three rear cameras
and the front camera stream through libcamera (simple pipeline, software
ISP) into omacam; the front camera rises when it is opened and lowers when it
is closed.

```
sensor --CCI (I2C)-- control      CCI0/CCI1, 4 masters             i2c-qcom-cci
   \-- CSI-2 --> CSIPHY0-3 --> CSID --> VFE (RDI) --> /dev/videoN   qcom-camss (SM8150 series)
                                                                    + C-PHY on CSIPHY1 (main)
   /dev/videoN --> libcamera simple pipeline + software ISP --> omacam / PipeWire
torch:   PM8150L flash module, channels 1+2 --> white:torch          leds-qcom-flash
pop-up:  PM8150L LPG (STEP) + PMIC GPIOs --> DRV8834 --> stepper    omamobile-hotdog-popup
         M1120 hall sensors (0x0c top, 0x0d bottom) on QUP SE1     (userspace, i2c-dev)
```

---

## 0. Facts, from our own captures

From the owner's OxygenOS 10.0.14 image (decrypted under
`~/android/reference/hotdog/ops/extract`, vendor in `vendor-fp/`), never
committed: the boot image's base DTB (`SM8150 v2`), `dtbo.img` entry 18
("MTP 19801 MP 14 15", board-id <8 0>; OnePlus's camera fragment on
`cam_cci0` overrides Qualcomm's template, and the four `cam-sensor` nodes it
rewrites are this phone's), and the camera module files
`vendor/lib64/camera/com.qti.sensormodule.*.bin`, decoded by
[`tools/camx-sensormodule-decode`](../../tools/camx-sensormodule-decode)
(the file layout is in its header comment).

| | Main | Telephoto | Front (pop-up) | Ultrawide |
| --- | --- | --- | --- | --- |
| Sensor | Sony IMX586, ID 0x0586 @0x0016 | Samsung S5K3M5, ID 0x30d5 @0x0000 | Sony IMX471, ID 0x0471 @0x0016 | Sony IMX481, ID 0x0481 @0x0016 |
| Vendor slot | 0 (REAR) | 1 | 2 (FRONT) | 3 (REAR_AUX) |
| CCI / master / address | CCI0 / 1 / 0x1a | CCI0 / 0 / 0x10 | CCI1 / 0 / 0x10 | CCI1 / 1 / 0x1a |
| PHY | CSIPHY1, **C-PHY, 3 trios** (0x210) | CSIPHY0, D-PHY 4 lanes | CSIPHY2, D-PHY 4 lanes | CSIPHY3, D-PHY 4 lanes |
| MCLK | MCLK1, gpio14, 19.2 MHz | MCLK0, gpio13, 19.2 MHz | MCLK2, gpio15, 19.2 MHz | MCLK3, gpio16, 19.2 MHz |
| XCLR | gpio30 | gpio28 | gpio12 | gpio23 |
| Analogue | switch on gpio11, then switch on gpio29 | switch on gpio148 | switch on PM8150L gpio12 | switch on PM8150L gpio2 |
| Digital | PM8009 L1 1.104 V, then switch on PM8150L gpio1 | PM8009 L2 1.056 V | PM8009 L3 1.056 V | PM8009 L4 1.056 V |
| Interface | PM8150L L1 1.8 V | same | same | same |
| Power-up (vendor) | VANA, VANA2, VDIG, VDIG2, VIO, MCLK, RESET | VANA, VDIG, VIO, MCLK, RESET | same | same |
| Bayer, black level | RGGB, 64 | GRBG, 64 | BGGR, 64 | RGGB, 64 |
| Lens extras (not used) | AF + OIS | AF (VAF gpio35) + OIS | fixed focus | AF (AK7374, VAF PM8150L gpio4) |
| Mounting (roll / yaw) | 90 / 180 | 90 / 180 | 90 / 0 | 270 / 0 |

- The load switches are fed from BoB (the vendor tree's `cam_vana` is BoB at
  3.3 V plus a `gpio-vana`); their output voltage isn't written anywhere we
  can read.
- Every module variant (semco, ofilm, `_2nd_lens`, `_no_otp`) decodes to the
  same register tables for its sensor.
- **Modes we use** (register counts are the tables' sizes):
  - **IMX586:** init 1710 writes. 4000x3000@30.10, line length 7872, frame
    length 3695, 577.65 Mpix/s out, which is a C-PHY link frequency of
    421 203 125 Hz. 2000x1500@120.10, link 340 003 125. 8000x6000@28.3,
    link 1 166 396 875, not in the device tree.
  - **IMX481:** init 205. 4656x3496@30.14, line length 5120, frame length
    3566, link 659 200 000.
  - **IMX471** and **S5K3M5:** the mainline drivers' own tables,
    1928x1088 at 200 MHz (19.2 MHz MCLK) and 4208x3120 or 2104x1184 at
    602.5 MHz (24 MHz MCLK).
- **CCI and CAMSS addresses, interrupts and pins:** the base DTB's
  `cam_cci0` @0xac4a000 (SPI 460, gpio17-20) and `cam_cci1` @0xac4b000
  (SPI 271, gpio31-34). CSIPHYs are `qcom,csiphy-v1.1` @0xac65000-0xac68000
  with a 1.2 V supply (PM8150L L3), and the camera clock controller is
  `camcc-sm8150-v2`. The running kernel already builds `SM_CAMCC_8150` as
  a module.
- **Flash:** PM8150L flash module @0xd300; `flash_0` and `flash_1` (1500 mA
  maximum, 1000 mA default, 1280 ms), `torch_0` and `torch_1` (500 mA
  maximum, **300 mA default**). Stock drives both through `switch_2`
  (mask 0x3), and channel 2 is disabled.
- **Pop-up:** a DRV8834 stepper driver at 1/32 microsteps with two MagnaChip
  M1120 hall sensors.
  - Pins:
    - STEP is PM8150L GPIO10 in `func1`, the LPG channel at 0xbd00
      (`pwm 4`).
    - DIR is PM8150L GPIO11: 0 = up, 1 = down.
    - M1 is PM8150L GPIO8 = 1.
    - M0 is PM8150B GPIO5, high-impedance.
    - nSLEEP is PM8150 GPIO10.
    - Boost enable is PM8150B GPIO12, set once and left on.
  - Hall sensors: on QUP SE1 at 0x0c (top) and 0x0d (bottom), vdd L7C,
    vio L8C, ID 0x9c @0x09; register 0x06 = 0x37 disables their I2C.
  - The stock move (OnePlus's GPL driver, `drivers/misc/oplus_motor/`,
    `oneplus_motor.c` and `oneplus_drv8834.c`):
    - about 100 ms of slow steps (stock asks for a 104 167 ns period), then
      fast steps (asks for 12 000 ns);
    - stopped by a timer after about 618 ms up, 626 ms down;
    - the hall sensors are read afterwards, to decide whether the move
      worked;
    - a sensor reading above 150 (absolute) means "there".
  - Stock's PWM driver rounds each period to the nearest value the LPG can
    make (about 13.3 µs). Mainline's `leds-qcom-lpg` rounds down instead,
    so we ask for the exactly reachable 13 125 ns and 105 000 ns.

## 1. What is reused, what is new

| Piece | State |
| --- | --- |
| `camcc-sm8150`, `i2c-qcom-cci`, `leds-qcom-flash`, `leds-qcom-lpg`, `s5k3m5` | mainline |
| SM8150 CAMSS: CCI binding, CAMSS binding, driver, dtsi nodes (Andrew Gigena, v1, 2026-11-04, [lore](https://lore.kernel.org/all/20261104-sm8150-v7-4-rc1-camss-v1-0-7a9534a9a22f@andrewgigena.dev/)) | posted upstream, not merged; applied as is (`e2c10d7fc`..`03e8c6abf`), tested by its author on a Pixel 4 |
| `media: qcom: camss: Skip the endpoints of disabled sensors` | **new**: a sensor whose node is disabled kept the notifier from completing, so no camera came up; lets the plan enable one sensor at a time |
| `media: i2c: imx471: Bind through devicetree` + binding | **new**: an OF match and the `vdig`/`vif` supplies (mainline binds it through ACPI only) |
| `media: i2c: Add a Sony IMX481/IMX586 driver with firmware tables` (`sony-fwtable`) + binding | **new**: shares no vendor data; loads the owner's tables (§5.2) and refuses tables that write mode select or the OTP registers |
| C-PHY in CAMSS (`omamobile-hotdog-cphy`, 12 commits on top) | David Heidelberg's series "media: camss: Add support for C-PHY configuration on Qualcomm platforms" v9 (2026-06-17, [lore](https://lore.kernel.org/r/20260617-qcom-cphy-v9-0-83da8a8e4e44@ixit.cz), not merged), plus three of ours: the SM8150 C-PHY init sequence (`csiphy_3ph_v1_1_reg[]` and CTRL7 = 0x72 from Google's GPL Pixel 4 kernel, `cam_csiphy_1_1_hwreg.h`, all 129 entries checked), a fix to v9's C-PHY link-frequency fallback (about 5.2x too high; for upstream), and a settle-count comment. For the main camera only |
| DT: flash LED, cameras, pop-up pins | **new**, all disabled; the overlays enable them |
| `tools/camx-sensormodule-decode`, `tools/hotdog-camera-tables` | **new**: read the owner's image on the laptop |
| `omamobile-hotdog-popup` + `omamobile-hotdog-popup.service` | **new**, device-hotdog 0.1.5; the service isn't enabled by the package |
| libcamera `0057`: IMX586, IMX481, IMX471, S5K3M5 helpers and tuning stubs | **new**, 0.7.2-4.23; the simple pipeline already knows `qcom-camss` |

**Why tables from firmware.** No register settings for the IMX586 or IMX481
are published under a licence a kernel driver can carry. The ones that exist
in other GPL kernels came from SoC vendors' trees, which are not sources this
project cites. The owner's own image has them; the cheetah ultrawide
(`tools/extract-camera-data`) set the pattern.

## 2. Unknowns (each is checked read-only, or in its own step)

- **U1, CAMSS streaming on SM8150.** The upstream series streamed on a
  Pixel 4. The earlier Pixel 4 port needed three more changes before its
  VFE wrote anything: CAMNOC QoS writes, a 31-bit DMA mask and a 150 MHz
  `camnoc_axi` floor. Symptom: CSID counts frames but no buffer completes.
  Fix path: the QoS writes through a proper `reg` entry, not that port's
  hard-coded `ioremap`.
- **U2, the load switches' output.** The vana/vana2/vdig2 switches are
  modelled as fixed regulators on BoB. If a sensor's ID read fails with
  everything else right, the switch polarity or its rail (U2a: PM8150L
  gpio1 "PVDD") is the first suspect.
- **U3, the S5K3M5 at 24 MHz.** Stock runs it at 19.2 MHz; mainline's tables
  want 24 MHz, which MCLK0 makes exactly. The datasheet range covers both.
  If C4 shows no frames, a 19.2 MHz table set from the owner's image (as for
  the Sony sensors) is the fallback.
- **U4, the front camera's resolution.** The mainline IMX471 driver has one
  mode, 1928x1088 (a crop). Full resolution needs the vendor's 4656x3496
  table, the same way as the other Sony sensors, later.
- **U5, rotation.** The device tree's `rotation` is the vendor's
  `sensor-position-roll` (90, or 270 on the ultrawide). C5 checks one
  picture per camera and fixes the values.
- **U6, C-PHY.** New code on a separate branch. If C7 fails, the main
  camera stays off and the other three keep working.
  - **Settle count.** It comes from the spec: 85 ns + 6 UI, which is 21 at
    4000x3000@30 on the 300 MHz timer. The vendor file's settle hint of
    "14" has unknown units, so this is the first thing to change if C7
    shows no frames or SOT errors.
  - **Rate cap.** The 300 MHz CSIPHY timer and CAMSS's clock check limit a
    trio to about 2.28 Gsym/s. That is why the 8000x6000 mode (1.17 GHz
    link frequency) isn't in the device tree.
  - **Not implemented:** the vendor's extra settings above 5.24 Gbit/s per
    trio, and line-order (A/B/C) swaps.
- **U7, the pop-up's calibration.**
  - Stock's motor service writes per-phone hall thresholds and step counts
    from a source we don't have; P2 measures this phone's values.
  - No stall detection and no free-fall protection: the free-fall interrupt
    (TLMM gpio163) has no known source on Linux.
  - The boost enable's purpose is inferred from its name.
- **U8, LPG side effects.** Enabling the PM8150L LPG turns off its tri-colour
  LED block, which this phone doesn't use.

## 3. Rules for this subsystem

- Nothing here touches radio, PMIC registers, RPMB, any partition or a
  slot. The phone writes are: a test kernel's module tree; bring-up files in
  `/etc/modprobe.d`; the owner's table files in
  `/usr/lib/firmware/omamobile/camera/`; and (later) the device and
  libcamera packages.
- Test kernels are **RAM-booted** (`fastboot boot`); `boot_a` stays as it
  is. Every return to `boot_a` spends a slot-A try while
  `slot-successful:a` is `no` ([BRINGUP-M1](BRINGUP-M1.md)): read the count
  first and keep boots few.
- One change per step: every new module is blacklisted for the test boot and
  loaded by hand under a log stream (`dmesg -w` to the laptop first).
- **Announce before T2** (the torch lights), **before P3 and every
  pop-up step** (the camera moves; the phone lies flat, nothing over the
  slot, no finger on it), and before any step that powers a sensor (no
  visible effect, but the phone warms).
- The torch is never left on: every torch step switches it off again within
  30 s.
- The pop-up is never forced by hand while the motor runs, and never moved
  while the hall readings are unknown, except `down`.
- Never write a hall sensor register except its reset and setup (0x00,
  0x01, 0x07, 0x08); the tool refuses others. 0x06 disables its I2C.
- The table files are the owner's vendor data: never commit, upload or copy
  them off this owner's machines.

## 4. Decisions for the owner

1. Run the plan at all, and when: each step needs a yes.
2. The upstream SM8150 CAMSS series is one day old: use it as is (this plan),
   or wait for v2.
3. The torch cap: stock's 300 mA per LED (this plan) or lower.
4. After P5: enable `omamobile-hotdog-popup.service` and create
   `/etc/omamobile/popup-hotdog-enable`.
5. Making it stay: flash a RAM-booted image to `boot_a` (BRINGUP-M1's
   rule), or enable the nodes in the kernel DT and drop the overlays.

## 5. Build

### 5.1 Kernel and images

```sh
# the fingerprint and camera options on top (temporary: do not commit)
cat device/hotdog/kernel-fingerprint.config device/hotdog/kernel-camera.config \
  >> device/hotdog/kernel.config
DEVICE=hotdog KERNEL_DIR=~/omamobile-kernel/wt-hotdog-camera \
  KERNEL_OUT=~/omamobile-kernel/out-hotdog-camera bin/omamobile kernel
git checkout device/hotdog/kernel.config
DEVICE=hotdog KERNEL_OUT=~/omamobile-kernel/out-hotdog-camera bin/omamobile modules
DEVICE=hotdog KERNEL_OUT=~/omamobile-kernel/out-hotdog-camera bin/omamobile initramfs
# DTB_OVERLAYS="torch camera popup" in device/hotdog/device.conf for this build only
DEVICE=hotdog KERNEL_OUT=~/omamobile-kernel/out-hotdog-camera bin/omamobile images
```

Without the overlays this kernel boots like `omamobile-hotdog-fingerprint`:
every new node is disabled. With them, at boot:

- The fixed regulators drive their enable pins low, so the sensors stay off.
- QUP SE1 probes.
- L7C and L8C come on (the hall sensors' supplies).

The blacklisted modules hold back everything else.

For C7 the same build from `wt-hotdog-cphy` into `out-hotdog-cphy`, with
`DTB_OVERLAYS="torch camera popup camera-main"`.

### 5.2 The owner's register tables (laptop)

```sh
tools/hotdog-camera-tables ~/android/reference/hotdog/vendor-fp/vendor/lib64/camera \
  ~/android/reference/hotdog/camera-tables
```

- **Expect:** `imx586-main.bin` (3 trios, C-PHY; modes 4000x3000, 2000x1500,
  8000x6000) and `imx481-wide.bin` (4 lanes; 4656x3496).
- **Check:** the printed link frequencies are the ones in the device tree
  (421203125 and 340003125; 659200000).
- **Never:** commit or upload the output.

## 6. Runbook

Each step is the owner's to run or approve. Read-only first. Each has
Expect/Pass, a **Stop** condition, a Rollback and a risk level. Results go in
§7 with the date and `uname -r`.

### C0: preconditions (read-only; risk none)

- The phone boots Omarchy Mobile from `boot_a` with USB SSH.
- In fastboot: `fastboot getvar slot-successful:a`,
  `fastboot getvar slot-retry-count:a`. **Stop** if the retry count is 2
  or lower (mark slot A first, the owner's open decision).

```sh
tools/phone-ssh 'lsmod | grep -E "camcc|cci|camss|lpg|flash"; ls /sys/class/leds /sys/class/pwm'
tools/phone-ssh 'grep -E "gpio(11|12|23|28|29|30|148) " /sys/kernel/debug/gpio'
tools/phone-ssh 'cat /sys/kernel/debug/gpio | grep -A12 -E "pmic@(0|2|4)"'
tools/phone-ssh 'grep -iE "l1f|l2f|l3f|l4f|l1c|l7c|l8c|bob" /sys/kernel/debug/regulator/regulator_summary'
```

- **Expect:**
  - `camcc_sm8150` loaded or absent, nothing camera-related bound;
  - none of these GPIOs claimed;
  - the PMIC GPIOs listed;
  - the PM8009 LDOs off.
- **Stop** if another driver owns one of the camera or motor pins.

### C1: the test kernel's modules, blacklist and tables (one write each; risk low)

```sh
DEVICE=hotdog KERNEL_OUT=~/omamobile-kernel/out-hotdog-camera bin/omamobile modules-push
tools/phone-ssh 'printf "%s\n" "# CAMERA-PLAN: each step loads one by hand" \
  "blacklist leds_qcom_flash" "blacklist leds_qcom_lpg" "blacklist i2c_qcom_cci" \
  "blacklist qcom_camss" "blacklist s5k3m5" "blacklist imx471" "blacklist sony_fwtable" \
  > /etc/modprobe.d/omamobile-camera-hotdog-bringup.conf'
tools/phone-ssh 'mkdir -p /usr/lib/firmware/omamobile/camera'
for f in imx586-main.bin imx481-wide.bin; do
  tools/phone-ssh "cat > /usr/lib/firmware/omamobile/camera/$f" < ~/android/reference/hotdog/camera-tables/$f
done
```

- **Rollback:** remove the blacklist file and the two table files; the extra
  module tree is harmless.

### T1-T2: the torch (RAM boot 1; risk low)

The owner brings the phone to fastboot by the buttons, then
`fastboot boot ~/omamobile-kernel/out-hotdog-camera/images/boot.img`. Fingerprint
unlock is off in this boot (its bring-up module is built for the running
kernel); unlock with the PIN. A log stream first:
`tools/phone-ssh 'dmesg -w' > logs/camera-$(date +%H%M).log &`.

**T1** (no light):

```sh
tools/phone-ssh 'uname -r; modprobe leds-qcom-flash; ls /sys/class/leds; cat /sys/class/leds/white:torch/max_brightness'
```

- **Expect:** `white:torch` with `max_brightness` 255; no error.

**T2** (announce: the rear flash lights, dim, for 2 s, then full for 5 s):

```sh
tools/phone-ssh 'cd /sys/class/leds/white:torch; echo 40 > brightness; sleep 2; echo 0 > brightness'
tools/phone-ssh 'cd /sys/class/leds/white:torch; echo 255 > brightness; sleep 5; echo 0 > brightness; cat brightness'
```

- **Pass:** the owner sees both LEDs light, dim then bright; `brightness` reads
  0; no `led-fault` in the log. Then the quick-settings Torch tile turns it on
  and off (its `brightnessctl --device=white:torch` path).
- **Stop** on a fault interrupt, one LED dark, or anything but 0 after off.
- **Rollback:** `echo 0 > brightness`; `rmmod leds_qcom_flash`.

### C2-C6: the D-PHY cameras (same boot; risk low to medium)

**C2, the CCI controllers:**

```sh
tools/phone-ssh 'modprobe i2c-qcom-cci; sleep 1; dmesg | grep -iE "cci|camcc|gdsc" | tail; ls /sys/bus/i2c/devices/ | grep -E "^i2c-"'
```

- **Expect:** four new I2C adapters; no clock or GDSC error.
- **Never** run `i2cdetect` on them.

**C3, the telephoto** (powers the S5K3M5 and reads its ID):

```sh
tools/phone-ssh 'modprobe s5k3m5; sleep 1; dmesg | grep -iE "s5k3m5|regulator|cci" | tail'
```

- **Pass:** probe without error.
- **Stop:** a chip ID mismatch, an I2C NACK, or a regulator error (U2).

**C4, the front and the ultrawide:**

```sh
tools/phone-ssh 'modprobe imx471; sleep 1; modprobe sony-fwtable; sleep 1; dmesg | grep -iE "imx471|imx481|sony" | tail'
```

- **Expect:** IMX471 probes; `IMX481, 1 modes from the tables`.
- **Stop:** any ID mismatch, or `refusing ...`.

**C5, CAMSS** (no streaming yet):

```sh
tools/phone-ssh 'modprobe qcom-camss; sleep 2; dmesg | grep -iE "camss|smmu|icc" | tail -20; media-ctl -d /dev/media0 -p | grep -E "entity|-> "'
```

- **Expect:** `msm_csiphy0..3`, CSIDs and VFEs; the three sensors linked to
  CSIPHY0, 2 and 3; no SMMU fault.
- **Stop** on an SMMU fault or a CAMSS probe error.

**C6, raw frames, one camera at a time** (telephoto first; the front sensor
streams dark frames with the pop-up down, which is fine):

```sh
tools/phone-ssh 'media-ctl -d /dev/media0 -r; \
  media-ctl -d /dev/media0 -l "\"msm_csiphy0\":1->\"msm_csid0\":0[1],\"msm_csid0\":1->\"msm_vfe0_rdi0\":0[1]"; \
  media-ctl -d /dev/media0 -V "\"s5k3m5 0-0010\":0[fmt:SGRBG10_1X10/4208x3120]"; \
  media-ctl -d /dev/media0 -V "\"msm_csiphy0\":0[fmt:SGRBG10_1X10/4208x3120],\"msm_csid0\":0[fmt:SGRBG10_1X10/4208x3120],\"msm_vfe0_rdi0\":0[fmt:SGRBG10_1X10/4208x3120]"; \
  timeout 20 v4l2-ctl -d /dev/video0 --set-fmt-video=width=4208,height=3120,pixelformat=pgAA \
    --stream-mmap --stream-count=30 --stream-to=/tmp/tele.raw'
```

- The entity names (the sensor's `<bus>-<addr>`), the VFE's video node and
  the packed-format fourcc come from C5's `media-ctl -p`; adjust before
  running.
- **Pass:** 30 frames, the expected size; `tools/raw10-stats` shows a
  plausible image (cover the lens: dark; uncover: brighter).
- **Stop:** a timeout with no frame (U1), an SMMU fault, `csid ... error`
  floods.
- **Rollback:** `pkill v4l2-ctl`; reboot rather than `rmmod`.
- Then the ultrawide on CSIPHY3 and the front on CSIPHY2 the same way.

### C7: the main camera (RAM boot 2, the C-PHY kernel; risk medium)

As C1 with `out-hotdog-cphy` and `camera-main` added. Then as C2-C6 for
`imx586` on CSIPHY1 (`sony-fwtable` probes it with the 4000x3000 and
2000x1500 modes).

- **Stop** on an ID mismatch, a CSIPHY error, or CSID errors (the C-PHY
  setup is the first suspect, U6).

### C8: libcamera and omacam (risk low)

```sh
tools/phone-install-package packages/libcamera
tools/phone-ssh 'cam -l'
tools/phone-ssh 'cam -c 1 -C 10 -F /tmp/cam1-#.ppm -s pixelformat=RGB888,width=1920,height=1440'
```

- **Expect:** four cameras (three before C7), each with its sensor model;
  pictures are the right way up (U5: else fix `rotation` in the DT).
- Then omacam.

### P0: pop-up preconditions (read-only, same boot as C2-C6; risk none)

```sh
tools/phone-ssh 'ls /sys/class/pwm; ls /sys/bus/i2c/devices | grep -E "^i2c-"; cat /sys/kernel/debug/gpio | grep -B2 -A14 "pmic@4"'
```

- **Expect:**
  - no PM8150L PWM yet (LPG blacklisted);
  - an adapter for `i2c@884000`;
  - PM8150L GPIO8, 10 and 11, PM8150 GPIO10 and PM8150B GPIO5 and 12
    unclaimed.

### P1: hall sensors and pins (risk low; no movement)

```sh
tools/phone-ssh 'modprobe leds-qcom-lpg; ls /sys/class/pwm; cat /sys/kernel/debug/pinctrl/*pmic@4*/pinconf-pins 2>/dev/null | grep -E "gpio(8|10|11)"'
scp packages/omamobile-device-hotdog/libexec/omamobile-hotdog-popup root@172.16.42.1:/root/
tools/phone-ssh 'python3 -I /root/omamobile-hotdog-popup status'
```

- **Expect:**
  - a `pwmchip` for `pmic@5/pwm`;
  - PM8150L GPIO10 in `func1`, GPIO11 and 8 low;
  - `status` prints `down up=<small> down=<large>` (both sensors answer
    ID 0x9c).
- **Stop:**
  - a hall sensor doesn't answer, or its ID is wrong;
  - the reading isn't `down` with the camera visibly down: don't move
    anything; record the values and work out the thresholds first.

### P2: the hall values at both ends (risk none; the owner moves nothing)

Record `status` three times with the camera down. Its values at the top come
from P3. Write the measured thresholds (about half of each end's value) to
`/etc/omamobile/popup-hotdog.conf` if they differ from 150.

### P3: the first move up (announce; risk medium: mechanical)

The phone lies flat, the slot is free, the owner watches it:

```sh
tools/phone-ssh 'python3 -I /root/omamobile-hotdog-popup up; python3 -I /root/omamobile-hotdog-popup status'
```

- **Expect:**
  - one smooth move of about 0.6 s;
  - the log says `sensor reached`, then `now up`;
  - the owner sees the camera fully up.
- **Stop:** `NOT reached`, a buzzing or grinding motor, or the camera
  stopping halfway. Then run `down` once (allowed from an unknown
  position) and stop the plan there.
- **Rollback:** `python3 -I /root/omamobile-hotdog-popup down`.

### P4: down, then five cycles (announce; risk medium)

```sh
tools/phone-ssh 'P=/root/omamobile-hotdog-popup; python3 -I $P down; for i in 1 2 3 4 5; do python3 -I $P up; sleep 2; python3 -I $P down; sleep 2; done'
```

- **Pass:** all moves end `reached`; times are steady; nothing grinds.
- Record the hall values at the top and bottom, and the time to "reached"
  in each direction.

### P5: the front camera follows the pop-up (announce; risk low)

Install device-hotdog 0.1.5, then
`touch /etc/omamobile/popup-hotdog-enable; systemctl start omamobile-hotdog-popup`.

- **Expect:**
  - streaming the front camera (C6's commands for CSIPHY2) raises it within
    about 0.8 s;
  - stopping lowers it 1.5 s later;
  - pushing it in while up lowers it and logs `left the top while in use`;
  - `systemctl stop omamobile-hotdog-popup` with it up lowers it.
- **Rollback:** `systemctl stop omamobile-hotdog-popup` (lowers it);
  remove the enable file.

### After the plan

Remove `/etc/modprobe.d/omamobile-camera-hotdog-bringup.conf` and
`/root/omamobile-hotdog-popup`, and keep the table files. Then the owner's
decision 5.

## 7. Results

Nothing has run on the phone yet.

**C-PHY branch:** `omamobile-hotdog-cphy` rebased onto the final camera
branch and built (`7.3.0-rc6-omamobile-push1-g8ff34aa9e03b`):

- no new warnings;
- `W=1` on `drivers/media/platform/qcom/camss/` and `sony-fwtable.o` clean;
- `checkpatch --strict` clean on our three commits (they carry no
  Signed-off-by, which is the owner's to add);
- the upstream nine keep their author's tags and Links.

**2026-11-05, laptop only:** stock facts in §0 from the owner's OxygenOS
image (base DTB, dtbo entry 18, the camera module files); the kernel branch,
the overlays, the pop-up tool, the tables tool and the libcamera patch
written. Checks:

- **Kernel build.** Built as §5.1, with the fingerprint and camera options
  (`7.3.0-rc6-omamobile-push1-g43b7e8ece3ad`). No new warnings; the
  modules `qcom-camss`, `i2c-qcom-cci`, `s5k3m5`, `imx471`, `sony-fwtable`
  and `leds-qcom-flash` are built.
- **W=1** on `sony-fwtable.o`, `imx471.o` and `camss.o`: clean.
- **`checkpatch --strict`:** the eight commits on top of the upstream series
  are clean, except that the three adding files ask about MAINTAINERS.
- **`dt_binding_check`** (dtschema 2026.9) for `sony,imx471`, `sony,imx586`,
  `qcom,sm8150-camss` and `qcom,i2c-cci`: clean.
- **`dt-validate`:** the same 22 messages for the running kernel's DTB, this
  branch's, and this branch's with all four overlays applied; nothing new.
- **Overlays:** all four compile; `fdtoverlay` applies them to the built
  DTB, and every target goes from `disabled` to `okay` (L7C and L8C become
  always-on).
- **Tables:** `tools/hotdog-camera-tables` on the owner's image gives
  `imx586-main.bin` (16 296 bytes) and `imx481-wide.bin` (2 952 bytes), kept
  in the scratchpad only. A Python mirror of the driver's parser accepts
  both: no write to 0x0100 or the OTP range, delays at most 100 ms, sizes
  exact.
- **Pop-up tool:** simulated against a mocked motor and hall sensors. It
  stops at the target's threshold plus 10 ms, refuses `up` toward an end the
  camera is at or from an unknown position, and allows `down` from one.
  device-hotdog's `test/all` passes.
- **libcamera:** the 0057 patch applies on top of 0001-0056 (it was
  generated there); libcamera itself was not built.
