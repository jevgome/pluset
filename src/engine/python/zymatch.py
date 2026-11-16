"""Recreates the student's own randomized version of a challenge level.

zyBooks generates each student's values by running the level's generator code with
random choices we can't see. The page shows the result, though, so we search for
random choices that make the generator produce the text the page shows.

Every call to the `random` module (directly, or through pick_from / eqat.rand) is a
"choice point" with a list of candidate outcomes (every integer in a randint range,
numbers from the page that fall in a uniform range, ...). We run the generator many
times, varying one choice point at a time and keeping changes that make its problem
text agree better with the page (coordinate descent with a few random restarts).
Most levels need a few dozen runs, because each shown value usually comes from one
choice point.

Agreement: each text template of the level, filled with the run's variables, is split
into words and numbers (TeX commands and signs dropped, since rendered math doesn't
show them), and we take its edit distance to the closest stretch of the page's words
and numbers. The words anchor each value to its place in the sentence.
Random calls made while building "Ex:" placeholders don't matter and aren't varied.
"""

import html
import json
import math
import random
import re
import sys
import time

import zyrunner

_TEMPLATE = re.compile(r"\$\{\s*([A-Za-z_]\w*)\s*\}")
_NUMBER = re.compile(r"\d+(?:\.\d+)?|\.\d+")
_TOKEN = re.compile(r"[a-z]{2,}|\d+(?:\.\d+)?|\.\d+")
_TEX_COMMAND = re.compile(r"\\[a-zA-Z]+")
_PLACEHOLDER_FUNCS = {"build_placeholder", "_finalize_placeholder", "placeholder_is_possible_answer"}
_MAX_CANDIDATES = 400

_orig = {name: getattr(random, name) for name in ("random", "uniform", "randint", "randrange", "choice")}


def _key(x):
    return float("%.10g" % abs(x))


def _tokens(text):
    """Words and numbers, ignoring TeX commands (rendered math doesn't show them)."""
    out = []
    for t in _TOKEN.findall(_TEX_COMMAND.sub(" ", text.lower())):
        out.append(t if t[0].isalpha() else _key(float(t)))
    return out


def _as_text(value):
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value)
    return str(value)


def _is_number(s):
    try:
        float(s)
        return True
    except ValueError:
        return False


def _align(seq, page):
    """Edit distance from seq to the best-matching stretch of page (free start and end)."""
    if not seq:
        return 0
    prev = [0] * (len(page) + 1)
    for i, a in enumerate(seq, 1):
        cur = [i] + [0] * len(page)
        for j, b in enumerate(page, 1):
            cur[j] = min(prev[j - 1] + (a != b), prev[j] + 1, cur[j - 1] + 1)
        prev = cur
    return min(prev)


def _in_placeholder_helper():
    f = sys._getframe(2)
    while f is not None:
        if f.f_code.co_name in _PLACEHOLDER_FUNCS or f.f_code.co_filename.endswith("zyversions.py"):
            return True
        f = f.f_back
    return False


class _Controller:
    """Stands in for the `random` module functions during one run."""

    def __init__(self, page_values, choices, rng):
        self.page_values = page_values
        self.choices = choices  # choice point index -> candidate index (shared across runs)
        self.rng = rng  # picks defaults for choice points seen for the first time
        self.points = []  # candidate count of each choice point in this run
        self.helper_rng = random.Random(1)

    def _pick(self, candidates):
        i = len(self.points)
        self.points.append(len(candidates))
        if i not in self.choices:
            self.choices[i] = self.rng.randrange(len(candidates))
        return candidates[self.choices[i] % len(candidates)]

    def _ints(self, start, stop, step):
        n = len(range(start, stop, step))
        if n <= 0:
            raise ValueError("empty range for randrange()")
        if n <= _MAX_CANDIDATES:
            return list(range(start, stop, step))
        r = range(start, stop, step)
        hits = [int(v) for v in self.page_values if v == int(v) and int(v) in r]
        return list(dict.fromkeys(hits + [r[self.rng.randrange(n)] for _ in range(40)]))

    def _floats(self, lo, hi):
        lo, hi = min(lo, hi), max(lo, hi)
        cands = []
        for v in self.page_values:
            for k in range(-3, 4):
                s = v * 10.0**k
                if lo <= s <= hi:
                    cands.append(s)
        # int(rand(3, 8.99)) and similar: one value inside each integer step
        for k in range(math.ceil(lo), math.floor(hi) + 1):
            cands.append(k + 0.5 if k + 0.5 <= hi else k)
        cands += [lo + (hi - lo) * t / 10.0 for t in range(11)]
        return list(dict.fromkeys(cands))[:_MAX_CANDIDATES]

    def randrange(self, start, stop=None, step=1):
        if _in_placeholder_helper():
            return self.helper_rng.randrange(start, stop, step) if stop is not None else self.helper_rng.randrange(start)
        if stop is None:
            start, stop = 0, start
        return self._pick(self._ints(int(start), int(stop), int(step)))

    def randint(self, a, b):
        if _in_placeholder_helper():
            return self.helper_rng.randint(a, b)
        return self._pick(self._ints(int(a), int(b) + 1, 1))

    def choice(self, seq):
        seq = list(seq)
        if not seq:
            raise IndexError("Cannot choose from an empty sequence")
        if _in_placeholder_helper():
            return self.helper_rng.choice(seq)
        return seq[self._pick(list(range(len(seq))))]

    def uniform(self, a, b):
        if _in_placeholder_helper():
            return self.helper_rng.uniform(a, b)
        return self._pick(self._floats(a, b))

    def random(self):
        if _in_placeholder_helper():
            return self.helper_rng.random()
        return self._pick([v for v in self._floats(0.0, 1.0) if v < 1.0])


class _Search:
    def __init__(self, shared_code, level_code, templates, answer_templates, page_text):
        self.compiled = zyrunner.compile_level(shared_code, level_code)
        self.templates = [html.unescape(t) for t in templates]
        self.answer_templates = answer_templates
        self.page_text = html.unescape(page_text).lower()
        self.page = _tokens(self.page_text)
        self.page_values = sorted(set(float(t) for t in _NUMBER.findall(self.page_text)))
        self.memo = {}
        self.runs = 0
        self.total = 0

    def run(self, choices, rng):
        ctl = _Controller(self.page_values, choices, rng)
        self.runs += 1
        random.seed(0)
        for name in _orig:
            setattr(random, name, getattr(ctl, name))
        try:
            scope = zyrunner.exec_level(self.compiled)
        except Exception:
            return None
        finally:
            for name, fn in _orig.items():
                setattr(random, name, fn)
        exported = zyrunner.export_vars(scope)
        values = {k: _as_text(v) for k, v in exported.items()}
        return {"vars": exported, "values": values, "points": ctl.points, "score": self.score(values)}

    def fill(self, template, values):
        return _TEMPLATE.sub(lambda m: values.get(m.group(1), m.group(0)), template)

    def score(self, values):
        total = 0
        size = 0
        for t in self.templates:
            filled = self.fill(t, values)
            seq = tuple(_tokens(filled))
            size += len(seq)
            if seq not in self.memo:
                self.memo[seq] = _align(seq, self.page)
            total += self.memo[seq]
            for name in _TEMPLATE.findall(t):
                v = values.get(name)
                if v is None:
                    total += 1
                elif not _is_number(v):
                    size += 1
                    total += 0 if v.lower() in self.page_text else 1
        self.total = size
        return total

    def answers(self, values):
        return [self.fill(t, values) for t in self.answer_templates]

    def descend(self, choices, rng, deadline):
        best = self.run(choices, rng)
        if best is None:
            return None, choices
        improved = True
        while improved and best["score"] > 0 and time.monotonic() < deadline:
            improved = False
            for i, n in enumerate(best["points"]):
                if best["score"] == 0 or time.monotonic() > deadline:
                    break
                current = choices[i]
                for c in range(n):
                    if c == current:
                        continue
                    trial = dict(choices)
                    trial[i] = c
                    res = self.run(trial, rng)
                    if res is not None and res["score"] < best["score"]:
                        best, choices, current, improved = res, trial, c, True
        return best, choices

    def ambiguous(self, best, choices, rng, deadline):
        """True if another single change matches the page as well but gives different answers."""
        want = self.answers(best["values"])
        for i, n in enumerate(best["points"]):
            for c in range(n):
                if c == choices[i] or time.monotonic() > deadline:
                    continue
                trial = dict(choices)
                trial[i] = c
                res = self.run(trial, rng)
                if res is not None and res["score"] == best["score"] and self.answers(res["values"]) != want:
                    return True
        return False


def match(shared_code, level_code, templates_json, answers_json, page_text, budget_ms):
    """Returns JSON: {"ok": true, "vars", "score", "size", "points", "ambiguous", "runs"} or {"ok": false, "error"}."""
    started = time.monotonic()
    deadline = started + budget_ms / 1000.0
    try:
        search = _Search(shared_code, level_code, json.loads(templates_json), json.loads(answers_json), page_text)
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})

    best, best_choices, best_rng = None, {}, None
    last_error = None
    for restart in range(6):
        rng = random.Random(1000 + restart)
        res, choices = search.descend({}, rng, deadline)
        if res is None:
            try:  # get the generator's own error message
                random.seed(restart)
                zyrunner.exec_level(search.compiled)
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            continue
        if best is None or res["score"] < best["score"]:
            best, best_choices, best_rng = res, choices, rng
        if best["score"] == 0 or time.monotonic() > deadline:
            break
    if best is None:
        return json.dumps({"ok": False, "error": last_error or "The generator code failed on every run."})

    ambiguous = bool(best["points"]) and search.ambiguous(best, best_choices, best_rng, deadline + 5)
    return json.dumps(
        {
            "ok": True,
            "vars": best["vars"],
            "score": best["score"],
            "size": search.total,
            "points": len(best["points"]),
            "ambiguous": ambiguous,
            "runs": search.runs,
        }
    )
