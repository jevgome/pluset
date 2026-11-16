"""Stand-in for zyBooks' `eqat` helper module (random values and math shorthands)."""

import math
import random

__all__ = ["rand", "rint", "decimal", "ln", "e", "pi", "eq", "gt", "lt", "eqat_if"]

e = math.e
pi = math.pi


def rand(low, high):
    """Uniform random float in [low, high]."""
    return random.uniform(low, high)


def rint(low, high=None):
    """rint(n) -> random int in [0, n); rint(a, b) -> random int in [a, b]."""
    if high is None:
        return random.randrange(int(low))
    return random.randint(int(low), int(high))


def decimal(places, value):
    """`value` rounded to `places` decimal places."""
    return round(value, int(places))


def ln(x):
    return math.log(x)


def eq(a, b):
    return a == b


def gt(a, b):
    return a > b


def lt(a, b):
    return a < b


def eqat_if(condition, if_true, if_false):
    return if_true if condition else if_false
