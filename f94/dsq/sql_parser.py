import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Union


AGGREGATE_FUNCTIONS = {"COUNT", "SUM", "AVG"}


@dataclass
class SelectItem:
    raw: str
    is_aggregate: bool = False
    agg_func: Optional[str] = None
    agg_arg: Optional[str] = None
    column_name: Optional[str] = None

    def __post_init__(self):
        m = re.match(r'^\s*(COUNT|SUM|AVG)\s*\(\s*(.+?)\s*\)\s*$', self.raw, re.IGNORECASE)
        if m:
            self.is_aggregate = True
            self.agg_func = m.group(1).upper()
            self.agg_arg = m.group(2).strip()
            if self.agg_arg == "*":
                self.column_name = "*"
            else:
                self.column_name = self.agg_arg
        else:
            self.column_name = self.raw.strip()

    @property
    def display_name(self) -> str:
        return self.raw.strip()


@dataclass
class ParsedQuery:
    table_name: str
    select_items: List[SelectItem]
    where_condition: Optional[str] = None
    has_aggregate: bool = field(init=False)

    def __post_init__(self):
        self.has_aggregate = any(item.is_aggregate for item in self.select_items)


class SQLParser:
    _SELECT_RE = re.compile(
        r'^\s*SELECT\s+(.+?)\s+FROM\s+(\w+)\s*(?:WHERE\s+(.+))?\s*;?\s*$',
        re.IGNORECASE | re.DOTALL
    )

    @classmethod
    def parse(cls, sql: str) -> ParsedQuery:
        sql = sql.strip()
        m = cls._SELECT_RE.match(sql)
        if not m:
            raise ValueError(f"Unsupported SQL syntax: {sql}")

        select_clause = m.group(1).strip()
        table_name = m.group(2).strip()
        where_clause = m.group(3)

        if where_clause:
            where_clause = cls._normalize_where(where_clause.strip())

        select_items = cls._parse_select_items(select_clause)
        cls._validate_query(select_items, table_name)

        return ParsedQuery(
            table_name=table_name,
            select_items=select_items,
            where_condition=where_clause
        )

    @staticmethod
    def _parse_select_items(select_clause: str) -> List[SelectItem]:
        items = []
        current = ""
        paren_depth = 0
        in_string = False
        string_char = None

        for char in select_clause:
            if in_string:
                current += char
                if char == string_char:
                    in_string = False
                continue

            if char in ("'", '"'):
                in_string = True
                string_char = char
                current += char
                continue

            if char == '(':
                paren_depth += 1
                current += char
            elif char == ')':
                paren_depth -= 1
                current += char
            elif char == ',' and paren_depth == 0:
                items.append(SelectItem(raw=current.strip()))
                current = ""
            else:
                current += char

        if current.strip():
            items.append(SelectItem(raw=current.strip()))

        if not items:
            raise ValueError("No columns specified in SELECT")

        return items

    @staticmethod
    def _normalize_where(where_clause: str) -> str:
        normalized = where_clause
        normalized = re.sub(r'\bAND\b', 'and', normalized, flags=re.IGNORECASE)
        normalized = re.sub(r'\bOR\b', 'or', normalized, flags=re.IGNORECASE)
        normalized = re.sub(r'\bNOT\b', 'not ', normalized, flags=re.IGNORECASE)
        return normalized

    @classmethod
    def _validate_query(cls, select_items: List[SelectItem], table_name: str):
        has_aggregate = any(item.is_aggregate for item in select_items)
        has_non_aggregate = any(not item.is_aggregate for item in select_items)

        if has_aggregate and has_non_aggregate:
            raise ValueError(
                "Mixing aggregate and non-aggregate columns in SELECT is not supported"
            )

        for item in select_items:
            if item.is_aggregate:
                if item.agg_func not in AGGREGATE_FUNCTIONS:
                    raise ValueError(f"Unsupported aggregate function: {item.agg_func}")
