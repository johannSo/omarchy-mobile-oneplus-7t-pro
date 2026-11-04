// SPDX-License-Identifier: MIT
/*
 * omamobile-fp-ion-shim: /dev/ion for the OnePlus 7T Pro (hotdog)
 * fingerprint chroot (device/hotdog/FINGERPRINT-PLAN.md). THEORETICAL:
 * nothing here has run on a phone.
 *
 * OnePlus's Goodix HAL reaches its trusted app in QSEE through Qualcomm's
 * libQSEEComAPI, and that library shares memory with the secure world in
 * ion buffers from the "qsecom" heap of the downstream kernel. Mainline
 * has no ion. Our kernel's qseecom compat driver (qcom_qseecom_compat)
 * hands out the same kind of buffer itself, as a dma-buf fd, physically
 * contiguous and from the qseecom carve-out:
 *
 *   ioctl(/dev/qseecom fd, QSEECOM_COMPAT_IOCTL_ALLOC, &alloc)
 *
 * This library makes /dev/ion out of that and nothing else:
 *
 *  - open()/openat() of "/dev/ion" (and their _2 and 64 forms) open
 *    /dev/qseecom instead (OMAMOBILE_FP_QSEECOM overrides the path) and
 *    remember the fd as an "ion fd" in a small table;
 *  - ioctl() on an ion fd answers the ion ABI (below); every other ioctl,
 *    and every ioctl on any other fd, goes on unchanged;
 *  - close() of an ion fd forgets it.
 *
 * The ion ABI, in two flavours (OMAMOBILE_FP_ION_ABI=new|legacy, default
 * new, which is what msm-4.14 offered the OxygenOS 10/11 vendor):
 *
 *  - new (4.12+): ION_IOC_ALLOC returns a dma-buf fd; ION_IOC_HEAP_QUERY
 *    lists the heaps; ION_IOC_ABI_VERSION answers 1. ION_IOC_FREE answers
 *    ENOTTY, as a 4.12+ kernel does: libion tells the two ABIs apart that
 *    way (ion_is_legacy() frees handle 0 and looks for ENOTTY).
 *  - legacy (before 4.12): ION_IOC_ALLOC returns a handle, ION_IOC_MAP and
 *    ION_IOC_SHARE return a dup of its dma-buf fd, ION_IOC_FREE drops it.
 *    ION_IOC_SYNC is accepted (the buffers are write-combined). Anything
 *    else (IMPORT, CUSTOM, the msm cache ioctls) answers ENOTTY and logs
 *    one line.
 *
 * Heaps: only allocations whose heap_id_mask includes "qsecom" (id 27) or
 * "qsecom_ta" (id 19) are honoured, both from the same carve-out; anything
 * else answers ENODEV. VERIFY both ids against the owner's libQSEEComAPI
 * (msm-4.14 msm_ion.h: ION_QSECOM_HEAP_ID 27, ION_QSECOM_TA_HEAP_ID 19);
 * OMAMOBILE_FP_ION_HEAPS="name:id,..." replaces them.
 *
 * Preloading next to omamobile-fp-shim.so: both libraries define ioctl().
 * With LD_PRELOAD="omamobile-fp-shim.so omamobile-fp-ion-shim.so" the
 * dynamic linker binds every caller to the first one's ioctl; its
 * dlsym(RTLD_NEXT, "ioctl") finds this one's, and ours finds bionic's. Each
 * handles only what it owns (the other shim: one binder ioctl; this one:
 * 'I' ioctls on ion fds) and passes the rest along, so either order works.
 * open/openat/close are ours alone.
 *
 * Thread-safe: the fd table has a lock; the kernel call itself runs
 * outside it.
 *
 * Build with the Android NDK (bionic, aarch64), see Makefile here.
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

#define EXPORT __attribute__((visibility("default")))

/* --- the kernel's side (qcom_qseecom_compat) --- */

struct qseecom_compat_alloc {
	uint64_t len;		/* in: bytes, rounded up to 4 KiB by the kernel */
	uint32_t flags;		/* in: 0 */
	int32_t fd;		/* out: a dma-buf fd */
};
#define QSEECOM_COMPAT_IOCTL_ALLOC	_IOWR(0x97, 0xc0, struct qseecom_compat_alloc)

/* --- the ion ABI the vendor libraries speak --- */

#define ION_MAGIC	'I'

/* 4.12+ */
struct ion_allocation_data {
	uint64_t len;
	uint32_t heap_id_mask;
	uint32_t flags;
	uint32_t fd;
	uint32_t unused;
};
struct ion_heap_data {
	char name[32];
	uint32_t type;
	uint32_t heap_id;
	uint32_t reserved0, reserved1, reserved2;
};
struct ion_heap_query {
	uint32_t cnt;
	uint32_t reserved0;
	uint64_t heaps;		/* user pointer to ion_heap_data[cnt] */
	uint32_t reserved1, reserved2;
};
#define ION_IOC_ALLOC		_IOWR(ION_MAGIC, 0, struct ion_allocation_data)
#define ION_IOC_HEAP_QUERY	_IOWR(ION_MAGIC, 8, struct ion_heap_query)
#define ION_IOC_ABI_VERSION	_IOR(ION_MAGIC, 9, uint32_t)
#define ION_HEAP_TYPE_DMA	4

/* before 4.12; sizes as on arm64 */
struct ion_legacy_allocation_data {
	uint64_t len;		/* size_t */
	uint64_t align;		/* size_t */
	uint32_t heap_id_mask;
	uint32_t flags;
	int32_t handle;
	uint32_t pad_;
};
struct ion_legacy_fd_data {
	int32_t handle;
	int32_t fd;
};
struct ion_legacy_handle_data {
	int32_t handle;
};
#define ION_IOC_LEGACY_ALLOC	_IOWR(ION_MAGIC, 0, struct ion_legacy_allocation_data)
#define ION_IOC_FREE		_IOWR(ION_MAGIC, 1, struct ion_legacy_handle_data)
#define ION_IOC_MAP		_IOWR(ION_MAGIC, 2, struct ion_legacy_fd_data)
#define ION_IOC_SHARE		_IOWR(ION_MAGIC, 4, struct ion_legacy_fd_data)
#define ION_IOC_SYNC		_IOWR(ION_MAGIC, 7, struct ion_legacy_fd_data)

/* --- logging (the other shim's liblog stand-in sends stderr to the journal) --- */

static void say(const char *format, ...)
{
	char line[256];
	va_list args;
	int n;

	va_start(args, format);
	n = vsnprintf(line, sizeof(line) - 1, format, args);
	va_end(args);
	if (n < 0)
		return;
	if (n > (int)sizeof(line) - 2)
		n = sizeof(line) - 2;
	line[n++] = '\n';
	(void)!write(STDERR_FILENO, "I omamobile-fp-ion: ", 20);
	(void)!write(STDERR_FILENO, line, n);
}

/* --- configuration --- */

#define MAX_HEAPS	4
struct heap {
	char name[32];
	uint32_t id;
};
static struct heap heaps[MAX_HEAPS];
static int heap_count;
static bool legacy_abi;
static const char *qseecom_path = "/dev/qseecom";

static void configure(void)
{
	const char *s = getenv("OMAMOBILE_FP_ION_HEAPS");
	const char *abi = getenv("OMAMOBILE_FP_ION_ABI");
	const char *q = getenv("OMAMOBILE_FP_QSEECOM");

	if (q && *q)
		qseecom_path = q;
	legacy_abi = abi && !strcmp(abi, "legacy");
	if (s && *s) {
		char copy[256], *save = NULL, *item;

		snprintf(copy, sizeof(copy), "%s", s);
		for (item = strtok_r(copy, ",", &save); item && heap_count < MAX_HEAPS;
		     item = strtok_r(NULL, ",", &save)) {
			char *colon = strchr(item, ':');
			long id;

			if (!colon)
				continue;
			*colon = '\0';
			id = strtol(colon + 1, NULL, 0);
			if (id < 0 || id > 31 || !*item)
				continue;
			snprintf(heaps[heap_count].name, sizeof(heaps[0].name), "%s", item);
			heaps[heap_count++].id = (uint32_t)id;
		}
	}
	if (!heap_count) {
		/* VERIFY: msm-4.14 ION_QSECOM_HEAP_ID / ION_QSECOM_TA_HEAP_ID */
		strcpy(heaps[0].name, "qsecom");
		heaps[0].id = 27;
		strcpy(heaps[1].name, "qsecom_ta");
		heaps[1].id = 19;
		heap_count = 2;
	}
}

static pthread_once_t configured = PTHREAD_ONCE_INIT;

static uint32_t heap_mask(void)
{
	uint32_t mask = 0;

	for (int i = 0; i < heap_count; i++)
		mask |= 1u << heaps[i].id;
	return mask;
}

/* --- the real functions --- */

typedef int (*open_fn)(const char *, int, ...);
typedef int (*openat_fn)(int, const char *, int, ...);
typedef int (*open2_fn)(const char *, int);
typedef int (*openat2_fn)(int, const char *, int);
typedef int (*ioctl_fn)(int, int, ...);
typedef int (*close_fn)(int);

#define REAL(type, name) \
	static type real_##name; \
	if (!real_##name) \
		real_##name = (type)dlsym(RTLD_NEXT, #name)

/* --- the ion fds and the legacy handles --- */

#define MAX_ION_FDS	16
#define MAX_HANDLES	64
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static int ion_fds[MAX_ION_FDS];	/* 0: free slot (fd 0 is never ours) */
struct handle {
	int ion_fd;	/* the ion fd it belongs to; 0: free */
	int buf_fd;	/* the dma-buf from the kernel */
};
static struct handle handles[MAX_HANDLES];

static bool is_ion_fd(int fd)
{
	bool found = false;

	if (fd <= 0)
		return false;
	pthread_mutex_lock(&lock);
	for (int i = 0; i < MAX_ION_FDS; i++)
		if (ion_fds[i] == fd) {
			found = true;
			break;
		}
	pthread_mutex_unlock(&lock);
	return found;
}

static bool track(int fd)
{
	bool ok = false;

	pthread_mutex_lock(&lock);
	for (int i = 0; i < MAX_ION_FDS; i++)
		if (!ion_fds[i]) {
			ion_fds[i] = fd;
			ok = true;
			break;
		}
	pthread_mutex_unlock(&lock);
	return ok;
}

/* Forget an ion fd and its handles; returns the dma-buf fds to close. */
static int untrack(int fd, int *bufs, int max)
{
	int n = 0;

	pthread_mutex_lock(&lock);
	for (int i = 0; i < MAX_ION_FDS; i++)
		if (ion_fds[i] == fd)
			ion_fds[i] = 0;
	for (int i = 0; i < MAX_HANDLES; i++)
		if (handles[i].ion_fd == fd) {
			if (n < max)
				bufs[n++] = handles[i].buf_fd;
			handles[i].ion_fd = 0;
		}
	pthread_mutex_unlock(&lock);
	return n;
}

static bool is_ion_path(const char *path)
{
	return path && !strcmp(path, "/dev/ion");
}

/* /dev/ion -> /dev/qseecom, through the real open, then tracked. */
static int open_ion(int flags)
{
	REAL(open_fn, open);
	int fd;

	pthread_once(&configured, configure);
	fd = real_open(qseecom_path, (flags & O_CLOEXEC) | O_RDWR);
	if (fd < 0) {
		say("/dev/ion: %s: %s (qcom_qseecom_compat loaded?)", qseecom_path,
		    strerror(errno));
		return -1;
	}
	if (!track(fd)) {
		REAL(close_fn, close);
		real_close(fd);
		say("/dev/ion: too many open ion fds");
		errno = EMFILE;
		return -1;
	}
	return fd;
}

/* --- interposed entry points --- */

EXPORT int open(const char *path, int flags, ...)
{
	REAL(open_fn, open);
	mode_t mode = 0;

	if (flags & (O_CREAT | O_TMPFILE)) {
		va_list ap;

		va_start(ap, flags);
		mode = (mode_t)va_arg(ap, int);
		va_end(ap);
	}
	if (is_ion_path(path))
		return open_ion(flags);
	return real_open(path, flags, mode);
}

EXPORT int open64(const char *path, int flags, ...)
{
	mode_t mode = 0;

	if (flags & (O_CREAT | O_TMPFILE)) {
		va_list ap;

		va_start(ap, flags);
		mode = (mode_t)va_arg(ap, int);
		va_end(ap);
	}
	return open(path, flags, mode);
}

EXPORT int openat(int dirfd, const char *path, int flags, ...)
{
	REAL(openat_fn, openat);
	mode_t mode = 0;

	if (flags & (O_CREAT | O_TMPFILE)) {
		va_list ap;

		va_start(ap, flags);
		mode = (mode_t)va_arg(ap, int);
		va_end(ap);
	}
	/* an absolute path ignores dirfd, as the kernel does */
	if (is_ion_path(path))
		return open_ion(flags);
	return real_openat(dirfd, path, flags, mode);
}

EXPORT int openat64(int dirfd, const char *path, int flags, ...)
{
	mode_t mode = 0;

	if (flags & (O_CREAT | O_TMPFILE)) {
		va_list ap;

		va_start(ap, flags);
		mode = (mode_t)va_arg(ap, int);
		va_end(ap);
	}
	return openat(dirfd, path, flags, mode);
}

/* bionic's FORTIFY entry points for open(path, flags) without a mode */
EXPORT int __open_2(const char *path, int flags)
{
	REAL(open2_fn, __open_2);

	if (is_ion_path(path))
		return open_ion(flags);
	return real___open_2(path, flags);
}

EXPORT int __openat_2(int dirfd, const char *path, int flags)
{
	REAL(openat2_fn, __openat_2);

	if (is_ion_path(path))
		return open_ion(flags);
	return real___openat_2(dirfd, path, flags);
}

EXPORT int close(int fd)
{
	REAL(close_fn, close);
	int bufs[MAX_HANDLES], n;

	if (is_ion_fd(fd)) {
		n = untrack(fd, bufs, MAX_HANDLES);
		for (int i = 0; i < n; i++)
			real_close(bufs[i]);
	}
	return real_close(fd);
}

/* --- the ion ioctls --- */

static int alloc_buffer(int ion_fd, uint64_t len, uint32_t mask, int *buf_fd)
{
	REAL(ioctl_fn, ioctl);
	struct qseecom_compat_alloc a = { .len = len };

	if (!(mask & heap_mask())) {
		say("alloc of %llu bytes from heap mask 0x%x refused: not a qsecom heap",
		    (unsigned long long)len, mask);
		errno = ENODEV;
		return -1;
	}
	if (!len) {
		errno = EINVAL;
		return -1;
	}
	if (real_ioctl(ion_fd, (int)QSEECOM_COMPAT_IOCTL_ALLOC, &a) < 0) {
		say("alloc of %llu bytes: %s", (unsigned long long)len, strerror(errno));
		return -1;
	}
	*buf_fd = a.fd;
	return 0;
}

static int heap_query(struct ion_heap_query *q)
{
	struct ion_heap_data *out = (struct ion_heap_data *)(uintptr_t)q->heaps;

	if (!out) {
		q->cnt = (uint32_t)heap_count;
		return 0;
	}
	if (q->cnt > (uint32_t)heap_count)
		q->cnt = (uint32_t)heap_count;
	for (uint32_t i = 0; i < q->cnt; i++) {
		memset(&out[i], 0, sizeof(out[i]));
		snprintf(out[i].name, sizeof(out[i].name), "%s", heaps[i].name);
		out[i].type = ION_HEAP_TYPE_DMA;
		out[i].heap_id = heaps[i].id;
	}
	return 0;
}

static struct handle *find_handle(int ion_fd, int32_t h)
{
	if (h < 1 || h > MAX_HANDLES || handles[h - 1].ion_fd != ion_fd)
		return NULL;
	return &handles[h - 1];
}

static int legacy_ioctl(int fd, unsigned int request, void *arg)
{
	REAL(close_fn, close);

	if (request == (unsigned int)ION_IOC_LEGACY_ALLOC) {
		struct ion_legacy_allocation_data *a = arg;
		int buf, slot = -1;

		if (alloc_buffer(fd, a->len, a->heap_id_mask, &buf))
			return -1;
		pthread_mutex_lock(&lock);
		for (int i = 0; i < MAX_HANDLES; i++)
			if (!handles[i].ion_fd) {
				handles[i].ion_fd = fd;
				handles[i].buf_fd = buf;
				slot = i;
				break;
			}
		pthread_mutex_unlock(&lock);
		if (slot < 0) {
			real_close(buf);
			errno = ENOMEM;
			return -1;
		}
		a->handle = slot + 1;
		return 0;
	}
	if (request == (unsigned int)ION_IOC_MAP || request == (unsigned int)ION_IOC_SHARE) {
		struct ion_legacy_fd_data *d = arg;
		struct handle *h;
		int buf = -1;

		pthread_mutex_lock(&lock);
		h = find_handle(fd, d->handle);
		if (h)
			buf = h->buf_fd;
		pthread_mutex_unlock(&lock);
		if (buf < 0) {
			errno = EINVAL;
			return -1;
		}
		d->fd = fcntl(buf, F_DUPFD_CLOEXEC, 0);
		return d->fd < 0 ? -1 : 0;
	}
	if (request == (unsigned int)ION_IOC_FREE) {
		struct ion_legacy_handle_data *d = arg;
		struct handle *h;
		int buf = -1;

		pthread_mutex_lock(&lock);
		h = find_handle(fd, d->handle);
		if (h) {
			buf = h->buf_fd;
			h->ion_fd = 0;
		}
		pthread_mutex_unlock(&lock);
		if (buf < 0) {
			errno = EINVAL;
			return -1;
		}
		real_close(buf);
		return 0;
	}
	if (request == (unsigned int)ION_IOC_SYNC)
		return 0;	/* write-combined buffers: nothing to flush */
	return 1;	/* not ours */
}

static int ion_ioctl(int fd, unsigned int request, void *arg)
{
	int ret;

	pthread_once(&configured, configure);
	if (!arg) {
		errno = EFAULT;
		return -1;
	}
	if (legacy_abi) {
		ret = legacy_ioctl(fd, request, arg);
		if (ret <= 0)
			return ret;
	} else if (request == (unsigned int)ION_IOC_ALLOC) {
		struct ion_allocation_data *a = arg;
		int buf;

		if (alloc_buffer(fd, a->len, a->heap_id_mask, &buf))
			return -1;
		a->fd = (uint32_t)buf;
		return 0;
	} else if (request == (unsigned int)ION_IOC_HEAP_QUERY) {
		return heap_query(arg);
	} else if (request == (unsigned int)ION_IOC_ABI_VERSION) {
		*(uint32_t *)arg = 1;
		return 0;
	}
	/* ION_IOC_FREE on the new ABI lands here: ENOTTY, as on 4.12+ */
	if (request != (unsigned int)ION_IOC_FREE)
		say("ion ioctl 0x%x (nr %u, size %u) not emulated", request,
		    _IOC_NR(request), _IOC_SIZE(request));
	errno = ENOTTY;
	return -1;
}

#ifdef __BIONIC__
EXPORT int ioctl(int fd, int request, ...)
#else
EXPORT int ioctl(int fd, unsigned long request, ...)
#endif
{
	REAL(ioctl_fn, ioctl);
	va_list ap;
	void *arg;

	va_start(ap, request);
	arg = va_arg(ap, void *);
	va_end(ap);

	if (_IOC_TYPE((unsigned int)request) == ION_MAGIC && is_ion_fd(fd))
		return ion_ioctl(fd, (unsigned int)request, arg);
	return real_ioctl(fd, (int)request, arg);
}
