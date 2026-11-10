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
}
_UNARY = {
    "neg": "{value}.wrapping_neg()", "abs": "{value}.wrapping_abs()", "narrow_byte": "{value} as i8 as i32",
    "narrow_char": "{value} as u16 as i32", "narrow_short": "{value} as i16 as i32",
}
_COMPARISONS = {"eq": "==", "ne": "!=", "lt": "<", "ge": ">=", "gt": ">", "le": "<="}
_END_BLOCK = {"if", "goto", "return"}
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
    if last == "return":
        return []
    if last == "goto":
        return [args[-1]]
    if next_block is None:
        raise ValueError("Reachable bytecode falls off the end of the method.")
    return [args[-1], next_block] if last == "if" else [next_block]


def _stack_effect(opcode: str, args: list) -> tuple[int, int]:
    if opcode in {"const", "load"}:
        return 0, 1
    if opcode in {"store", "pop", "return"}:
        return 1, 0
    if opcode in _ARITHMETIC:
        return 2, 1
    if opcode in _UNARY:
        return 1, 1
    if opcode == "dup":
        return 1, 2
    if opcode == "if":
        return (2 if args[1] else 1), 0
    return 0, 0


def _verify(method: dict, blocks: dict[int, list[list]], successors: dict[int, list[int]]) -> dict[int, int]:
    """Check operand stack height and definite assignment across all incoming edges."""
    argument_count = len(method["params"])
    if not blocks or argument_count > method["locals"]:
        raise ValueError("Invalid method frame.")
    entries: dict[int, tuple[int, frozenset[int]]] = {0: (0, frozenset(range(argument_count)))}
    pending = deque([0])
    while pending:
        current = pending.popleft()
        depth, locals_in = entries[current]
        initialized = set(locals_in)
        for _, opcode, *args in blocks[current]:
            if opcode in {"load", "store", "increment"}:
                local = args[0]
                if local >= method["locals"]:
                    raise ValueError("Local variable index exceeds the method frame.")
                if opcode == "store":
                    initialized.add(local)
                elif local not in initialized:
                    raise ValueError("A local may be read before assignment.")
            popped, pushed = _stack_effect(opcode, args)
            if popped > depth:
                raise ValueError("Operand stack underflow.")
            depth += pushed - popped
            if depth > method["stack"]:
                raise ValueError("Operand stack exceeds the method frame.")
            if opcode == "return" and depth:
                raise ValueError("Operand stack contains additional values at return.")
        for successor in successors[current]:
            if successor in entries:
                previous_depth, previous_locals = entries[successor]
                if previous_depth != depth:
                    raise ValueError("Operand stack heights disagree at a branch target.")
                merged = previous_locals.intersection(initialized)
                if merged == previous_locals:
                    continue
            else:
                merged = frozenset(initialized)
            entries[successor] = depth, merged
            pending.append(successor)
    if len(entries) != len(blocks):
        raise ValueError("Unreachable bytecode requires manual review.")
    if not any(block[-1][1] == "return" for block in blocks.values()):
        raise ValueError("No supported return was reachable.")
    return {entry: depth for entry, (depth, _) in entries.items()}


def _rust_name(class_name: str, method: dict) -> str:
    original = f"{class_name}.{method['name']}{method['descriptor']}"
    suffix = hashlib.sha256(original.encode("utf-8", "surrogatepass")).hexdigest()[:16]
    readable = re.sub(r"[^a-zA-Z0-9]", "_", f"{class_name.rsplit('/', 1)[-1]}_{method['name']}")[:55]
    return f"java_{readable.lower()}_{suffix}"


def _i32(value: int) -> str:
    return f"{value}_i32"


def _return_expression(value: str, kind: str) -> str:
    if kind == "Z":
        return f"({value} & 1) != 0"
    return value if kind == "I" else f"{value} as {INT_TYPES[kind]}"


def _lower_block(block: list[list], depth: int, successors: list[int], returns: str) -> list[str]:
    lines = []
    for _, opcode, *args in block:
        top = f"stack[{depth - 1}]"
        second = f"stack[{depth - 2}]"
        if opcode == "const":
            lines.append(f"stack[{depth}] = {_i32(args[0])};")
        elif opcode == "load":
            lines.append(f"stack[{depth}] = locals[{args[0]}];")
        elif opcode == "store":
            lines.append(f"locals[{args[0]}] = {top};")
        elif opcode == "increment":
            local = f"locals[{args[0]}]"
            lines.append(f"{local} = {local}.wrapping_add({_i32(args[1])});")
        elif opcode == "dup":
            lines.append(f"stack[{depth}] = {top};")
        elif opcode in _ARITHMETIC:
            expression = _ARITHMETIC[opcode].format(left=second, right=top)
            lines.append(f"{second} = {expression};")
        elif opcode in _UNARY:
            expression = _UNARY[opcode].format(value=top)
            lines.append(f"{top} = {expression};")
        elif opcode == "if":
            left, right = (second, top) if args[1] else (top, "0")
            comparison = _COMPARISONS[args[0]]
            target, fallthrough = successors
            lines.append(f"block = if {left} {comparison} {right} {{ {target} }} else {{ {fallthrough} }};")
        elif opcode == "return":
            lines.append(f"return {_return_expression(top, returns)};")
        popped, pushed = _stack_effect(opcode, args)
        depth += pushed - popped
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
    depths = _verify(method, blocks, successors)
    name = _rust_name(class_name, method)
    signature = ", ".join(f"arg_{index}: {INT_TYPES[kind]}" for index, kind in enumerate(method["params"]))
    lines = [
        "#[allow(dead_code, unused_assignments, unused_mut, unused_variables)]",
        f"pub fn {name}({signature}) -> {INT_TYPES[method['returns']]} {{",
        f"    let mut stack = [0_i32; {method['stack']}];",
    ]
    if method["locals"]:
        lines.append(f"    let mut locals = [0_i32; {method['locals']}];")
        for index, kind in enumerate(method["params"]):
            value = f"arg_{index}" if kind == "I" else f"arg_{index} as i32"
            lines.append(f"    locals[{index}] = {value};")
    if len(blocks) == 1 and not successors[0]:
        lines.extend(f"    {line}" for line in _lower_block(blocks[0], 0, [], method["returns"]))
    else:
        lines.extend(["    let mut block = 0_u16;", "    loop {", "        match block {"])
        for offset, block in blocks.items():
            lines.append(f"            {offset} => {{")
            lines.extend(f"                {line}" for line in _lower_block(
                block, depths[offset], successors[offset], method["returns"]
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
            method_map.append({"java": source_method, "rust": name})
    if sources:
        files["src/translated.rs"] = (
            "// Deterministic translation of selected static Java method bodies.\n"
            "// Review class initialization, callers, and game bindings before use.\n\n"
            + "\n\n".join(sources) + "\n"
        )
        features.append({
            "name": "Static integer and boolean methods", "status": "translated",
            "detail": f"{len(sources)} method bodies lowered to standalone Rust functions. "
                      "Java class initialization, external callers and Horizon bindings need manual integration.",
        })
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
