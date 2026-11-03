// NecroCard stack data model types.
// This file contains type declarations only — no runtime code.

export interface Rect {
  x: number; // logical pixels, origin top-left of card; may be negative (partially off-card)
  y: number;
  w: number; // must be >= 0
  h: number; // must be >= 0
}

export interface ObjectBase {
  id: string;      // short URL-safe id, unique within the stack
  name: string;
  rect: Rect;
  visible: boolean;
  script: string;  // NecroTalk handler source, may be empty string
}

export interface ButtonObject extends ObjectBase {
  type: 'button';
  style: 'rect' | 'roundRect' | 'transparent';
  label: string;
  autoHilite: boolean;
}

export interface FieldObject extends ObjectBase {
  type: 'field';
  text: string;
  lockText: boolean;
  style: 'rect' | 'scrolling' | 'transparent';
}

export interface ImageObject extends ObjectBase {
  type: 'image';
  src: string; // data URL or asset id string
}

export type CardObject = ButtonObject | FieldObject | ImageObject;

export interface Background {
  id: string;
  name: string;
  objects: CardObject[];
  script: string;
}

export interface Card {
  id: string;
  name: string;
  backgroundId: string; // references a Background.id in the same Stack
  objects: CardObject[];
  script: string;
}

export interface StackMetadata {
  created: string;  // ISO 8601 date-time string (e.g. "2026-11-03T14:00:00.000Z")
  modified: string; // ISO 8601 date-time string
  author: string;   // free text, may be empty string
}

export interface Stack {
  id: string;
  name: string;
  backgrounds: Background[];
  cards: Card[];
  script: string; // stack-level NecroTalk handler source, may be empty string
  metadata: StackMetadata;
}
