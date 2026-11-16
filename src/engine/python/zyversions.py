"""Stand-in for zyBooks' `zyversions` helper module used by challenge activity code.

Written from the observed behavior of the helpers (not copied):
  zyv_sig_fig_round(x, n)       -> x rounded to n significant figures, as a string,
                                   keeping trailing zeros ("1.20"), no exponent notation
  convert_to_scinot(x, n=3)     -> (coefficient_str, exponent_int), e.g. 12345 -> ('1.23', 4)
                                   (a tuple: book code formats it directly with '%s x 10^%s' % result)
  build_placeholder(ans, tol)   -> an "Ex:" hint with the same format as `ans` that is
                                   NOT itself an acceptable answer
"""

import math
import random
from decimal import Decimal, ROUND_HALF_EVEN

__all__ = ["zyv_sig_fig_round", "convert_to_scinot", "build_placeholder"]


def _to_decimal(value):
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        # repr() gives the shortest string that round-trips, avoiding binary noise.
        return Decimal(repr(value))
    return Decimal(str(value).strip())


def _fixed(d, decimals):
    """Format Decimal `d` with exactly `decimals` digits after the point (or none if <= 0)."""
    if decimals > 0:
        return format(d.quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_EVEN), "f")
    q = d.quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_EVEN)
    return format(q.quantize(Decimal(1)), "f")


def zyv_sig_fig_round(num_to_round, sig_figs):
    if type(sig_figs) is not int:
        raise TypeError("sig fig input must be int")
    if sig_figs < 1:
        raise ValueError("sig_fig value cannot be less than 1")
    d = _to_decimal(num_to_round)
    if d == 0:
        return "0"
    exponent = d.copy_abs().adjusted()  # position of the leading digit
    decimals = sig_figs - 1 - exponent
    rounded = Decimal(_fixed(d, decimals))
    # Rounding can carry into a new leading digit (9.99 -> 10.0): keep n significant figures.
    if rounded != 0 and rounded.copy_abs().adjusted() != exponent:
        decimals = sig_figs - 1 - rounded.copy_abs().adjusted()
    text = _fixed(rounded, decimals)
    return "0" if text in ("-0", "-0.0") else text


def convert_to_scinot(num, num_to_round=3):
    d = _to_decimal(num)
    if d == 0:
        return (zyv_sig_fig_round(0, num_to_round), 0)
    exponent = d.copy_abs().adjusted()
    coefficient = zyv_sig_fig_round(d.scaleb(-exponent), num_to_round)
    if abs(float(coefficient)) >= 10:  # 9.996 -> 10.0 -> 1.00 x 10^(e+1)
        exponent += 1
        coefficient = zyv_sig_fig_round(d.scaleb(-exponent), num_to_round)
    return (coefficient, exponent)


def _is_acceptable(candidate, answer, tolerance, absolute_tolerance):
    if absolute_tolerance:
        return abs(candidate - answer) <= tolerance
    if answer == 0:
        return candidate == 0
    return abs(candidate - answer) <= abs(answer) * tolerance / 100.0


def build_placeholder(answer, tolerance, trailing_zeroes_are_significant=True, absolute_tolerance=False):
    """Returns example input with the answer's shape (digit count, decimals) but a wrong value."""
    text = str(answer).strip()
    try:
        answer_value = float(text)
    except ValueError:
        raise ValueError("build_placeholder() answer must be convertible to a float")
    if text.startswith("-"):
        text = text[1:]
    if "e" in text.lower():
        text = format(_to_decimal(text), "f")

    # The hint only needs the answer's shape, so trailing_zeroes_are_significant doesn't change it.
    whole, _, decimals = text.partition(".")
    has_point = "." in text

    def candidate():
        digits = "123456789"
        if not has_point and whole in ("", "0"):
            w = random.choice(digits)  # answer is exactly 0: any nonzero digit
        elif whole in ("", "0"):
            w = "0"
        else:
            w = random.choice(digits) + "".join(random.choice("0123456789") for _ in whole[1:])
        if not has_point:
            return w
        lead = len(decimals) - len(decimals.lstrip("0")) if w == "0" else 0
        rest = len(decimals) - lead
        d = "0" * lead + "".join(random.choice(digits if i == rest - 1 else "0123456789") for i in range(rest))
        return w + "." + d

    for _ in range(200):
        c = candidate()
        if not _is_acceptable(float(c), answer_value, float(tolerance), absolute_tolerance):
            return c
    # Extremely wide tolerance: any value of this shape is acceptable; fall back to a fixed pattern.
    return candidate()
