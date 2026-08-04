#!/usr/bin/env python3
"""Execute a specific code block from a Python file in isolation.

Usage: python3 run_block.py <filepath> <start_line> <end_line>

Gathers imports and referenced variable assignments from before the block,
assembles a runnable snippet, executes it, and prints JSON output.
"""

import ast
import json
import re
import subprocess
import sys


def extract_dependencies(source_lines: list[str], block_text: str, start_line: int) -> str:
    """Gather imports and variable assignments from before the block that are referenced in it."""
    preamble_lines = source_lines[: start_line - 1]

    # Collect all names used in the block (simple word extraction)
    block_names = set(re.findall(r"\b([A-Za-z_]\w*)\b", block_text))

    imports = []
    assignments = []

    try:
        preamble_src = "\n".join(preamble_lines)
        tree = ast.parse(preamble_src)
    except SyntaxError:
        # If preamble doesn't parse, just grab import lines and assignments by regex
        for line in preamble_lines:
            stripped = line.strip()
            if stripped.startswith("import ") or stripped.startswith("from "):
                imports.append(line)
            elif "=" in stripped and not stripped.startswith("#"):
                var_match = re.match(r"^(\w+)\s*=", stripped)
                if var_match and var_match.group(1) in block_names:
                    assignments.append(line)
        return "\n".join(imports + assignments)

    # Multi-pass: when we include a function/class, expand block_names
    # with names used inside it so their dependencies also get pulled
    top_level = list(ast.iter_child_nodes(tree))
    included_nodes: list[ast.AST] = []
    changed = True
    while changed:
        changed = False
        for node in top_level:
            if node in included_nodes:
                continue

            include = False
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                include = True
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in block_names:
                        include = True
                        break
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name in block_names:
                    include = True
            elif isinstance(node, ast.ClassDef):
                if node.name in block_names:
                    include = True

            if include:
                included_nodes.append(node)
                # Expand block_names with names used inside this node
                new_names = set(re.findall(r"\b([A-Za-z_]\w*)\b",
                    "\n".join(preamble_lines[node.lineno - 1 : (node.end_lineno or node.lineno)])))
                if not new_names.issubset(block_names):
                    block_names.update(new_names)
                    changed = True

    for node in included_nodes:
        src = "\n".join(preamble_lines[node.lineno - 1 : (node.end_lineno or node.lineno)])
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imports.append(src)
        else:
            assignments.append(src)

    return "\n".join(imports + assignments)


def run_block(filepath: str, start_line: int, end_line: int) -> dict:
    with open(filepath, "r") as f:
        source_lines = f.read().splitlines()

    if start_line < 1 or end_line > len(source_lines):
        return {"stdout": "", "stderr": f"Line range {start_line}-{end_line} out of bounds (file has {len(source_lines)} lines)", "exitCode": 1}

    # Extract the target block
    block_lines = source_lines[start_line - 1 : end_line]
    block_text = "\n".join(block_lines)

    # Dedent the block if it's indented (e.g., inside a function)
    min_indent = float("inf")
    for line in block_lines:
        if line.strip():
            indent = len(line) - len(line.lstrip())
            min_indent = min(min_indent, indent)
    if min_indent > 0 and min_indent < float("inf"):
        block_lines = [line[min_indent:] if len(line) > min_indent else line for line in block_lines]
        block_text = "\n".join(block_lines)

    # Gather dependencies
    deps = extract_dependencies(source_lines, block_text, start_line)

    # Assemble the runnable code
    code = deps + "\n\n" + block_text if deps else block_text

    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exitCode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "Execution timed out (10s limit)", "exitCode": 124}
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "exitCode": 1}


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: run_block.py <filepath> <start_line> <end_line>"}))
        sys.exit(1)

    filepath = sys.argv[1]
    start_line = int(sys.argv[2])
    end_line = int(sys.argv[3])

    output = run_block(filepath, start_line, end_line)
    print(json.dumps(output))
