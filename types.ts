
export type ToolType = 'pen' | 'highlighter' | 'eraser';

export interface Point {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  id: string;
  tool: ToolType;
  color: string;
  width: number;
  points: Point[];
  opacity: number;
}

export interface TextBox {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
}
