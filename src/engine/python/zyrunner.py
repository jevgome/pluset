"""Runs a challenge level's generator code and returns its variables as strings.

Challenge code is stored HTML-escaped (&lt; for <, &amp; for &), so it is unescaped first.

zyBooks runs this code on a more forgiving Python than CPython 3. Book code relies on:
  - `%` formatting with stray `%` characters (e.g. LaTeX `\\%`) or a list as the arguments
  - ordering comparisons between strings and numbers (Python 2 rules: numbers < strings)
  - built-ins that are never imported: pick_from, pick_from_range, sig_fig_round
We rewrite `%` and `<`/`<=`/`>`/`>=` into calls that behave normally when CPython
would succeed and fall back to the forgiving behavior only when it would raise.
"""

import ast
import builtins
import html
import json
import math
import numbers
import random
import re
from decimal import Decimal

from zyversions import zyv_sig_fig_round


def pick_from(options):
    return random.choice(list(options))


def pick_from_range(low, high, step=1):
    if all(isinstance(v, int) for v in (low, high, step)):
        return random.randrange(low, high + 1, step)
    return random.uniform(low, high)


builtins.pick_from = pick_from
builtins.pick_from_range = pick_from_range
builtins.sig_fig_round = zyv_sig_fig_round

# ---------------------------------------------------------------- forgiving operators

_SPEC = re.compile(r"%(?:\((\w+)\))?([-#0 +]*)(\d+)?(?:\.(\d+))?([diouxXeEfFgGcrsa%])")


def _lenient_format(fmt, args):
    mapping = args if isinstance(args, dict) else None
    values = list(args) if isinstance(args, (tuple, list)) else [args]
    out = []
    i = 0
    while i < len(fmt):
        ch = fmt[i]
        if ch != "%":
            out.append(ch)
            i += 1
            continue
        m = _SPEC.match(fmt, i)
        if not m:  # a stray '%' (e.g. LaTeX "\%"): keep it literally
            out.append("%")
            i += 1
            continue
        key, flags, width, precision, conv = m.groups()
        if conv == "%":
            out.append("%")
        elif key is not None and mapping is not None and key in mapping:
            out.append(_format_one(m.group(0).replace(f"({key})", ""), mapping[key]))
        elif key is None and values:
            out.append(_format_one(m.group(0), values.pop(0)))
        else:  # not enough arguments: leave the specifier as text
            out.append(m.group(0))
        i = m.end()
    return "".join(out)


def _format_one(spec, value):
    try:
        return spec % (value,)
    except (TypeError, ValueError):
        return str(value)


def __zy_mod(left, right):
    if not isinstance(left, str):
        return left % right
    try:
        return left % right
    except (TypeError, ValueError):
        pass
    if isinstance(right, list):
        try:
            return left % tuple(right)
        except (TypeError, ValueError):
            pass
    return _lenient_format(left, right)


_COMPARE = {
    "Lt": lambda a, b: a < b,
    "LtE": lambda a, b: a <= b,
    "Gt": lambda a, b: a > b,
    "GtE": lambda a, b: a >= b,
}


def _py2_key(v):
    # Python 2 ordering for mixed types: numbers sort before everything else.
    return (0, v) if isinstance(v, numbers.Number) else (1, str(v))


def __zy_cmp(op, left, right):
    compare = _COMPARE[op]
    try:
        return compare(left, right)
    except TypeError:
        return compare(_py2_key(left), _py2_key(right))


class _Forgiving(ast.NodeTransformer):
    def visit_BinOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, ast.Mod):
            call = ast.Call(func=ast.Name("__zy_mod", ast.Load()), args=[node.left, node.right], keywords=[])
            return ast.copy_location(call, node)
        return node

    def visit_Compare(self, node):
        self.generic_visit(node)
        if len(node.ops) == 1 and type(node.ops[0]).__name__ in _COMPARE:
            call = ast.Call(
                func=ast.Name("__zy_cmp", ast.Load()),
                args=[ast.Constant(type(node.ops[0]).__name__), node.left, node.comparators[0]],
                keywords=[],
            )
            return ast.copy_location(call, node)
        return node


def _compile(source, label):
    tree = ast.fix_missing_locations(_Forgiving().visit(ast.parse(html.unescape(source or ""), label)))
    return compile(tree, label, "exec")


# ---------------------------------------------------------------- running a level


def _export(value):
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float, str, Decimal)):
        return str(value)
    if isinstance(value, (list, tuple)) and all(isinstance(v, (int, float, str, Decimal)) for v in value):
        return [str(v) for v in value]
    return None


# Problem code (the book's, or AI-written) never needs to reach the browser. Pyodide
# exposes JavaScript through these modules, so block them for the code we exec.
# This only affects `import` statements in that code; library modules it imports
# (unittest, decimal, ...) keep their normal imports.
_BLOCKED_IMPORTS = {"js", "pyodide", "pyodide_js", "_pyodide", "micropip", "sys", "importlib", "ctypes", "gc", "inspect", "builtins", "os", "subprocess", "socket"}
_real_import = builtins.__import__


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if name.split(".")[0] in _BLOCKED_IMPORTS:
        raise ImportError(f"import of '{name}' is not allowed in problem code")
    return _real_import(name, globals, locals, fromlist, level)


_SAFE_BUILTINS = {k: getattr(builtins, k) for k in dir(builtins) if k not in ("open", "breakpoint", "input", "exit", "quit", "help")}
_SAFE_BUILTINS["__import__"] = _safe_import


def new_scope():
    return {
        "__builtins__": _SAFE_BUILTINS,
        "__name__": "__zylevel__",
        "__zy_mod": __zy_mod,
        "__zy_cmp": __zy_cmp,
        "math": math,
        "random": random,
        "re": re,
    }


def compile_level(shared_code, level_code):
    return _compile(shared_code, "<shared code>"), _compile(level_code, "<level code>")


def exec_level(compiled):
    """Runs compiled (shared, level) code in a fresh scope and returns the scope."""
    scope = new_scope()
    exec(compiled[0], scope)
    exec(compiled[1], scope)
    return scope


def export_vars(scope):
    out = {}
    for name, value in scope.items():
        if name.startswith("__"):
            continue
        exported = _export(value)
        if exported is not None:
            out[name] = exported
    return out


def run(shared_code, level_code, seed):
    """Returns JSON: {"ok": true, "vars": {...}} or {"ok": false, "error": "..."}."""
    random.seed(seed)
    try:
        scope = exec_level(compile_level(shared_code, level_code))
    except Exception as exc:  # report, don't crash the worker
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
    return json.dumps({"ok": True, "vars": export_vars(scope)})
