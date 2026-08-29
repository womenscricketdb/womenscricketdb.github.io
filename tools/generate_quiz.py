#!/usr/bin/env python3
"""
generate_quiz.py

Generates a 6-question daily quiz from the site's existing JSON data.
No manually maintained question bank -- every question is derived from
data/ at generation time. The random seed is the ISO date, so the same
day always produces the same quiz for every visitor, and re-running the
script for the same date is idempotent.

Usage:
    python3 tools/generate_quiz.py                 # generate today's quiz
    python3 tools/generate_quiz.py --date 2026-08-12
    python3 tools/generate_quiz.py --preview        # print without writing

Output:
    data/quiz/YYYY-MM-DD.json

Run from the repo root (paths below are relative to repo root).
"""

import argparse
import json
import random
import sys
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
QUIZ_OUT_DIR = DATA_DIR / "quiz"

QUESTIONS_PER_DAY = 6


# --------------------------------------------------------------------------
# Data loading helpers
# --------------------------------------------------------------------------

def load_json(rel_path):
    path = DATA_DIR / rel_path
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def rows_of(rel_path):
    """Return (columns, rows) for a {columns, rows} shaped record file."""
    d = load_json(rel_path)
    return d["columns"], d["rows"]


def col_index(columns, name):
    return columns.index(name)


def filter_overall(columns, rows, extra_filters=None):
    """
    Keep only rows representing the single all-time OVERALL record
    (Format/Season/*_Opposition_Tier all == 'OVERALL' where those
    columns exist). extra_filters is an optional dict of {col: value}
    for additional constraints.
    """
    return filter_by_format(columns, rows, "OVERALL", extra_filters)


FORMAT_CHOICES = ["OVERALL", "T20", "List A"]
FORMAT_LABEL = {
    "OVERALL": "combined T20 + List A",
    "T20": "T20",
    "List A": "List A",
}


def filter_by_format(columns, rows, format_value, season_value="OVERALL", extra_filters=None):
    """
    Keep rows for a specific Format ('OVERALL' | 'T20' | 'List A') and a
    specific Season ('OVERALL' for career-to-date, or a real season code
    like '19/20'), with any *_Opposition_Tier columns still pinned to
    'OVERALL'. extra_filters is an optional dict of {col: value} for
    additional constraints.
    """
    idxs = {}
    for c in columns:
        if c == "Format":
            idxs[c] = columns.index(c)
        elif c == "Season":
            idxs[c] = columns.index(c)
        elif c.endswith("_Opposition_Tier"):
            idxs[c] = columns.index(c)

    out = []
    for r in rows:
        ok = True
        for c, i in idxs.items():
            if c == "Format":
                want = format_value
            elif c == "Season":
                want = season_value
            else:
                want = "OVERALL"
            if r[i] != want:
                ok = False
                break
        if ok and extra_filters:
            for c, v in extra_filters.items():
                if r[columns.index(c)] != v:
                    ok = False
                    break
        if ok:
            out.append(r)
    return out


# Player-facing record files: (relative path, human label, holder column,
# value column used for the "explanation" line)
PLAYER_RECORD_FILES = [
    ("records/batting/json/Most_Runs.json", "Most Runs", "Player", "Runs"),
    ("records/batting/json/Highest_Score.json", "Highest Individual Score", "Player", "Runs Scored"),
    ("records/batting/json/100Plus_Scores.json", "Most 100+ Scores", "Player", "100+ Scores"),
    ("records/batting/json/50Plus_Scores.json", "Most 50+ Scores", "Player", "50+ Scores"),
    ("records/batting/json/Most_Sixes.json", "Most Sixes", "Player", "Sixes"),
    ("records/batting/json/Most_Fours.json", "Most Fours", "Player", "Fours"),
    ("records/batting/json/Batting_Average.json", "Best Batting Average", "Player", "Batting Average"),
    ("records/batting/json/Fastest_50.json", "Fastest 50 (by balls)", "Player", "Balls"),
    ("records/batting/json/Fastest_100.json", "Fastest 100 (by balls)", "Player", "Balls"),
    ("records/bowling/json/Most_Wickets.json", "Most Wickets", "Player", "Wickets"),
    ("records/bowling/json/Best_Bowl_Performance.json", "Best Bowling Figures in an Innings", "Player", "Bowling Figures"),
    ("records/bowling/json/Best_Bowl_Average.json", "Best Bowling Average", "Player", "Bowling Average"),
    ("records/bowling/json/Most_5Wickets.json", "Most 5-Wicket Hauls", "Player", "5-for's"),
    ("records/bowling/json/Most_Maidens.json", "Most Maidens", "Player", "Maidens"),
    ("records/fielding/json/Field_Catches.json", "Most Catches (Fielding)", "Player", "Catches (Field)"),
    ("records/fielding/json/WK_Dismissals.json", "Most Wicketkeeping Dismissals", "Player", "Wicketkeeping Dismissals"),
    ("records/partnerships/json/Highest_Partnership.json", "Highest Partnership", "Pair", "Runs"),
    ("records/misc/json/Most_Matches.json", "Most Matches Played", "Player", "Matches"),
    ("records/misc/json/Matches_Captained.json", "Most Matches as Captain", "Player", "Matches Captained"),
]

# Team-facing record files
TEAM_RECORD_FILES = [
    ("records/team/json/Highest_Total.json", "Highest Team Total", "Total"),
    ("records/team/json/Lowest_Total.json", "Lowest Team Total (all out or completed innings)", "Total"),
    ("records/team/json/Win_By_Runs.json", "Biggest Win by Runs", "Win Margin"),
    ("records/team/json/Most_Wins.json", "Most Wins", "Wins"),
]


# --------------------------------------------------------------------------
# Question templates
# Each returns a dict: {type, question, options, answer_index, explanation}
# or None if it couldn't generate a valid question (caller should retry).
# --------------------------------------------------------------------------

def _split_tied_top(rows, get_name, get_value, max_scan=10):
    """
    Walk best-first sorted rows and separate the top value's holders
    (ALL of them, if tied) from genuinely lower-ranked names. This
    exists specifically so a tied co-holder never gets used as a wrong
    decoy -- e.g. if two players share the record for most catches at
    a venue, marking either one "wrong" would be factually false.

    get_name/get_value are callables applied to each row (works for
    both list-rows via index and dict-rows via key, depending on caller).

    Returns (tied_top_names, top_value, decoy_candidates) where
    decoy_candidates are distinct names with a strictly lower value, in
    best-first order. tied_top_names is empty if there's nothing to work
    with.
    """
    seen_order = []
    seen_set = set()
    for r in rows:
        name = get_name(r)
        val = get_value(r)
        if name not in seen_set:
            seen_set.add(name)
            seen_order.append((name, val))
        if len(seen_order) >= max_scan:
            break
    if not seen_order:
        return [], None, []

    top_value = seen_order[0][1]
    tied_top = [n for n, v in seen_order if v == top_value]
    decoy_candidates = [n for n, v in seen_order if v != top_value]
    return tied_top, top_value, decoy_candidates


def _joint_holder_suffix(answer_name, tied_top):
    """', jointly with X and Y' if there were other tied top-holders, else ''."""
    others = [t for t in tied_top if t != answer_name]
    if not others:
        return ""
    if len(others) == 1:
        return f", a joint record shared with {others[0]}"
    return f", a joint record shared with {', '.join(others[:-1])} and {others[-1]}"



def _pick_record_scope(columns, rows, rng, fmt, min_rows=4):
    """
    Given a record file's (columns, rows) and a chosen format, pick a
    (season_value, filtered_rows) pair -- trying real seasons first (in
    random order) before falling back to the career-to-date 'OVERALL'
    scope, and finally falling back to a different format entirely if
    even that's too sparse. Returns (fmt, season_value, filtered_rows)
    or (fmt, None, []) if nothing usable was found.

    This is what turns "record" questions from ~19 files x 3 formats
    (~57 combos) into files x formats x seasons (roughly 15-20x more),
    which is the actual lever for reducing repeat frequency.
    """
    if "Season" not in columns:
        filtered = filter_by_format(columns, rows, fmt, "OVERALL")
        return fmt, ("OVERALL" if len(filtered) >= min_rows else None), filtered

    season_i = col_index(columns, "Season")
    fmt_i = col_index(columns, "Format") if "Format" in columns else None
    seasons = sorted(set(
        r[season_i] for r in rows
        if (fmt_i is None or r[fmt_i] == fmt) and r[season_i] != "OVERALL"
    ))
    rng.shuffle(seasons)

    for season in seasons:
        filtered = filter_by_format(columns, rows, fmt, season)
        if len(filtered) >= min_rows:
            return fmt, season, filtered

    # No real season had enough entries -- fall back to the combined
    # career-to-date figure for this format.
    filtered = filter_by_format(columns, rows, fmt, "OVERALL")
    if len(filtered) >= min_rows:
        return fmt, "OVERALL", filtered

    return fmt, None, []


def q_player_record(rng, used_files):
    candidates = [f for f in PLAYER_RECORD_FILES if f[0] not in used_files]
    if not candidates:
        candidates = PLAYER_RECORD_FILES
    rel_path, label, holder_col, value_col = rng.choice(candidates)

    columns, rows = rows_of(rel_path)

    fmt = rng.choice(FORMAT_CHOICES)
    scope_fmt, season, filtered = _pick_record_scope(columns, rows, rng, fmt)
    if season is None:
        # This format is entirely too sparse for this record -- try the
        # combined figure as a last resort.
        scope_fmt, season, filtered = "OVERALL", "OVERALL", filter_by_format(columns, rows, "OVERALL", "OVERALL")
        if len(filtered) < 4:
            return None
    fmt = scope_fmt

    holder_i = col_index(columns, holder_col)
    value_i = col_index(columns, value_col) if value_col in columns else None

    tied_top, top_value, decoy_candidates = _split_tied_top(
        filtered, lambda r: r[holder_i], lambda r: r[value_i] if value_i is not None else None
    )
    if not tied_top or len(decoy_candidates) < 3:
        return None

    answer_name = rng.choice(tied_top)
    answer_value = top_value
    decoys = decoy_candidates[:3]

    options = [answer_name] + decoys
    rng.shuffle(options)
    answer_index = options.index(answer_name)

    if season == "OVERALL":
        question = f"Who holds the record for '{label}' ({FORMAT_LABEL[fmt]})?"
    else:
        question = f"Who holds the record for '{label}' in the {season} season ({FORMAT_LABEL[fmt]})?"
    verb = "hold" if holder_col == "Pair" else "holds"
    explanation = f"{answer_name} {verb} it"
    if answer_value:
        # "total" is wrong for stats that aren't additive counts (an
        # average or a bowling figure like 6-11 isn't "a total of 46.21")
        non_total_cols = {"Batting Average", "Bowling Average", "Bowling Figures"}
        if value_col in non_total_cols:
            explanation += f" with {answer_value}"
        else:
            explanation += f", with a total of {answer_value}"
    explanation += _joint_holder_suffix(answer_name, tied_top) + "."

    return {
        "type": "player_record",
        "question": question,
        "options": options,
        "answer_index": answer_index,
        "explanation": explanation,
    }, rel_path


def q_team_record(rng, used_files):
    candidates = [f for f in TEAM_RECORD_FILES if f[0] not in used_files]
    if not candidates:
        candidates = TEAM_RECORD_FILES
    rel_path, label, value_col = rng.choice(candidates)

    columns, rows = rows_of(rel_path)

    fmt = rng.choice(FORMAT_CHOICES)
    scope_fmt, season, filtered = _pick_record_scope(columns, rows, rng, fmt)
    if season is None:
        scope_fmt, season, filtered = "OVERALL", "OVERALL", filter_by_format(columns, rows, "OVERALL", "OVERALL")
        if len(filtered) < 4:
            return None
    fmt = scope_fmt

    team_i = col_index(columns, "Team")
    value_i = col_index(columns, value_col) if value_col in columns else None

    tied_top, top_value, decoy_candidates = _split_tied_top(
        filtered, lambda r: r[team_i], lambda r: r[value_i] if value_i is not None else None
    )
    if not tied_top or len(decoy_candidates) < 3:
        return None

    answer_name = rng.choice(tied_top)
    answer_value = top_value
    decoys = decoy_candidates[:3]

    options = [answer_name] + decoys
    rng.shuffle(options)
    answer_index = options.index(answer_name)

    if season == "OVERALL":
        question = f"Which provincial union holds the record for '{label}' ({FORMAT_LABEL[fmt]})?"
    else:
        question = f"Which provincial union holds the record for '{label}' in the {season} season ({FORMAT_LABEL[fmt]})?"
    explanation = f"{answer_name}"
    if answer_value:
        explanation += f" — {answer_value}"
    explanation += _joint_holder_suffix(answer_name, tied_top) + "."

    return {
        "type": "team_record",
        "question": question,
        "options": options,
        "answer_index": answer_index,
        "explanation": explanation,
    }, rel_path


BATTING_ARCHIVE_FILES = {
    "OVERALL": "summaries/json/Archive_Batting_OVERALL.json",
    "T20": "summaries/json/Archive_Batting_T20.json",
    "List A": "summaries/json/Archive_Batting_List_A.json",
}
BOWLING_ARCHIVE_FILES = {
    "OVERALL": "summaries/json/Archive_Bowling_OVERALL.json",
    "T20": "summaries/json/Archive_Bowling_T20.json",
    "List A": "summaries/json/Archive_Bowling_List_A.json",
}
# Lower qualification bars for single-format views since individual-format
# career totals run smaller than the T20+List A combined figure.
BATTING_MIN_RUNS = {"OVERALL": 1500, "T20": 500, "List A": 1000}
BOWLING_MIN_WICKETS = {"OVERALL": 20, "T20": 10, "List A": 15}


def _batting_rows(fmt="OVERALL", min_runs=None):
    columns, rows = rows_of(BATTING_ARCHIVE_FILES[fmt])
    season_i = col_index(columns, "Season")
    tier_i = col_index(columns, "Batting_Opposition_Tier")
    runs_i = col_index(columns, "Runs")
    threshold = min_runs if min_runs is not None else BATTING_MIN_RUNS[fmt]
    out = []
    for r in rows:
        if r[season_i] == "OVERALL" and r[tier_i] == "OVERALL":
            try:
                if int(r[runs_i]) >= threshold:
                    out.append(dict(zip(columns, r)))
            except ValueError:
                continue
    return out


def _bowling_rows(fmt="OVERALL", min_wickets=None):
    columns, rows = rows_of(BOWLING_ARCHIVE_FILES[fmt])
    season_i = col_index(columns, "Season")
    tier_i = col_index(columns, "Bowling_Opposition_Tier")
    wkt_i = col_index(columns, "Wickets")
    threshold = min_wickets if min_wickets is not None else BOWLING_MIN_WICKETS[fmt]
    out = []
    for r in rows:
        if r[season_i] == "OVERALL" and r[tier_i] == "OVERALL":
            try:
                if int(r[wkt_i]) >= threshold:
                    out.append(dict(zip(columns, r)))
            except ValueError:
                continue
    return out


def _season_rows(archive_map, fmt, tier_col_name):
    """All career-archive rows for a given format, keyed by real season
    (i.e. excluding the 'OVERALL'/career-to-date rows), with opposition
    tier pinned to 'OVERALL' so it's a genuine per-season leaderboard."""
    columns, rows = rows_of(archive_map[fmt])
    season_i = col_index(columns, "Season")
    tier_i = col_index(columns, tier_col_name)
    out = []
    for r in rows:
        if r[season_i] != "OVERALL" and r[tier_i] == "OVERALL":
            out.append(dict(zip(columns, r)))
    return out


def q_season_leader(rng, used_files):
    """Who topped the run/wicket charts in a specific real season --
    distinct from the career-record templates since it's scoped to one
    season rather than all-time."""
    key = "season_leader"
    fmt = rng.choice(FORMAT_CHOICES)
    if fmt == "OVERALL":
        # "OVERALL" isn't a real season-by-season format bucket in the
        # archive files -- treat it as "pick T20 or List A" instead.
        fmt = rng.choice(["T20", "List A"])

    stat_choice = rng.choice(["runs", "wickets"])
    if stat_choice == "runs":
        rows = _season_rows(BATTING_ARCHIVE_FILES, fmt, "Batting_Opposition_Tier")
        value_col, stat_label = "Runs", "runs"
    else:
        rows = _season_rows(BOWLING_ARCHIVE_FILES, fmt, "Bowling_Opposition_Tier")
        value_col, stat_label = "Wickets", "wickets"

    if not rows:
        return None

    seasons = sorted(set(r["Season"] for r in rows))
    rng.shuffle(seasons)

    for season in seasons:
        season_rows = [r for r in rows if r["Season"] == season]
        try:
            season_rows.sort(key=lambda r: -int(r[value_col]))
        except ValueError:
            continue

        tied_top, top_value, decoy_candidates = _split_tied_top(
            season_rows, lambda r: r["Player"], lambda r: r[value_col]
        )
        if not tied_top or len(decoy_candidates) < 3:
            continue

        answer_name = rng.choice(tied_top)
        answer_value = top_value
        decoys = decoy_candidates[:3]
        options = [answer_name] + decoys
        rng.shuffle(options)
        answer_index = options.index(answer_name)

        question = (
            f"Who topped the {stat_label} charts in the {season} season "
            f"({FORMAT_LABEL[fmt]})?"
        )
        explanation = f"{answer_name} led with {answer_value} {stat_label}"
        explanation += _joint_holder_suffix(answer_name, tied_top) + "."

        return {
            "type": "season_leader",
            "question": question,
            "options": options,
            "answer_index": answer_index,
            "explanation": explanation,
        }, key

    return None


def q_guess_player_from_stats(rng, used_files):
    key = "guess_player_from_stats"
    fmt = rng.choice(FORMAT_CHOICES)
    players = _batting_rows(fmt)
    if len(players) < 4:
        fmt = "OVERALL"
        players = _batting_rows(fmt)
        if len(players) < 4:
            return None

    target = rng.choice(players)
    target_runs = int(target["Runs"])

    others = [p for p in players if p["Player"] != target["Player"]]
    others.sort(key=lambda p: abs(int(p["Runs"]) - target_runs))
    decoys = [p["Player"] for p in others[:8]]
    rng.shuffle(decoys)
    decoys = decoys[:3]
    if len(decoys) < 3:
        return None

    options = [target["Player"]] + decoys
    rng.shuffle(options)
    answer_index = options.index(target["Player"])

    question = (
        f"Guess the player: {target['Runs']} runs in {target['Innings']} innings "
        f"(average {target['Average']}, high score {target['Highest Score']}, "
        f"{target['100s']} centuries) for {target['Teams']}. ({FORMAT_LABEL[fmt]} career totals.)"
    )
    explanation = f"It's {target['Player']}."

    return {
        "type": "guess_player",
        "question": question,
        "options": options,
        "answer_index": answer_index,
        "explanation": explanation,
    }, key


def q_higher_or_lower(rng, used_files):
    key = "higher_or_lower"
    fmt = rng.choice(FORMAT_CHOICES)
    stat_choice = rng.choice(["runs", "wickets"])

    if stat_choice == "runs":
        players = _batting_rows(fmt, min_runs=300 if fmt != "T20" else 150)
        stat_label = "runs"
        value_col = "Runs"
    else:
        players = _bowling_rows(fmt, min_wickets=15 if fmt != "T20" else 8)
        stat_label = "wickets"
        value_col = "Wickets"

    if len(players) < 2:
        return None

    a, b = rng.sample(players, 2)
    va, vb = int(a[value_col]), int(b[value_col])
    if va == vb:
        return None

    options = [a["Player"], b["Player"]]
    answer_index = 0 if va > vb else 1

    question = (
        f"Who has more {stat_label} — {a['Player']} or {b['Player']}? ({FORMAT_LABEL[fmt]}.)"
    )
    explanation = f"{a['Player']}: {va} — {b['Player']}: {vb}."

    return {
        "type": "higher_lower",
        "question": question,
        "options": options,
        "answer_index": answer_index,
        "explanation": explanation,
    }, key


def q_match_margin(rng, used_files):
    key = "match_margin"
    matches = load_json("matches/index/MatchIndex.json")
    candidates = [
        m for m in matches
        if m.get("winner") and m.get("win_margin") and m.get("win_margin_type")
        and m["win_margin"].strip() not in ("", "0")
    ]
    if not candidates:
        return None

    m = rng.choice(candidates)
    winner = m["winner"]
    loser = m["team_away"] if m["team_home"] == winner else m["team_home"]
    try:
        margin = int(float(m["win_margin"]))
    except ValueError:
        return None
    margin_type = m["win_margin_type"]

    if margin_type.lower().startswith("wicket"):
        offsets = [o for o in (-3, -2, -1, 1, 2, 3) if 1 <= margin + o <= 10]
    else:
        offsets = [-15, -8, -3, 3, 8, 15, 20]

    decoy_values = set()
    for o in offsets:
        v = margin + o
        if v > 0 and v != margin:
            decoy_values.add(v)
        if len(decoy_values) >= 6:
            break
    decoy_values = list(decoy_values)
    rng.shuffle(decoy_values)
    decoy_values = decoy_values[:3]
    if len(decoy_values) < 3:
        return None

    options = [str(margin)] + [str(v) for v in decoy_values]
    rng.shuffle(options)
    answer_index = options.index(str(margin))

    date_str = m["date"].replace("/", "-") if m.get("date") else "an unknown date"
    fmt_str = m.get("format", "")
    fmt_phrase = f" ({fmt_str})" if fmt_str else ""
    question = (
        f"On {date_str}, {winner} beat {loser} at {m.get('venue', 'an unlisted venue')}"
        f"{fmt_phrase}. By how many {margin_type.lower()} did they win?"
    )
    explanation = f"{winner} won by {margin} {margin_type.lower()}."

    return {
        "type": "match_margin",
        "question": question,
        "options": options,
        "answer_index": answer_index,
        "explanation": explanation,
    }, key


def _all_team_names():
    teams_dir = DATA_DIR / "teams" / "json"
    return sorted(p.stem for p in teams_dir.glob("*.json"))


def _all_venue_names():
    venues_dir = DATA_DIR / "venues" / "json"
    return sorted(p.stem for p in venues_dir.glob("*.json"))


VENUE_MIN_MATCHES = 10  # avoid trivial "records" from venues with only a handful of matches ever played
_VENUE_MATCH_COUNTS_CACHE = None
_MATCH_LOOKUP_CACHE = None
_TEAM_VENUES_CACHE = None


def _venue_match_counts(min_matches=VENUE_MIN_MATCHES):
    global _VENUE_MATCH_COUNTS_CACHE
    if _VENUE_MATCH_COUNTS_CACHE is None:
        matches = load_json("matches/index/MatchIndex.json")
        counts = {}
        for m in matches:
            v = m.get("venue")
            if v:
                counts[v] = counts.get(v, 0) + 1
        _VENUE_MATCH_COUNTS_CACHE = counts
    return {v: c for v, c in _VENUE_MATCH_COUNTS_CACHE.items() if c >= min_matches}


def _match_lookup():
    """(date, format, team) -> matching MatchIndex entries, for resolving
    a player's top5 (Date, Format, Opposition) entry to a real venue."""
    global _MATCH_LOOKUP_CACHE
    if _MATCH_LOOKUP_CACHE is None:
        matches = load_json("matches/index/MatchIndex.json")
        lookup = {}
        for m in matches:
            for team in (m.get("team_home"), m.get("team_away")):
                if team:
                    lookup.setdefault((m.get("date"), m.get("format"), team), []).append(m)
        _MATCH_LOOKUP_CACHE = lookup
    return _MATCH_LOOKUP_CACHE


def _team_venues_map():
    """team name -> set of venues they've played at, for decoy selection."""
    global _TEAM_VENUES_CACHE
    if _TEAM_VENUES_CACHE is None:
        matches = load_json("matches/index/MatchIndex.json")
        m = {}
        for match in matches:
            for team in (match.get("team_home"), match.get("team_away")):
                if team and match.get("venue"):
                    m.setdefault(team, set()).add(match["venue"])
        _TEAM_VENUES_CACHE = m
    return _TEAM_VENUES_CACHE


def _fill_decoy_venues(rng, correct_venue, preferred_pool, all_venues, n=3):
    """Prefer decoys from venues genuinely associated with the player/team
    (harder, fairer than plainly-wrong options); fall back to any real
    venue if there aren't enough."""
    pool = [v for v in preferred_pool if v != correct_venue]
    rng.shuffle(pool)
    decoys = pool[:n]
    if len(decoys) < n:
        extra = [v for v in all_venues if v != correct_venue and v not in decoys]
        rng.shuffle(extra)
        decoys += extra[: n - len(decoys)]
    return decoys if len(decoys) >= n else None


def q_career_best_venue(rng, used_files):
    """At which ground did {player} record their career-best innings /
    bowling figures in a given format? Resolved by joining the player's
    top5 (Date, Format, Opposition) entry against MatchIndex -- works
    for ~97% of entries; the rest are silently skipped and retried."""
    player_dir = DATA_DIR / "players" / "json"
    player_files = list(player_dir.glob("*.json"))
    rng.shuffle(player_files)
    lookup = _match_lookup()
    all_venues = _all_venue_names()

    for pf in player_files[:60]:  # bounded scan, not the whole 1723-file pool every call
        player_name = pf.stem
        pkey = f"career_best_venue:{player_name}"
        if pkey in used_files:
            continue
        try:
            with open(pf, "r", encoding="utf-8") as f:
                pdata = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        stat_choice = rng.choice(["batting", "bowling"])
        section = pdata.get(stat_choice, {})
        top5 = section.get("top5", [])
        if not top5:
            continue

        fmt = rng.choice(["T20", "List A"])
        fmt_entries = [e for e in top5 if e.get("Format") == fmt]
        if not fmt_entries:
            continue
        best = fmt_entries[0]  # top5 is already best-first within each format

        if stat_choice == "batting":
            try:
                runs_val = int(str(best["Runs"]).rstrip("*"))
            except (ValueError, KeyError):
                continue
            if runs_val < 25:  # quality floor: keep the "career best" genuinely notable
                continue
            value_str = best["Runs"]
            stat_label = "innings"
        else:
            try:
                wkts_val = int(str(best["Figures"]).split("-")[0])
            except (ValueError, KeyError, IndexError):
                continue
            if wkts_val < 2:
                continue
            value_str = best["Figures"]
            stat_label = "bowling figures"

        match_key = (best.get("Date"), fmt, best.get("Opposition"))
        candidates = lookup.get(match_key, [])
        if len(candidates) != 1:
            continue  # unresolved or ambiguous -- skip, try another player
        correct_venue = candidates[0].get("venue")
        if not correct_venue:
            continue

        player_venues = [e["Venue"] for e in section.get("byVenue", []) if e.get("Venue")]
        decoys = _fill_decoy_venues(rng, correct_venue, player_venues, all_venues)
        if not decoys:
            continue

        options = [correct_venue] + decoys
        rng.shuffle(options)
        answer_index = options.index(correct_venue)

        question = (
            f"At which ground did {player_name} record their career-best {stat_label} "
            f"({value_str}, {FORMAT_LABEL[fmt]})?"
        )
        explanation = f"It was at {correct_venue}, against {best.get('Opposition')} on {best.get('Date')}."

        return {
            "type": "career_best_venue",
            "question": question,
            "options": options,
            "answer_index": answer_index,
            "explanation": explanation,
        }, pkey
    return None


def q_team_record_venue(rng, used_files):
    """At which ground did {team} set a given record (highest total,
    biggest win by X) in a given format? Teams already carry Venue
    directly on each record entry -- no join needed, 100% coverage."""
    # Excluded: margin types that are circumstantial (chase target, DLS
    # overs, run rate) rather than genuinely indicative of team quality
    # -- same standard applied when 'Biggest Win by Wickets' was cut
    # from TEAM_RECORD_FILES.
    EXCLUDED_RECORD_TYPES = {"Largest Win by Wickets", "Biggest Win by Balls Remaining"}

    team_dir = DATA_DIR / "teams" / "json"
    team_files = list(team_dir.glob("*.json"))
    rng.shuffle(team_files)
    team_venues_map = _team_venues_map()
    all_venues = _all_venue_names()

    for tf in team_files:
        team_name = tf.stem
        try:
            with open(tf, "r", encoding="utf-8") as f:
                tdata = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        records = [
            r for r in tdata.get("records", [])
            if r.get("Record") not in EXCLUDED_RECORD_TYPES
        ]
        if not records:
            continue
        rng.shuffle(records)

        for rec in records:
            venue = rec.get("Venue")
            fmt = rec.get("Format")
            label = rec.get("Record")
            value = rec.get("Value")
            if not venue or not fmt or not label:
                continue
            key = f"team_record_venue:{team_name}:{label}:{fmt}"
            if key in used_files:
                continue

            decoys = _fill_decoy_venues(
                rng, venue, list(team_venues_map.get(team_name, [])), all_venues
            )
            if not decoys:
                continue

            options = [venue] + decoys
            rng.shuffle(options)
            answer_index = options.index(venue)

            question = f"At which ground did {team_name} record their '{label}' ({FORMAT_LABEL[fmt]})?"
            explanation = f"It was at {venue} — {label.lower()} of {value}"
            if rec.get("Opposition"):
                explanation += f", against {rec['Opposition']}"
            if rec.get("Date"):
                explanation += f" on {rec['Date']}"
            explanation += "."

            return {
                "type": "team_record_venue",
                "question": question,
                "options": options,
                "answer_index": answer_index,
                "explanation": explanation,
            }, key
    return None



def q_venue_record(rng, used_files):
    """Records scoped to a single venue -- e.g. most catches ever taken
    at a specific ground -- restricted to venues with enough matches
    played there for the 'record' to mean something."""
    venues = list(_venue_match_counts().keys())
    if not venues:
        return None
    rng.shuffle(venues)

    for venue in venues:
        key = f"venue:{venue}"
        if key in used_files:
            continue
        path = DATA_DIR / "venues" / "json" / f"{venue}.json"
        if not path.exists():
            continue
        with open(path, "r", encoding="utf-8") as f:
            vdata = json.load(f)
        records = vdata.get("careerRecords", [])
        if not records:
            continue

        combos = sorted(set((r["Format"], r["Record"]) for r in records))
        rng.shuffle(combos)

        for fmt, rec_label in combos:
            subset = [r for r in records if r["Format"] == fmt and r["Record"] == rec_label]
            try:
                subset.sort(key=lambda r: int(r["Rank"]))
            except (ValueError, KeyError):
                continue

            tied_top, top_value, decoy_candidates = _split_tied_top(
                subset,
                lambda r: r.get("Player"),
                lambda r: r.get("Value"),
            )
            tied_top = [t for t in tied_top if t]  # drop any None names
            if not tied_top or len(decoy_candidates) < 3:
                continue

            answer_name = rng.choice(tied_top)
            answer_value = top_value
            decoys = decoy_candidates[:3]
            options = [answer_name] + decoys
            rng.shuffle(options)
            answer_index = options.index(answer_name)

            question = (
                f"At {venue}, who holds the record for '{rec_label}' "
                f"({FORMAT_LABEL.get(fmt, fmt)})?"
            )
            explanation = f"{answer_name} holds it with {answer_value}"
            explanation += _joint_holder_suffix(answer_name, tied_top) + "."

            return {
                "type": "venue_record",
                "question": question,
                "options": options,
                "answer_index": answer_index,
                "explanation": explanation,
            }, key
    return None



    """Which of these unions has {player} actually played for? (list membership,
    not 'most for' -- tests recall of a player's journey, not just a number)."""
def q_which_union(rng, used_files):
    key = "which_union"
    players = _batting_rows("OVERALL", min_runs=500)
    if not players:
        return None
    all_teams = _all_team_names()
    rng.shuffle(players)

    for p in players:
        real_teams = [t.strip() for t in p.get("Teams", "").split("/") if t.strip()]
        if not real_teams:
            continue
        decoy_candidates = [t for t in all_teams if t not in real_teams]
        if len(decoy_candidates) < 3:
            continue
        correct = rng.choice(real_teams)
        decoys = rng.sample(decoy_candidates, 3)
        options = [correct] + decoys
        rng.shuffle(options)
        answer_index = options.index(correct)

        question = f"Which of these unions has {p['Player']} actually played for?"
        explanation = f"{p['Player']} has represented: {', '.join(real_teams)}."

        return {
            "type": "which_union",
            "question": question,
            "options": options,
            "answer_index": answer_index,
            "explanation": explanation,
        }, key
    return None


def _record_top_row(rel_path, holder_col, value_col, rng, fmt):
    columns, rows = rows_of(rel_path)
    scope_fmt, season, filtered = _pick_record_scope(columns, rows, rng, fmt, min_rows=1)
    if season is None:
        return None
    holder_i = col_index(columns, holder_col)
    value_i = col_index(columns, value_col) if value_col in columns else None
    r = filtered[0]
    return r[holder_i], (r[value_i] if value_i is not None else None), scope_fmt, season


def q_reverse_record(rng, used_files):
    """Flip the usual record question: give the value, ask what it's the
    record for. Forces recognising the number, not just the name.

    Decoys are drawn only from the SAME holder-type pool as the correct
    answer (player-record labels for a player holder, team-record
    labels for a team holder) -- mixing the two meant any wrong-category
    label could be eliminated on sight (a team name isn't a person's
    name), with zero cricket knowledge required. Partnership records
    ("Pair" holders) are excluded from this template entirely for the
    same reason: two names joined by '&' only fits one label in the
    whole pool, so it gives itself away regardless of decoys.
    """
    source_type = rng.choice(["player", "team"])

    if source_type == "player":
        pool = [f for f in PLAYER_RECORD_FILES if f[2] != "Pair"]
        all_labels = [l for _, l, hc, _ in PLAYER_RECORD_FILES if hc != "Pair"]
    else:
        pool = list(TEAM_RECORD_FILES)
        all_labels = [l for _, l, _ in TEAM_RECORD_FILES]

    rng.shuffle(pool)

    for entry in pool:
        if source_type == "player":
            rel_path, label, holder_col, value_col = entry
        else:
            rel_path, label, value_col = entry
            holder_col = "Team"

        if rel_path in used_files:
            continue
        fmt = rng.choice(FORMAT_CHOICES)
        top = _record_top_row(rel_path, holder_col, value_col, rng, fmt)
        if not top:
            top = _record_top_row(rel_path, holder_col, value_col, rng, "OVERALL")
        if not top:
            continue
        holder, value, fmt, season = top
        if not value:
            continue
        decoy_pool = [l for l in all_labels if l != label]
        if len(decoy_pool) < 3:
            continue
        decoys = rng.sample(decoy_pool, 3)
        options = [label] + decoys
        rng.shuffle(options)
        answer_index = options.index(label)

        scope_phrase = f"{FORMAT_LABEL[fmt]}" if season == "OVERALL" else f"{season} season, {FORMAT_LABEL[fmt]}"
        subject = holder if source_type == "player" else f"{holder}"
        question = (
            f"{subject} set a database record ({scope_phrase}) with a value "
            f"of {value}. Which record is it?"
        )
        explanation = f"It's the record for '{label}', held by {holder}."

        return {
            "type": "reverse_record",
            "question": question,
            "options": options,
            "answer_index": answer_index,
            "explanation": explanation,
        }, rel_path
    return None


def q_magnitude_gap(rng, used_files):
    """Tests intuition about scale rather than recall of a name --
    how big is the gap between #1 and #2 on a leaderboard?"""
    key = "magnitude_gap"
    fmt = rng.choice(FORMAT_CHOICES)
    stat_choice = rng.choice(["runs", "wickets"])

    if stat_choice == "runs":
        players = _batting_rows(fmt, min_runs=0)
        value_col = "Runs"
        stat_label = "runs"
        stat_noun = "run-scorers"
    else:
        players = _bowling_rows(fmt, min_wickets=0)
        value_col = "Wickets"
        stat_label = "wickets"
        stat_noun = "wicket-takers"

    if len(players) < 2:
        return None

    ranked = sorted(players, key=lambda p: int(p[value_col]), reverse=True)
    p1, p2 = ranked[0], ranked[1]
    v1, v2 = int(p1[value_col]), int(p2[value_col])
    gap = v1 - v2
    if gap <= 0:
        return None

    # Scale decoys to the gap's own size rather than a fixed absolute
    # offset -- a flat +/-30 is a fine spread when the gap is ~12, but
    # is an unnoticeable rounding error when the gap is ~600+, leaving
    # all four options clustered together and effectively unguessable.
    # A minimum floor keeps small gaps spread out too.
    scale = max(gap, 10)
    frac_offsets = (-0.6, -0.4, -0.2, 0.2, 0.4, 0.6, 0.9)
    offsets = []
    for frac in frac_offsets:
        o = round(scale * frac)
        if o == 0:
            o = 1 if frac > 0 else -1
        offsets.append(o)
    offsets = [o for o in offsets if gap + o > 0 and gap + o != gap]
    rng.shuffle(offsets)
    decoy_values = []
    for o in offsets:
        v = gap + o
        if v not in decoy_values:
            decoy_values.append(v)
        if len(decoy_values) >= 3:
            break
    if len(decoy_values) < 3:
        return None

    options = [str(gap)] + [str(v) for v in decoy_values]
    rng.shuffle(options)
    answer_index = options.index(str(gap))

    question = (
        f"How many {stat_label} separate the all-time #1 ({p1['Player']}) "
        f"and #2 ({p2['Player']}) {stat_noun} ({FORMAT_LABEL[fmt]})?"
    )
    explanation = f"{p1['Player']}: {v1} — {p2['Player']}: {v2} — a gap of {gap}."

    return {
        "type": "magnitude_gap",
        "question": question,
        "options": options,
        "answer_index": answer_index,
        "explanation": explanation,
    }, key



DOUBLE_FILES = [
    ("D_50_3", "50+ runs and 3+ wickets in a match"),
    ("D_50_4", "50+ runs and 4+ wickets in a match"),
    ("D_50_5", "50+ runs and 5+ wickets in a match"),
    ("D_100_3", "100+ runs and 3+ wickets in a match"),
    ("D_100_4", "100+ runs and 4+ wickets in a match"),
    ("D_150_3", "150+ runs and 3+ wickets in a match"),
]
# Excluded: D_100_5, D_150_4, D_150_5, D_200_3 -- 2 or fewer players have
# ever achieved these, too thin to fairly generate decoys from.


def q_doubles_higher_lower(rng, used_files):
    """Who's achieved a given batting/bowling double more times -- tests
    knowledge of genuine all-rounders, not a single date/match memory."""
    candidates = [f for f in DOUBLE_FILES if f[0] not in used_files] or DOUBLE_FILES
    rel, label = rng.choice(candidates)
    columns, rows = rows_of(f"records/doubles/json/{rel}.json")
    player_i = col_index(columns, "Player")
    # Every genuine instance appears TWICE in this file -- once tagged
    # Format="OVERALL", once tagged with its specific format (e.g. "List A").
    # Counting all rows double-counts every real occurrence; keep only
    # the OVERALL-tagged copy so each instance is counted exactly once.
    format_i = col_index(columns, "Format") if "Format" in columns else None
    if format_i is not None:
        rows = [r for r in rows if r[format_i] == "OVERALL"]
    counts = Counter(r[player_i] for r in rows)
    if len(counts) < 2:
        return None

    items = list(counts.items())
    rng.shuffle(items)
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a_name, a_val = items[i]
            b_name, b_val = items[j]
            if a_val == b_val:
                continue
            options = [a_name, b_name]
            answer_index = 0 if a_val > b_val else 1
            question = (
                f"Who has achieved the {label} double more times, "
                f"{a_name} or {b_name}?"
            )
            explanation = f"{a_name}: {a_val} times. {b_name}: {b_val} times."
            return {
                "type": "doubles_higher_lower",
                "question": question,
                "options": options,
                "answer_index": answer_index,
                "explanation": explanation,
            }, rel
    return None


def _ordinal(n):
    n = int(n)
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def q_partnership_wicket_compare(rng, used_files):
    """Which wicket holds the bigger record partnership -- tests intuition
    about how stands shrink as an innings wears on, not pair recall."""
    key = "partnership_wicket_compare"
    columns, rows = rows_of("records/partnerships/json/Partnership_By_Wicket.json")
    fmt = rng.choice(FORMAT_CHOICES)
    filtered = filter_by_format(columns, rows, fmt, "OVERALL")
    if len(filtered) < 2:
        return None

    wicket_i = col_index(columns, "Wicket")
    runs_i = col_index(columns, "Runs")
    pair_i = col_index(columns, "Pair")
    entries = [(r[wicket_i], int(r[runs_i]), r[pair_i]) for r in filtered]
    rng.shuffle(entries)

    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            w1, v1, p1 = entries[i]
            w2, v2, p2 = entries[j]
            if v1 == v2:
                continue
            a_label, b_label = f"the {_ordinal(w1)} wicket", f"the {_ordinal(w2)} wicket"
            options = [a_label, b_label]
            answer_index = 0 if v1 > v2 else 1
            question = (
                f"Which wicket has the bigger record partnership "
                f"({FORMAT_LABEL[fmt]}), {a_label} or {b_label}?"
            )
            explanation = f"{a_label.capitalize()}: {v1} ({p1}). {b_label.capitalize()}: {v2} ({p2})."
            return {
                "type": "partnership_wicket_compare",
                "question": question,
                "options": options,
                "answer_index": answer_index,
                "explanation": explanation,
            }, key
    return None


MIN_H2H_MATCHES = 8  # guardrail: skip small, noisy sample sizes
H2H_EXCLUDED_TEAMS = {"Western Province"}  # too dominant -- makes the "who
# has the edge" question trivial rather than a genuine test of knowledge


def q_head_to_head(rng, used_files):
    """Who has the head-to-head edge between two unions -- guarded against
    thin samples, non-decisive (tied) records, and Western Province (whose
    dominance makes the question a foregone conclusion)."""
    team_dir = DATA_DIR / "teams" / "json"
    team_files = [
        f for f in team_dir.glob("*.json") if f.stem not in H2H_EXCLUDED_TEAMS
    ]
    rng.shuffle(team_files)

    for tf in team_files:
        team_name = tf.stem
        try:
            with open(tf, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        entries = data.get("headToHead", [])
        rng.shuffle(entries)
        for e in entries:
            opp = e.get("Opponent")
            fmt = e.get("Format")
            total = e.get("Total_Matches", 0)
            won = e.get("Matches_Won", 0)
            lost = e.get("Matches_Lost", 0)
            if (
                not opp
                or opp in H2H_EXCLUDED_TEAMS
                or not fmt
                or total < MIN_H2H_MATCHES
                or won == lost
            ):
                continue

            key = f"h2h:{'-'.join(sorted([team_name, opp]))}:{fmt}"
            if key in used_files:
                continue

            leader, other = (team_name, opp) if won > lost else (opp, team_name)
            w, l = (won, lost) if leader == team_name else (lost, won)

            options = [team_name, opp]
            rng.shuffle(options)
            answer_index = options.index(leader)

            question = (
                f"In head-to-head {FORMAT_LABEL[fmt]} meetings, who has the "
                f"edge, {team_name} or {opp}?"
            )
            explanation = f"{leader} lead {w}-{l} across {total} meetings ({FORMAT_LABEL[fmt]})."

            return {
                "type": "head_to_head",
                "question": question,
                "options": options,
                "answer_index": answer_index,
                "explanation": explanation,
            }, key
    return None


TEMPLATES = [
    q_player_record,
    q_player_record,       # weighted higher: lots of good source files
    q_team_record,
    q_guess_player_from_stats,
    q_higher_or_lower,
    q_which_union,
    q_reverse_record,
    q_magnitude_gap,
    q_season_leader,
    q_season_leader,       # weighted higher: fun category, per user request
    q_venue_record,
    q_career_best_venue,
    q_team_record_venue,
    q_doubles_higher_lower,
    q_head_to_head,
]


# --------------------------------------------------------------------------
# Bucket 2: hand-written curveballs (tools/curveballs.json)
#
# Lives next to this script, not in data/ -- unlike everything else in
# data/, this file is hand-authored quiz content, not site database
# content, and it's never fetched directly by the browser (only
# data/quiz/YYYY-MM-DD.json is, which quiz.js reads at runtime).
#
# Format: a JSON array of objects, each:
#   {
#     "question": "...",
#     "options": ["...", "...", "...", "..."],
#     "answer_index": 0,
#     "explanation": "..."
#   }
#
# Rotation is deterministic and independent of the day's other random
# picks: the pool is shuffled once with a fixed seed into a stable deck,
# then walked forward one card per day (day index relative to a fixed
# epoch), reshuffling only once the whole deck has been used. This means
# no repeats until the entire pool has been shown, and it's still 100%
# reproducible for any given date without storing state anywhere.
# --------------------------------------------------------------------------

CURVEBALL_EPOCH = date(2026, 1, 1)
CURVEBALL_PATH = REPO_ROOT / "tools" / "curveballs.json"


def load_curveballs():
    if not CURVEBALL_PATH.exists():
        return []
    with open(CURVEBALL_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_curveball_for_date(for_date):
    pool = load_curveballs()
    if not pool:
        return None

    deck_rng = random.Random("wca-curveball-deck-v1")
    day_index = (for_date - CURVEBALL_EPOCH).days
    cycle = day_index // len(pool)
    position = day_index % len(pool)

    # Re-derive the same shuffle for this cycle deterministically: reseed
    # with the cycle number folded in so every ~len(pool) days the deck
    # is freshly (but reproducibly) reshuffled rather than repeating in
    # the exact same order forever.
    deck_rng = random.Random(f"wca-curveball-deck-v1-cycle-{cycle}")
    deck = list(range(len(pool)))
    deck_rng.shuffle(deck)
    idx = deck[position]
    item = pool[idx]

    return {
        "type": "curveball",
        "question": item["question"],
        "options": item["options"],
        "answer_index": item["answer_index"],
        "explanation": item.get("explanation", ""),
    }


# --------------------------------------------------------------------------
# Quiz assembly
# --------------------------------------------------------------------------

def generate_quiz(for_date, seed=None):
    rng = random.Random(seed if seed is not None else for_date.isoformat())
    templates = TEMPLATES[:]
    rng.shuffle(templates)

    questions = []

    curveball = get_curveball_for_date(for_date)
    if curveball:
        questions.append(curveball)

    used_files_by_template = {}
    attempts = 0
    template_cycle = list(templates)

    while len(questions) < QUESTIONS_PER_DAY and attempts < 200:
        attempts += 1
        if not template_cycle:
            template_cycle = list(templates)
        fn = template_cycle.pop()
        key = fn.__name__
        used = used_files_by_template.setdefault(key, set())

        result = fn(rng, used)
        if result is None:
            continue
        q, source_key = result
        if source_key in used:
            continue
        used.add(source_key)
        questions.append(q)

    if len(questions) < QUESTIONS_PER_DAY:
        print(
            f"WARNING: only generated {len(questions)}/{QUESTIONS_PER_DAY} questions",
            file=sys.stderr,
        )

    rng.shuffle(questions)

    return {
        "date": for_date.isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "questions": questions,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD, defaults to today (UTC)")
    parser.add_argument("--preview", action="store_true", help="print, don't write")
    args = parser.parse_args()

    for_date = date.fromisoformat(args.date) if args.date else date.today()
    quiz = generate_quiz(for_date)

    if args.preview:
        print(json.dumps(quiz, indent=2, ensure_ascii=False))
        return

    QUIZ_OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = QUIZ_OUT_DIR / f"{for_date.isoformat()}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(quiz, f, indent=2, ensure_ascii=False)
    print(f"Wrote {out_path} ({len(quiz['questions'])} questions)")


if __name__ == "__main__":
    main()
