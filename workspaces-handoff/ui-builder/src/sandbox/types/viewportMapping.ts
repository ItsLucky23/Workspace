export enum Viewports {
  LAPTOP = "Laptop",
  TABLET = "Tablet",
  PHONE = "Phone",
  NONE = "None",
}

export const viewportMapping = {
  [Viewports.LAPTOP]: { width: 1440, height: 900 },
  [Viewports.TABLET]: { width: 768, height: 1024 },
  [Viewports.PHONE]: { width: 375, height: 667 },
  [Viewports.NONE]: { width: 0, height: 0 },
};