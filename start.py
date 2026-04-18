"""ZIGGY standalone launcher.

Run: python start.py
Dashboard opens at http://localhost:8421
"""
import sys
import pathlib

# Put E:\ziggy first on sys.path so all `from stan.*` imports resolve
# to this local frozen copy, never the installed STAN package.
_HERE = pathlib.Path(__file__).parent.resolve()
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import threading
import time
import webbrowser
import uvicorn

def _open_browser():
    time.sleep(1.5)  # give uvicorn a moment to bind
    webbrowser.open("http://localhost:8421")

if __name__ == "__main__":
    print("ZIGGY — starting at http://localhost:8421")
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(
        "stan.dashboard.server:app",
        host="0.0.0.0",
        port=8421,
        log_level="info",
    )
