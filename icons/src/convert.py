# Regenerates ../*.png from the vendored original Win-app bitmaps in this
# folder (Links/*.bmp from the original C++ project - IDB_OPEN, IDB_SAVE,
# etc in Links/resource.rc/hecken.h). The originals are opaque 22x22 24-bit
# BMPs composited against a black background (DxLib's DrawGraph was called
# with TransFlag=FALSE, so the app itself never keyed out that background -
# it only looked seamless because the app's own canvas defaulted to black
# too). For the web UI to work on any toolbar background, the black border
# is flood-filled to transparent here (flood fill, not a blanket color-key,
# so black used *inside* an icon's linework - see stop.bmp - is preserved).
#
# Usage: pip install pillow && python convert.py
import os
from collections import deque
from PIL import Image

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.dirname(SRC_DIR)
os.makedirs(OUT_DIR, exist_ok=True)

BLACK_THRESHOLD = 24  # r,g,b all below this counts as "background black"

FILES = [
    "anime", "close", "dxf", "graph", "helpon", "lside", "lturn", "menuon",
    "new", "none", "open", "opt", "orbit", "paste", "pasteDXF", "property",
    "reload", "resol", "rturn", "save", "saveas", "savegraph", "start",
    "stop", "turbo",
]

def is_bg_black(px):
    r, g, b = px
    return r < BLACK_THRESHOLD and g < BLACK_THRESHOLD and b < BLACK_THRESHOLD

def flood_transparent(im):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    visited = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg_black(px[x, y][:3]) and not visited[y][x]:
                visited[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg_black(px[x, y][:3]) and not visited[y][x]:
                visited[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                if is_bg_black(px[nx, ny][:3]):
                    visited[ny][nx] = True
                    q.append((nx, ny))
    return im

for name in FILES:
    path = os.path.join(SRC_DIR, name + ".bmp")
    if not os.path.exists(path):
        print("missing", path)
        continue
    im = Image.open(path)
    im = flood_transparent(im)
    # Upscale 2x with nearest-neighbor to look crisp at slightly larger
    # display sizes without introducing blur (these are small pixel-art icons).
    im2x = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
    im2x.save(os.path.join(OUT_DIR, name + ".png"))

print("done:", len(FILES), "icons ->", OUT_DIR)
