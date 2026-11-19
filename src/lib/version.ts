import packageJson from "../../package.json";

/** «vX.Y.Z - commit», o solo la versión si el build no supo su commit. */
export const VERSION = [`v${packageJson.version}`, process.env.COMMIT_DEL_BUILD].filter(Boolean).join(" - ");
