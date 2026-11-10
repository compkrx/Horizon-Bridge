"""Bounded read-only access to untrusted JAR members."""

from __future__ import annotations

import re
import stat
import unicodedata
import zipfile
import zlib
from contextlib import contextmanager
from pathlib import Path
from struct import Struct
from typing import BinaryIO, Iterator

MAX_UPLOAD = 32 * 1024 * 1024
MAX_EXPANDED = 96 * 1024 * 1024
MAX_ENTRY = 16 * 1024 * 1024
MAX_ENTRIES = 10_000
_CHUNK = 64 * 1024
_DEVICE = re.compile(r"^(con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)", re.I)
_BAD_CHAR = re.compile(r'[\x00-\x1f\x7f\\:<>"|?*]')
_ZIP_ERRORS = (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error)
_EOCD = Struct("<4s4H2LH")
_LOCAL_HEADER = Struct("<4s5H3I2H")


def _parts(info: zipfile.ZipInfo) -> list[str]:
    raw = info.orig_filename
    name = raw[:-1] if info.is_dir() else raw
    parts = name.split("/")
    if (
        len(raw) > 400
        or len(parts) > 32
        or any(
            part in {"", ".", ".."}
            or len(part) > 150
            or part.endswith((" ", "."))
            or _BAD_CHAR.search(part)
            or _DEVICE.match(part)
            for part in parts
        )
    ):
        raise ValueError("Archive contains an unsafe member path.")
    return parts


class JarArchive:
    def __init__(self, handle: zipfile.ZipFile, stream: BinaryIO, expected_count: int) -> None:
        self._zip = handle
        self._stream = stream
        self._files: dict[str, zipfile.ZipInfo] = {}
        members = handle.infolist()
        if len(members) != expected_count:
            raise ValueError("Archive entry count does not match the directory record.")
        nodes: dict[str, tuple[str, str]] = {}
        expanded = 0
        for info in members:
            parts = _parts(info)
            expanded += info.file_size
            mode = stat.S_IFMT(info.external_attr >> 16) if info.create_system == 3 else 0
            if mode not in {0, stat.S_IFDIR if info.is_dir() else stat.S_IFREG}:
                raise ValueError("Archive contains a link or special file.")
            if info.flag_bits & 0x41:
                raise ValueError("Encrypted archive members are unsupported.")
            if info.compress_type not in {zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED}:
                raise ValueError("Archive uses an unsupported compression method.")
            if (
                expanded > MAX_EXPANDED
                or info.file_size > MAX_ENTRY
                or (info.is_dir() and info.file_size != 0)
                or (info.file_size > 1024 * 1024 and info.file_size > 250 * max(1, info.compress_size))
            ):
                raise ValueError("Archive exceeds the expanded size or compression safety limits.")

            for depth in range(1, len(parts) + 1):
                path = "/".join(parts[:depth])
                key = unicodedata.normalize("NFC", path).casefold()
                kind = "parent" if depth != len(parts) else "directory" if info.is_dir() else "file"
                if key in nodes:
                    previous, previous_kind = nodes[key]
                    if previous != path or "file" in {kind, previous_kind} or kind == previous_kind == "directory":
                        raise ValueError("Archive contains duplicate or conflicting member paths.")
                    if kind == "parent":
                        continue
                nodes[key] = (path, kind)

            if not info.is_dir():
                self._files[info.filename] = info
        self.expanded_size = expanded
        self._members = members

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(self._files)

    def size(self, name: str) -> int:
        return self._files[name].file_size

    def verify(self) -> None:
        """Check the actual compressed streams, including bytes beyond a forged declared size."""
        for info in self._members:
            # ZipFile checks local member names and overlap, then bounds reads by the declared size.
            # Independently verify stream termination before passing the original JAR to other parsers.
            with self._zip.open(info):
                pass
            self._stream.seek(info.header_offset)
            header = self._stream.read(_LOCAL_HEADER.size)
            if len(header) != _LOCAL_HEADER.size:
                raise ValueError("Archive member header is truncated.")
            _, _, flags, method, _, _, crc, compressed, expanded, name_length, extra_length = _LOCAL_HEADER.unpack(header)
            if flags != info.flag_bits or method != info.compress_type or (
                not flags & 8 and (
                    crc != info.CRC or compressed not in {0xFFFFFFFF, info.compress_size}
                    or expanded not in {0xFFFFFFFF, info.file_size}
                )
            ):
                raise ValueError("Archive member headers disagree.")
            self._stream.seek(name_length + extra_length, 1)
            self._verify_stream(info)

    def _verify_stream(self, info: zipfile.ZipInfo) -> None:
        observed = 0
        crc = 0
        remaining = info.compress_size
        decoder = zlib.decompressobj(-zlib.MAX_WBITS) if info.compress_type == zipfile.ZIP_DEFLATED else None
        while remaining:
            chunk = self._stream.read(min(_CHUNK, remaining))
            if not chunk:
                raise ValueError("Archive member stream is truncated.")
            remaining -= len(chunk)
            if decoder is None:
                observed += len(chunk)
                crc = zlib.crc32(chunk, crc)
            else:
                while True:
                    budget = min(_CHUNK, info.file_size - observed + 1)
                    expanded = decoder.decompress(chunk, budget)
                    observed += len(expanded)
                    crc = zlib.crc32(expanded, crc)
                    if observed > info.file_size:
                        raise ValueError("Archive member exceeds its declared size.")
                    if decoder.unused_data or (decoder.eof and remaining):
                        raise ValueError("Archive member contains trailing compressed bytes.")
                    chunk = decoder.unconsumed_tail
                    if not chunk and len(expanded) < budget:
                        break
            if observed > info.file_size:
                raise ValueError("Archive member exceeds its declared size.")
        if decoder is not None and not decoder.eof:
            raise ValueError("Archive member has an incomplete DEFLATE stream.")
        if observed != info.file_size:
            raise ValueError("Archive member does not match its declared size.")
        if crc != info.CRC:
            raise ValueError("Archive member failed its integrity check.")

    def read(self, name: str, *, limit: int = MAX_ENTRY) -> bytes:
        info = self._files[name]
        if info.file_size > limit:
            raise ValueError("Archive member is larger than the parser limit.")
        with self._zip.open(info) as stream:
            data = stream.read(limit + 1)
        if len(data) != info.file_size:
            raise ValueError("Archive member does not match its declared size.")
        return data


def _entry_count(stream: BinaryIO, size: int, kind: str) -> int:
    """Bound the central directory before ZipFile constructs its index."""
    stream.seek(max(0, size - 65535 - _EOCD.size))
    tail = stream.read()
    position = tail.rfind(b"PK\x05\x06")
    if position < 0 or len(tail) - position < _EOCD.size:
        raise ValueError(f"The {kind} has no readable ZIP directory.")
    _, disk, start_disk, count_disk, count, directory_size, directory_offset, comment_size = _EOCD.unpack_from(tail, position)
    if (
        disk or start_disk or count != count_disk or not 1 <= count <= MAX_ENTRIES
        or directory_size > 4 * 1024 * 1024 or directory_size < 46 * count
        or directory_offset + directory_size > size - _EOCD.size
        or len(tail) - position != _EOCD.size + comment_size
    ):
        raise ValueError(f"The {kind} has an invalid or excessive ZIP directory.")
    return count


@contextmanager
def open_jar(path: Path, *, verify: bool = True, kind: str = "JAR") -> Iterator[JarArchive]:
    try:
        size = path.stat().st_size
        if size > MAX_UPLOAD:
            raise ValueError(f"{kind} exceeds the 32 MiB upload limit.")
        with path.open("rb") as stream:
            if stream.read(4) != b"PK\x03\x04":
                raise ValueError(f"The input is not a {kind} archive.")
            expected_count = _entry_count(stream, size, kind)
            with zipfile.ZipFile(stream) as archive:
                jar = JarArchive(archive, stream, expected_count)
                if verify:
                    jar.verify()
                yield jar
    except _ZIP_ERRORS as error:
        raise ValueError(f"The {kind} is malformed or failed its integrity check.") from error
