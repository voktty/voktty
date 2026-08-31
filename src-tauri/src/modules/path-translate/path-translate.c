/*
 * libvoktty-path-translate.so
 *
 * LD_PRELOAD library that intercepts file system calls and translates
 * /data/data/com.termux/files -> /data/data/app.voktty.voktty/files
 *
 * This allows Termux bootstrap binaries (which have hardcoded com.termux
 * paths) to work correctly in the Voktty Android app.
 *
 * Compile:
 *   aarch64-linux-android28-clang -shared -fPIC -O2 -o libvoktty-path-translate.so path-translate.c -ldl
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <string.h>
#include <stdarg.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/vfs.h>
#include <dirent.h>
#include <unistd.h>
#include <errno.h>

/* Path translation */
#define OLD_PREFIX "/data/data/com.termux"
#define NEW_PREFIX "/data/data/app.voktty.voktty"
#define OLD_LEN (sizeof(OLD_PREFIX) - 1)  /* 21 */
#define NEW_LEN (sizeof(NEW_PREFIX) - 1)  /* 27 */

/* Thread-local buffers for translated paths.
 * Two buffers are needed because functions like rename(old, new)
 * call translate() twice - if both used the same buffer, the second
 * call would overwrite the first result. */
static __thread char g_buf1[4096];
static __thread char g_buf2[4096];
static __thread int g_buf_idx = 0;

static const char *translate(const char *path) {
    if (!path) return path;
    if (strncmp(path, OLD_PREFIX, OLD_LEN) != 0) return path;
    /* Only translate if followed by '/', '\0', or end of string */
    char next = path[OLD_LEN];
    if (next != '/' && next != '\0') return path;

    /* Alternate between two buffers so rename(old,new) works */
    char *buf = (g_buf_idx++ & 1) ? g_buf2 : g_buf1;
    memcpy(buf, NEW_PREFIX, NEW_LEN);
    strcpy(buf + NEW_LEN, path + OLD_LEN);
    return buf;
}

/* -- open / open64 ------------------------------------------ */

typedef int (*open_fn)(const char *, int, ...);

int open(const char *pathname, int flags, ...) {
    static open_fn real = NULL;
    if (!real) real = (open_fn)dlsym(RTLD_NEXT, "open");

    pathname = translate(pathname);

    if (flags & (O_CREAT | O_TMPFILE)) {
        va_list args;
        va_start(args, flags);
        mode_t mode = va_arg(args, mode_t);
        va_end(args);
        return real(pathname, flags, mode);
    }
    return real(pathname, flags);
}

int open64(const char *pathname, int flags, ...) {
    static open_fn real = NULL;
    if (!real) real = (open_fn)dlsym(RTLD_NEXT, "open64");

    pathname = translate(pathname);

    if (flags & (O_CREAT | O_TMPFILE)) {
        va_list args;
        va_start(args, flags);
        mode_t mode = va_arg(args, mode_t);
        va_end(args);
        return real(pathname, flags, mode);
    }
    return real(pathname, flags);
}

/* -- openat / openat64 -------------------------------------- */

typedef int (*openat_fn)(int, const char *, int, ...);

int openat(int dirfd, const char *pathname, int flags, ...) {
    static openat_fn real = NULL;
    if (!real) real = (openat_fn)dlsym(RTLD_NEXT, "openat");

    pathname = translate(pathname);

    if (flags & (O_CREAT | O_TMPFILE)) {
        va_list args;
        va_start(args, flags);
        mode_t mode = va_arg(args, mode_t);
        va_end(args);
        return real(dirfd, pathname, flags, mode);
    }
    return real(dirfd, pathname, flags);
}

int openat64(int dirfd, const char *pathname, int flags, ...) {
    static openat_fn real = NULL;
    if (!real) real = (openat_fn)dlsym(RTLD_NEXT, "openat64");

    pathname = translate(pathname);

    if (flags & (O_CREAT | O_TMPFILE)) {
        va_list args;
        va_start(args, flags);
        mode_t mode = va_arg(args, mode_t);
        va_end(args);
        return real(dirfd, pathname, flags, mode);
    }
    return real(dirfd, pathname, flags);
}

/* -- access / faccessat ------------------------------------- */

int access(const char *pathname, int mode) {
    typedef int (*fn)(const char *, int);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "access");
    return real(translate(pathname), mode);
}

int faccessat(int dirfd, const char *pathname, int mode, int flags) {
    typedef int (*fn)(int, const char *, int, int);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "faccessat");
    return real(dirfd, translate(pathname), mode, flags);
}

/* -- stat / lstat / fstatat --------------------------------- */

int stat(const char *pathname, struct stat *buf) {
    typedef int (*fn)(const char *, struct stat *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "stat");
    return real(translate(pathname), buf);
}

int stat64(const char *pathname, struct stat64 *buf) {
    typedef int (*fn)(const char *, struct stat64 *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "stat64");
    return real(translate(pathname), buf);
}

int lstat(const char *pathname, struct stat *buf) {
    typedef int (*fn)(const char *, struct stat *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "lstat");
    return real(translate(pathname), buf);
}

int lstat64(const char *pathname, struct stat64 *buf) {
    typedef int (*fn)(const char *, struct stat64 *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "lstat64");
    return real(translate(pathname), buf);
}

int fstatat(int dirfd, const char *pathname, struct stat *buf, int flags) {
    typedef int (*fn)(int, const char *, struct stat *, int);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "fstatat");
    return real(dirfd, translate(pathname), buf, flags);
}

/* -- opendir / opendir64 ------------------------------------ */

DIR *opendir(const char *name) {
    typedef DIR *(*fn)(const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "opendir");
    return real(translate(name));
}

DIR *opendir64(const char *name) {
    typedef DIR *(*fn)(const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "opendir64");
    return real(translate(name));
}

/* -- readlink / readlinkat ---------------------------------- */

ssize_t readlink(const char *pathname, char *buf, size_t bufsiz) {
    typedef ssize_t (*fn)(const char *, char *, size_t);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "readlink");

    const char *translated = translate(pathname);
    ssize_t ret = real(translated, buf, bufsiz);

    /* If the symlink target contains com.termux, translate it back in the result */
    if (ret > 0 && ret < (ssize_t)bufsiz) {
        buf[ret] = '\0';
        if (strncmp(buf, OLD_PREFIX, OLD_LEN) == 0) {
            /* Translate the target path in the buffer */
            char tmp[4096];
            memcpy(tmp, NEW_PREFIX, NEW_LEN);
            strcpy(tmp + NEW_LEN, buf + OLD_LEN);
            size_t new_len = strlen(tmp);
            if (new_len < bufsiz) {
                memcpy(buf, tmp, new_len);
                ret = new_len;
            }
        }
    }
    return ret;
}

ssize_t readlinkat(int dirfd, const char *pathname, char *buf, size_t bufsiz) {
    typedef ssize_t (*fn)(int, const char *, char *, size_t);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "readlinkat");
    return real(dirfd, translate(pathname), buf, bufsiz);
}

/* -- realpath ----------------------------------------------- */

char *realpath(const char *path, char *resolved) {
    typedef char *(*fn)(const char *, char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "realpath");
    return real(translate(path), resolved);
}

/* -- execve / execvp / execvpe ------------------------------ */
/* Translate paths for exec, AND handle script shebangs.
 *
 * When executing a script, the kernel reads the #! shebang line internally
 * and tries to exec the interpreter path. But the kernel doesn't go through
 * LD_PRELOAD, so it can't translate com.termux paths. SELinux blocks access
 * to /data/data/com.termux/ -> EACCES.
 *
 * Fix: detect scripts manually, translate the interpreter, exec it directly. */

int execve(const char *pathname, char *const argv[], char *const envp[]) {
    typedef int (*fn)(const char *, char *const[], char *const[]);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "execve");

    const char *translated = translate(pathname);

    /* Check if it's a script (starts with #!) */
    int fd = open(translated, O_RDONLY);
    if (fd >= 0) {
        char buf[512];
        memset(buf, 0, sizeof(buf));
        int n = read(fd, buf, sizeof(buf) - 1);
        close(fd);

        if (n >= 2 && buf[0] == '#' && buf[1] == '!') {
            /* Parse shebang: #!/path/to/interpreter [optional-arg] */
            char *p = buf + 2;
            while (*p == ' ' || *p == '\t') p++;

            /* Find end of interpreter path */
            char *interp = p;
            while (*p && *p != ' ' && *p != '\t' && *p != '\n') p++;

            char *shebang_arg = NULL;
            if (*p && *p != '\n') {
                *p++ = '\0';
                /* Skip spaces */
                while (*p == ' ' || *p == '\t') p++;
                if (*p && *p != '\n') {
                    shebang_arg = p;
                    /* Find end of optional arg */
                    while (*p && *p != '\n') p++;
                    *p = '\0';
                }
            } else {
                *p = '\0';
            }

            /* Translate interpreter path */
            const char *tinterp = translate(interp);

            /* Count original argv entries */
            int argc = 0;
            if (argv) {
                while (argv[argc]) argc++;
            }

            /* Build new argv: [interpreter, shebang_arg?, script_path, argv[1:]] */
            int extra = shebang_arg ? 3 : 2;
            char **new_argv = (char **)malloc(sizeof(char *) * (argc + extra));
            if (!new_argv) {
                errno = ENOMEM;
                return -1;
            }

            int idx = 0;
            new_argv[idx++] = (char *)tinterp;
            if (shebang_arg) new_argv[idx++] = shebang_arg;
            new_argv[idx++] = (char *)translated;
            /* Copy argv[1:] (skip argv[0] which is the original command name) */
            for (int i = 1; i < argc; i++) {
                new_argv[idx++] = argv[i];
            }
            new_argv[idx] = NULL;

            int ret = real(tinterp, new_argv, envp);
            free(new_argv);
            return ret;
        }
    }

    /* ELF binary or unreadable - normal execve */
    return real(translated, argv, envp);
}

/* -- chdir -------------------------------------------------- */
/* apt calls chdir("/data/data/com.termux/files/usr/tmp/") before
 * exec-ing method binaries. Without this intercept, chdir fails
 * with EACCES and apt's child exits with code 100. */

int chdir(const char *path) {
    typedef int (*fn)(const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "chdir");
    return real(translate(path));
}

/* -- mkdir / mkdirat ---------------------------------------- */

int mkdir(const char *pathname, mode_t mode) {
    typedef int (*fn)(const char *, mode_t);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "mkdir");
    return real(translate(pathname), mode);
}

int mkdirat(int dirfd, const char *pathname, mode_t mode) {
    typedef int (*fn)(int, const char *, mode_t);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "mkdirat");
    return real(dirfd, translate(pathname), mode);
}

/* -- rmdir -------------------------------------------------- */

int rmdir(const char *pathname) {
    typedef int (*fn)(const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "rmdir");
    return real(translate(pathname));
}

/* -- unlink / unlinkat -------------------------------------- */

int unlink(const char *pathname) {
    typedef int (*fn)(const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "unlink");
    return real(translate(pathname));
}

int unlinkat(int dirfd, const char *pathname, int flags) {
    typedef int (*fn)(int, const char *, int);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "unlinkat");
    return real(dirfd, translate(pathname), flags);
}

/* -- rename / renameat -------------------------------------- */

int rename(const char *oldpath, const char *newpath) {
    typedef int (*fn)(const char *, const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "rename");
    return real(translate(oldpath), translate(newpath));
}

int renameat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath) {
    typedef int (*fn)(int, const char *, int, const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "renameat");
    return real(olddirfd, translate(oldpath), newdirfd, translate(newpath));
}

/* -- chmod / fchmodat --------------------------------------- */

int chmod(const char *pathname, mode_t mode) {
    typedef int (*fn)(const char *, mode_t);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "chmod");
    return real(translate(pathname), mode);
}

int fchmodat(int dirfd, const char *pathname, mode_t mode, int flags) {
    typedef int (*fn)(int, const char *, mode_t, int);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "fchmodat");
    return real(dirfd, translate(pathname), mode, flags);
}

/* -- symlink / symlinkat ------------------------------------ */

int symlink(const char *target, const char *linkpath) {
    typedef int (*fn)(const char *, const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "symlink");
    return real(translate(target), translate(linkpath));
}

int symlinkat(const char *target, int dirfd, const char *linkpath) {
    typedef int (*fn)(const char *, int, const char *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "symlinkat");
    return real(translate(target), dirfd, translate(linkpath));
}

/* -- utimes / utimensat / futimesat ------------------------- */
/* apt calls utimes() on downloaded files to set modification time */

int utimes(const char *filename, const struct timeval times[2]) {
    typedef int (*fn)(const char *, const struct timeval[2]);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "utimes");
    return real(translate(filename), times);
}

int utimensat(int dirfd, const char *pathname, const struct timespec times[2], int flags) {
    typedef int (*fn)(int, const char *, const struct timespec[2], int);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "utimensat");
    return real(dirfd, translate(pathname), times, flags);
}

int futimesat(int dirfd, const char *pathname, const struct timeval times[2]) {
    typedef int (*fn)(int, const char *, const struct timeval[2]);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "futimesat");
    return real(dirfd, translate(pathname), times);
}

/* -- statvfs / statfs --------------------------------------- */
/* apt calls statvfs() to check free space before downloading packages.
 * Without intercept, /data/data/com.termux/cache/ -> EACCES -> apt fails. */

int statvfs(const char *path, struct statvfs *buf) {
    typedef int (*fn)(const char *, struct statvfs *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "statvfs");
    return real(translate(path), buf);
}

int statfs(const char *path, struct statfs *buf) {
    typedef int (*fn)(const char *, struct statfs *);
    static fn real = NULL;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "statfs");
    return real(translate(path), buf);
}
