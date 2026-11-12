export type PreviewThemeKind = 'dark' | 'light' | 'high-contrast';

type Palette = Record<string, string>;

const FONT: Palette = {
  '--vscode-font-family': "'Segoe UI', system-ui, -apple-system, sans-serif",
  '--vscode-font-size': '13px',
  '--vscode-editor-font-family': "Menlo, Monaco, 'Courier New', monospace",
  '--vscode-editor-font-size': '12px',
};

const DARK: Palette = {
  '--vscode-foreground': '#cccccc',
  '--vscode-descriptionForeground': '#9d9d9d',
  '--vscode-editor-background': '#1f1f1f',
  '--vscode-editor-foreground': '#cccccc',
  '--vscode-editorLineNumber-foreground': '#6e7681',
  '--vscode-editor-selectionBackground': '#264f78',
  '--vscode-editorWidget-background': '#202020',
  '--vscode-editorWidget-foreground': '#cccccc',
  '--vscode-editorWidget-border': '#454545',
  '--vscode-sideBar-background': '#181818',
  '--vscode-sideBar-foreground': '#cccccc',
  '--vscode-sideBar-border': '#2b2b2b',
  '--vscode-activityBar-background': '#181818',
  '--vscode-activityBar-foreground': '#d7d7d7',
  '--vscode-activityBar-inactiveForeground': '#868686',
  '--vscode-activityBar-activeBorder': '#0078d4',
  '--vscode-titleBar-activeBackground': '#181818',
  '--vscode-titleBar-activeForeground': '#cccccc',
  '--vscode-titleBar-border': '#2b2b2b',
  '--vscode-statusBar-background': '#181818',
  '--vscode-statusBar-foreground': '#cccccc',
  '--vscode-statusBar-border': '#2b2b2b',
  '--vscode-panel-border': '#2b2b2b',
  '--vscode-editorGroup-border': '#2b2b2b',
  '--vscode-editorGroupHeader-tabsBackground': '#181818',
  '--vscode-tab-activeBackground': '#1f1f1f',
  '--vscode-tab-activeForeground': '#ffffff',
  '--vscode-tab-inactiveBackground': '#181818',
  '--vscode-tab-inactiveForeground': '#9d9d9d',
  '--vscode-tab-border': '#2b2b2b',
  '--vscode-textLink-foreground': '#4daafc',
  '--vscode-focusBorder': '#0078d4',
  '--vscode-input-background': '#313131',
  '--vscode-input-foreground': '#cccccc',
  '--vscode-input-border': '#3c3c3c',
  '--vscode-input-placeholderForeground': '#989898',
  '--vscode-inputOption-activeBackground': 'rgba(36, 137, 219, 0.51)',
  '--vscode-button-background': '#0078d4',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-hoverBackground': '#026ec1',
  '--vscode-menu-background': '#1f1f1f',
  '--vscode-menu-foreground': '#cccccc',
  '--vscode-menu-border': '#454545',
  '--vscode-menu-selectionBackground': '#0078d4',
  '--vscode-menu-selectionForeground': '#ffffff',
  '--vscode-list-hoverBackground': '#2a2d2e',
  '--vscode-list-activeSelectionBackground': '#04395e',
  '--vscode-list-activeSelectionForeground': '#ffffff',
  '--vscode-notifications-background': '#1f1f1f',
  '--vscode-notifications-foreground': '#cccccc',
  '--vscode-notifications-border': '#454545',
  '--vscode-widget-shadow': 'rgba(0, 0, 0, 0.36)',
  '--vscode-scrollbarSlider-background': 'rgba(121, 121, 121, 0.4)',
  '--vscode-scrollbarSlider-hoverBackground': 'rgba(100, 100, 100, 0.7)',
  '--vscode-charts-blue': '#3794ff',
  '--vscode-charts-green': '#89d185',
  '--vscode-charts-purple': '#b180d7',
  '--vscode-editorWarning-foreground': '#cca700',
  '--vscode-editorError-foreground': '#f14c4c',
  '--vscode-testing-iconPassed': '#73c991',
};

const LIGHT: Palette = {
  '--vscode-foreground': '#3b3b3b',
  '--vscode-descriptionForeground': '#717171',
  '--vscode-editor-background': '#ffffff',
  '--vscode-editor-foreground': '#3b3b3b',
  '--vscode-editorLineNumber-foreground': '#6e7681',
  '--vscode-editor-selectionBackground': '#add6ff',
  '--vscode-editorWidget-background': '#f8f8f8',
  '--vscode-editorWidget-foreground': '#3b3b3b',
  '--vscode-editorWidget-border': '#c8c8c8',
  '--vscode-sideBar-background': '#f8f8f8',
  '--vscode-sideBar-foreground': '#3b3b3b',
  '--vscode-sideBar-border': '#e5e5e5',
  '--vscode-activityBar-background': '#f8f8f8',
  '--vscode-activityBar-foreground': '#1f1f1f',
  '--vscode-activityBar-inactiveForeground': '#616161',
  '--vscode-activityBar-activeBorder': '#005fb8',
  '--vscode-titleBar-activeBackground': '#f8f8f8',
  '--vscode-titleBar-activeForeground': '#1f1f1f',
  '--vscode-titleBar-border': '#e5e5e5',
  '--vscode-statusBar-background': '#f8f8f8',
  '--vscode-statusBar-foreground': '#3b3b3b',
  '--vscode-statusBar-border': '#e5e5e5',
  '--vscode-panel-border': '#e5e5e5',
  '--vscode-editorGroup-border': '#e5e5e5',
  '--vscode-editorGroupHeader-tabsBackground': '#f8f8f8',
  '--vscode-tab-activeBackground': '#ffffff',
  '--vscode-tab-activeForeground': '#3b3b3b',
  '--vscode-tab-inactiveBackground': '#f8f8f8',
  '--vscode-tab-inactiveForeground': '#717171',
  '--vscode-tab-border': '#e5e5e5',
  '--vscode-textLink-foreground': '#005fb8',
  '--vscode-focusBorder': '#005fb8',
  '--vscode-input-background': '#ffffff',
  '--vscode-input-foreground': '#3b3b3b',
  '--vscode-input-border': '#cecece',
  '--vscode-input-placeholderForeground': '#767676',
  '--vscode-inputOption-activeBackground': 'rgba(0, 95, 184, 0.24)',
  '--vscode-button-background': '#005fb8',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-hoverBackground': '#0258a8',
  '--vscode-menu-background': '#ffffff',
  '--vscode-menu-foreground': '#3b3b3b',
  '--vscode-menu-border': '#cecece',
  '--vscode-menu-selectionBackground': '#005fb8',
  '--vscode-menu-selectionForeground': '#ffffff',
  '--vscode-list-hoverBackground': '#f2f2f2',
  '--vscode-list-activeSelectionBackground': '#e8e8e8',
  '--vscode-list-activeSelectionForeground': '#000000',
  '--vscode-notifications-background': '#ffffff',
  '--vscode-notifications-foreground': '#3b3b3b',
  '--vscode-notifications-border': '#cecece',
  '--vscode-widget-shadow': 'rgba(0, 0, 0, 0.16)',
  '--vscode-scrollbarSlider-background': 'rgba(100, 100, 100, 0.4)',
  '--vscode-scrollbarSlider-hoverBackground': 'rgba(100, 100, 100, 0.7)',
  '--vscode-charts-blue': '#0066bf',
  '--vscode-charts-green': '#388a34',
  '--vscode-charts-purple': '#652d90',
  '--vscode-editorWarning-foreground': '#bf8803',
  '--vscode-editorError-foreground': '#e51400',
  '--vscode-testing-iconPassed': '#388a34',
};

const HIGH_CONTRAST: Palette = {
  '--vscode-foreground': '#ffffff',
  '--vscode-descriptionForeground': '#ffffff',
  '--vscode-editor-background': '#000000',
  '--vscode-editor-foreground': '#ffffff',
  '--vscode-editorLineNumber-foreground': '#ffffff',
  '--vscode-editor-selectionBackground': '#0f4a85',
  '--vscode-editorWidget-background': '#000000',
  '--vscode-editorWidget-foreground': '#ffffff',
  '--vscode-editorWidget-border': '#6fc3df',
  '--vscode-sideBar-background': '#000000',
  '--vscode-sideBar-foreground': '#ffffff',
  '--vscode-sideBar-border': '#6fc3df',
  '--vscode-activityBar-background': '#000000',
  '--vscode-activityBar-foreground': '#ffffff',
  '--vscode-activityBar-inactiveForeground': '#ffffff',
  '--vscode-activityBar-activeBorder': '#ffffff',
  '--vscode-titleBar-activeBackground': '#000000',
  '--vscode-titleBar-activeForeground': '#ffffff',
  '--vscode-titleBar-border': '#6fc3df',
  '--vscode-statusBar-background': '#000000',
  '--vscode-statusBar-foreground': '#ffffff',
  '--vscode-statusBar-border': '#6fc3df',
  '--vscode-panel-border': '#6fc3df',
  '--vscode-editorGroup-border': '#6fc3df',
  '--vscode-editorGroupHeader-tabsBackground': '#000000',
  '--vscode-tab-activeBackground': '#000000',
  '--vscode-tab-activeForeground': '#ffffff',
  '--vscode-tab-inactiveBackground': '#000000',
  '--vscode-tab-inactiveForeground': '#ffffff',
  '--vscode-tab-border': '#6fc3df',
  '--vscode-textLink-foreground': '#3794ff',
  '--vscode-focusBorder': '#f38518',
  '--vscode-contrastBorder': '#6fc3df',
  '--vscode-contrastActiveBorder': '#f38518',
  '--vscode-input-background': '#000000',
  '--vscode-input-foreground': '#ffffff',
  '--vscode-input-border': '#6fc3df',
  '--vscode-input-placeholderForeground': '#ffffff',
  '--vscode-inputOption-activeBackground': '#0f4a85',
  '--vscode-button-background': '#000000',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-hoverBackground': '#0f4a85',
  '--vscode-menu-background': '#000000',
  '--vscode-menu-foreground': '#ffffff',
  '--vscode-menu-border': '#6fc3df',
  '--vscode-menu-selectionBackground': '#0f4a85',
  '--vscode-menu-selectionForeground': '#ffffff',
  '--vscode-list-hoverBackground': '#1a1a1a',
  '--vscode-list-activeSelectionBackground': '#0f4a85',
  '--vscode-list-activeSelectionForeground': '#ffffff',
  '--vscode-notifications-background': '#000000',
  '--vscode-notifications-foreground': '#ffffff',
  '--vscode-notifications-border': '#6fc3df',
  '--vscode-widget-shadow': 'transparent',
  '--vscode-scrollbarSlider-background': 'rgba(111, 195, 223, 0.4)',
  '--vscode-scrollbarSlider-hoverBackground': 'rgba(111, 195, 223, 0.8)',
  '--vscode-charts-blue': '#3794ff',
  '--vscode-charts-green': '#3ff23f',
  '--vscode-charts-purple': '#d670d6',
  '--vscode-editorWarning-foreground': '#ffd700',
  '--vscode-editorError-foreground': '#ff0000',
  '--vscode-testing-iconPassed': '#3ff23f',
};

const PALETTES: Record<PreviewThemeKind, Palette> = {
  dark: DARK,
  light: LIGHT,
  'high-contrast': HIGH_CONTRAST,
};

const ORDER: PreviewThemeKind[] = ['dark', 'light', 'high-contrast'];

export const THEME_LABELS: Record<PreviewThemeKind, string> = {
  dark: 'Dark Modern',
  light: 'Light Modern',
  'high-contrast': 'High Contrast',
};

let current: PreviewThemeKind = 'dark';

export function currentPreviewTheme(): PreviewThemeKind {
  return current;
}

export function nextPreviewTheme(): PreviewThemeKind {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}

/**
 * 把内置主题写进文档根部的 --vscode-* 变量，让 Webview 在浏览器预览时
 * 和真实 VS Code 使用同一套颜色来源。
 */
export function setPreviewTheme(kind: PreviewThemeKind): void {
  current = kind;
  if (typeof document !== 'undefined') {
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries({ ...FONT, ...PALETTES[kind] })) {
      style.setProperty(name, value);
    }
    const { body } = document;
    body.dataset.vsTheme = kind;
    for (const name of ['vscode-light', 'vscode-dark', 'vscode-high-contrast']) {
      body.classList.toggle(name, name === `vscode-${kind}`);
    }
  }
}
