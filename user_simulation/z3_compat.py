"""
z3_compat.py

Pure-Python fallback when z3-solver is not installed.
Implements only the subset of Z3 used by this package:
  Bool, And, Or, Not, Implies, Solver, sat, unsat

All formulas are evaluated against a fixed boolean assignment
(the measured perceptions). No search is performed.

Replace this module entirely by installing z3-solver:
  pip install z3-solver
Then imports in judgement.py switch to the real library automatically.
"""

try:
    from z3 import Bool, And, Or, Not, Implies, Solver, sat, unsat, BoolRef  # type: ignore
    Z3_AVAILABLE = True
except ImportError:
    Z3_AVAILABLE = False

    # ── Minimal Z3-compatible implementation ────────────────────────────────

    class BoolRef:
        """A symbolic boolean that can be evaluated against an assignment."""
        def __init__(self, name: str):
            self._name = name

        def sexpr(self) -> str:
            return self._name

        def _eval(self, assignment: dict) -> bool:
            return bool(assignment.get(self._name, False))

        def __repr__(self):
            return f"Bool('{self._name}')"

    class _Compound(BoolRef):
        def __init__(self, op: str, *args):
            self._op   = op
            self._args = args

        def sexpr(self) -> str:
            inner = " ".join(a.sexpr() for a in self._args)
            return f"({self._op} {inner})"

        def _eval(self, assignment: dict) -> bool:
            vals = [a._eval(assignment) for a in self._args]
            if self._op == "and":     return all(vals)
            if self._op == "or":      return any(vals)
            if self._op == "not":     return not vals[0]
            if self._op == "=>":      return (not vals[0]) or vals[1]
            if self._op == "==":      return vals[0] == vals[1]
            raise ValueError(f"Unknown op: {self._op}")

        def __repr__(self):
            return self.sexpr()

    class _BoolLiteral(BoolRef):
        """True/False literal."""
        def __init__(self, val: bool):
            self._val = val

        def _eval(self, _) -> bool:
            return self._val

        def sexpr(self):
            return "true" if self._val else "false"

    def Bool(name: str) -> BoolRef:
        return BoolRef(name)

    def And(*args) -> BoolRef:
        flat = []
        for a in args:
            flat.extend(a._args if isinstance(a, _Compound) and a._op == "and" else [a])
        return _Compound("and", *flat)

    def Or(*args) -> BoolRef:
        return _Compound("or", *args)

    def Not(a) -> BoolRef:
        return _Compound("not", a)

    def Implies(a, b) -> BoolRef:
        return _Compound("=>", a, b)

    class _Status:
        def __init__(self, name): self._name = name
        def __repr__(self): return self._name
        def __eq__(self, other): return isinstance(other, _Status) and self._name == other._name

    sat   = _Status("sat")
    unsat = _Status("unsat")

    class Solver:
        """
        Simple satisfiability checker for fixed assignments.

        Usage mirrors z3.Solver:
          s = Solver()
          s.add(Bool('x') == True)
          s.add(formula_over_x)
          assert s.check() == sat
        """

        def __init__(self):
            self._assignment: dict = {}
            self._formulas: list   = []

        def add(self, formula):
            # Detect assignment constraints: _Compound('==', BoolRef(name), literal)
            if (isinstance(formula, _Compound) and formula._op == "==" and
                    len(formula._args) == 2):
                var, lit = formula._args
                if isinstance(var, BoolRef) and not isinstance(var, _Compound):
                    if isinstance(lit, _BoolLiteral):
                        self._assignment[var._name] = lit._val
                        return
                    # z3-style: Bool('x') == True  →  Python True/False passed directly
            # Plain bool passed in (Python auto-evaluates the == at call site)
            if isinstance(formula, bool):
                if not formula:
                    self._formulas.append(_BoolLiteral(False))
                return
            self._formulas.append(formula)

        def check(self) -> _Status:
            for f in self._formulas:
                if not f._eval(self._assignment):
                    return unsat
            return sat

        def model(self):
            return self._assignment

    # Monkey-patch equality so Bool('x') == True works
    def _bool_eq(self, other):
        if isinstance(other, bool):
            return _Compound("==", self, _BoolLiteral(other))
        return NotImplemented

    BoolRef.__eq__ = _bool_eq
    BoolRef.__hash__ = lambda self: hash(getattr(self, '_name', id(self)))
