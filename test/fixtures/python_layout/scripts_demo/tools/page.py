from html.parser import HTMLParser


class TitleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self._in = False

    def handle_starttag(self, tag, attrs):
        self._in = tag == "title"

    def handle_endtag(self, tag):
        self._in = False

    def handle_data(self, data):
        if self._in:
            self.title += data


# old_title is kept for reference — a comment that names it is not a use
def old_title(html):
    """Nothing calls this: `old_title` is the one real dead-code candidate."""
    return html[:10]


def title_of(html):
    parser = TitleParser()
    parser.feed(html)
    parser.close()
    return parser.title
