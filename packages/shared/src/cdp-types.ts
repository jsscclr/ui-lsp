/** Raw CDP DOM.BoxModel shape returned by DOM.getBoxModel. */
export interface CDPBoxModel {
  content: number[];
  padding: number[];
  border: number[];
  margin: number[];
  width: number;
  height: number;
}

export interface CDPComputedStyleProperty {
  name: string;
  value: string;
}

export interface CDPRemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  objectId?: string;
  description?: string;
}

export interface CDPNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName: string;
  nodeValue: string;
  childNodeCount?: number;
  children?: CDPNode[];
  attributes?: string[];
}
