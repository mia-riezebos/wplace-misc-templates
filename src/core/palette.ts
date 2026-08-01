export type Rgb = readonly [red: number, green: number, blue: number];

export interface Color {
  readonly name: string | null;
  readonly rgb: Rgb;
}

const CURRENT_WPLACE_COLORS: ReadonlyArray<readonly [name: string, hex: string]> = [
  ["Black", "#000000"],
  ["Dark Gray", "#3C3C3C"],
  ["Gray", "#787878"],
  ["Medium Gray", "#AAAAAA"],
  ["Light Gray", "#D2D2D2"],
  ["White", "#FFFFFF"],
  ["Deep Red", "#600018"],
  ["Dark Red", "#A50E1E"],
  ["Red", "#ED1C24"],
  ["Light Red", "#FA8072"],
  ["Dark Orange", "#E45C1A"],
  ["Orange", "#FF7F27"],
  ["Gold", "#F6AA09"],
  ["Yellow", "#F9DD3B"],
  ["Light Yellow", "#FFFABC"],
  ["Dark Goldenrod", "#9C8431"],
  ["Goldenrod", "#C5AD31"],
  ["Light Goldenrod", "#E8D45F"],
  ["Dark Olive", "#4A6B3A"],
  ["Olive", "#5A944A"],
  ["Light Olive", "#84C573"],
  ["Dark Green", "#0EB968"],
  ["Green", "#13E67B"],
  ["Light Green", "#87FF5E"],
  ["Dark Teal", "#0C816E"],
  ["Teal", "#10AEA6"],
  ["Light Teal", "#13E1BE"],
  ["Dark Cyan", "#0F799F"],
  ["Cyan", "#60F7F2"],
  ["Light Cyan", "#BBFAF2"],
  ["Dark Blue", "#28509E"],
  ["Blue", "#4093E4"],
  ["Light Blue", "#7DC7FF"],
  ["Dark Indigo", "#4D31B8"],
  ["Indigo", "#6B50F6"],
  ["Light Indigo", "#99B1FB"],
  ["Dark Slate Blue", "#4A4284"],
  ["Slate Blue", "#7A71C4"],
  ["Light Slate Blue", "#B5AEF1"],
  ["Dark Purple", "#780C99"],
  ["Purple", "#AA38B9"],
  ["Light Purple", "#E09FF9"],
  ["Dark Pink", "#CB007A"],
  ["Pink", "#EC1F80"],
  ["Light Pink", "#F38DA9"],
  ["Dark Peach", "#9B5249"],
  ["Peach", "#D18078"],
  ["Light Peach", "#FAB6A4"],
  ["Dark Brown", "#684634"],
  ["Brown", "#95682A"],
  ["Light Brown", "#DBA463"],
  ["Dark Tan", "#7B6352"],
  ["Tan", "#9C846B"],
  ["Light Tan", "#D6B594"],
  ["Dark Beige", "#D18051"],
  ["Beige", "#F8B277"],
  ["Light Beige", "#FFC5A5"],
  ["Dark Stone", "#6D643F"],
  ["Stone", "#948C6B"],
  ["Light Stone", "#CDC59E"],
  ["Dark Slate", "#333941"],
  ["Slate", "#6D758D"],
  ["Light Slate", "#B3B9D1"],
];

function colorFromHex(name: string, hex: string): Color {
  return {
    name,
    rgb: [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as unknown as Rgb,
  };
}

export const CURRENT_WPLACE_PALETTE: readonly Color[] = CURRENT_WPLACE_COLORS.map(
  ([name, hex]) => colorFromHex(name, hex),
);

export function colorKey(color: Color): string {
  return color.rgb.join(",");
}

export function colorHex(color: Color): string {
  return `#${color.rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function colorLabel(color: Color): string {
  return color.name || colorHex(color).toUpperCase();
}

export function parseCssRgb(cssColor: string): Rgb | null {
  const channels = cssColor.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  return channels?.length === 3 ? channels as unknown as Rgb : null;
}

export function colorFromRgb(rgb: Rgb, name: string | null = null): Color {
  return { name, rgb };
}

export function paletteMap(colors: readonly Color[]): ReadonlyMap<string, Color> {
  return new Map(colors.map((color) => [colorKey(color), color]));
}
