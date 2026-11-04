# SPDX-License-Identifier: MIT
# Builds the OnePlus 7T Pro (hotdog) fingerprint chroot's bionic (aarch64)
# programs on the computer. THEORETICAL: never built against the owner's
# vendor image yet, never run on a phone (README.md).
#
#   out/omamobile-fp-ion-shim.so      /dev/ion on our qseecom compat driver
#                                     (preloaded next to fingerprint/shim's
#                                     omamobile-fp-shim.so)
#   out/omamobile-fp-hotdog-bridge    the HIDL 2.1 client fprintd's driver
#                                     talks to
#
#   make shim NDK=/opt/android-ndk CHROOT=...      the shim (plain C; NDK r27+)
#   make AOSP=<tree> GEN=<hidl-gen out> CHROOT=... both
#
# CHROOT is the extracted OxygenOS root (system/, vendor/; README.md):
# both programs link against its libraries, so they match the phone.
#
# The bridge is C++ on libhidlbase, so it must be compiled with the same
# libc++ as the chroot's libraries (the platform's, std::__1): an AOSP or
# LineageOS tree of the vendor's Android version (10 or 11), its prebuilt
# clang, its libc++ and libhidl headers, and the hidl-gen headers of the
# interface, made once with:
#
#   hidl-gen -o $GEN -L c++-headers \
#     -r android.hardware:$AOSP/hardware/interfaces \
#     -r android.hidl:$AOSP/system/libhidl/transport \
#     android.hardware.biometrics.fingerprint@2.1
#
# The NDK's libc++ (std::__ndk1) does not mix with the platform's, which is
# why the NDK builds only the shim. The interface's proxy code is not built
# here either: it is the phone's own android.hardware.biometrics.fingerprint
# @2.1.so, linked from CHROOT.

API      ?= 29
OUT      ?= out
CFLAGS   ?= -O2
WARN     := -Wall -Wextra -Werror
ION_SRC  := omamobile-fp-ion-shim.c
BRIDGE_SRC := omamobile-fp-hotdog-bridge.cpp

ifndef CHROOT
$(error set CHROOT=<extracted OxygenOS root> (system/, vendor/))
endif
SYSLIB   := $(CHROOT)/system/lib64
# Android 10 keeps bionic in the runtime APEX; older images in system/lib64
LIBC     := $(firstword $(wildcard $(CHROOT)/apex/com.android.runtime/lib64/bionic/libc.so \
                                   $(CHROOT)/system/apex/com.android.runtime.release/lib64/bionic/libc.so) \
                        $(SYSLIB)/libc.so)
LIBDL    := $(patsubst %/libc.so,%/libdl.so,$(LIBC))
LIBM     := $(patsubst %/libc.so,%/libm.so,$(LIBC))
# the interface library: system/lib64 on 10, vendor/lib64 on some builds
FP_HIDL  := $(firstword $(wildcard $(SYSLIB)/android.hardware.biometrics.fingerprint@2.1.so \
                                   $(CHROOT)/vendor/lib64/android.hardware.biometrics.fingerprint@2.1.so))
# libhwbinder and libhidltransport are separate on 10 and stubs on 11
HIDL_LIBS := $(SYSLIB)/libhidlbase.so $(wildcard $(SYSLIB)/libhidltransport.so \
             $(SYSLIB)/libhwbinder.so) $(SYSLIB)/libutils.so $(SYSLIB)/libcutils.so \
             $(SYSLIB)/liblog.so $(SYSLIB)/libc++.so

ifdef NDK
CC       := $(NDK)/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android$(API)-clang
else ifdef AOSP
CLANG    ?= $(firstword $(wildcard $(AOSP)/prebuilts/clang/host/linux-x86/clang-r*/bin/clang))
BIONIC   := $(AOSP)/bionic/libc
SYSROOT  := -nostdinc -isystem $(BIONIC)/include -isystem $(BIONIC)/kernel/uapi \
	    -isystem $(BIONIC)/kernel/uapi/asm-arm64 -isystem $(BIONIC)/kernel/android/uapi \
	    -isystem $(shell $(CLANG) -print-resource-dir)/include
CC       := $(CLANG) --target=aarch64-linux-android$(API) $(SYSROOT) -fuse-ld=lld
CXX      := $(CLANG)++ --target=aarch64-linux-android$(API) -nostdinc++ \
	    -isystem $(AOSP)/external/libcxx/include -isystem $(AOSP)/external/libcxxabi/include \
	    $(SYSROOT) -fuse-ld=lld
HIDL_INC := -I$(GEN) -I$(AOSP)/system/libhidl/base/include \
	    -I$(AOSP)/system/libhidl/transport/include \
	    -I$(AOSP)/system/libhidl/transport/token/1.0/utils/include \
	    -I$(AOSP)/system/libhwbinder/include -I$(AOSP)/system/core/libutils/include \
	    -I$(AOSP)/system/core/libcutils/include -I$(AOSP)/system/core/liblog/include \
	    -I$(AOSP)/system/core/libsystem/include -I$(AOSP)/system/core/base/include \
	    -I$(AOSP)/system/libbase/include \
	    -I$(GEN)/android/hidl/base/1.0 -I$(GEN)/android/hidl/manager/1.0
else
$(error set NDK=<android-ndk> (shim only) or AOSP=<tree>, GEN= and CHROOT=)
endif

all: shim bridge
shim: $(OUT)/omamobile-fp-ion-shim.so
bridge: $(OUT)/omamobile-fp-hotdog-bridge

$(OUT)/omamobile-fp-ion-shim.so: $(ION_SRC)
	@mkdir -p $(OUT)
	$(CC) $(CFLAGS) $(WARN) -fPIC -fvisibility=hidden -shared -nostdlib \
		-Wl,--no-undefined -Wl,-soname,omamobile-fp-ion-shim.so -o $@ $< \
		$(LIBC) $(LIBDL)

# The platform's crtbegin and libc++ come from CHROOT and the tree; Soong's
# defaults: no exceptions, no RTTI. A normal dynamic executable (unlike
# the Pixel bridge, no hand-written _start): crtbegin_dynamic.o from the
# tree's bionic prebuilts.
CRTBEGIN ?= $(firstword $(wildcard $(AOSP)/prebuilts/ndk/current/platforms/android-$(API)/arch-arm64/usr/lib/crtbegin_dynamic.o \
                                   $(AOSP)/out/soong/.intermediates/bionic/libc/crtbegin_dynamic/android_arm64_armv8-a/crtbegin_dynamic.o))
CRTEND   ?= $(patsubst %crtbegin_dynamic.o,%crtend_android.o,$(CRTBEGIN))

$(OUT)/omamobile-fp-hotdog-bridge: $(BRIDGE_SRC)
ifndef AOSP
	$(error the bridge needs AOSP= and GEN= (see the header))
endif
	@mkdir -p $(OUT)
	$(CXX) -std=c++17 $(CFLAGS) $(WARN) -fno-exceptions -fno-rtti -fPIE -pie \
		$(HIDL_INC) -nostdlib -Wl,--dynamic-linker=/system/bin/linker64 \
		-Wl,-z,now -Wl,-z,relro -Wl,--hash-style=gnu -Wl,--no-undefined \
		-Wl,--allow-shlib-undefined -o $@ $(CRTBEGIN) $< \
		$(FP_HIDL) $(HIDL_LIBS) $(LIBM) $(LIBDL) $(LIBC) $(CRTEND)

clean:
	rm -rf $(OUT)

.PHONY: all shim bridge clean
