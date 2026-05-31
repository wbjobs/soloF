import ast
import operator
from typing import Any, Callable, Dict, Optional, Union


OpNode = Union[ast.AST, str, int, float, bool]


class ExpressionEvaluator:
    _BIN_OPS = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Mod: operator.mod,
        ast.Pow: operator.pow,
        ast.Gt: operator.gt,
        ast.Lt: operator.lt,
        ast.GtE: operator.ge,
        ast.LtE: operator.le,
        ast.Eq: operator.eq,
        ast.NotEq: operator.ne,
    }

    _BOOL_OPS = {
        ast.And: all,
        ast.Or: any,
    }

    _UNARY_OPS = {
        ast.Not: operator.not_,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,
    }

    @staticmethod
    def parse(expr_str: str) -> ast.Expression:
        try:
            return ast.parse(expr_str, mode="eval")
        except SyntaxError as e:
            raise ValueError(f"Invalid expression: {expr_str}. Error: {e}")

    @classmethod
    def evaluate(cls, expr: Union[str, ast.AST], row: Dict[str, Any]) -> Any:
        if isinstance(expr, str):
            expr = cls.parse(expr)

        if isinstance(expr, ast.Expression):
            return cls._eval_node(expr.body, row)

        return cls._eval_node(expr, row)

    @classmethod
    def _eval_node(cls, node: ast.AST, row: Dict[str, Any]) -> Any:
        if isinstance(node, ast.Constant):
            return node.value

        if isinstance(node, ast.Name):
            if node.id in row:
                return row[node.id]
            raise ValueError(f"Column '{node.id}' not found in row")

        if isinstance(node, ast.BinOp):
            left = cls._eval_node(node.left, row)
            right = cls._eval_node(node.right, row)
            op_type = type(node.op)
            if op_type in cls._BIN_OPS:
                return cls._BIN_OPS[op_type](left, right)
            raise ValueError(f"Unsupported binary operator: {op_type.__name__}")

        if isinstance(node, ast.BoolOp):
            values = [cls._eval_node(v, row) for v in node.values]
            op_type = type(node.op)
            if op_type in cls._BOOL_OPS:
                return cls._BOOL_OPS[op_type](values)
            raise ValueError(f"Unsupported boolean operator: {op_type.__name__}")

        if isinstance(node, ast.UnaryOp):
            operand = cls._eval_node(node.operand, row)
            op_type = type(node.op)
            if op_type in cls._UNARY_OPS:
                return cls._UNARY_OPS[op_type](operand)
            raise ValueError(f"Unsupported unary operator: {op_type.__name__}")

        if isinstance(node, ast.Compare):
            left = cls._eval_node(node.left, row)
            result = True
            for op, comparator in zip(node.ops, node.comparators):
                right = cls._eval_node(comparator, row)
                op_type = type(op)
                if op_type in cls._BIN_OPS:
                    if not cls._BIN_OPS[op_type](left, right):
                        result = False
                        break
                else:
                    raise ValueError(f"Unsupported comparison operator: {op_type.__name__}")
                left = right
            return result

        raise ValueError(f"Unsupported AST node type: {type(node).__name__}")

    @staticmethod
    def to_string(expr: ast.AST) -> str:
        return ast.unparse(expr)


def safe_convert(value: str) -> Any:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    return value
