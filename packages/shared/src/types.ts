/** A quad of four [x, y] points defining a CSS box region (clockwise from top-left). */
export type Quad = [number, number, number, number, number, number, number, number];

export interface BoxModelData {
  content: { x: number; y: number; width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
  border: { top: number; right: number; bottom: number; left: number };
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface ComputedStyles {
  [property: string]: string;
}

export interface ComponentInfo {
  name: string;
  filePath: string;
  line: number;
  column: number;
  props: Record<string, unknown>;
}

export interface LiveHoverData {
  source: 'live';
  componentInfo: ComponentInfo;
  boxModel: BoxModelData;
  computedStyles: ComputedStyles;
  screenshot?: string;
}

export interface StaticHoverData {
  source: 'estimated';
  componentInfo: ComponentInfo;
  boxModel: BoxModelData | null;
  computedStyles: ComputedStyles;
}

export type HoverData = LiveHoverData | StaticHoverData;
