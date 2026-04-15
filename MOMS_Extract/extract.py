"""
MOMS Checklist Extractor — Universal v3
=========================================
Dynamically resolves column headers and row labels for ANY WI structure.
No hardcoded column positions. Works for radio checklists, measurement
tables, form-style WIs, and mixed layouts.

Key algorithm:
  For every input control at (row R, col C):
    1. ColumnHeader  = scan upward from R for nearest Header row covering C
    2. RowLabel      = scan left on same row R for nearest Label/Header
    3. FullFieldName = ColumnHeader + " > " + RowLabel (if both exist)

Sheets produced:
  Summary          — run stats and result distribution
  Checklist_Steps  — one row per input, fully labelled
  Raw_Controls     — every control with full metadata (AI/ML feed)

Usage:
    python extract.py --wi SIG/WR/PMW/0007
    python extract.py --wi SIG/WR/PMW/0007 --limit 500
    python extract.py --wi SIG/WR/PMW/0007 --limit 0      (all records)
    python extract.py --wi SIG/WR/PMW/0007 --output C:/data

Author: SMRT Technical Operations
"""

import argparse
import logging
import os
import re
import sys
from datetime import datetime

import pandas as pd
import pyodbc
import xml.etree.ElementTree as ET
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

# ── LOGGING ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ── DATABASE CONFIG ───────────────────────────────────────────────────────────
DB_CONFIG = {
    "driver":   "SQL Server",
    "server":   "SQLRAILAGLP1",
    "port":     "9762",
    "database": "SMRT_MOMS_DB",
}

# ── CONTROL TYPE CLASSIFICATION ───────────────────────────────────────────────
CTRL_CATEGORY = {
    "Radio":    "result",
    "DropDown": "selection",
    "Textbox":  "measurement",
    "TextArea": "narrative",
    "Remark":   "remark",
    "CheckBox": "confirmation",
    "Date":     "datetime",
    "Header":   "layout",
    "Label":    "layout",
    "SignPad":  "signature",
    "Initials": "signature",
}

INPUT_CATEGORIES = {
    "result", "selection", "measurement",
    "narrative", "remark", "confirmation", "datetime"
}

# Excel colours
COLORS = {
    "header_bg":  "1F4E79",
    "section_bg": "2E75B6",
    "ok_bg":      "E2EFDA",
    "nok_bg":     "FCE4D6",
    "na_bg":      "FFF2CC",
    "alt_row":    "F2F2F2",
    "white":      "FFFFFF",
    "warn":       "C00000",
}


# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_connection():
    conn_str = (
        f"DRIVER={{{DB_CONFIG['driver']}}};"
        f"SERVER={DB_CONFIG['server']},{DB_CONFIG['port']};"
        f"DATABASE={DB_CONFIG['database']};"
        f"Trusted_Connection=yes;"
    )
    try:
        conn = pyodbc.connect(conn_str, timeout=30)
        log.info(f"Connected to {DB_CONFIG['database']} on {DB_CONFIG['server']}")
        return conn
    except pyodbc.Error as e:
        log.error(f"Connection failed: {e}")
        sys.exit(1)


def fetch_records(wi_number, limit):
    conn   = get_connection()
    cursor = conn.cursor()
    top    = f"TOP {limit}" if limit > 0 else ""
    cursor.execute(f"""
        SELECT {top}
            ID, Checklist, WorkOrderID,
            ChecklistTemplateID, ChecklistTemplateLookup,
            Description, Created, CreatedBy,
            Modified, ModifiedBy, FilledBy, VersionNo, IsDeleted
        FROM   Checklist
        WHERE  IsDeleted = 0
          AND  ChecklistTemplateID = ?
        ORDER  BY ID DESC
    """, (wi_number,))
    rows = cursor.fetchall()
    conn.close()
    log.info(f"Fetched {len(rows):,} records for WI: {wi_number}")
    return rows


# ── XML SECTION MODEL ─────────────────────────────────────────────────────────
def build_section_model(section):
    """
    Build a rich model of a section with two indexes:
      row_map[row]     = [ctrl, ...]       — all controls on a row
      col_map[col]     = [ctrl, ...]       — all controls in a column
      header_rows      = sorted list of row numbers that are pure Header rows
      col_header_map   = {(header_row, col): label} — header labels by position
    """
    row_map = {}
    col_map = {}

    for ctrl in section.findall(".//ControlBase"):
        r   = int(ctrl.findtext("Row",         "0"))
        c   = int(ctrl.findtext("Column",      "0"))
        cs  = int(ctrl.findtext("ColumnSpan",  "1"))
        t   =     ctrl.findtext("Type",        "")
        lbl =     ctrl.findtext("Label",       "").strip()\
                      .replace("#lbh#", " ").replace("\n", " ").strip()
        dat =     ctrl.findtext("Data",        "").strip()

        ctrl_dict = {
            "row":      r,
            "col":      c,
            "col_span": cs,
            "type":     t,
            "label":    lbl,
            "data":     dat,
            "group":    ctrl.findtext("GroupName",    "").strip(),
            "name":     ctrl.findtext("n",            "").strip(),
            "mandatory":ctrl.findtext("Mandatory",    ""),
            "dd_items": ctrl.findtext("DropDownItems","").strip(),
            "min_val":  ctrl.findtext("Min",          "").strip(),
            "max_val":  ctrl.findtext("Max",          "").strip(),
        }

        row_map.setdefault(r, []).append(ctrl_dict)
        # Register this control against every column it spans
        for offset in range(cs):
            col_map.setdefault(c + offset, []).append(ctrl_dict)

    # Find pure header rows (all non-empty controls are Headers)
    # and build a col-position → label lookup per header row
    header_rows      = []   # list of row numbers
    col_header_map   = {}   # (row, col) -> label

    for r, controls in sorted(row_map.items()):
        non_empty = [c for c in controls if c["label"] or c["data"]]
        if not non_empty:
            continue
        all_hdrs = all(c["type"] == "Header" for c in non_empty)
        has_lbl  = any(c["label"] for c in non_empty)
        if all_hdrs and has_lbl and len(non_empty) >= 2:
            header_rows.append(r)
            for c in non_empty:
                for offset in range(c["col_span"]):
                    col_header_map[(r, c["col"] + offset)] = c["label"]

    return {
        "row_map":       row_map,
        "col_map":       col_map,
        "header_rows":   sorted(header_rows),
        "col_header_map":col_header_map,
    }


# ── DYNAMIC HEADER RESOLUTION ─────────────────────────────────────────────────
def resolve_column_header(model, ctrl_row, ctrl_col):
    """
    Find the most relevant column header for an input control at (ctrl_row, ctrl_col).
    Scans upward from ctrl_row to find the nearest header row that covers ctrl_col.
    Returns the header label string or empty string.
    """
    col_header_map = model["col_header_map"]
    header_rows    = model["header_rows"]

    # Find header rows that are above this control (strictly less than)
    above = [r for r in header_rows if r < ctrl_row]
    if not above:
        return ""

    # Start from closest header row and work upward
    for hdr_row in sorted(above, reverse=True):
        label = col_header_map.get((hdr_row, ctrl_col), "")
        if label:
            # Skip generic WI title headers — not useful as field names
            if any(skip in label for skip in ["WI TITLE", "WR NO.", "WI NO.", "Page"]):
                continue
            return label

    return ""


def resolve_row_label(model, ctrl_row, ctrl_col):
    """
    Find the row label for an input control at (ctrl_row, ctrl_col).
    Scans left on the same row for the nearest Label or Header control.
    Returns the label string or empty string.
    """
    row_controls = model["row_map"].get(ctrl_row, [])

    # Get all label-type controls to the left of this input
    left_labels = [
        c for c in row_controls
        if c["type"] in ("Label", "Header")
        and c["col"] < ctrl_col
        and c["label"]
    ]

    if not left_labels:
        return ""

    # Return the closest one to the left
    return max(left_labels, key=lambda c: c["col"])["label"]


def build_full_field_name(col_header, row_label, ctrl_label):
    """
    Construct a meaningful field name from available context.
    Priority: col_header > row_label > ctrl_label
    Combines both if both are meaningful and non-redundant.
    """
    parts = []

    # Clean up col_header — remove excessive whitespace/tabs
    if col_header:
        clean_hdr = re.sub(r"\s+", " ", col_header).strip()
        # Truncate very long headers (keep meaningful part)
        if len(clean_hdr) > 60:
            clean_hdr = clean_hdr[:60].rsplit(" ", 1)[0] + "..."
        parts.append(clean_hdr)

    if row_label:
        clean_row = re.sub(r"\s+", " ", row_label).strip()
        # Only add row label if it's not already contained in col_header
        if clean_row and clean_row.lower() not in (col_header or "").lower():
            parts.append(clean_row)

    if not parts and ctrl_label:
        parts.append(ctrl_label)

    return " > ".join(parts) if parts else ""


# ── RADIO RESULT ──────────────────────────────────────────────────────────────
def radio_result(row_controls):
    """Resolve OK/NOK/NA from radio buttons on a row."""
    radio_map = {
        c["col"]: c["data"]
        for c in row_controls if c["type"] == "Radio"
    }
    if radio_map.get(6) == "true": return "OK"
    if radio_map.get(7) == "true": return "NOK"
    if radio_map.get(8) == "true": return "NA"
    return ""


# ── METADATA DETECTION ────────────────────────────────────────────────────────
def detect_wi_metadata(root):
    """
    Extract form-level metadata from first section header controls.
    Flexible — does not assume fixed row/col positions.
    """
    meta = {
        "WI_Title":    "",
        "WI_Number":   "",
        "WR_Number":   "",
        "MaintOrder":  "",
        "Station":     "",
        "EquipmentID": "",
        "Multimeter":  "",
    }

    all_ctrls = root.findall(".//ControlBase")

    # Build a flat list for scanning
    flat = []
    for ctrl in all_ctrls:
        flat.append({
            "row":   int(ctrl.findtext("Row", "0")),
            "col":   int(ctrl.findtext("Column", "0")),
            "cs":    int(ctrl.findtext("ColumnSpan", "1")),
            "type":  ctrl.findtext("Type", ""),
            "label": ctrl.findtext("Label", "").strip().replace("#lbh#", " "),
            "data":  ctrl.findtext("Data", "").strip(),
        })

    def adjacent_input(header_fragment):
        """Find the input value adjacent to a header with a given label fragment."""
        matches = [
            c for c in flat
            if c["type"] == "Header"
            and header_fragment.lower() in c["label"].lower()
        ]
        if not matches:
            return ""
        hdr = matches[0]
        # Look for input on same row, to the right
        candidates = sorted(
            [c for c in flat
             if c["row"] == hdr["row"]
             and c["type"] in ("Textbox", "DropDown", "Date")
             and c["col"] > hdr["col"]],
            key=lambda x: x["col"]
        )
        return candidates[0]["data"] if candidates else ""

    # WI Title — longest Header label in first 3 rows
    title_candidates = [
        c for c in flat
        if c["type"] == "Header"
        and c["row"] <= 3
        and len(c["label"]) > 15
        and not any(skip in c["label"].upper()
                    for skip in ["WI TITLE", "WI NO", "WR NO", "PAGE"])
    ]
    if title_candidates:
        meta["WI_Title"] = max(title_candidates, key=lambda x: len(x["label"]))["label"]

    # WI Number — Header with slash pattern e.g. SIG/WI/PMW/0007 REV 14
    for c in flat:
        if c["type"] == "Header" and c["row"] <= 5:
            if re.search(r"[A-Z]+/[A-Z]+/", c["label"]) and not meta["WI_Number"]:
                if "WI" in c["label"] or "wi" in c["label"].lower():
                    meta["WI_Number"] = c["label"]
            if re.search(r"[A-Z]+/[A-Z]+/", c["label"]) and "WR" in c["label"]:
                if not meta["WR_Number"]:
                    meta["WR_Number"] = c["label"]

    meta["MaintOrder"]  = adjacent_input("Maintenance Order")
    meta["Station"]     = adjacent_input("Station")
    meta["EquipmentID"] = adjacent_input("Equipment ID")
    meta["Multimeter"]  = adjacent_input("Multimeter")

    return meta


# ── SUBSECTION CONTEXT ────────────────────────────────────────────────────────
def update_context(ctx, row_controls, row_num):
    """
    Detect subsection headers (17.x, 17.x.x) and update context dict.
    Returns True if this row is a context-only row (should not emit data).
    """
    non_empty = [c for c in row_controls if c["label"] or c["data"]]
    all_hdrs  = non_empty and all(c["type"] in ("Header", "Label") for c in non_empty)

    if not all_hdrs:
        return False

    # Check col 0 for subsection number pattern
    col0_labels = [c["label"] for c in non_empty if c["col"] == 0 and c["label"]]
    col2_labels = [c["label"] for c in non_empty if c["col"] == 2 and c["label"]]

    if col0_labels:
        lbl0 = col0_labels[0]

        # Subsection: 17.1 / 17.2 etc
        if re.match(r"^\d+\.\d+$", lbl0) and col2_labels:
            ctx["subsection_no"]   = lbl0
            ctx["subsection_name"] = col2_labels[0]
            ctx["subitem_no"]      = ""
            ctx["subitem_name"]    = ""
            return True

        # Sub-item: 17.1.1 etc (label spanning >= 5 cols)
        col2_span = next(
            (c["col_span"] for c in non_empty if c["col"] == 2), 1
        )
        if re.match(r"^\d+\.\d+\.\d+$", lbl0) and col2_span >= 5:
            ctx["subitem_no"]   = lbl0
            ctx["subitem_name"] = col2_labels[0] if col2_labels else ""
            return True

    return False


# ── CORE PARSER ───────────────────────────────────────────────────────────────
def parse_record(row):
    """
    Parse one MOMS record. Returns:
      { 'steps': [...], 'raw': [...], 'error': str|None }
    """
    record_id = row.ID
    xml_str   = row.Checklist
    out       = {"steps": [], "raw": [], "error": None}

    if not xml_str or not str(xml_str).strip():
        out["error"] = "Empty XML"
        return out

    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError as e:
        out["error"] = f"XML parse error: {e}"
        return out

    # ── Base record metadata ──────────────────────────────────────────────────
    base = {
        "ID":          record_id,
        "WorkOrderID": str(row.WorkOrderID or "").strip(),
        "TemplateID":  str(row.ChecklistTemplateID or "").strip(),
        "Template":    str(row.ChecklistTemplateLookup or "").strip(),
        "Created":     row.Created,
        "CreatedBy":   str(row.CreatedBy or "").strip(),
        "FilledBy":    str(row.FilledBy or "").strip(),
        "VersionNo":   row.VersionNo,
    }

    form_meta = detect_wi_metadata(root)
    base      = {**base, **form_meta}

    sections = root.findall(".//Section")

    for sec_idx, section in enumerate(sections):
        sec_name = section.findtext("n", "").strip() or f"Section_{sec_idx}"

        # Skip sections with no analytical controls
        type_counts = {}
        for c in section.findall(".//ControlBase"):
            t = c.findtext("Type", "")
            type_counts[t] = type_counts.get(t, 0) + 1

        analytical = {
            t: v for t, v in type_counts.items()
            if CTRL_CATEGORY.get(t, "") in INPUT_CATEGORIES
        }
        if not analytical:
            continue

        # Build section model with header indexes
        model = build_section_model(section)

        # Subsection context tracker
        ctx = {
            "subsection_no":   "",
            "subsection_name": "",
            "subitem_no":      "",
            "subitem_name":    "",
        }

        for row_num in sorted(model["row_map"].keys()):
            row_controls = model["row_map"][row_num]

            # Update subsection context (returns True = context-only row, skip)
            if update_context(ctx, row_controls, row_num):
                continue

            # Collect input controls on this row
            inputs = [
                c for c in row_controls
                if CTRL_CATEGORY.get(c["type"], "") in INPUT_CATEGORIES
            ]
            if not inputs:
                continue

            # ── For each input control, resolve full label context ─────────────
            for ctrl in inputs:
                ctrl_type = ctrl["type"]
                category  = CTRL_CATEGORY.get(ctrl_type, "other")
                raw_value = ctrl["data"]

                # ── DYNAMIC HEADER RESOLUTION ─────────────────────────────────
                col_header = resolve_column_header(model, row_num, ctrl["col"])
                row_label  = resolve_row_label(model, row_num, ctrl["col"])
                field_name = build_full_field_name(col_header, row_label, ctrl["label"])

                # ── Normalise value per control type ──────────────────────────
                if ctrl_type == "Radio":
                    # Only emit one row per radio group (col 6 = OK trigger)
                    if ctrl["col"] != 6:
                        continue
                    value      = radio_result(row_controls)
                    # For radio, field_name = step description (col 2 label)
                    step_label = next(
                        (c["label"] for c in row_controls
                         if c["type"] == "Label" and c["col"] == 2),
                        field_name
                    )
                    field_name = step_label or field_name

                elif ctrl_type == "CheckBox":
                    value = "YES" if raw_value == "true" else (
                            "NO"  if raw_value == "false" else "")

                else:
                    value = raw_value

                # Step number (col 0 label) for checklist rows
                step_no = next(
                    (c["label"] for c in row_controls
                     if c["type"] == "Label" and c["col"] == 0),
                    ""
                )

                # Inline remark for radio steps (col 9)
                inline_remark = next(
                    (c["data"] for c in row_controls
                     if c["type"] in ("Remark", "TextArea") and c["col"] == 9),
                    ""
                ) if ctrl_type == "Radio" else ""

                # ── Checklist_Steps row ───────────────────────────────────────
                out["steps"].append({
                    **base,
                    "SectionIdx":     sec_idx,
                    "SectionName":    sec_name,
                    "SubSectionNo":   ctx["subsection_no"],
                    "SubSectionName": ctx["subsection_name"],
                    "SubItemNo":      ctx["subitem_no"],
                    "SubItemName":    ctx["subitem_name"],
                    "StepNo":         step_no,
                    "FieldLabel":     field_name,
                    "ColHeader":      col_header,     # <- raw column header
                    "RowLabel":       row_label,       # <- raw row label
                    "CtrlType":       ctrl_type,
                    "Category":       category,
                    "Value":          value,
                    "IsFilled":       bool(value),
                    "IsNOK":          value == "NOK",
                    "Remark":         inline_remark,
                    "HasRemark":      bool(inline_remark),
                    "DropDownOpts":   ctrl["dd_items"],
                    "Mandatory":      ctrl["mandatory"],
                    "GridRow":        row_num,
                    "GridCol":        ctrl["col"],
                })

                # ── Raw_Controls row (full fidelity) ──────────────────────────
                out["raw"].append({
                    **base,
                    "SectionIdx":   sec_idx,
                    "SectionName":  sec_name,
                    "GridRow":      row_num,
                    "GridCol":      ctrl["col"],
                    "ColSpan":      ctrl["col_span"],
                    "CtrlType":     ctrl_type,
                    "Category":     category,
                    "ColHeader":    col_header,
                    "RowLabel":     row_label,
                    "FieldLabel":   field_name,
                    "CtrlLabel":    ctrl["label"],
                    "CtrlName":     ctrl["name"],
                    "GroupName":    ctrl["group"],
                    "RawValue":     raw_value,
                    "DropDownOpts": ctrl["dd_items"],
                    "Mandatory":    ctrl["mandatory"],
                    "MinVal":       ctrl["min_val"],
                    "MaxVal":       ctrl["max_val"],
                })

    return out


# ── SUMMARY ───────────────────────────────────────────────────────────────────
def build_summary(df_steps, wi_number, limit, record_count, error_count):
    if df_steps.empty:
        filled = nok = ok = na = total_steps = 0
        ctrl_dist = {}
        cat_dist  = {}
    else:
        filled      = df_steps[df_steps["IsFilled"] == True]["ID"].nunique()
        nok         = int(df_steps["IsNOK"].sum())
        val_counts  = df_steps["Value"].value_counts()
        ok          = int(val_counts.get("OK",  0))
        na          = int(val_counts.get("NA",  0))
        total_steps = len(df_steps)
        ctrl_dist   = df_steps["CtrlType"].value_counts().to_dict()
        cat_dist    = df_steps["Category"].value_counts().to_dict()

    rows = [
        ("── Extraction Info ──",    ""),
        ("WI Number",                wi_number),
        ("Extracted On",             datetime.now().strftime("%Y-%m-%d %H:%M")),
        ("Record Limit",             str(limit) if limit > 0 else "All records"),
        ("",                         ""),
        ("── Record Counts ──",      ""),
        ("Total Records Pulled",     record_count),
        ("Filled Records",           filled),
        ("Empty / Draft Records",    record_count - filled),
        ("Parse Errors",             error_count),
        ("",                         ""),
        ("── Step Results ──",       ""),
        ("Total Step Rows",          total_steps),
        ("OK Responses",             ok),
        ("NOK Responses",            nok),
        ("NA Responses",             na),
        ("",                         ""),
        ("── Control Types ──",      ""),
    ] + [(f"  {k}", v) for k, v in sorted(ctrl_dist.items())] + [
        ("",                         ""),
        ("── Categories ──",         ""),
    ] + [(f"  {k}", v) for k, v in sorted(cat_dist.items())]

    return pd.DataFrame(rows, columns=["Metric", "Value"])


# ── EXCEL FORMATTING ──────────────────────────────────────────────────────────
def _font(bold=False, color="000000", size=10):
    return Font(name="Arial", bold=bold, color=color, size=size)

def _fill(hex_color):
    return PatternFill("solid", fgColor=hex_color)

def _border():
    s = Side(style="thin", color="CCCCCC")
    return Border(left=s, right=s, top=s, bottom=s)


def format_sheet(ws, col_widths, result_col=None, freeze_col=4):
    """Apply consistent formatting to a data worksheet."""
    for cell in ws[1]:
        cell.font      = _font(bold=True, color="FFFFFF")
        cell.fill      = _fill(COLORS["header_bg"])
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)
        cell.border    = _border()
    ws.row_dimensions[1].height = 32

    for row_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
        bg = COLORS["alt_row"] if row_idx % 2 == 0 else COLORS["white"]
        for cell in row:
            cell.font      = _font()
            cell.border    = _border()
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            if result_col and cell.column_letter == result_col:
                val = str(cell.value or "").strip()
                if   val == "OK":  cell.fill = _fill(COLORS["ok_bg"])
                elif val == "NOK":
                    cell.fill = _fill(COLORS["nok_bg"])
                    cell.font = _font(bold=True, color=COLORS["warn"])
                elif val == "NA":  cell.fill = _fill(COLORS["na_bg"])
                else:              cell.fill = _fill(bg)
            else:
                cell.fill = _fill(bg)

    for col_letter, width in col_widths.items():
        ws.column_dimensions[col_letter].width = width

    ws.freeze_panes    = ws.cell(row=2, column=freeze_col + 1)
    ws.auto_filter.ref = ws.dimensions


def format_summary(ws):
    ws.column_dimensions["A"].width = 35
    ws.column_dimensions["B"].width = 30
    for row in ws.iter_rows():
        for cell in row:
            val = str(cell.value or "")
            if val.startswith("──"):
                cell.font = _font(bold=True, color="FFFFFF")
                cell.fill = _fill(COLORS["section_bg"])
            else:
                cell.font = _font(size=10)
                cell.fill = _fill(COLORS["white"])
            cell.border    = _border()
            cell.alignment = Alignment(vertical="center")
        ws.row_dimensions[row[0].row].height = 20


def apply_formatting(path):
    wb = load_workbook(path)

    if "Summary" in wb.sheetnames:
        format_summary(wb["Summary"])

    if "Checklist_Steps" in wb.sheetnames:
        ws = wb["Checklist_Steps"]
        val_col = next(
            (c.column_letter for c in ws[1] if str(c.value) == "Value"), None
        )
        format_sheet(ws, {
            "A": 8,  "B": 14, "C": 14, "D": 28, "E": 20,
            "F": 18, "G": 18, "H": 14, "I": 14, "J": 14,
            "K": 12, "L": 35, "M": 20, "N": 20, "O": 12,
            "P": 12, "Q": 30, "R": 8,  "S": 8,  "T": 8,
            "U": 8,  "V": 20, "W": 8,  "X": 8,
        }, result_col=val_col, freeze_col=5)

    if "Raw_Controls" in wb.sheetnames:
        ws = wb["Raw_Controls"]
        format_sheet(ws, {
            "A": 8,  "B": 14, "C": 14, "D": 28, "E": 8,
            "F": 8,  "G": 12, "H": 12, "I": 20, "J": 20,
            "K": 35, "L": 20, "M": 20, "N": 12, "O": 30,
            "P": 8,  "Q": 8,  "R": 8,  "S": 8,
        }, freeze_col=4)

    wb.save(path)
    log.info("Formatting applied")


# ── OUTPUT ────────────────────────────────────────────────────────────────────
def safe_name(wi_number):
    return re.sub(r"[^\w]", "_", wi_number).strip("_")


def save_workbook(df_steps, df_raw, df_summary, wi_number, output_folder):
    os.makedirs(output_folder, exist_ok=True)
    ts       = datetime.now().strftime("%Y%m%d_%H%M")
    path     = os.path.join(output_folder, f"{safe_name(wi_number)}_{ts}.xlsx")

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        df_summary.to_excel(writer, sheet_name="Summary",
                            index=False, header=False)
        if not df_steps.empty:
            df_steps.drop(
                columns=["GridRow", "GridCol"], errors="ignore"
            ).to_excel(writer, sheet_name="Checklist_Steps", index=False)
        if not df_raw.empty:
            df_raw.to_excel(writer, sheet_name="Raw_Controls", index=False)

    return path


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Extract MOMS checklist data for any WI number.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python extract.py --wi SIG/WR/PMW/0007
  python extract.py --wi SIG/WR/PMW/0007 --limit 1000
  python extract.py --wi SIG/WR/PMW/0007 --limit 0
  python extract.py --wi SIG/WR/PMW/0007 --output C:/Reports
        """
    )
    parser.add_argument("--wi",     required=True,
                        help="WI number e.g. SIG/WR/PMW/0007")
    parser.add_argument("--limit",  type=int, default=500,
                        help="Max records. 0 = all. Default: 500")
    parser.add_argument("--output", default="output",
                        help="Output folder. Default: output/")
    args = parser.parse_args()

    wi_number = args.wi.strip()
    log.info("=" * 60)
    log.info(f"  WI : {wi_number}  |  Limit : {args.limit or 'ALL'}")
    log.info("=" * 60)

    records = fetch_records(wi_number, args.limit)
    if not records:
        log.warning("No records found. Check WI number.")
        sys.exit(0)

    all_steps, all_raw, errors = [], [], []

    for i, row in enumerate(records, 1):
        parsed = parse_record(row)
        if parsed["error"]:
            errors.append({"ID": row.ID, "Error": parsed["error"]})
            log.warning(f"  Skipped {row.ID}: {parsed['error']}")
        else:
            all_steps.extend(parsed["steps"])
            all_raw.extend(parsed["raw"])
        if i % 100 == 0:
            log.info(f"  Parsed {i:,} / {len(records):,} ...")

    log.info(
        f"Parsing complete → "
        f"{len(all_steps):,} step rows | "
        f"{len(all_raw):,} raw rows | "
        f"{len(errors):,} errors"
    )

    df_steps   = pd.DataFrame(all_steps)
    df_raw     = pd.DataFrame(all_raw)
    df_summary = build_summary(
        df_steps, wi_number, args.limit, len(records), len(errors)
    )

    path = save_workbook(df_steps, df_raw, df_summary, wi_number, args.output)
    log.info(f"Saved: {path}")

    apply_formatting(path)

    if errors:
        err_path = os.path.join(
            args.output, f"{safe_name(wi_number)}_errors.csv"
        )
        pd.DataFrame(errors).to_csv(err_path, index=False)
        log.warning(f"Errors saved: {err_path}")

    nok_count = int(df_steps["IsNOK"].sum()) if not df_steps.empty else 0

    log.info("=" * 60)
    log.info(f"  WI Number      : {wi_number}")
    log.info(f"  Records        : {len(records):,}")
    log.info(f"  Step rows      : {len(df_steps):,}")
    log.info(f"  NOK responses  : {nok_count:,}")
    log.info(f"  Parse errors   : {len(errors):,}")
    log.info(f"  Output         : {path}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
