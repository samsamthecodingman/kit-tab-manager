// Kit's artwork, shared by the background (tab bar and toolbar icon) and the toolbar menu.

// Kit: a little Claude-orange blob in a Firefox-orange fox hoodie, on a 17 x 15 grid of
// [x, y, w, h, colour] rects. Drawn facing right (tail trailing on the left); facingLeft mirrors it.
const ORANGE = "#D97757", RUST = "#993C1D", INK = "#2C2C2A";
const HOODIE = "#E8833A", HOODIE_DARK = "#B8602A", CREAM = "#F7EBDD", GOLD = "#FFD54A", BLUSH = "#F0997B";
const KIT_W = 17, KIT_H = 15;
const KIT_TAIL = [[1, 11, 4, 2, HOODIE_DARK], [0, 9, 3, 2, HOODIE], [0, 6, 2, 3, HOODIE], [0, 4, 2, 2, CREAM], [1, 3, 1, 1, CREAM]];
const KIT_HOOD = [
  [5, 0, 2, 2, HOODIE], [14, 0, 2, 2, HOODIE], [6, 1, 1, 1, GOLD], [14, 1, 1, 1, GOLD], // hood ears
  [4, 2, 13, 8, HOODIE], [6, 4, 9, 6, ORANGE], // hood and face
  [7, 8, 1, 1, BLUSH], [13, 8, 1, 1, BLUSH], [9, 9, 3, 1, RUST], // cheeks and mouth
  [6, 10, 9, 3, HOODIE], [10, 10, 1, 3, HOODIE_DARK], // body and zip
];
const KIT_EYES = (dx) => [[7 + dx, 6, 2, 2, INK], [12 + dx, 6, 2, 2, INK], [7 + dx, 6, 1, 1, "#FFFFFF"], [12 + dx, 6, 1, 1, "#FFFFFF"]];
const KIT_ARM = (x, lift) => [[x, 10 - lift, 2, 3, HOODIE], [x, 13 - lift, 2, 1, ORANGE]];
const KIT_LEGS = { stand: [[7, 13, 2, 2, RUST], [12, 13, 2, 2, RUST]], a: [[7, 13, 2, 1, RUST], [12, 13, 2, 2, RUST]], b: [[7, 13, 2, 2, RUST], [12, 13, 2, 1, RUST]] };

// Kit's rects for a pose: "stand" (feet level, looking at you), "a" or "b" (opposite foot and arm
// lifted, eyes glancing the way it walks).
function kitRects(pose, facingLeft, { tail = true } = {}) {
  const walking = pose !== "stand";
  const rects = [
    ...(tail ? KIT_TAIL : []), ...KIT_HOOD, ...KIT_EYES(walking ? 1 : 0),
    ...KIT_ARM(4, pose === "a" ? 1 : 0), ...KIT_ARM(15, pose === "b" ? 1 : 0), ...KIT_LEGS[pose],
  ];
  return facingLeft ? rects.map(([x, y, w, h, c]) => [KIT_W - x - w, y, w, h, c]) : rects;
}

// silhouette draws every pixel in that one colour (for Kit's outline).
function drawKit(ctx, ox, oy, s, pose, facingLeft, silhouette) {
  for (const [x, y, w, h, fill] of kitRects(pose, facingLeft)) {
    ctx.fillStyle = silhouette || fill;
    ctx.fillRect(ox + x * s, oy + y * s, w * s, h * s);
  }
}
