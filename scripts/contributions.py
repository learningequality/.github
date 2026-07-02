#!/usr/bin/env python3
"""
contributions.py — Contribution analytics from a CSV export of the contributions spreadsheet

Usage:
    python3 contributions.py summary --from YYYY-MM-DD --to YYYY-MM-DD [--source CSV_FILE]
    python3 contributions.py authors --from YYYY-MM-DD --to YYYY-MM-DD [--token TOKEN] [--source CSV_FILE]
    python3 contributions.py charts  --from YYYY-MM-DD --to YYYY-MM-DD [--source CSV_FILE] [--out-dir DIR]
"""

import argparse
import colorsys
import csv
import os
import re
import random
import sys
import urllib.request
import urllib.error
import json
from collections import defaultdict
from datetime import datetime, date
from calendar import month_name

# ── Pillow (required for chart rendering) ────────────────────────────────────
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Error: Pillow is required. Install it with: pip install Pillow")

# ── matplotlib (required for bar charts) ─────────────────────────────────────
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as ticker
except ImportError:
    sys.exit("Error: matplotlib is required. Install it with: pip install matplotlib")


# ── Constants ────────────────────────────────────────────────────────────────

SUMMARY_COLUMN = "Non-technical summary"

LORA_FONT = "/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf"
FALLBACK_FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]

RED   = "\033[31m"
RESET = "\033[0m"


# ── CSV helpers ───────────────────────────────────────────────────────────────

def load_csv(path):
    if not os.path.exists(path):
        sys.exit(f"Error: CSV file not found: {path}")
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def summary_col(rows):
    """Return the summary column name, or exit with an error if not found."""
    if rows and SUMMARY_COLUMN not in rows[0]:
        sys.exit(f"Error: expected column '{SUMMARY_COLUMN}' not found in CSV.")
    return SUMMARY_COLUMN


DATE_FORMATS = [
    "%Y-%m-%d",   # 2026-04-19  (canonical)
    "%m/%d/%Y",   # 04/19/2026
    "%d/%m/%Y",   # 19/04/2026
    "%Y/%m/%d",   # 2026/04/19
    "%d-%m-%Y",   # 19-04-2026
    "%B %d, %Y",  # April 19, 2026
    "%b %d, %Y",  # Apr 19, 2026
]

DATE_LIKE = re.compile(r'\d')  # any digit → looks like it was meant to be a date

# Known non-date values that are valid in the Merged column
MERGED_KEYWORDS = {"open", "closed", "hiatus"}


def _try_parse_date(raw):
    """
    Try to parse a raw cell value as a date.
    Strips leading apostrophes (Google Sheets text-prefix artefact).
    Returns a date on success, or None on failure.
    """
    s = raw.strip().lstrip("'").strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_date(s, flag):
    """Parse a CLI --from / --to argument. Exits with a clear message on failure."""
    d = _try_parse_date(s)
    if d is None:
        sys.exit(f"Error: {flag} value '{s}' is not a valid date (expected YYYY-MM-DD)")
    return d


def _row_label(r):
    """Short human-readable label for a row, used in error messages."""
    author = r.get("Author", "").strip()
    title  = r.get("Title",  "").strip()
    link   = r.get("Link",   "").strip()
    parts  = [f"@{author}" if author else "(no author)"]
    if title:
        parts.append(title)
    if link:
        parts.append(f"({link})")
    return " — ".join(parts[:2]) + (f" {parts[2]}" if len(parts) > 2 else "")


def _col_letter(idx):
    """Convert a 0-based column index to a spreadsheet column letter (A, B, … Z, AA, …)."""
    letter = ""
    idx += 1  # 1-based
    while idx:
        idx, rem = divmod(idx - 1, 26)
        letter = chr(65 + rem) + letter
    return letter


def merged_in_range(rows, start, end):
    """
    Rows whose Merged column is a date within [start, end].
    Prints a red warning to stderr for values that look date-like but cannot be parsed.
    Non-date keywords (open, closed, hiatus, empty) are silently skipped.
    Returns list of (date, row_number, row).
    """
    result  = []
    warnings = []
    for i, r in enumerate(rows, start=2):
        raw = r.get("Merged", "")
        s   = raw.strip().lstrip("'").strip()

        if not s or s.lower() in MERGED_KEYWORDS:
            if not s:
                warnings.append(
                    f"{RED}Warning: row {i} — Merged value is empty "
                    f"({_row_label(r)}); row skipped.{RESET}"
                )
            continue

        d = _try_parse_date(raw)
        if d is None:
            if DATE_LIKE.search(s):
                warnings.append(
                    f"{RED}Warning: row {i} — unrecognised Merged value {repr(raw)} "
                    f"({_row_label(r)}); row skipped.{RESET}"
                )
            continue

        if start <= d <= end:
            result.append((d, i, r))

    for w in warnings:
        print(w, file=sys.stderr)

    return result


def closed_in_range(rows, start, end):
    """
    Rows where Merged='closed' and Created date is within [start, end].
    Prints a red warning to stderr for Created values that look date-like but cannot be parsed.
    Returns list of (date, row_number, row).
    """
    result = []
    warnings = []
    for i, r in enumerate(rows, start=2):
        if r.get("Merged", "").strip().lstrip("'").strip().lower() != "closed":
            continue

        raw = r.get("Created", "")
        s   = raw.strip().lstrip("'").strip()
        d   = _try_parse_date(raw)
        if d is None:
            if s and DATE_LIKE.search(s):
                warnings.append(
                    f"{RED}Warning: row {i} — unrecognised Created value {repr(raw)} "
                    f"({_row_label(r)}); row skipped.{RESET}"
                )
            elif not s:
                warnings.append(
                    f"{RED}Warning: row {i} — Created value is empty "
                    f"({_row_label(r)}); row skipped.{RESET}"
                )
            continue

        if start <= d <= end:
            result.append((d, i, r))

    for w in warnings:
        print(w, file=sys.stderr)

    return result


def months_in_range(start, end):
    """Return list of (year, month) tuples for every month in [start, end]."""
    months = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months


def year_label(start, end):
    if start.year == end.year:
        return str(start.year)
    return f"{start.year}–{end.year}"


# ── summary command ───────────────────────────────────────────────────────────

def cmd_summary(args):
    start = parse_date(args.start, "--from")
    end   = parse_date(args.end,   "--to")
    rows  = load_csv(args.csv)
    col   = summary_col(rows)

    matched = merged_in_range(rows, start, end)
    if not matched:
        print("No merged PRs found in the given date range.")
        return

    # Group by author preserving chronological order within each author
    author_data = defaultdict(list)  # handle -> list of (date, summary, title, link)
    for d, row_num, r in sorted(matched, key=lambda x: x[0]):
        handle  = r.get("Author", "").strip()
        summary = r.get(col, "").strip()
        title   = r.get("Title", "").strip()
        link    = r.get("Link", "").strip()
        author_data[handle].append((d, summary, title, link))

    # Emit output
    for handle in sorted(author_data, key=str.casefold):
        entries = author_data[handle]
        seen, summaries = set(), []
        for _, summary, _, _ in entries:
            if summary:
                key = summary.lower()
                if key not in seen:
                    seen.add(key)
                    summaries.append(summary)

        if summaries:
            formatted = [summaries[0]]
            formatted += [s[0].lower() + s[1:] for s in summaries[1:]]
            line = ", ".join(formatted)
        else:
            line = ""

        print(f"@{handle} - {line}")

    # Warnings for missing summaries
    missing = [(d, row_num, r) for d, row_num, r in matched if not r.get(col, "").strip()]
    if missing:
        # Find the column letter for the summary column in the spreadsheet
        all_cols = list(rows[0].keys()) if rows else []
        col_idx  = all_cols.index(col) if col in all_cols else -1
        col_letter = _col_letter(col_idx) if col_idx >= 0 else "?"

        print(
            f"\n{RED}Error: Summary is incomplete. {len(missing)} contributions are missing a "
            f"non-technical summary. Fill the following cells in the spreadsheet and "
            f"re-run the script.{RESET}",
            file=sys.stderr,
        )
        cells = ", ".join(f"{col_letter}{row_num}" for _, row_num, r in missing)
        print(f"  {RED}{cells}{RESET}", file=sys.stderr)


# ── authors command ───────────────────────────────────────────────────────────

def resolve_github_name(handle, token):
    url = f"https://api.github.com/users/{handle}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "contributions-script",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("name") or None
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit("Error: GitHub token is invalid or unauthorised.")
        if e.code == 404:
            return None
        sys.exit(f"Error: GitHub API returned HTTP {e.code} for @{handle}.")
    except Exception as e:
        sys.exit(f"Error: Failed to reach GitHub API: {e}")


def cmd_authors(args):
    start = parse_date(args.start, "--from")
    end   = parse_date(args.end,   "--to")
    rows  = load_csv(args.csv)

    token = args.token or os.environ.get("GITHUB_TOKEN")
    if not token:
        sys.exit(
            "Error: A GitHub token is required. Provide it via --token or the "
            "GITHUB_TOKEN environment variable.\n"
            "To obtain a token: https://github.com/settings/tokens"
        )

    matched = merged_in_range(rows, start, end)
    if not matched:
        print("No merged PRs found in the given date range.")
        return

    handles = sorted(set(r.get("Author", "").strip() for _, _rn, r in matched), key=str.casefold)

    found, not_found = [], []
    for handle in handles:
        name = resolve_github_name(handle, token)
        if name:
            found.append((name, handle))
        else:
            not_found.append(handle)

    for name, handle in sorted(found, key=lambda x: x[0].casefold()):
        print(f"{name} (@{handle})")

    for handle in sorted(not_found, key=str.casefold):
        print(f"Name not found (@{handle})")


# ── chart helpers ─────────────────────────────────────────────────────────────

def _try_load_font(size):
    for path in [LORA_FONT] + FALLBACK_FONTS:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _generate_colors(n, seed=42):
    rng = random.Random(seed)
    golden = (1 + 5 ** 0.5) / 2
    colors = []
    offset = rng.random()
    for i in range(n):
        h = (offset + i / golden) % 1.0
        s = 0.55 + rng.random() * 0.3
        l = 0.38 + rng.random() * 0.18
        r, g, b = colorsys.hls_to_rgb(h, l, s)
        colors.append(f"#{int(r*255):02X}{int(g*255):02X}{int(b*255):02X}")
    return colors


def _hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


# ── activity dot chart (JPG only) ────────────────────────────────────────────

def generate_activity_charts(author_month_counts, months, year_lbl, out_dir):
    """
    author_month_counts: dict { handle: { (year, month): count } }
    months: list of (year, month) tuples in order
    """
    n_months = len(months)
    month_labels = [month_name[m] for _, m in months]

    # Sort authors alphabetically
    authors = sorted(author_month_counts.keys(), key=str.casefold)
    n_authors = len(authors)
    colors = _generate_colors(n_authors)

    row_h, top_pad, col_w, left_pad = 18, 30, 52, 100
    label_gap, label_area, right_pad = 30, 110, 44
    cx_vals = [left_pad + c * col_w + 26 for c in range(n_months)]
    chart_h = top_pad + n_authors * row_h
    svg_h = chart_h + label_gap + label_area
    svg_w = left_pad + n_months * col_w + right_pad
    scale = 2
    s = scale
    W, H = svg_w * s, svg_h * s
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    for r in range(n_authors + 1):
        y = (top_pad + r * row_h) * s
        draw.line([(left_pad - 4) * s, y, (svg_w - right_pad + 4) * s, y],
                  fill="#e0e0e0", width=max(1, s // 2))

    label_font = _try_load_font(16 * s)

    ly_px = (chart_h + label_gap + 10) * s
    for c, lbl in enumerate(month_labels):
        x = (cx_vals[c] - 4) * s
        txt_img = Image.new("RGBA", (200 * s, 20 * s), (255, 255, 255, 0))
        txt_draw = ImageDraw.Draw(txt_img)
        txt_draw.text((0, 0), lbl, fill="black", font=label_font)
        bbox = txt_img.getbbox()
        if bbox:
            txt_img = txt_img.crop(bbox)
        txt_img = txt_img.rotate(45, expand=True, resample=Image.BICUBIC)
        img.paste(txt_img, (int(x - txt_img.width), int(ly_px - txt_img.height // 2)), txt_img)

    author_font = _try_load_font(16 * s)
    author_bbox = draw.textbbox((0, 0), "Author", font=author_font)
    author_w = author_bbox[2] - author_bbox[0]
    draw.text(((left_pad // 2) * s - author_w // 2, (top_pad + 2) * s),
              "Author", fill="black", font=author_font)

    year_font = _try_load_font(16 * s)
    year_bbox = draw.textbbox((0, 0), year_lbl, font=year_font)
    year_w = year_bbox[2] - year_bbox[0]
    draw.text(((svg_w - 12) * s - year_w, (svg_h - 10) * s - (year_bbox[3] - year_bbox[1])),
              year_lbl, fill="black", font=year_font)

    for ai, handle in enumerate(authors):
        counts = author_month_counts[handle]
        row = [min(counts.get(ym, 0), 9) for ym in months]
        cy = (top_pad + ai * row_h + row_h // 2) * s
        color_rgb = _hex_to_rgb(colors[ai])
        active = [j for j in range(n_months) if row[j] > 0]
        if not active:
            continue

        runs, cur = [], [active[0]]
        for k in range(1, len(active)):
            if active[k] <= active[k-1] + 2:
                cur.append(active[k])
            else:
                runs.append(cur); cur = [active[k]]
        runs.append(cur)

        for run in runs:
            if len(run) >= 2:
                draw.line([(cx_vals[run[0]] * s, cy), (cx_vals[run[-1]] * s, cy)],
                          fill=color_rgb, width=max(1, int(1.5 * s)))

        for m_idx in active:
            rv = (3 + row[m_idx]) * s
            cx = cx_vals[m_idx] * s
            draw.ellipse([cx - rv - s, cy - rv - s, cx + rv + s, cy + rv + s], fill="white")
            draw.ellipse([cx - rv, cy - rv, cx + rv, cy + rv], fill=color_rgb)

    img = img.resize((svg_w, svg_h), Image.LANCZOS)
    jpg_path = os.path.join(out_dir, "activity.jpg")
    img.save(jpg_path, "JPEG", quality=95)

    return jpg_path


# ── bar charts ────────────────────────────────────────────────────────────────

BAR_COLOR = "#5B8ED6"

def _bar_chart(month_labels, values, title, out_path):
    fig, ax = plt.subplots(figsize=(9, 5.5))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    x = range(len(month_labels))
    ax.bar(x, values, color=BAR_COLOR, width=0.6, zorder=3)

    ax.set_xticks(list(x))
    ax.set_xticklabels(month_labels, rotation=45, ha="right",
                       fontsize=11, fontfamily="DejaVu Sans")
    ax.yaxis.set_major_locator(ticker.MaxNLocator(integer=True))
    ax.tick_params(axis="y", labelsize=11)

    ax.set_ylim(bottom=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.spines["bottom"].set_color("#cccccc")
    ax.tick_params(axis="x", length=0)
    ax.tick_params(axis="y", length=0)
    ax.yaxis.grid(True, color="#e0e0e0", linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)

    ax.set_title(title, fontsize=14, fontweight="bold", loc="left", pad=12,
                 fontfamily="DejaVu Sans")

    plt.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)


# ── charts command ────────────────────────────────────────────────────────────

def cmd_charts(args):
    start = parse_date(args.start, "--from")
    end   = parse_date(args.end,   "--to")
    rows  = load_csv(args.csv)

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    months     = months_in_range(start, end)
    month_lbls = [month_name[m] for _, m in months]
    year_lbl   = year_label(start, end)

    merged  = merged_in_range(rows, start, end)
    closed  = closed_in_range(rows, start, end)

    if not merged:
        print("No merged PRs found in the given date range.")

    # ── activity chart data ───────────────────────────────────────────────────
    author_month_counts = defaultdict(lambda: defaultdict(int))
    for d, _rn, r in merged:
        handle = r.get("Author", "").strip()
        author_month_counts[handle][(d.year, d.month)] += 1

    if author_month_counts:
        jpg_p = generate_activity_charts(author_month_counts, months, year_lbl, out_dir)
        print(f"Written: {jpg_p}")

    # ── merged bar chart ──────────────────────────────────────────────────────
    merged_by_month = defaultdict(int)
    for d, _rn, _r in merged:
        merged_by_month[(d.year, d.month)] += 1
    merged_vals = [merged_by_month[ym] for ym in months]

    total_merged = sum(merged_vals)
    _bar_chart(month_lbls, merged_vals,
               f"{total_merged} accepted contributions...",
               os.path.join(out_dir, "merged.jpg"))
    print(f"Written: {os.path.join(out_dir, 'merged.jpg')}")

    # ── authors bar chart ─────────────────────────────────────────────────────
    authors_by_month = defaultdict(set)
    for d, _rn, r in merged:
        authors_by_month[(d.year, d.month)].add(r.get("Author", "").strip())
    author_vals = [len(authors_by_month[ym]) for ym in months]

    total_authors = len(set(r.get("Author", "").strip() for _, _rn, r in merged))
    _bar_chart(month_lbls, author_vals,
               f"...by {total_authors} authors",
               os.path.join(out_dir, "authors.jpg"))
    print(f"Written: {os.path.join(out_dir, 'authors.jpg')}")

    # ── closed bar chart ──────────────────────────────────────────────────────
    closed_by_month = defaultdict(int)
    for d, _rn, _r in closed:
        closed_by_month[(d.year, d.month)] += 1
    closed_vals = [closed_by_month[ym] for ym in months]

    total_closed = sum(closed_vals)
    _bar_chart(month_lbls, closed_vals,
               f"{total_closed} canceled or rejected contributions",
               os.path.join(out_dir, "closed.jpg"))
    print(f"Written: {os.path.join(out_dir, 'closed.jpg')}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="contributions.py",
        description="Contribution analytics from a pull request CSV.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # shared date/csv args
    def add_common(p):
        p.add_argument("--from", dest="start", required=True, metavar="YYYY-MM-DD")
        p.add_argument("--to",   dest="end",   required=True, metavar="YYYY-MM-DD")
        p.add_argument("--source", dest="csv", default="contributions.csv", metavar="FILE")

    p_summary = sub.add_parser("summary", help="Per-author summary of contributions.")
    add_common(p_summary)

    p_authors = sub.add_parser("authors", help="Authors with full names from GitHub API.")
    add_common(p_authors)
    p_authors.add_argument("--token", default=None, metavar="TOKEN",
                           help="GitHub personal access token (default: $GITHUB_TOKEN)")

    p_charts = sub.add_parser("charts", help="Generate activity and bar charts.")
    add_common(p_charts)
    p_charts.add_argument("--out-dir", default=".", metavar="DIR",
                          help="Output directory for generated files (default: .)")

    args = parser.parse_args()

    if args.command == "summary":
        cmd_summary(args)
    elif args.command == "authors":
        cmd_authors(args)
    elif args.command == "charts":
        cmd_charts(args)


if __name__ == "__main__":
    main()
