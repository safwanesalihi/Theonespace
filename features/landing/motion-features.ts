// motion's heavy half for the landing, in its own chunk loaded after the first screen: the features
// LazyMotion hands to the `m` components (animations, gestures, drag; landing.tsx) and the animation
// engine the page's few scripted animations call (ui.tsx). Imported only dynamically, never statically.
import { animate, domMax } from "motion/react";

export { animate };
export default domMax;
