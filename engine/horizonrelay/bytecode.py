"""Read JVM class files and decode a bounded, integer-only instruction IR."""

from __future__ import annotations

from dataclasses import dataclass
from struct import Struct

_U2 = Struct(">H")
_U4 = Struct(">I")
_I4 = Struct(">i")
MAX_CLASS_MAJOR = 70  # Java 26, JVMS table 4.1-A.
MAX_METHOD_CODE = 512
ACC_STATIC = 0x0008
_ANNOTATION_ATTRS = {"RuntimeVisibleAnnotations", "RuntimeInvisibleAnnotations"}


class Reader:
    def __init__(self, data: bytes | memoryview) -> None:
        self.data = memoryview(data)
        self.pos = 0

    def read(self, count: int) -> memoryview:
        end = self.pos + count
        if end > len(self.data):
            raise ValueError("Truncated class-file structure.")
        result = self.data[self.pos:end]
        self.pos = end
        return result

    def u1(self) -> int:
        return self.read(1)[0]

    def u2(self) -> int:
        return _U2.unpack(self.read(2))[0]

    def u4(self) -> int:
        return _U4.unpack(self.read(4))[0]

    def end(self) -> None:
        if self.pos != len(self.data):
            raise ValueError("Unexpected bytes in class-file structure.")


@dataclass(frozen=True)
class Method:
    name: str
    descriptor: str
    flags: int
    stack: int = 0
    locals: int = 0
    code: bytes | None = None
    exceptions: int = 0


@dataclass(frozen=True)
class ClassFile:
    name: str
    superclass: str
    interfaces: tuple[str, ...]
    flags: int
    major: int
    minor: int
    pool: tuple[tuple | None, ...]
    field_count: int
    methods: tuple[Method, ...]
    annotations: dict[str, str | None]
    references: frozenset[str]


def _modified_utf8(data: memoryview) -> str:
    try:
        raw = bytes(data)
        if b"\0" in raw or any(value >= 0xF0 for value in raw):
            raise UnicodeError
        decoded = raw.replace(b"\xc0\x80", b"\0").decode("utf-8", "surrogatepass")
        return decoded.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")
    except UnicodeError as error:
        raise ValueError("Invalid modified UTF-8 in constant pool.") from error


def _pool(reader: Reader) -> tuple[tuple | None, ...]:
    count = reader.u2()
    if count == 0:
        raise ValueError("Invalid constant pool size.")
    pool: list[tuple | None] = [None]
    while len(pool) < count:
        tag = reader.u1()
        if tag == 1:
            pool.append((tag, _modified_utf8(reader.read(reader.u2()))))
        elif tag == 3:
            pool.append((tag, _I4.unpack(reader.read(4))[0]))
        elif tag == 4:
            pool.append((tag, reader.u4()))
        elif tag in {5, 6}:
            pool.extend([(tag, bytes(reader.read(8))), None])
        elif tag in {7, 8, 16, 19, 20}:
            pool.append((tag, reader.u2()))
        elif tag in {9, 10, 11, 12, 17, 18}:
            pool.append((tag, reader.u2(), reader.u2()))
        elif tag == 15:
            pool.append((tag, reader.u1(), reader.u2()))
        else:
            raise ValueError(f"Unknown constant pool tag {tag}.")
    if len(pool) != count:
        raise ValueError("Invalid constant pool alignment.")
    return tuple(pool)


def constant(pool: tuple[tuple | None, ...], index: int, *tags: int) -> tuple:
    value = pool[index] if 0 < index < len(pool) else None
    if value is None or value[0] not in tags:
        raise ValueError("Invalid constant pool reference.")
    return value


def _utf(pool: tuple[tuple | None, ...], index: int) -> str:
    return constant(pool, index, 1)[1]


def _class_name(pool: tuple[tuple | None, ...], index: int) -> str:
    return _utf(pool, constant(pool, index, 7)[1])


def _member_ref(pool: tuple[tuple | None, ...], index: int, tag: int) -> tuple[str, str, str]:
    _, owner_index, name_and_type = constant(pool, index, tag)
    _, name_index, type_index = constant(pool, name_and_type, 12)
    return _class_name(pool, owner_index), _utf(pool, name_index), _utf(pool, type_index)


def _attributes(reader: Reader, pool: tuple[tuple | None, ...]):
    for _ in range(reader.u2()):
        name = _utf(pool, reader.u2())
        yield name, reader.read(reader.u4())


def _read_method(reader: Reader, pool: tuple[tuple | None, ...]) -> Method:
    flags = reader.u2()
    name = _utf(pool, reader.u2())
    descriptor = _utf(pool, reader.u2())
    method = Method(name, descriptor, flags)
    for attribute, content in _attributes(reader, pool):
        if attribute != "Code":
            continue
        if method.code is not None:
            raise ValueError("Duplicate method Code attribute.")
        code_reader = Reader(content)
        stack, locals_ = code_reader.u2(), code_reader.u2()
        count = code_reader.u4()
        if not 0 < count < 65536:
            raise ValueError("Invalid JVM Code length.")
        code = bytes(code_reader.read(count))
        exceptions = code_reader.u2()
        code_reader.read(exceptions * 8)
        for _ in _attributes(code_reader, pool):
            pass
        code_reader.end()
        method = Method(name, descriptor, flags, stack, locals_, code, exceptions)
    return method


def _read_annotation(reader: Reader, pool: tuple[tuple | None, ...], depth: int):
    name = _utf(pool, reader.u2())
    data: dict[str, str | None] = {}
    for _ in range(reader.u2()):
        key = _utf(pool, reader.u2())
        data[key] = _read_element(reader, pool, depth)
    return name, data.get("value")


def _read_element(reader: Reader, pool: tuple[tuple | None, ...], depth: int) -> str | None:
    if depth > 16:
        raise ValueError("Class annotation exceeds the nesting limit.")
    tag = chr(reader.u1())
    if tag == "s":
        return _utf(pool, reader.u2())
    if tag in "BCDFIJSZc":
        reader.read(2)
    elif tag == "e":
        reader.read(4)
    elif tag == "@":
        _read_annotation(reader, pool, depth + 1)
    elif tag == "[":
        for _ in range(reader.u2()):
            _read_element(reader, pool, depth + 1)
    else:
        raise ValueError("Unknown class annotation element type.")
    return None


def read_class(data: bytes) -> ClassFile:
    reader = Reader(data)
    if reader.u4() != 0xCAFEBABE:
        raise ValueError("Invalid class-file magic.")
    minor, major = reader.u2(), reader.u2()
    if major < 45:
        raise ValueError("Invalid JVM class-file version.")
    pool = _pool(reader)
    flags = reader.u2()
    name = _class_name(pool, reader.u2())
    parent = reader.u2()
    superclass = _class_name(pool, parent) if parent else ""
    interfaces = tuple(_class_name(pool, reader.u2()) for _ in range(reader.u2()))
    fields = reader.u2()
    for _ in range(fields):
        reader.read(2)
        _utf(pool, reader.u2())
        _utf(pool, reader.u2())
        for _ in _attributes(reader, pool):
            pass
    methods = tuple(_read_method(reader, pool) for _ in range(reader.u2()))
    annotations: dict[str, str | None] = {}
    for attribute, content in _attributes(reader, pool):
        if attribute in _ANNOTATION_ATTRS:
            annotation_reader = Reader(content)
            for _ in range(annotation_reader.u2()):
                key, value = _read_annotation(annotation_reader, pool, 0)
                annotations[key] = value
            annotation_reader.end()
    reader.end()
    references = frozenset(
        _utf(pool, item[1])
        for item in pool
        if item is not None and item[0] == 7
    )
    return ClassFile(name, superclass, interfaces, flags, major, minor, pool, fields, methods, annotations, references)


def exact_fabric_client_message(cls: ClassFile) -> str | None:
    """Recognize one closed-world Fabric entrypoint without executing bytecode."""
    if (
        cls.major > MAX_CLASS_MAJOR
        or cls.minor == 65535
        or not cls.flags & 1
        or cls.flags & (0x0200 | 0x0400)
        or cls.superclass != "java/lang/Object"
        or cls.interfaces != ("net/fabricmc/api/ClientModInitializer",)
        or cls.field_count
        or cls.annotations
        or len(cls.methods) != 2
    ):
        return None
    methods = {method.name: method for method in cls.methods}
    constructor, main = methods.get("<init>"), methods.get("onInitializeClient")
    if any(
        method is None or method.descriptor != "()V" or method.flags != 1 or method.exceptions
        or method.locals != 1 or method.code is None
        for method in (constructor, main)
    ):
        return None
    if constructor.stack < 1 or main.stack < 2:
        return None
    init_code, code = constructor.code, main.code
    if len(init_code) != 5 or init_code[:2] != b"\x2a\xb7" or init_code[-1] != 0xB1:
        return None
    if len(code) not in {9, 10} or code[0] != 0xB2 or code[-4] != 0xB6 or code[-1] != 0xB1:
        return None
    if (len(code), code[3]) not in {(9, 0x12), (10, 0x13)}:
        return None
    try:
        if _member_ref(cls.pool, int.from_bytes(init_code[2:4]), 10) != ("java/lang/Object", "<init>", "()V"):
            return None
        if _member_ref(cls.pool, int.from_bytes(code[1:3]), 9) != ("java/lang/System", "out", "Ljava/io/PrintStream;"):
            return None
        if _member_ref(cls.pool, int.from_bytes(code[-3:-1]), 10) != (
            "java/io/PrintStream", "println", "(Ljava/lang/String;)V"
        ):
            return None
        message = _utf(cls.pool, constant(cls.pool, int.from_bytes(code[4:-4]), 8)[1])
        if len(message) <= 256 and all(char.isprintable() for char in message):
            return message
    except ValueError:
        return None
    return None


_INT_BINOP = {
    0x60: "add", 0x64: "sub", 0x68: "mul",
    0x78: "shl", 0x7A: "shr", 0x7C: "ushr",
    0x7E: "and", 0x80: "or", 0x82: "xor",
}
_INT_UNOP = {0x74: "neg", 0x91: "narrow_byte", 0x92: "narrow_char", 0x93: "narrow_short"}
_COMPARISONS = ("eq", "ne", "lt", "ge", "gt", "le")
_INT_MATH = {("abs", "(I)I"), ("min", "(II)I"), ("max", "(II)I")}
INT_TYPES = {"I": "i32", "B": "i8", "S": "i16", "C": "u16", "Z": "bool"}


def integer_method(cls: ClassFile, method: Method) -> dict:
    """Return JSON-compatible IR or a reason for leaving this body for manual porting."""
    result = {
        "name": method.name[:160].encode("utf-8", "backslashreplace").decode("utf-8"),
        "descriptor": method.descriptor[:240].encode("utf-8", "backslashreplace").decode("utf-8"),
    }
    try:
        if result["name"] != method.name or result["descriptor"] != method.descriptor:
            raise ValueError("JVM method signature is too long or contains unsupported characters.")
        if cls.major > MAX_CLASS_MAJOR or cls.minor == 65535:
            raise ValueError("Class uses a newer JVM format or Java preview features.")
        if not method.flags & ACC_STATIC or method.flags & 0x0020:
            raise ValueError("Instance or synchronized methods require manual translation.")
        if method.name.startswith("<") or method.code is None or method.exceptions:
            raise ValueError("Initializers, native methods, and exception handlers require manual translation.")
        parameters, separator, returns = method.descriptor.removeprefix("(").partition(")")
        if (
            not method.descriptor.startswith("(") or not separator
            or returns not in INT_TYPES or any(kind not in INT_TYPES for kind in parameters)
        ):
            raise ValueError("Only primitive int, byte, short, char and boolean signatures are lowered.")
        if len(method.code) > MAX_METHOD_CODE or method.locals > 32 or method.stack > 32:
            raise ValueError("Method exceeds the translation size or complexity limits.")
        return {
            **result, "params": parameters, "returns": returns, "locals": method.locals,
            "stack": method.stack, "instructions": _decode_integer(cls.pool, method.code),
        }
    except ValueError as error:
        return {**result, "reason": str(error)}


def _decode_integer(pool: tuple[tuple | None, ...], code: bytes) -> list[list]:
    reader = Reader(code)
    instructions = []
    while reader.pos < len(code):
        offset = reader.pos
        opcode = reader.u1()
        if opcode == 0:
            instruction = ["nop"]
        elif 0x02 <= opcode <= 0x08:
            instruction = ["const", opcode - 0x03]
        elif opcode in {0x10, 0x11}:
            instruction = ["const", int.from_bytes(reader.read(opcode - 0x0F), signed=True)]
        elif opcode in {0x12, 0x13}:
            index = int.from_bytes(reader.read(opcode - 0x11))
            instruction = ["const", constant(pool, index, 3)[1]]
        elif opcode in {0x15, 0x36}:
            instruction = ["load" if opcode == 0x15 else "store", reader.u1()]
        elif 0x1A <= opcode <= 0x1D:
            instruction = ["load", opcode - 0x1A]
        elif 0x3B <= opcode <= 0x3E:
            instruction = ["store", opcode - 0x3B]
        elif opcode in _INT_BINOP:
            instruction = [_INT_BINOP[opcode]]
        elif opcode in _INT_UNOP:
            instruction = [_INT_UNOP[opcode]]
        elif opcode == 0x84:
            instruction = ["increment", reader.u1(), int.from_bytes(reader.read(1), signed=True)]
        elif 0x99 <= opcode <= 0xA4:
            cmp = _COMPARISONS[(opcode - 0x99) % 6]
            instruction = ["if", cmp, opcode >= 0x9F, offset + int.from_bytes(reader.read(2), signed=True)]
        elif opcode in {0xA7, 0xC8}:
            instruction = ["goto", offset + int.from_bytes(reader.read(2 if opcode == 0xA7 else 4), signed=True)]
        elif opcode == 0xAC:
            instruction = ["return"]
        elif opcode == 0xB8:
            owner, name, descriptor = _member_ref(pool, reader.u2(), 10)
            if owner != "java/lang/Math" or (name, descriptor) not in _INT_MATH:
                raise ValueError("Method invokes Java or game behavior outside the verified Math subset.")
            instruction = [name]
        elif opcode in {0x57, 0x59}:
            instruction = ["pop" if opcode == 0x57 else "dup"]
        else:
            raise ValueError(f"Unsupported JVM instruction 0x{opcode:02x} at byte offset {offset}.")
        instructions.append([offset, *instruction])
    return instructions
