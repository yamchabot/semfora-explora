"""
z3_compat.py

Pure-Python fallback when z3-solver is not installed.
Implements the subset of Z3 used by this package:
  Bool, Real, Int, And, Or, Not, Implies, If, Solver, sat, unsat

All symbolic expressions support:
  - Arithmetic: +, -, *, /
  - Comparisons: >=, <=, >, <, == (return BoolRef)
  - Boolean: And, Or, Not, Implies
  - Conditional: If(cond, then_expr, else_expr)

Install real Z3 for SMT solving, UNSAT cores, and model generation:
  pip install z3-solver
"""

try:
    from z3 import (                                                  # type: ignore
        Bool, Real, Int, And, Or, Not, Implies, If,
        Solver, sat, unsat, BoolRef, ArithRef,
    )
    Z3_AVAILABLE = True
except ImportError:
    Z3_AVAILABLE = False

    # ── Base expression types ─────────────────────────────────────────────────

    class BoolRef:
        """A symbolic boolean expression."""
        def sexpr(self) -> str:
            return "?"

        def _eval(self, assignment: dict) -> bool:
            raise NotImplementedError

        def describe(self, assignment: dict) -> str:
            """Human-readable description of why this constraint failed."""
            return self.sexpr()

        def __repr__(self):
            return self.sexpr()

    class ArithRef:
        """A symbolic numeric expression (Real or Int)."""
        def sexpr(self) -> str:
            return "?"

        def _eval(self, assignment: dict):
            raise NotImplementedError

        # ── Comparison operators → BoolRef ────────────────────────────────────
        def __ge__(self, other):  return _CmpExpr(">=", self, _awrap(other))
        def __le__(self, other):  return _CmpExpr("<=", self, _awrap(other))
        def __gt__(self, other):  return _CmpExpr(">",  self, _awrap(other))
        def __lt__(self, other):  return _CmpExpr("<",  self, _awrap(other))
        def __eq__(self, other):
            if isinstance(other, (int, float)):
                return _CmpExpr("==", self, _awrap(other))
            return NotImplemented

        # ── Arithmetic operators → ArithRef ──────────────────────────────────
        def __add__(self, other):       return _ArithBinOp("+", self, _awrap(other))
        def __radd__(self, other):      return _ArithBinOp("+", _awrap(other), self)
        def __sub__(self, other):       return _ArithBinOp("-", self, _awrap(other))
        def __rsub__(self, other):      return _ArithBinOp("-", _awrap(other), self)
        def __mul__(self, other):       return _ArithBinOp("*", self, _awrap(other))
        def __rmul__(self, other):      return _ArithBinOp("*", _awrap(other), self)
        def __truediv__(self, other):   return _ArithBinOp("/", self, _awrap(other))

        def __hash__(self):             return hash(id(self))
        def __repr__(self):             return self.sexpr()


    # ── Arithmetic leaves ─────────────────────────────────────────────────────

    class _ArithVar(ArithRef):
        def __init__(self, name: str, kind: str = "Real"):
            self._name = name
            self._kind = kind

        def sexpr(self):
            return self._name

        def _eval(self, assignment: dict):
            if self._name not in assignment:
                raise KeyError(f"No assignment for perception {self._name!r}")
            return assignment[self._name]

    class _ArithLit(ArithRef):
        def __init__(self, val):
            self._val = val

        def sexpr(self):
            return f"{self._val:g}" if isinstance(self._val, float) else str(self._val)

        def _eval(self, _):
            return self._val

    class _ArithBinOp(ArithRef):
        def __init__(self, op, left, right):
            self._op, self._left, self._right = op, left, right

        def sexpr(self):
            return f"({self._left.sexpr()} {self._op} {self._right.sexpr()})"

        def _eval(self, a):
            l, r = self._left._eval(a), self._right._eval(a)
            if self._op == "+": return l + r
            if self._op == "-": return l - r
            if self._op == "*": return l * r
            if self._op == "/": return l / r

    def _awrap(v):
        """Wrap a Python literal as an ArithLit; pass through ArithRef as-is."""
        if isinstance(v, ArithRef): return v
        return _ArithLit(v)


    # ── Comparison expression ─────────────────────────────────────────────────

    class _CmpExpr(BoolRef):
        """Result of an ArithRef comparison — a BoolRef."""
        def __init__(self, op, left: ArithRef, right: ArithRef):
            self._op, self._left, self._right = op, left, right

        def sexpr(self) -> str:
            return f"{self._left.sexpr()} {self._op} {self._right.sexpr()}"

        def _eval(self, assignment: dict) -> bool:
            l, r = self._left._eval(assignment), self._right._eval(assignment)
            return {
                ">=": l >= r, "<=": l <= r,
                ">":  l >  r, "<":  l <  r, "==": l == r,
            }[self._op]

        def describe(self, assignment: dict) -> str:
            try:
                l_val = self._left._eval(assignment)
                r_val = self._right._eval(assignment)
                l_fmt = f"{l_val:.3g}" if isinstance(l_val, float) else str(l_val)
                return (
                    f"{self._left.sexpr()} is {l_fmt} "
                    f"(needs {self._op} {self._right.sexpr()})"
                )
            except KeyError:
                return self.sexpr()


    # ── Boolean compounds ─────────────────────────────────────────────────────

    class _BoolLit(BoolRef):
        def __init__(self, val: bool):
            self._val = val

        def _eval(self, _) -> bool:
            return self._val

        def sexpr(self):
            return "true" if self._val else "false"

    class _Compound(BoolRef):
        def __init__(self, op: str, *args):
            self._op   = op
            self._args = args

        def sexpr(self) -> str:
            inner = " ".join(a.sexpr() for a in self._args)
            return f"({self._op} {inner})"

        def _eval(self, assignment: dict) -> bool:
            vals = [a._eval(assignment) for a in self._args]
            if self._op == "and":   return all(vals)
            if self._op == "or":    return any(vals)
            if self._op == "not":   return not vals[0]
            if self._op == "=>":
                return (not vals[0]) or vals[1]
            if self._op == "ite":   # If-then-else
                return vals[1] if vals[0] else vals[2]
            if self._op == "==":    return vals[0] == vals[1]
            raise ValueError(f"Unknown op: {self._op}")

        def describe(self, assignment: dict) -> str:
            """Human-readable failure description for compound expressions."""
            if self._op == "=>":
                ante, cons = self._args
                try:
                    if ante._eval(assignment):
                        # Antecedent holds but consequent fails
                        cons_desc = cons.describe(assignment) if hasattr(cons, 'describe') else cons.sexpr()
                        ante_desc = ante.sexpr()
                        return f"Since {ante_desc}, {cons_desc}"
                except Exception:
                    pass
            return self.sexpr()


    # ── Public constructors ───────────────────────────────────────────────────

    def Bool(name: str) -> BoolRef:
        b = BoolRef.__new__(BoolRef)
        b._name = name  # type: ignore[attr-defined]
        b.sexpr = lambda: name  # type: ignore[method-assign]
        b._eval = lambda assignment: bool(assignment.get(name, False))  # type: ignore[method-assign]
        return b

    def Real(name: str) -> ArithRef:
        return _ArithVar(name, "Real")

    def Int(name: str) -> ArithRef:
        return _ArithVar(name, "Int")

    def And(*args) -> BoolRef:
        flat = []
        for a in args:
            if isinstance(a, _Compound) and a._op == "and":
                flat.extend(a._args)
            else:
                flat.append(a)
        return _Compound("and", *flat)

    def Or(*args) -> BoolRef:
        return _Compound("or", *args)

    def Not(a) -> BoolRef:
        return _Compound("not", a)

    def Implies(a, b) -> BoolRef:
        return _Compound("=>", a, b)

    def If(cond, then_expr, else_expr):
        """Ternary: If(cond, then, else). Returns ArithRef or BoolRef."""
        # For the shim, return a compound that evaluates correctly
        if isinstance(then_expr, ArithRef):
            class _IfArith(ArithRef):
                def sexpr(self):
                    return f"(if {cond.sexpr()} {then_expr.sexpr()} {else_expr.sexpr()})"
                def _eval(self, a):
                    return then_expr._eval(a) if cond._eval(a) else else_expr._eval(a)
            return _IfArith()
        return _Compound("ite", cond, then_expr, else_expr)


    # ── Solver ────────────────────────────────────────────────────────────────

    class _Status:
        def __init__(self, name): self._name = name
        def __repr__(self): return self._name
        def __eq__(self, other):
            return isinstance(other, _Status) and self._name == other._name
        def __hash__(self): return hash(self._name)

    sat   = _Status("sat")
    unsat = _Status("unsat")

    class Solver:
        """
        Fixed-assignment satisfiability checker.

        Mirrors z3.Solver:
          s = Solver()
          s.add(Real('x') == 1.75)     # fix variable
          s.add(Real('x') >= 1.80)     # add constraint
          assert s.check() == unsat    # 1.75 < 1.80
        """

        def __init__(self):
            self._assignment: dict = {}
            self._formulas: list   = []

        def add(self, expr):
            # Detect arithmetic variable assignment: _CmpExpr("==", _ArithVar, _ArithLit)
            if (isinstance(expr, _CmpExpr) and expr._op == "==" and
                    isinstance(expr._left, _ArithVar) and
                    isinstance(expr._right, _ArithLit)):
                self._assignment[expr._left._name] = expr._right._val
                return

            # Detect bool variable assignment: _Compound("==", BoolRef, _BoolLit)
            if (isinstance(expr, _Compound) and expr._op == "==" and
                    len(expr._args) == 2):
                var, lit = expr._args
                if (hasattr(var, '_name') and not isinstance(var, _Compound)
                        and isinstance(lit, _BoolLit)):
                    self._assignment[var._name] = lit._val
                    return

            # Plain Python bool (from short-circuit evaluation)
            if isinstance(expr, bool):
                if not expr:
                    self._formulas.append(_BoolLit(False))
                return

            self._formulas.append(expr)

        def check(self) -> "_Status":
            for f in self._formulas:
                try:
                    if not f._eval(self._assignment):
                        return unsat
                except Exception:
                    return unsat
            return sat


    # Monkey-patch Bool equality so Bool('x') == True produces an assignment expression
    def _bool_eq(self, other):
        if isinstance(other, bool):
            return _Compound("==", self, _BoolLit(other))
        return NotImplemented

    # Apply to the simple Bool objects created by the Bool() constructor
    # (they're BoolRef instances but with instance-level method overrides via lambda)
    BoolRef.__eq__ = _bool_eq   # type: ignore[method-assign]
    BoolRef.__hash__ = lambda self: hash(getattr(self, '_name', id(self)))  # type: ignore[method-assign]
