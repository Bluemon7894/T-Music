// The app's own window. There is more than one window now (the quick menu has its own), so code that
// used to take "the first window" asks for this one by name.
let win = null;
export const setMainWindow = (w) => { win = w; };
export const mainWindow = () => (win && !win.isDestroyed() ? win : null);
