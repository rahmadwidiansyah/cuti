#!/usr/bin/env python3
"""Generate Database_Data_Dictionary.md from a live cuti schema.

Usage:
    CUTI_DSN=postgresql://postgres:postgres@localhost:55432/cuti_test \
        python3 Web/Database/tools/generate_data_dictionary.py
"""

from __future__ import annotations

import os
import subprocess
from collections import defaultdict
from datetime import date
from pathlib import Path

DSN = os.environ.get(
    "CUTI_DSN",
    "postgresql://postgres:postgres@localhost:55432/cuti_test",
)
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "Docs" / "Database_Data_Dictionary.md"


def query(sql: str) -> list[list[str]]:
    result = subprocess.run(
        ["psql", DSN, "-X", "-A", "-F", "\t", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=True,
        text=True,
        capture_output=True,
    )
    rows: list[list[str]] = []
    for line in result.stdout.splitlines():
        if line == "":
            continue
        rows.append(line.split("\t"))
    return rows


def esc(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ").strip()


def main() -> None:
    columns = query(
        """
        SELECT table_name, ordinal_position, column_name, data_type,
               COALESCE(character_maximum_length::text, ''),
               is_nullable, COALESCE(column_default, ''),
               is_identity::text, is_generated::text
        FROM information_schema.columns
        WHERE table_schema = 'cuti'
        ORDER BY table_name, ordinal_position
        """
    )
    tables = query(
        """
        SELECT c.relname,
               replace(replace(replace(COALESCE(obj_description(c.oid, 'pg_class'), ''),
                                       chr(10), ' '), chr(13), ' '), chr(9), ' ')
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'cuti' AND c.relkind = 'r'
        ORDER BY c.relname
        """
    )
    constraints = query(
        """
        SELECT c.relname, conname, contype,
               replace(replace(replace(pg_get_constraintdef(pg_constraint.oid),
                                       chr(10), ' '), chr(13), ' '), chr(9), ' ')
        FROM pg_constraint
        JOIN pg_class c ON c.oid = pg_constraint.conrelid
        WHERE connamespace = 'cuti'::regnamespace
        ORDER BY c.relname, conname
        """
    )
    indexes = query(
        """
        SELECT tablename, indexname,
               replace(replace(replace(indexdef, chr(10), ' '), chr(13), ' '), chr(9), ' ')
        FROM pg_indexes
        WHERE schemaname = 'cuti'
        ORDER BY tablename, indexname
        """
    )
    views = query(
        """
        SELECT table_name
        FROM information_schema.views
        WHERE table_schema = 'cuti'
        ORDER BY table_name
        """
    )
    functions = query(
        """
        SELECT routine_name, data_type
        FROM information_schema.routines
        WHERE routine_schema = 'cuti'
        ORDER BY routine_name
        """
    )

    cols_by_table: dict[str, list[list[str]]] = defaultdict(list)
    for row in columns:
        cols_by_table[row[0]].append(row)

    cons_by_table: dict[str, list[list[str]]] = defaultdict(list)
    for row in constraints:
        cons_by_table[row[0]].append(row)

    idx_by_table: dict[str, list[list[str]]] = defaultdict(list)
    for row in indexes:
        idx_by_table[row[0]].append(row)

    lines: list[str] = []
    lines.append("# Data Dictionary Database Modul Cuti")
    lines.append("")
    lines.append("**Dibuat:** " + date.today().strftime("%d %B %Y"))
    lines.append("")
    lines.append("**Sumber:** schema `cuti` pada PostgreSQL 15.")
    lines.append("")
    lines.append(
        "Dokumen ini dihasilkan dari database yang sudah dimigrasikan. "
        "Dokumen desain dan alasan keputusan ada di "
        "`Database_Design_Pengajuan_Cuti.md`; DDL ada di `Web/Database/001_schema.sql`."
    )
    lines.append("")
    lines.append("## Ringkasan objek")
    lines.append("")
    lines.append("| Objek | Jumlah |")
    lines.append("|---|---:|")
    lines.append(f"| Tabel | {len(tables)} |")
    lines.append(f"| View | {len(views)} |")
    lines.append(f"| Fungsi | {len(functions)} |")
    lines.append(
        "| Constraint | "
        + str(sum(len(v) for v in cons_by_table.values()))
        + " |"
    )
    lines.append(
        "| Index | " + str(sum(len(v) for v in idx_by_table.values())) + " |"
    )
    lines.append("")
    lines.append("## Tabel")
    lines.append("")

    for table_name, comment in tables:
        lines.append(f"### `{table_name}`")
        lines.append("")
        if comment:
            lines.append(comment)
            lines.append("")
        lines.append("| No | Kolom | Tipe | Null | Default | Identitas/Generated |")
        lines.append("|---:|---|---|---|---|---|")
        for row in cols_by_table.get(table_name, []):
            _, pos, name, data_type, max_len, nullable, default, is_identity, is_generated = row
            type_text = data_type
            if max_len:
                type_text += f"({max_len})"
            flags = []
            if is_identity == "YES":
                flags.append("identity")
            if is_generated in ("ALWAYS", "YES"):
                flags.append(f"generated ({is_generated})")
            lines.append(
                "| "
                + " | ".join(
                    [
                        pos,
                        f"`{name}`",
                        esc(type_text),
                        "YA" if nullable == "YES" else "TIDAK",
                        f"`{esc(default)}`" if default else "",
                        ", ".join(flags),
                    ]
                )
                + " |"
            )
        lines.append("")
        cons = cons_by_table.get(table_name, [])
        if cons:
            lines.append("**Constraint**")
            lines.append("")
            lines.append("| Nama | Jenis | Definisi |")
            lines.append("|---|---|---|")
            type_map = {
                "p": "PRIMARY KEY",
                "u": "UNIQUE",
                "f": "FOREIGN KEY",
                "c": "CHECK",
                "x": "EXCLUDE",
            }
            for _, conname, contype, definition in cons:
                lines.append(
                    f"| `{conname}` | {type_map.get(contype, contype)} | `{esc(definition)}` |"
                )
            lines.append("")
        idx = idx_by_table.get(table_name, [])
        if idx:
            lines.append("**Index**")
            lines.append("")
            lines.append("| Nama | Definisi |")
            lines.append("|---|---|")
            for _, indexname, definition in idx:
                lines.append(f"| `{indexname}` | `{esc(definition)}` |")
            lines.append("")

    lines.append("## View")
    lines.append("")
    for row in views:
        view_name = row[0]
        lines.append(f"### `{view_name}`")
        lines.append("")
        lines.append("| No | Kolom | Tipe | Null |")
        lines.append("|---:|---|---|---|")
        for col in cols_by_table.get(view_name, []):
            _, pos, name, data_type, max_len, nullable, _default, _identity, _generated = col
            type_text = data_type + (f"({max_len})" if max_len else "")
            lines.append(
                f"| {pos} | `{name}` | `{esc(type_text)}` | {'YA' if nullable == 'YES' else 'TIDAK'} |"
            )
        lines.append("")

    lines.append("## Fungsi")
    lines.append("")
    lines.append("| Nama | Tipe hasil |")
    lines.append("|---|---|")
    for name, data_type in functions:
        lines.append(f"| `{name}` | `{data_type}` |")
    lines.append("")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
