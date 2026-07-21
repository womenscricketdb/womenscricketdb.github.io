/* ==========================================================================
   Generated from WCA_Dataset_Template.xlsx (DatasetManifest sheet).
   One entry per exported record-type JSON. If a new record type is added to
   the pipeline, add its {file,label} here too, this list is not derived
   automatically at runtime.

   `qualifier` and `note` come from the manifest's "Variable values" and
   "Notes" columns respectively. `qualifier` is structured, not a flat
   string, so the Records page can show only the branch that's actually
   relevant to the Format/Season currently selected in the table's own
   filter row, rather than dumping every branch at once:
     - unit: what the number counts (innings, runs, wickets, etc.)
     - seasonal: the per-season bar, a flat number, or {"List A":x,"T20":y}
     - allTime: the all-time/career bar, same shape as seasonal, or null
       if there's no separate all-time bar (the seasonal number always
       applies, e.g. single-innings records with no career variant)
     - innings: true if this is inherently a single-innings record, so the
       display always says "in the innings" rather than "per season"/"all-time"
   qualifier: null = no minimum applied, every player/team/performance
   on record is eligible.

   `grain` ("career" or "innings") is a separate, independent field, not
   derived from `qualifier.innings` above, since plenty of types with no
   qualifier at all (Fastest_50, Most_5Wickets, 50Plus_Scores, ...) are
   still clearly one grain or the other. It only exists on types where a
   section actually mixes both grains (batting/bowling/fielding/team) so
   the Records page can split the type list into "Career" and "Innings"
   groups instead of one undifferentiated wall of pills. Sections that are
   already single-grain (misc, partnerships, doubles) skip it entirely,
   since grouping a homogeneous list into one labeled group adds a heading
   with nothing to contrast it against.

   Units for the qualifier numbers are confirmed against the manifest's
   "Use of Variable" column (e.g. Best_Economy checks Sum(Overs_Calculated),
   Best_Inns_Economy checks Sum(Balls_Bowled)), overs bowled at the
   season/career grain, balls bowled at the single-innings grain.
   ========================================================================== */

const WCA_RECORD_SECTIONS = {
    batting: {
        label: "Batting Records",
        icon: "bi-bar-chart-fill",
        types: [
            { file: "Most_Runs", grain: "career", label: "Most Runs", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Batting_Average", grain: "career", label: "Batting Average",
              qualifier: { unit: "innings", seasonal: { "List A": 5, "T20": 3 }, allTime: 20 },
              note: "Showing the top 25 for the selected filters." },
            { file: "Highest_Score", grain: "innings", label: "Highest Individual Score",
              qualifier: { unit: "runs", seasonal: { "List A": 100, "T20": 50 }, allTime: { "List A": 150, "T20": 50 }, innings: true },
              note: "Showing the top 25 for the selected filters." },
            { file: "Most_NotOuts", grain: "career", label: "Most Unbeaten Innings", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Batting_StrikeRate", grain: "career", label: "Batting Strike-rate",
              qualifier: { unit: "balls faced", seasonal: { "List A": 100, "T20": 50 }, allTime: 250 },
              note: "Showing the top 25 for the selected filters." },
            { file: "50Plus_Scores", grain: "career", label: "50+ Scores", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "100Plus_Scores", grain: "career", label: "100+ Scores", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "200Plus_Scores", grain: "career", label: "200+ Scores", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_Fours", grain: "career", label: "Most Fours", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_Sixes", grain: "career", label: "Most Sixes", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_Ducks", grain: "career", label: "Most Ducks", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_GoldenDucks", grain: "career", label: "Most Golden Ducks", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Best_BoundaryCareer", grain: "career", label: "Best Batting Boundary %",
              qualifier: { unit: "runs", seasonal: { "List A": 100, "T20": 50 }, allTime: 250 },
              note: "Showing the top 25 for the selected filters." },
            { file: "Innings_Bat_SR", grain: "innings", label: "Highest Bat Strike-Rate Innings",
              qualifier: { unit: "runs", seasonal: { "List A": 30, "T20": 20 }, allTime: null, innings: true },
              note: "Showing the top 25 for the selected filters, where balls-faced data is recorded." },
            { file: "Innings_Boundary", grain: "innings", label: "Best Innings Boundary Percentage",
              qualifier: { unit: "runs", seasonal: { "List A": 30, "T20": 20 }, allTime: null, innings: true },
              note: "Showing the top 25 for the selected filters." },
            { file: "Fastest_50", grain: "innings", label: "Fastest 50", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Fastest_100", grain: "innings", label: "Fastest 100", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Fastest_150", grain: "innings", label: "Fastest 150", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Fastest_200", grain: "innings", label: "Fastest 200", qualifier: null, note: "Showing the top 25 for the selected filters." },
        ],
    },
    bowling: {
        label: "Bowling Records",
        icon: "bi-dpad",
        types: [
            { file: "Most_Wickets", grain: "career", label: "Most Wickets", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Best_Bowl_Average", grain: "career", label: "Best Bowling Average",
              qualifier: { unit: "wickets", seasonal: { "List A": 10, "T20": 5 }, allTime: 40 },
              note: "Showing the top 25 for the selected filters." },
            { file: "Best_Economy", grain: "career", label: "Best Bowling Economy",
              qualifier: { unit: "overs bowled", seasonal: { "List A": 30, "T20": 12 }, allTime: 50 },
              note: "Showing the top 25 for the selected filters." },
            { file: "Best_Inns_Economy", grain: "innings", label: "Most Economic Spell",
              qualifier: { unit: "balls bowled", seasonal: { "List A": 30, "T20": 18 }, allTime: null, innings: true },
              note: "Showing the top 25 for the selected filters." },
            { file: "Most_5Wickets", grain: "career", label: "Most 5+ Wickets", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_4Wickets", grain: "career", label: "Most 4+ Wickets", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Best_Bowl_Performance", grain: "innings", label: "Best Bowling Performance",
              qualifier: { unit: "wickets", seasonal: { "List A": 5, "T20": 4 }, allTime: { "List A": 7, "T20": 5 }, innings: true },
              note: "Showing every qualifying performance." },
            { file: "Best_Bowl_StrikeRate", grain: "career", label: "Best Bowling Strike-rate",
              qualifier: { unit: "wickets", seasonal: { "List A": 10, "T20": 5 }, allTime: 40 },
              note: "Showing the top 25 for the selected filters." },
            { file: "Most_NoBalls", grain: "career", label: "Most No-Balls Bowled", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_Wides", grain: "career", label: "Most Wides Bowled", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_Maidens", grain: "career", label: "Most Maidens", qualifier: null, note: "Showing the top 25 for the selected filters." },
        ],
    },
    fielding: {
        label: "Fielding Records",
        icon: "bi-hand-index-thumb-fill",
        types: [
            { file: "Most_D_RunOut", grain: "career", label: "Most Direct Run-Outs", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_A_RunOut", grain: "career", label: "Most Assisted Run-Outs", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "WK_Dismissals", grain: "career", label: "Wicketkeeping Dismissals", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "WK_Stumpings", grain: "career", label: "Wicketkeeping Stumpings", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "WK_Catches", grain: "career", label: "Wicketkeeping Catches", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Field_Catches", grain: "career", label: "Fielder Catches", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Inns_Field_Catches", grain: "innings", label: "Most Innings Catches", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Inns_WK_Dismissals", grain: "innings", label: "Most Innings WK Dismissals", qualifier: null, note: "Showing the top 25 for the selected filters." },
        ],
    },
    misc: {
        label: "Miscellaneous Records",
        icon: "bi-stars",
        types: [
            { file: "Most_Matches", label: "Most Matches", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Matches_Captained", label: "Matches Captained", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_Matches_1Team", label: "Most Matches for a Team", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_TeamsPlayedFor", label: "Most Teams Played For", qualifier: null, note: "Showing the top 25 for the selected filters." },
        ],
    },
    partnerships: {
        label: "Partnership Records",
        icon: "bi-people-fill",
        types: [
            { file: "Highest_Partnership", label: "Highest Partnership", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_Partnership_Runs", label: "Most Partnership Runs", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Partnership_By_Wicket", label: "Highest Partnership by Wicket", qualifier: null, note: "Showing the best partnership for each wicket." },
        ],
    },
    team: {
        label: "Team Records",
        icon: "bi-shield-fill",
        types: [
            { file: "Most_Wins", grain: "career", label: "Most Wins", qualifier: null, note: "Showing all teams." },
            { file: "Highest_Total", grain: "innings", label: "Highest Total", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Lowest_Total", grain: "innings", label: "Lowest Total", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Highest_Agg_Runs", grain: "innings", label: "Highest Aggregate Runs", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Lowest_Agg_Runs", grain: "innings", label: "Lowest Aggregate Runs", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Win_By_Runs", grain: "innings", label: "Win by Runs", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Win_By_Wickets", grain: "innings", label: "Win by Wickets Remaining", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Win_By_Balls", grain: "innings", label: "Win by Balls Remaining", qualifier: null, note: "Showing the top 25 for the selected filters." },
            { file: "Most_Extras_Team", grain: "career", label: "Most Extras Bowled", qualifier: null, note: "Showing the top 25 for the selected filters." },
        ],
    },
    doubles: {
        label: "Doubles (Bat & Bowl)",
        icon: "bi-trophy-fill",
        types: [
            { file: "D_50_3", label: "50 runs & 3 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_50_4", label: "50 runs & 4 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_50_5", label: "50 runs & 5 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_100_3", label: "100 runs & 3 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_100_4", label: "100 runs & 4 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_100_5", label: "100 runs & 5 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_150_3", label: "150 runs & 3 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_150_4", label: "150 runs & 4 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_150_5", label: "150 runs & 5 wickets", qualifier: null, note: "Showing every qualifying performance." },
            { file: "D_200_3", label: "200 runs & 3 wickets", qualifier: null, note: "Showing every qualifying performance." },
        ],
    },
};
