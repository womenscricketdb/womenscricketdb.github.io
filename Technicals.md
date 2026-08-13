


# Building a Statistical Archive for South African Women's Provincial Cricket

**womenscricketdb.github.io**


The about page of the site gives context to the decisions made with this project. The aim here is to give a more technical view of how it was done.


The project data pipeline consists of four major components: Python, SQLite, QlikView and Python (again). 

## 1. Python

Python scripts (BeautifulSoup doing the HTML parsing) handle the actual scraping: pulling scorecard pages and writing structured rows into SQLite. The parsing itself has to be genuinely dynamic rather than assuming a fixed layout, because two decades of scorecards on an old archive site don't all share one table structure. Each table on a scorecard page is identified by scanning its own header text for the words "innings" or "bowling" rather than being assumed by position, and the column positions inside each table (which column is runs, which is balls, which is strike rate) are worked out fresh per table by reading the header row and accounting for column-spanning cells, rather than hard-coded to a fixed index.

A big challenge here was data completeness. Incomplete scorecards had to be flagged, as the missing values would have an impact on metrics. This mostly relates to balls faced, dismissal method and extras per bowler.

Not everything on the site comes from a number that's actually printed on a scorecard. Partnership records are the clearest example: a scorecard tells you the fall-of-wicket sequence (team score at each dismissal) and the batting order, but it never states "these two players put on 84 together."

As a solution to this, I simulated the innings (each wicket falling, each retirement, each return to the crease after a retirement) into a timeline. The simulation then tracks which two batters are actually at the crease at any point and credits the runs scored between consecutive events to whichever pair was in at the time.


## 2. SQLite


SQLite is basically the filing cabinet of the project. The choice of database was mostly down to ease of use and familiarity with it.

Data was loaded into their respective tables: batting, bowling, fielding, match info, partnerships and competitions/seasons. A few additional tables were added as the project progressed, such as player mapping (to sort out duplicates) and venue/provincial union data.


## 3. QlikView


With the database populated, I loaded it into QlikView. QlikView is enterprise-level software (quite dated at this point), that is mostly used for Business Intelligence and corporate data analysis. Not the first thing people would think of when it comes to this type of project, but its associative data engine works perfectly for all the ways the data had to be sliced (per player, season, venue, team, etc.).   
  
Each table as seen on the site was built as its own straight table object in QlikView. The scripting language of QlikView also made it easy to build more complex formulas/expressions. This is where flagged scorecards were ignored for certain metrics, and thresholds were added with the use of variables.   
  
In all, over 90 different tables were built for the Archive Viewer, eight record sections and Player/Team/Venue/Match Pages. Exporting it from QlikView was both a problem and a solution. By using the VBScript module in Qlikview I was able to loop through all the tables and selections to export the data to CSV files. Where possible, like for Archive Viewer and Records tables, the different selections were all exported to one file. The rest of the tables were exported on a per selection basis.

Explaining the whole 1000-line module could easily be its own piece, as there were many challenges to solve and totally different approaches were needed for different tables.


## 4. Python (again)


The exported CSV files had to be converted into JSON files, which can be read by the site components. Two steps involved here: consolidation and conversion.

Consolidation involved getting all the different components for a respective player/match/team/venue into one file. For example, instead of 16,000+ files involving player data, only 1,723 player JSON files get pushed to the site.

Conversion is a more straightforward 1:1 conversion of the CSV to a JSON array, mostly used for Archive Viewer and Records data. 

This allowed pages to be loaded with only a single JSON file to fetch.


The site itself is deliberately simple: plain HTML and CSS, with [DataTables](https://datatables.net/) doing the heavy lifting for anything resembling a filterable, sortable table, which is most of the site. It's hosted for free on GitHub Pages, which is a natural fit for a project that's 100% static once the JSON is generated.


## If I were starting over

QlikView did the job well, but it's not a tool most people have sitting around, and it's not something I'd necessarily recommend picking up from scratch just for this. If I had to rebuild this pipeline today without access to it, I'd reach for something much more accessible: Google Sheets, with Apps Script handling the export.

The associative, slice-it-every-which-way modelling QlikView gave me could mostly be replicated with formulas and pivot tables across a few linked sheets, good enough for computing career totals, per-season splits, and leaderboards. Apps Script can then take over where the QlikView macro left off: reading the computed tables and writing them straight out as JSON, triggered on a schedule or on demand, with no manual export-and-consolidate step in between. That collapses stages 3 through 5 of the pipeline above (QlikView modelling, the export macros, and JSON consolidation) into one tool instead of three, and it's something anyone can set up for free with no licenses or installs.

The frontend wouldn't need to change at all. Plain HTML/CSS with DataTables reading JSON doesn't care where the JSON came from. That part of the stack was the right call regardless of what's generating the data behind it.
