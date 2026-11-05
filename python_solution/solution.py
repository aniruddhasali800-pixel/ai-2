from html.parser import HTMLParser
import re
from urllib.request import Request, urlopen


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._table_depth = 0
        self._table = None
        self._row = None
        self._cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            if self._table_depth == 0:
                self._table = []
            self._table_depth += 1
        elif self._table_depth and tag == "tr":
            self._row = []
        elif self._table_depth and tag in ("td", "th"):
            self._cell = []

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table_depth:
            self._table_depth -= 1
            if self._table_depth == 0:
                self.tables.append(self._table)
                self._table = None


def print_grid_from_google_doc(url: str) -> None:
    """Fetch a published Google Doc and print its character-coordinate grid."""
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:
        encoding = response.headers.get_content_charset() or "utf-8"
        document = response.read().decode(encoding)

    parser = _TableParser()
    parser.feed(document)

    records = []
    for table in parser.tables:
        if not table:
            continue
        headers = [re.sub(r"[^a-z]", "", cell.lower()) for cell in table[0]]
        try:
            x_column = headers.index("xcoordinate")
            character_column = headers.index("character")
            y_column = headers.index("ycoordinate")
        except ValueError:
            continue

        for row in table[1:]:
            if max(x_column, character_column, y_column) >= len(row):
                continue
            try:
                x = int(row[x_column])
                y = int(row[y_column])
            except ValueError:
                continue
            records.append((x, y, row[character_column]))

    if not records:
        raise ValueError("No character-coordinate table found in the document")

    max_x = max(x for x, _, _ in records)
    max_y = max(y for _, y, _ in records)
    grid = [[" " for _ in range(max_x + 1)] for _ in range(max_y + 1)]

    for x, y, character in records:
        grid[y][x] = character

    for y in range(max_y, -1, -1):
        print("".join(grid[y]))
