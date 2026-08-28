#!/usr/bin/env python3
"""Dev server with caching switched off — properly.

Browsers happily hand back a stale ES module for an hour, which turns one typo
into a debugging session. This server said so in a comment and sent the usual
no-cache headers, and it still happened: some browsers (the embedded one Claude
drives among them) serve a module from their own cache with transferSize 0 and
never ask. A header is a request; it is not a guarantee.

So the headers stay AND every relative import in a served .js file gets a
version query stamped on it. The URL changes when the file changes, and a URL
that has changed cannot be answered from a cache. Nothing on disk is touched:
the rewrite happens on the way out.
"""
import http.server, socketserver, sys, re, os, io, time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.getcwd()

# from './x.js'   from "../y/z.js"   import('./w.js')
IMPORT_RE = re.compile(rb"""(from\s*|import\s*\(\s*)(['"])(\.{1,2}/[^'"]+?)(['"])""")
# <script type="module" src="src/main.js">  — the entry point is cached too, and
# stamping only the imports inside it leaves the whole graph stale behind a stale
# root, which looks exactly like "my edit did nothing".
SCRIPT_RE = re.compile(rb"""(<script[^>]*src=)(['"])([^'"]+?\.js)(['"])""")


def version_stamp():
    """A value that is different on every request.

    Stamping with the newest source mtime was the obvious choice and it is not
    enough: the browser this project is developed against caches a module under
    its exact URL and hands it back with transferSize 0, so two loads that
    happen to share a stamp share a stale module — including the one where you
    just fixed the bug. A nonce costs a re-download of a few hundred kilobytes
    of local text per reload and removes the entire class of problem.
    """
    return time.time_ns()


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        is_js = path.endswith('.js')
        is_html = path.endswith('.html')
        if not (is_js or is_html) or not os.path.isfile(path):
            return super().send_head()
        with open(path, 'rb') as f:
            body = f.read()
        version = str(version_stamp()).encode()

        def stamp(m):
            sep = b'&' if b'?' in m.group(3) else b'?'
            return m.group(1) + m.group(2) + m.group(3) + sep + b'v=' + version + m.group(4)

        # HTML gets both: the <script src> that starts the graph, and any
        # inline module that imports from src/ (the tool pages do).
        body = IMPORT_RE.sub(stamp, body)
        if is_html:
            body = SCRIPT_RE.sub(stamp, body)
        self.send_response(200)
        self.send_header('Content-type', 'text/javascript' if is_js else 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def log_message(self, fmt, *args):
        if '404' in (fmt % args):
            sys.stderr.write('%s\n' % (fmt % args))


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'SKI Together on http://localhost:{PORT}  (every import stamped with a fresh version)')
    httpd.serve_forever()
