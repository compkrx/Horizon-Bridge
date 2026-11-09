"""Per-job filesystem policy inside the disconnected Linux processing container."""

import ctypes
import os
import platform
from pathlib import Path


class PathRule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('access', ctypes.c_uint64), ('fd', ctypes.c_int32)]


def process_private():
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(4, 0, 0, 0, 0) != 0:  # PR_SET_DUMPABLE
        raise OSError(ctypes.get_errno(), 'Could not protect processor file descriptors')


def restrict(workspace: Path):
    if platform.system() != 'Linux' or platform.machine() not in {'x86_64', 'aarch64'}:
        raise OSError('The production sandbox requires Linux x86-64 or ARM64.')
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long

    def syscall(number, *args):
        result = libc.syscall(number, *args)
        if result < 0:
            raise OSError(ctypes.get_errno(), f'Landlock operation {number} failed')
        return result

    if syscall(444, None, 0, 1) < 3:
        raise OSError('The production sandbox requires Landlock ABI 3 or later.')
    handled = ctypes.c_uint64((1 << 15) - 1)
    readonly = (1 << 0) | (1 << 2) | (1 << 3)
    writable = handled.value & ~((1 << 6) | (1 << 9) | (1 << 10) | (1 << 11) | (1 << 12))
    ruleset = syscall(444, ctypes.byref(handled), ctypes.sizeof(handled), 0)
    try:
        read_dirs = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/opt', '/app', '/proc', '/sys']
        allowed = [(p, readonly) for p in read_dirs if Path(p).is_dir()]
        allowed += [(p, (1 << 1) | (1 << 2)) for p in ['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom']]
        allowed.append((str(workspace), writable))
        for path, access in allowed:
            fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                syscall(445, ruleset, 1, ctypes.byref(PathRule(access, fd)), 0)
            finally:
                os.close(fd)
        if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
            raise OSError(ctypes.get_errno(), 'Could not set no_new_privs')
        syscall(446, ruleset, 0)
    finally:
        os.close(ruleset)
