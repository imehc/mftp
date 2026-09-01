import { Container, Graphics } from "pixi.js";
import { px } from "./table";

export function createCueView() {
  const layer = new Container();
  const shadow = new Graphics();
  const stick = new Graphics();
  const stickLength = px(1.05);
  const tipHalfWidth = 3.2;
  const buttHalfWidth = 6.8;
  const halfWidthAt = (x: number) =>
    tipHalfWidth + (buttHalfWidth - tipHalfWidth) * (x / stickLength);
  const band = (
    graphic: Graphics,
    start: number,
    end: number,
    color: number,
    alpha = 1,
  ) => {
    graphic
      .poly([
        start,
        -halfWidthAt(start),
        end,
        -halfWidthAt(end),
        end,
        halfWidthAt(end),
        start,
        halfWidthAt(start),
      ])
      .fill({ color, alpha });
  };
  const strip = (top: number, bottom: number, color: number, alpha: number) => {
    stick
      .poly([
        0,
        halfWidthAt(0) * top,
        stickLength,
        halfWidthAt(stickLength) * top,
        stickLength,
        halfWidthAt(stickLength) * bottom,
        0,
        halfWidthAt(0) * bottom,
      ])
      .fill({ color, alpha });
  };

  band(stick, 0, px(0.014), 0x3f6597);
  band(stick, px(0.014), px(0.038), 0xf3ede1);
  band(stick, px(0.038), px(0.6), 0xd7b183);
  band(stick, px(0.6), px(0.638), 0x2c2c2c);
  band(stick, px(0.638), px(0.8), 0x6d3a23);
  band(stick, px(0.8), px(0.95), 0x3b2b21);
  band(stick, px(0.95), stickLength - px(0.022), 0x5b2f1e);
  band(stick, stickLength - px(0.022), stickLength, 0x1b1b1b);
  band(stick, px(0.792), px(0.8), 0xcfc9ba);
  band(stick, px(0.95), px(0.958), 0xcfc9ba);
  strip(-1, -0.62, 0xffffff, 0.1);
  strip(-0.62, -0.3, 0xffffff, 0.2);
  strip(-0.42, -0.32, 0xffffff, 0.26);
  strip(0.34, 0.72, 0x000000, 0.18);
  strip(0.72, 1, 0x000000, 0.3);
  band(shadow, 0, stickLength, 0x000000, 0.22);
  layer.addChild(shadow, stick);
  layer.visible = false;

  return { layer, shadow, stick };
}
