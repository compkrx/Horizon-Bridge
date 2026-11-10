"""Bound the JVM evidence available to a rewrite model."""

import json


def method_sources(inspection):
    candidates = []
    for cls in inspection["classes"]:
        for method in cls["methods"]:
            instructions = method.get("draftInstructions") or method.get("instructions")
            if not instructions:
                continue
            name = f"{cls['name'].replace('/', '.')}.{method['name']}{method['descriptor']}"
            text = json.dumps({"method": name, "instructions": instructions}, ensure_ascii=True, separators=(",", ":"))
            if len(text) <= 2600:
                candidates.append((not bool(method.get("draftInstructions")), name, text))
    return [{"id": f"method-{index}", "label": name, "language": "JVM bytecode", "text": text}
            for index, (_, name, text) in enumerate(sorted(candidates)[:20])]
