export type LspNavigator = {
  openFile: (path: string, line: number, column?: number) => void;
};

let current: LspNavigator | null = null;

export function setLspNavigator(nav: LspNavigator | null): void {
  current = nav;
}

export function getLspNavigator(): LspNavigator | null {
  return current;
}
