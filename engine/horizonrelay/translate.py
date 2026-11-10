"""Lower a checked subset of JVM integer operations to Rust source."""

from __future__ import annotations

import hashlib
import re
from collections import Counter, deque

from .bytecode import INT_TYPES

_ARITHMETIC = {
    "add": "{left}.wrapping_add({right})", "sub": "{left}.wrapping_sub({right})",
    "mul": "{left}.wrapping_mul({right})", "and": "{left} & {right}", "or": "{left} | {right}",
    "xor": "{left} ^ {right}", "shl": "{left}.wrapping_shl({right} as u32)",
    "shr": "{left}.wrapping_shr({right} as u32)",
    "ushr": "({left} as u32).wrapping_shr({right} as u32) as i32",
    "min": "{left}.min({right})", "max": "{left}.max({right})",
    "idiv": "{left}.wrapping_div({right})", "irem": "{left}.wrapping_rem({right})",
}
_LONG_BINARY = {"ladd": "add", "lsub": "sub", "lmul": "mul", "ldiv": "idiv", "lrem": "irem"}
_FALLIBLE = {"idiv", "irem", "ldiv", "lrem"}
_UNARY = {
    "neg": "{value}.wrapping_neg()", "abs": "{value}.wrapping_abs()", "narrow_byte": "{value} as i8 as i32",
    "narrow_char": "{value} as u16 as i32", "narrow_short": "{value} as i16 as i32",
}
_COMPARISONS = {"eq": "==", "ne": "!=", "lt": "<", "ge": ">=", "gt": ">", "le": "<="}
_RETURNS = {"return", "lreturn"}
_END_BLOCK = {"if", "goto", *_RETURNS}
_LOCAL_TYPES = {"load": "I", "store": "I", "increment": "I", "lload": "J", "lstore": "J"}
_STORES = {"store", "lstore"}
_FUNCTION_LIMIT = 220
_SOURCE_LIMIT = 560 * 1024


def _blocks(instructions: list[list]) -> dict[int, list[list]]:
    offsets = {offset for offset, *_ in instructions}
    boundaries = {0}
    for index, (offset, opcode, *args) in enumerate(instructions):
        if opcode in {"if", "goto"}:
            if args[-1] not in offsets:
                raise ValueError("Branch target is outside an instruction boundary.")
            boundaries.add(args[-1])
        if opcode in _END_BLOCK and index + 1 < len(instructions):
            boundaries.add(instructions[index + 1][0])
    blocks: dict[int, list[list]] = {}
    for instruction in instructions:
        if instruction[0] in boundaries:
            block = blocks[instruction[0]] = []
        block.append(instruction)
    return blocks


def _successors(block: list[list], next_block: int | None) -> list[int]:
    _, last, *args = block[-1]
    if last in _RETURNS:
        return []
    if last == "goto":
        return [args[-1]]
    if next_block is None:
        raise ValueError("Reachable bytecode falls off the end of the method.")
    return [args[-1], next_block] if last == "if" else [next_block]


def _stack_effect(opcode: str, args: list) -> tuple[str, str]:
    if opcode in {"const", "load"}:
        return "", "I"
    if opcode in {"store", "pop", "return"}:
        return "I", ""
    if opcode in _ARITHMETIC:
        return "II", "I"
    if opcode in _UNARY:
        return "I", "I"
    if opcode == "dup":
        return "I", "II"
    if opcode == "if":
        return ("II" if args[1] else "I"), ""
    if opcode in {"lconst", "lload"}:
        return "", "J"
    if opcode in {"lstore", "lreturn"}:
        return "J", ""
    if opcode in _LONG_BINARY:
        return "JJ", "J"
    if opcode == "lcmp":
        return "JJ", "I"
    if opcode == "lneg":
        return "J", "J"
    if opcode == "i2l":
        return "I", "J"
    if opcode == "l2i":
        return "J", "I"
    return "", ""


def _slot_width(kind: str) -> int:
    return 2 if kind == "J" else 1


def _parameters(method: dict):
    slot = 0
    for kind in method["params"]:
        yield slot, kind
        slot += _slot_width(kind)


def _set_local(locals_: dict[int, str], slot: int, kind: str) -> None:
    # Writing either half of a category-2 local invalidates the previous value.
    if locals_.get(slot - 1) == "J":
        del locals_[slot - 1]
    if kind == "J":
        locals_.pop(slot + 1, None)
    locals_[slot] = kind


def _verify(method: dict, blocks: dict[int, list[list]], successors: dict[int, list[int]]) -> dict[int, str]:
    """Check the typed operand stack and definite locals across all incoming edges."""
    parameters = {slot: "J" if kind == "J" else "I" for slot, kind in _parameters(method)}
    if not blocks or any(slot + _slot_width(kind) > method["locals"] for slot, kind in parameters.items()):
        raise ValueError("Invalid method frame.")
    entries = {0: ("", parameters)}
    pending = deque([0])
    while pending:
        current = pending.popleft()
        stack, locals_in = entries[current]
        initialized = locals_in.copy()
        for _, opcode, *args in blocks[current]:
            if opcode in _LOCAL_TYPES:
                local, kind = args[0], _LOCAL_TYPES[opcode]
                if local + _slot_width(kind) > method["locals"]:
                    raise ValueError("Local variable index exceeds the method frame.")
                if opcode in _STORES:
                    _set_local(initialized, local, kind)
                elif local not in initialized:
                    raise ValueError("A local may be read before assignment.")
                elif initialized[local] != kind:
                    raise ValueError("Local variable type does not match the instruction.")
            popped, pushed = _stack_effect(opcode, args)
            if len(popped) > len(stack):
                raise ValueError("Operand stack underflow.")
            if not stack.endswith(popped):
                raise ValueError("Operand stack types do not match the instruction.")
            stack = stack[:len(stack) - len(popped)] + pushed
            if len(stack) + stack.count("J") > method["stack"]:
                raise ValueError("Operand stack exceeds the method frame.")
            if opcode in _RETURNS:
                if (method["returns"] == "J") != (opcode == "lreturn"):
                    raise ValueError("Return instruction does not match the method descriptor.")
                if stack:
                    raise ValueError("Operand stack contains additional values at return.")
        for successor in successors[current]:
            if successor in entries:
                previous_stack, previous_locals = entries[successor]
                if previous_stack != stack:
                    raise ValueError("Operand stacks disagree at a branch target.")
                merged = {slot: kind for slot, kind in previous_locals.items() if initialized.get(slot) == kind}
                if merged == previous_locals:
                    continue
            else:
                merged = initialized.copy()
            entries[successor] = stack, merged
            pending.append(successor)
    if len(entries) != len(blocks):
        raise ValueError("Unreachable bytecode requires manual review.")
    if not any(block[-1][1] in _RETURNS for block in blocks.values()):
        raise ValueError("No supported return was reachable.")
    return {entry: stack for entry, (stack, _) in entries.items()}


def _rust_name(class_name: str, method: dict) -> str:
    original = f"{class_name}.{method['name']}{method['descriptor']}"
    suffix = hashlib.sha256(original.encode("utf-8", "surrogatepass")).hexdigest()[:16]
    readable = re.sub(r"[^a-zA-Z0-9]", "_", f"{class_name.rsplit('/', 1)[-1]}_{method['name']}")[:55]
    return f"java_{readable.lower()}_{suffix}"


def _return_expression(value: str, kind: str) -> str:
    if kind == "Z":
        return f"({value} & 1) != 0"
    return value if kind in {"I", "J"} else f"{value} as {INT_TYPES[kind]}"


def _fallible(method: dict) -> bool:
    return any(opcode in _FALLIBLE for _, opcode, *_ in method["instructions"])


def _lower_block(
    block: list[list], depth: int, successors: list[int], returns: str, storage: str, fallible: bool,
) -> list[str]:
    lines = []
    wide = storage == "i64"

    def narrow(value: str) -> str:
        return f"({value} as i32)" if wide else value

    def assign_int(destination: str, expression: str) -> None:
        value = f"({expression}) as i64" if wide else expression
        lines.append(f"{destination} = {value};")

    for _, opcode, *args in block:
        top = f"stack[{depth - 1}]"
        second = f"stack[{depth - 2}]"
        if opcode in {"const", "lconst"}:
            lines.append(f"stack[{depth}] = {int(args[0])}_{storage};")
        elif opcode in {"load", "lload"}:
            lines.append(f"stack[{depth}] = locals[{args[0]}];")
        elif opcode in _STORES:
            lines.append(f"locals[{args[0]}] = {top};")
        elif opcode == "increment":
            local = f"locals[{args[0]}]"
            assign_int(local, f"{narrow(local)}.wrapping_add({args[1]}_i32)")
        elif opcode == "dup":
            lines.append(f"stack[{depth}] = {top};")
        elif opcode in _ARITHMETIC or opcode in _LONG_BINARY:
            if opcode in _FALLIBLE:
                lines.extend([
                    f"if {top} == 0 {{",
                    "    return Err(JavaArithmeticError::DivisionByZero);",
                    "}",
                ])
            if opcode in _LONG_BINARY:
                expression = _ARITHMETIC[_LONG_BINARY[opcode]].format(left=second, right=top)
                lines.append(f"{second} = {expression};")
            else:
                right = f"{top} as i32" if wide else top
                expression = _ARITHMETIC[opcode].format(left=narrow(second), right=right)
                assign_int(second, expression)
        elif opcode in _UNARY:
            assign_int(top, _UNARY[opcode].format(value=narrow(top)))
        elif opcode == "lneg":
            lines.append(f"{top} = {top}.wrapping_neg();")
        elif opcode == "lcmp":
            lines.append(f"{second} = ({second} > {top}) as i64 - ({second} < {top}) as i64;")
        elif opcode == "l2i":
            lines.append(f"{top} = {top} as i32 as i64;")
        # Integer values are already sign-extended in wide storage, so i2l leaves the slot untouched.
        elif opcode == "if":
            left, right = (second, top) if args[1] else (top, "0")
            comparison = _COMPARISONS[args[0]]
            target, fallthrough = successors
            lines.append(f"block = if {left} {comparison} {right} {{ {target} }} else {{ {fallthrough} }};")
        elif opcode in _RETURNS:
            expression = f"{top} as i32" if returns == "I" and wide else _return_expression(top, returns)
            value = f"Ok({expression})" if fallible else expression
            lines.append(f"return {value};")
        popped, pushed = _stack_effect(opcode, args)
        depth += len(pushed) - len(popped)
    if successors and block[-1][1] != "if":
        lines.append(f"block = {successors[0]};")
    return lines


def _lower_method(class_name: str, method: dict) -> tuple[str, str]:
    blocks = _blocks(method["instructions"])
    offsets = list(blocks)
    successors = {
        offset: _successors(blocks[offset], offsets[index + 1] if index + 1 < len(offsets) else None)
        for index, offset in enumerate(offsets)
    }
    stacks = _verify(method, blocks, successors)
    name = _rust_name(class_name, method)
    signature = ", ".join(f"arg_{index}: {INT_TYPES[kind]}" for index, kind in enumerate(method["params"]))
    long_used = "J" in method["params"] or any(
        any("J" in kinds for kinds in _stack_effect(opcode, args))
        for _, opcode, *args in method["instructions"]
    )
    storage = "i64" if long_used else "i32"
    fallible = _fallible(method)
    return_type = INT_TYPES[method["returns"]]
    if fallible:
        return_type = f"Result<{return_type}, JavaArithmeticError>"
    lines = [
        "#[allow(dead_code, unused_assignments, unused_mut, unused_variables)]",
        f"pub fn {name}({signature}) -> {return_type} {{",
        f"    let mut stack = [0_{storage}; {method['stack']}];",
    ]
    if method["locals"]:
        lines.append(f"    let mut locals = [0_{storage}; {method['locals']}];")
        for index, (slot, kind) in enumerate(_parameters(method)):
            value = f"arg_{index}" if INT_TYPES[kind] == storage else f"arg_{index} as {storage}"
            lines.append(f"    locals[{slot}] = {value};")
    if len(blocks) == 1 and not successors[0]:
        lines.extend(
            f"    {line}" for line in _lower_block(blocks[0], 0, [], method["returns"], storage, fallible)
        )
    else:
        lines.extend(["    let mut block = 0_u16;", "    loop {", "        match block {"])
        for offset, block in blocks.items():
            lines.append(f"            {offset} => {{")
            lines.extend(f"                {line}" for line in _lower_block(
                block, len(stacks[offset]), successors[offset], method["returns"], storage, fallible
            ))
            lines.append("            }")
        lines.extend(['            _ => unreachable!("validated JVM branch target"),', "        }", "    }"])
    lines.append("}")
    return name, "\n".join(lines)


def translate(inspection: dict) -> dict:
    """Produce readable native Rust and an explicit inventory of skipped behavior."""
    files = {}
    features = []
    reasons = Counter()
    method_map = []
    sources = []
    bytes_used = 0
    fallible_count = 0
    for cls in inspection["classes"]:
        for method in cls["methods"]:
            source_method = f"{cls['name'].replace('/', '.')}.{method['name']}{method['descriptor']}"
            if (
                inspection.get("startupMessage") is not None and method["name"] in {"<init>", "onInitializeClient"}
            ):
                continue
            if "reason" in method:
                reasons[method["reason"]] += 1
                continue
            if len(sources) >= _FUNCTION_LIMIT or bytes_used >= _SOURCE_LIMIT:
                reasons["Generated source budget exceeded."] += 1
                continue
            try:
                name, source = _lower_method(cls["name"], method)
            except ValueError as error:
                reasons[str(error)] += 1
                continue
            if any(entry["rust"] == name for entry in method_map):
                reasons["Duplicate JVM method signature."] += 1
                continue
            sources.append(source)
            bytes_used += len(source)
            fallible_count += _fallible(method)
            method_map.append({"java": source_method, "rust": name})
    if sources:
        arithmetic_error = (
            "/// A translated Java division or remainder threw ArithmeticException.\n"
            "#[derive(Clone, Copy, Debug, Eq, PartialEq)]\n"
            "pub enum JavaArithmeticError {\n"
            "    DivisionByZero,\n"
            "}\n\n"
        ) if fallible_count else ""
        files["src/translated.rs"] = (
            "// Deterministic translation of selected static Java method bodies.\n"
            "// Review class initialization, callers, and game bindings before use.\n\n"
            + arithmetic_error + "\n\n".join(sources) + "\n"
        )
        features.append({
            "name": "Static integer and boolean methods", "status": "translated",
            "detail": f"{len(sources)} method bodies lowered to standalone Rust functions. "
                      "Java class initialization, external callers and Horizon bindings need manual integration.",
        })
        if fallible_count:
            features[-1]["detail"] += f" {fallible_count} return Rust Result to preserve Java division-by-zero behavior."
    if reasons:
        features.append({
            "name": "Java method bodies needing manual work", "status": "unsupported",
            "detail": " ".join(f"{count}× {reason}" for reason, count in reasons.most_common(8)),
        })
    if inspection.get("startupMessage") is not None:
        features.append({
            "name": "Fabric client startup message", "status": "translated",
            "detail": "The sole client entry point prints a constant string. The native port uses Horizon’s client-start "
                      "hook, whose timing can differ from Fabric initialization.",
        })
    return {
        "files": files, "features": features, "methodMap": method_map,
        "ir": {
            "schemaVersion": 1, "classCount": inspection["classCount"], "methodCount": inspection["methodCount"],
            "skippedMethods": inspection["skippedMethods"], "classIssues": inspection["classIssues"],
            "classes": inspection["classes"],
        },
        "native": {"startupMessage": inspection["startupMessage"]} if inspection.get("startupMessage") is not None else None,
    }
